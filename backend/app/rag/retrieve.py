"""Hybrid retrieval inside the caller's RLS-scoped transaction.

Both legs run as rag_reader under the signed context, so unauthorised chunks are removed inside
the index scans themselves (hnsw.iterative_scan keeps the vector leg from coming back short)."""

import re

from psycopg import AsyncConnection

from ..ai.embeddings import literal
from ..ingest.blocks import looks_injected

STOP = set(
    "a an the is are was were be been of for to in on at by with and or not no what who whom whose which how when where "
    "why do does did i me my mine our we you your it its this that these those there their them they please tell give "
    "show list about from can could would should much many any all some get got has have had will shall may might "
    "than then into per each every also just only need needed want know sit find explain describe".split()
)
_TOKEN = re.compile(r"[a-z0-9]+")
RRF_K = 60
VEC_K = 40
LEX_K = 40


def terms(text: str) -> list[str]:
    seen, out = set(), []
    for t in _TOKEN.findall(text.lower()):
        if len(t) > 1 and t not in STOP and t not in seen:
            seen.add(t)
            out.append(t)
    return out[:24]


def _norm(t: str) -> str:
    if len(t) > 4 and t.endswith("ies"):
        return t[:-3] + "y"
    if len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
        return t[:-1]
    return t


def key_terms(qterms: list[str]) -> list[str]:
    """Terms that carry meaning for relevance: no bare numbers or years."""
    return [t for t in qterms if not t.isdigit()]


def coverage(qterms: list[str], text: str) -> float:
    qt = key_terms(qterms)
    if not qt:
        return 0.0
    hay = {_norm(h) for h in _TOKEN.findall(text.lower())}
    stems = {h[:4] for h in hay if len(h) >= 4}
    hit = sum(1 for t in map(_norm, qt) if t in hay or (len(t) >= 4 and t[:4] in stems))
    return hit / len(qt)


async def _ranked(conn: AsyncConnection, question: str, qvec: list[float] | None) -> tuple[dict, dict]:
    vec: dict[str, tuple[int, float]] = {}
    if qvec is not None:
        lit = literal(qvec)
        rows = await (await conn.execute(
            "SELECT id, 1 - (embedding <=> %s::vector) AS sim FROM chunks"
            " WHERE embedding IS NOT NULL ORDER BY embedding <=> %s::vector LIMIT %s",
            (lit, lit, VEC_K))).fetchall()
        vec = {str(r["id"]): (i, float(r["sim"])) for i, r in enumerate(rows)}
    lex: dict[str, tuple[int, float]] = {}
    qt = terms(question)
    if qt:
        rows = await (await conn.execute(
            "SELECT c.id, ts_rank_cd(c.content_tsv, q, 32) AS lex FROM chunks c, to_tsquery('english', %s) q"
            " WHERE c.content_tsv @@ q ORDER BY lex DESC LIMIT %s",
            (" | ".join(qt), LEX_K))).fetchall()
        lex = {str(r["id"]): (i, float(r["lex"])) for i, r in enumerate(rows)}
    return vec, lex


async def hybrid(conn: AsyncConnection, question: str, qvec: list[float] | None, top: int = 12) -> dict:
    vec, lex = await _ranked(conn, question, qvec)
    rrf: dict[str, float] = {}
    for ranks in (vec, lex):
        for cid, (rank, _) in ranks.items():
            rrf[cid] = rrf.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
    ids = sorted(rrf, key=rrf.get, reverse=True)[:top]
    if not ids:
        return {"candidates": [], "visible": 0, "vector": len(vec), "lexical": len(lex)}

    rows = await (await conn.execute(
        "SELECT c.id, c.document_id, c.ord, c.modality, c.content, c.page, c.bbox, c.row_ref, c.meta,"
        "       d.title, d.source_type, d.classification, d.department, d.allowed_roles, d.created_at,"
        "       d.meta AS doc_meta, d.mime_type"
        "  FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id = ANY(%s::uuid[])",
        (ids,))).fetchall()
    qt = terms(question)
    max_rrf = max(rrf[i] for i in ids)
    cands = []
    for r in rows:
        cid = str(r["id"])
        sim = vec.get(cid, (None, 0.0))[1]
        cov = 0.75 * coverage(qt, r["content"]) + 0.25 * coverage(qt, f"{r['title']} {r['content']}")
        short = len(r["content"].split()) < 10 and r["modality"] in ("text", "ocr")
        r["features"] = {"sim": round(sim, 4), "coverage": round(cov, 3), "rrf": round(rrf[cid], 5),
                         "vec_rank": vec.get(cid, (None,))[0], "lex_rank": lex.get(cid, (None,))[0]}
        r["score"] = round((0.55 * max(sim, 0) + 0.30 * cov + 0.15 * rrf[cid] / max_rrf) * (0.6 if short else 1.0), 4)
        r["injection"] = bool((r["meta"] or {}).get("injection")) or looks_injected(r["content"])
        cands.append(r)
    cands.sort(key=lambda r: r["score"], reverse=True)
    return {"candidates": cands, "visible": len(set(vec) | set(lex)), "vector": len(vec), "lexical": len(lex)}


def relevant(c: dict, qterms_n: int, semantic: bool) -> bool:
    """Gate before generation. With real embeddings a strong similarity can carry a paraphrase;
    with the offline hash embedding only lexical coverage is trusted."""
    f = c["features"]
    if semantic and f["sim"] >= 0.70:
        return True
    if qterms_n == 0:
        return False
    return f["coverage"] >= 0.5 or (semantic and f["sim"] >= 0.60 and f["coverage"] >= 0.25)
