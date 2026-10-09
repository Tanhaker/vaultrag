"""Citation targets. Access is re-checked by RLS on every open, so a copied link to a chunk the
caller cannot read returns 404, exactly as if it never existed."""

import base64
import uuid

from fastapi import APIRouter, HTTPException

from ..db import secure_session
from ..deps import CurrentUser
from ..rag.answer import chunk_view, doc_view

router = APIRouter(tags=["source"])


@router.get("/source/{chunk_id}")
async def source(chunk_id: str, user: CurrentUser) -> dict:
    try:
        cid = uuid.UUID(chunk_id)
    except ValueError:
        raise HTTPException(404)
    async with secure_session(user, read_only=False) as conn:
        row = await (await conn.execute(
            "SELECT c.id, c.document_id, c.ord, c.modality, c.content, c.page, c.bbox, c.row_ref, c.meta,"
            "       d.title, d.source_type, d.classification, d.department, d.allowed_roles, d.created_at, d.meta AS doc_meta"
            "  FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id = %s", (cid,))).fetchone()
        action = "source_view" if row else "denied_source"
        await conn.execute(
            "INSERT INTO audit_log (tenant_id, user_id, action, query) VALUES (%s, %s, %s, %s)",
            (user.tid, user.uid, action, f"GET /source/{chunk_id}"))
        if not row:
            raise HTTPException(404, "Not found")
        blocks = await (await conn.execute(
            "SELECT id, document_id, modality, content, page, bbox, row_ref, meta FROM chunks"
            " WHERE document_id = %s AND page IS NOT DISTINCT FROM %s ORDER BY ord",
            (row["document_id"], row["page"]))).fetchall()
        blob = await (await conn.execute(
            "SELECT mime, width, height, data FROM document_blobs WHERE document_id = %s", (row["document_id"],))).fetchone()
    return {
        "chunk": chunk_view(row),
        "doc": doc_view(row),
        "blocks": [chunk_view(b | {"title": row["title"]}) for b in blocks],
        "image": {"src": f"data:{blob['mime']};base64,{base64.b64encode(blob['data']).decode()}",
                  "width": blob["width"], "height": blob["height"]} if blob else None,
    }
