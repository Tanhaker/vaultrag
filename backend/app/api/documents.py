"""Knowledge base: list (RLS-scoped), ingest, ACL edits (admin), audit log, evaluation results."""

import json
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb

from ..config import get_settings
from ..db import secure_session, writer_session
from ..deps import CurrentUser
from ..ingest.pipeline import IngestError, ingest_file
from ..rag import answer
from ..ai.gemini import LLMUnavailable

router = APIRouter(tags=["knowledge"])
KNOWN_ROLES = {"*", "student", "faculty", "hod", "finance", "hr", "admin"}
DEPARTMENTS = {"CSE", "MECH", "CIVIL", "EC"}
ROOT = Path(__file__).resolve().parents[2]


def _doc(r: dict) -> dict:
    meta = r.get("meta") or {}
    return {
        "id": str(r["id"]), "title": r["title"], "sourceType": r["source_type"], "classification": r["classification"],
        "department": r["department"], "allowedRoles": r["allowed_roles"],
        "allowedUsers": [str(u) for u in (r.get("allowed_users") or [])], "owner": meta.get("owner", ""),
        "uploadedAt": r["created_at"].date().isoformat(),
        "pages": meta.get("pages"), "size": f"{meta['size_kb']} KB" if meta.get("size_kb") else f"{r.get('chunks', 0)} chunks",
        "status": r["status"], "flags": meta.get("flags", []), "summary": meta.get("summary", ""),
        "chunks": r.get("chunks", 0),
    }


@router.get("/documents")
async def documents(user: CurrentUser) -> dict:
    async with secure_session(user) as conn:
        rows = await (await conn.execute(
            "SELECT d.id, d.title, d.source_type, d.classification, d.department, d.allowed_roles, d.allowed_users,"
            "       d.status, d.meta, d.created_at, (SELECT count(*) FROM chunks c WHERE c.document_id = d.id) AS chunks"
            "  FROM documents d WHERE d.source_type <> 'db_record' ORDER BY d.created_at DESC")).fetchall()
        groups = await (await conn.execute(
            "SELECT split_part(title, ' · ', 1) AS relation, count(*) AS rows, min(classification) AS min_cls,"
            "       max(classification) AS max_cls FROM documents WHERE source_type = 'db_record' GROUP BY 1 ORDER BY 1")).fetchall()
    return {"documents": [_doc(r) for r in rows], "records": groups}


@router.post("/ingest", status_code=status.HTTP_201_CREATED)
async def ingest(
    user: CurrentUser,
    file: UploadFile = File(...),
    classification: int = Form(1),
    department: str = Form(""),
    allowed_roles: str = Form("faculty,hod"),
) -> dict:
    if "student" in user.roles and len(user.roles) == 1:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Students cannot add documents to the knowledge base.")
    roles = sorted({r.strip() for r in allowed_roles.split(",") if r.strip()})
    if not roles or not set(roles) <= KNOWN_ROLES:
        raise HTTPException(422, "allowed_roles must be a comma-separated list of known roles")
    if not 0 <= classification <= 3:
        raise HTTPException(422, "classification must be 0-3")
    dept = department.strip().upper() or None
    if dept and dept not in DEPARTMENTS:
        raise HTTPException(422, "unknown department")
    data = await file.read()
    if len(data) > get_settings().max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File larger than {get_settings().max_upload_mb} MB")
    try:
        result = await ingest_file(
            tenant=user.tid, filename=file.filename or "upload", data=data, mime=file.content_type or "",
            classification=classification, department=dept, allowed_roles=roles, owner_id=user.uid,
        )
    except IngestError as e:
        raise HTTPException(422, str(e))
    except LLMUnavailable as e:
        raise HTTPException(503, f"Embedding/OCR provider unavailable: {e}")
    answer._cache.clear()
    async with secure_session(user, read_only=False) as conn:
        await conn.execute("INSERT INTO audit_log (tenant_id, user_id, action, query, meta) VALUES (%s, %s, 'upload', %s, %s)",
                           (user.tid, user.uid, f"{result['title']} · L{classification} · {','.join(roles)}",
                            Jsonb({"document_id": result["id"], "chunks": result["chunks"]})))
    return result


class AclIn(BaseModel):
    classification: int = Field(ge=0, le=3)
    department: str | None = None
    allowedRoles: list[str]


@router.patch("/documents/{doc_id}/acl")
async def update_acl(doc_id: UUID, body: AclIn, user: CurrentUser) -> dict:
    if "admin" not in user.roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only administrators can change access rules.")
    if not body.allowedRoles or not set(body.allowedRoles) <= KNOWN_ROLES:
        raise HTTPException(422, "unknown role")
    dept = (body.department or "").upper() or None
    async with writer_session() as conn:
        row = await (await conn.execute(
            "UPDATE documents SET classification = %s, department = %s, allowed_roles = %s"
            " WHERE id = %s AND tenant_id = %s RETURNING id, title",
            (body.classification, dept, sorted(set(body.allowedRoles)), doc_id, user.tid))).fetchone()
        if not row:
            raise HTTPException(404)
        chunks = (await (await conn.execute("SELECT count(*) AS n FROM chunks WHERE document_id = %s", (doc_id,))).fetchone())["n"]
    answer._cache.clear()
    async with secure_session(user, read_only=False) as conn:
        await conn.execute("INSERT INTO audit_log (tenant_id, user_id, action, query) VALUES (%s, %s, 'acl_change', %s)",
                           (user.tid, user.uid, f"{row['title']} → L{body.classification} · {','.join(body.allowedRoles)}"))
    return {"id": str(row["id"]), "title": row["title"], "chunksUpdated": chunks}


@router.get("/audit")
async def audit(user: CurrentUser, limit: int = 100) -> list[dict]:
    """RLS on audit_log: users see their own entries, admins see the tenant's."""
    async with secure_session(user) as conn:
        rows = await (await conn.execute(
            "SELECT id, created_at, user_id, action, query, cardinality(retrieved_chunk_ids) AS chunks, meta, latency_ms"
            "  FROM audit_log ORDER BY created_at DESC LIMIT %s", (min(limit, 300),))).fetchall()
    names = {str(user.uid): (user.name, user.email)}
    others = {r["user_id"] for r in rows} - {user.uid}
    if others and "admin" in user.roles:
        async with writer_session() as conn:
            for r in await (await conn.execute("SELECT id, name, email FROM users WHERE id = ANY(%s)", (list(others),))).fetchall():
                names[str(r["id"])] = (r["name"], r["email"])
    return [{
        "id": str(r["id"]), "at": r["created_at"].isoformat()[:19],
        "userEmail": names.get(str(r["user_id"]), ("—", ""))[1], "userName": names.get(str(r["user_id"]), ("—", ""))[0],
        "action": r["action"], "detail": r["query"] or "", "chunks": r["chunks"],
        "filtered": (r["meta"] or {}).get("filtered", 0), "latencyMs": r["latency_ms"],
    } for r in rows]


@router.get("/eval/latest")
async def eval_latest(user: CurrentUser) -> dict:
    out = {}
    for name, path in {"recall": ROOT / "bench/results/recall.json", "redteam": ROOT / "eval/results/redteam.json",
                       "tests": ROOT / "eval/results/pytest.json"}.items():
        if path.exists():
            out[name] = json.loads(path.read_text(encoding="utf-8"))
    return out
