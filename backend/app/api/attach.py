"""Chat attachments: any signed-in user can add a PDF or image that only they can read.

The file is ingested like any document (text, tables, OCR with boxes, embeddings) but its ACL names the
owner as the only reader and grants no role. Retrieval still runs as rag_reader under RLS, so the
privacy comes from the same database rule as everything else. The duplicate check is scoped to the
owner, so attaching a copy of someone else's document never reveals that it exists. The owner's
cached answers stay valid for questions asked before: the cache key includes a fingerprint of their
private files (rag.guard.preflight), so new questions see the new file."""

from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from psycopg.types.json import Jsonb

from ..ai.gemini import LLMUnavailable
from ..config import get_settings
from ..db import secure_session, writer_session
from ..deps import CurrentUser
from ..ingest.pipeline import IngestError, ingest_file

router = APIRouter(prefix="/chat", tags=["chat"])

ALLOWED = (".pdf", ".png", ".jpg", ".jpeg", ".webp")


@router.post("/attach", status_code=status.HTTP_201_CREATED)
async def attach(user: CurrentUser, file: UploadFile = File(...)) -> dict:
    name = (file.filename or "upload").strip()
    if not name.lower().endswith(ALLOWED):
        raise HTTPException(422, "Attach a PDF or an image (PNG, JPG or WEBP).")
    data = await file.read()
    if len(data) > get_settings().max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File larger than {get_settings().max_upload_mb} MB")
    async with secure_session(user) as conn:
        n = (await (await conn.execute(
            "SELECT count(*) AS n FROM audit_log WHERE user_id = %s AND action = 'attach'"
            "   AND created_at > now() - interval '1 hour'", (user.uid,))).fetchone())["n"]
    limit = get_settings().attach_per_hour
    if n >= limit:
        raise HTTPException(429, f"You can attach {limit} files an hour. Try again later.")
    try:
        result = await ingest_file(
            tenant=user.tid, filename=name, data=data, mime=file.content_type or "", classification=0,
            department=None, allowed_roles=[], allowed_users=[user.uid], owner_id=user.uid,
            dedupe_scope=f"private:{user.uid}",
        )
    except IngestError as e:
        raise HTTPException(422, str(e))
    except LLMUnavailable as e:
        raise HTTPException(503, f"Reading the file needs the AI service, which is busy right now ({e}). Try again in a minute.")
    async with secure_session(user, read_only=False) as conn:
        await conn.execute("INSERT INTO audit_log (tenant_id, user_id, action, query, meta) VALUES (%s, %s, 'attach', %s, %s)",
                           (user.tid, user.uid, f"{result['title']} · private", Jsonb({"document_id": result["id"], "chunks": result["chunks"]})))
    return {**result, "private": True, "readers": "only you"}


@router.delete("/attach/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def detach(doc_id: UUID, user: CurrentUser) -> None:
    async with writer_session() as conn:
        row = await (await conn.execute(
            "DELETE FROM documents WHERE id = %s AND tenant_id = %s AND owner_id = %s"
            "   AND allowed_roles = '{}' AND allowed_users = ARRAY[%s]::uuid[] RETURNING id",
            (doc_id, user.tid, user.uid, user.uid))).fetchone()
    if not row:
        raise HTTPException(404)  # same answer whether it never existed or is someone else's
