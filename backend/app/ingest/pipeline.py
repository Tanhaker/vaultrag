"""Ingestion: extract -> chunk -> scan for injection -> embed -> store with the document's ACL.
Chunks never carry their own ACL from here; the chunks_inherit_acl trigger copies it."""

import hashlib
import json
import time
import uuid
from uuid import UUID

from psycopg.types.json import Jsonb

from ..ai import embeddings
from ..db import writer_session
from . import records
from .blocks import Block, chunk_blocks, looks_injected
from .ocr import ocr_image, preview
from .pdf import extract_pdf

IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp"}


class IngestError(Exception):
    pass


def _source_type(filename: str, mime: str) -> str:
    if mime == "application/pdf" or filename.lower().endswith(".pdf"):
        return "pdf"
    if mime in IMAGE_MIMES or filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        return "image"
    raise IngestError("Only PDF, PNG, JPEG and WEBP files are supported.")


async def _insert_chunks(conn, doc_id: UUID, chunks: list[Block], vectors: list[list[float]], title: str) -> None:
    tag = embeddings.model_tag()
    rows = []
    for i, (c, v) in enumerate(zip(chunks, vectors)):
        meta = {"emb": tag, "title": title} | ({"conf": c.conf} if c.conf is not None else {}) | c.meta
        if looks_injected(c.text):
            meta["injection"] = True
        rows.append((uuid.uuid4(), doc_id, i, c.modality, c.text, embeddings.literal(v), c.page,
                     Jsonb(c.bbox) if c.bbox else None, c.meta.get("row_ref"), Jsonb(meta)))
    async with conn.cursor() as cur:
        await cur.executemany(
            "INSERT INTO chunks (id, document_id, ord, modality, content, embedding, page, bbox, row_ref, meta,"
            "                    tenant_id, classification, allowed_roles, allowed_users)"
            " VALUES (%s, %s, %s, %s, %s, %s::vector, %s, %s, %s, %s, '00000000-0000-0000-0000-000000000000', 0, '{}', '{}')",
            rows,
        )


async def ingest_file(*, tenant: UUID, filename: str, data: bytes, mime: str, classification: int,
                      department: str | None, allowed_roles: list[str], allowed_users: list[UUID] | None = None,
                      owner_id: UUID | None = None, title: str | None = None) -> dict:
    steps: list[dict] = []
    t0 = time.perf_counter()

    def step(key: str, label: str, detail: str) -> None:
        nonlocal t0
        steps.append({"key": key, "label": label, "detail": detail, "ms": round((time.perf_counter() - t0) * 1000)})
        t0 = time.perf_counter()

    source_type = _source_type(filename, mime)
    sha = hashlib.sha256(data).hexdigest()
    title = title or filename
    async with writer_session() as conn:
        dup = await (await conn.execute(
            "SELECT id, title FROM documents WHERE tenant_id = %s AND sha256 = %s", (tenant, sha))).fetchone()
    step("dedupe", "Upload & sha256 dedupe", f"{len(data) // 1024} KB · {sha[:12]}")
    if dup:
        return {"id": str(dup["id"]), "title": dup["title"], "duplicate": True, "chunks": 0, "steps": steps}

    meta: dict = {"size_kb": max(1, len(data) // 1024)}
    blob = None
    if source_type == "pdf":
        blocks, info = await extract_pdf(data)
        meta |= info
        step("extract", "Extract text, tables, OCR", f"{info['pages']} pages · {info['tables']} tables · {info['ocr_pages']} OCR")
    else:
        blocks, caption, engine = await ocr_image(data)
        meta |= {"ocr_engine": engine}
        if caption:
            blocks.append(Block(f"Vision caption: {caption}", None, None, "caption"))
        jpg, w, h = preview(data)
        blob = (jpg, w, h)
        step("extract", "OCR + vision caption", f"{engine} · {len(blocks)} regions" + (" · captioned" if caption else ""))

    chunks = chunk_blocks(blocks)
    if not chunks:
        raise IngestError("No text could be extracted from this file.")
    flags = sorted({"ocr"} if source_type == "image" or meta.get("ocr_pages") else set())
    if any(c.modality == "caption" for c in chunks):
        flags.append("caption")
    if any(looks_injected(c.text) for c in chunks):
        flags.append("prompt_injection")
    meta["flags"] = flags
    step("chunk", "Layout-aware chunking", f"{len(chunks)} chunks" + (" · injection flagged" if "prompt_injection" in flags else ""))

    vectors = await embeddings.embed_documents([f"{title}\n{c.text}" for c in chunks])
    meta["emb"] = embeddings.model_tag()
    step("embed", "Embed", f"{len(vectors)} × {len(vectors[0])}-d · {embeddings.provider()}")

    doc_id = uuid.uuid4()
    async with writer_session() as conn:
        await conn.execute(
            "INSERT INTO documents (id, tenant_id, title, source_type, mime_type, sha256, owner_id, department,"
            "                       classification, allowed_roles, allowed_users, status, meta)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'ready', %s)",
            (doc_id, tenant, title, source_type, mime, sha, owner_id, department, classification,
             allowed_roles, allowed_users or [], Jsonb(meta)),
        )
        await _insert_chunks(conn, doc_id, chunks, vectors, title)
        if blob:
            await conn.execute(
                "INSERT INTO document_blobs (document_id, tenant_id, mime, width, height, data) VALUES (%s, %s, 'image/jpeg', %s, %s, %s)",
                (doc_id, tenant, blob[1], blob[2], blob[0]),
            )
    step("index", "Index with inherited ACL", f"classification {classification} · roles {','.join(allowed_roles)}")
    return {"id": str(doc_id), "title": title, "duplicate": False, "chunks": len(chunks), "flags": flags, "steps": steps}


async def ingest_records(tenant: UUID) -> int:
    """Rebuild every record card for the tenant from the live tables."""
    async with writer_session() as conn:
        await conn.execute("DELETE FROM documents WHERE tenant_id = %s AND source_type = 'db_record'", (tenant,))
        cards = await records.build_cards(conn, tenant)
    vectors = await embeddings.embed_documents([f"{c['title']}\n{c['content']}" for c in cards])
    tag = embeddings.model_tag()
    async with writer_session() as conn:
        async with conn.cursor() as cur:
            doc_rows, chunk_rows = [], []
            for c, v in zip(cards, vectors):
                did = uuid.uuid4()
                doc_rows.append((did, tenant, c["title"], c["department"], c["classification"], c["allowed_roles"],
                                 c["allowed_users"], Jsonb({"row_ref": c["row_ref"], "emb": tag})))
                chunk_rows.append((uuid.uuid4(), did, c["content"], embeddings.literal(v), c["row_ref"],
                                   Jsonb({"record": c["record"], "emb": tag, "title": c["title"]})))
            await cur.executemany(
                "INSERT INTO documents (id, tenant_id, title, source_type, department, classification, allowed_roles,"
                "                       allowed_users, status, meta)"
                " VALUES (%s, %s, %s, 'db_record', %s, %s, %s, %s, 'ready', %s)", doc_rows)
            await cur.executemany(
                "INSERT INTO chunks (id, document_id, ord, modality, content, embedding, row_ref, meta,"
                "                    tenant_id, classification, allowed_roles, allowed_users)"
                " VALUES (%s, %s, 0, 'record', %s, %s::vector, %s, %s, '00000000-0000-0000-0000-000000000000', 0, '{}', '{}')",
                chunk_rows)
    return len(cards)


def dumps(o) -> str:
    return json.dumps(o, default=str)
