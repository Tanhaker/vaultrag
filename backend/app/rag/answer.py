"""Query orchestration. Output matches the frontend's Answer type."""

import datetime as dt
import decimal
import hashlib
import json
import re
import time
import uuid

from psycopg.types.json import Jsonb

from ..ai import embeddings, gemini, llm
from ..ai.embeddings import literal
from ..config import get_settings
from ..db import secure_session, writer_session
from ..models import UserCtx
from . import sql as sqlmod
from .retrieve import answerable, coverage, hybrid, relevant, terms
from .verify import verify

REFUSAL = llm.REFUSAL
_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9₹(])")
_cache: dict[str, tuple[float, dict]] = {}
CACHE_TTL = 600


_DEPTS = {"CSE": r"\bcse\b|computer science", "MECH": r"\bmech\b|mechanical", "CIVIL": r"\bcivil\b",
          "EC": r"\bec\b|electronics"}


def mentioned_departments(question: str) -> set[str]:
    q = question.lower()
    return {d for d, pat in _DEPTS.items() if re.search(pat, q)}


def fingerprint(user: UserCtx) -> str:
    raw = json.dumps([str(user.tid), str(user.uid), sorted(user.roles), sorted(user.depts), user.clearance])
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def jsonable(v):
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, dict):
        return {k: jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    return v


class Timer:
    def __init__(self):
        self.steps: list[dict] = []
        self.t = time.perf_counter()
        self.start = self.t

    def step(self, key: str, label: str, detail: str) -> None:
        now = time.perf_counter()
        self.steps.append({"key": key, "label": label, "detail": detail, "ms": max(1, round((now - self.t) * 1000))})
        self.t = now

    @property
    def total(self) -> int:
        return round((time.perf_counter() - self.start) * 1000)


def doc_view(r: dict) -> dict:
    meta = r.get("doc_meta") or {}
    size = f"{meta['size_kb']} KB" if meta.get("size_kb") else "1 row"
    return {
        "id": str(r["document_id"]), "title": r["title"], "sourceType": r["source_type"],
        "classification": r["classification"], "department": r["department"], "allowedRoles": r["allowed_roles"],
        "allowedUsers": [], "owner": "", "uploadedAt": r["created_at"].date().isoformat(), "size": size,
        "status": "ready", "flags": meta.get("flags", []), "summary": "", "pages": meta.get("pages"),
    }


def chunk_view(r: dict) -> dict:
    meta = r.get("meta") or {}
    return {
        "id": str(r["id"]), "docId": str(r["document_id"]), "modality": r["modality"], "page": r["page"],
        "bbox": r["bbox"], "rowRef": r["row_ref"], "content": r["content"], "tags": [], "claims": [],
        "record": meta.get("record"), "ocrConfidence": meta.get("conf"), "injection": r.get("injection", False),
    }


def _table_sentence(text: str) -> str:
    lines = [l.split(" | ") for l in text.splitlines() if " | " in l]
    if len(lines) < 2:
        return text
    head, body = lines[0], lines[1:]
    unit = f" ({head[1]})" if len(head) > 1 else ""
    return "; ".join(f"{r[0]}: {r[1]}" for r in body if len(r) > 1) + (f"{unit}." if unit else ".")


def extractive(question: str, usable: list[dict]) -> list[dict]:
    """No-LLM composer: the best-matching sentences, verbatim, each cited to its chunk."""
    qt = terms(question)
    out: list[dict] = []
    top = usable[0]["score"] if usable else 0
    for i, c in enumerate(usable[:3]):
        if i and c["score"] < 0.8 * top:
            continue  # only chunks nearly as relevant as the best one contribute
        text = _table_sentence(c["content"]) if c["modality"] == "table" else c["content"]
        text = text.removeprefix("Vision caption: ")
        parts = [text] if c["modality"] in ("record", "table") else _SENT.split(text)
        scored = []
        for j, p in enumerate(parts):
            if len(p.split()) < 6 or p.count("·") >= 4:
                continue  # fragments and table-of-contents lines
            score = 0.7 * coverage(qt, p) + 0.3 * coverage(qt, f"{c['title']} {p}")
            scored.append((score, j, p))
        scored.sort(key=lambda x: (-x[0], x[1]))
        for score, _, p in scored[: 2 if i == 0 else 1]:
            if score >= (0.25 if i == 0 else 0.5):
                out.append({"text": p.strip(), "cites": [i + 1]})
    return out[:4]


async def _unfiltered_count(tenant, question: str, qvec) -> int:
    """Presenter X-ray only: how many candidates exist before RLS (same tenant)."""
    ids: set[str] = set()
    async with writer_session() as conn:
        if qvec is not None:
            lit = literal(qvec)
            rows = await (await conn.execute(
                "SELECT id FROM chunks WHERE tenant_id = %s AND embedding IS NOT NULL ORDER BY embedding <=> %s::vector LIMIT 40",
                (tenant, lit))).fetchall()
            ids |= {str(r["id"]) for r in rows}
        qt = terms(question)
        if qt:
            rows = await (await conn.execute(
                "SELECT c.id FROM chunks c, to_tsquery('english', %s) q WHERE c.tenant_id = %s AND c.content_tsv @@ q"
                " ORDER BY ts_rank_cd(c.content_tsv, q, 32) DESC LIMIT 40", (" | ".join(qt), tenant))).fetchall()
            ids |= {str(r["id"]) for r in rows}
    return len(ids)


async def _audit(user: UserCtx, question: str, chunk_ids: list[str], latency: int, meta: dict) -> None:
    try:
        async with secure_session(user, read_only=False) as conn:
            await conn.execute(
                "INSERT INTO audit_log (tenant_id, user_id, action, query, retrieved_chunk_ids, meta, latency_ms)"
                " VALUES (%s, %s, 'query', %s, %s::uuid[], %s, %s)",
                (user.tid, user.uid, question[:500], [c for c in chunk_ids if not c.startswith("sql")], Jsonb(meta), latency),
            )
    except Exception:
        pass  # auditing must never break answering


def _finish(user, question, timer, sentences, citations, quarantined, xray, mode) -> dict:
    kept = [s for s in sentences if not s.get("removed")]
    refused = not kept
    final = [{"text": REFUSAL, "cites": []}] if refused else sentences
    removed = len([s for s in sentences if s.get("removed")])
    return {
        "id": str(uuid.uuid4()), "question": question, "user": user.model_dump(mode="json"),
        "sentences": final, "citations": [] if refused else citations, "quarantined": quarantined,
        "refused": refused, "groundedness": 1.0 if refused else len(kept) / (len(kept) + removed),
        "steps": timer.steps, "xray": xray, "latencyMs": timer.total,
        "at": dt.datetime.now(dt.timezone.utc).isoformat(), "mode": "refused" if refused else mode,
    }


async def _sql_answer(user: UserCtx, question: str, timer: Timer) -> dict | None:
    try:
        proposal, source = await sqlmod.propose(question)
        safe = sqlmod.validate(proposal)
    except sqlmod.SqlRejected as e:
        timer.step("sql", "Text-to-SQL", f"not used: {e}")
        return None
    tables = sqlmod.tables_of(safe)
    timer.step("sql", "Text-to-SQL", f"{source} · validated single SELECT on {', '.join(tables)}")
    try:
        async with secure_session(user) as conn:
            await conn.execute("SELECT set_config('statement_timeout', '5s', true)")
            rows = [jsonable(r) for r in await (await conn.execute(f"SELECT * FROM ({safe}) AS q LIMIT 50")).fetchall()]
    except Exception as e:
        timer.step("sql_run", "Run under RLS", f"failed: {e.__class__.__name__}")
        return None
    timer.step("sql_run", "Run under RLS", f"{len(rows)} rows · read-only as rag_reader")
    if sqlmod.all_null(rows):
        timer.step("sql_empty", "Result check", "no visible values → document search")
        return None

    source_text = {1: json.dumps(rows, default=str) + f" rows={len(rows)}"}
    sentences: list[dict] = []
    mode = "sql"
    if get_settings().llm_enabled:
        try:
            sentences = [{"text": t if t.endswith(".") else t + ".", "cites": [1]} for t in await llm.summarise_rows(question, safe, rows)]
        except gemini.LLMUnavailable:
            sentences = []
    if not sentences:
        cols = list(rows[0].keys())
        preview = "; ".join(", ".join(f"{k} {r[k]}" for k in cols) for r in rows[:4])
        sentences = [{"text": f"The query returned {len(rows)} row{'s' if len(rows) != 1 else ''}: {preview}.", "cites": [1]}]
    sentences, method = await verify(sentences, source_text)
    timer.step("verify", "Citation verifier", f"{method} · {len([s for s in sentences if not s.get('removed')])} supported")
    digest = hashlib.sha256(safe.encode()).hexdigest()[:12]
    citation = {
        "n": 1, "score": 1.0,
        "chunk": {"id": f"sql-{digest}", "docId": "sql", "modality": "sql", "page": None, "bbox": None,
                  "rowRef": f"sql://{','.join(tables)}", "content": safe, "sql": safe, "rows": rows,
                  "columns": list(rows[0].keys()), "tags": [], "claims": [], "record": None},
        "doc": {"id": "sql", "title": f"Live query · {', '.join(tables)}", "sourceType": "db_record", "classification": 1,
                "department": None, "allowedRoles": [], "allowedUsers": [], "owner": "rag_reader",
                "uploadedAt": dt.date.today().isoformat(), "size": f"{len(rows)} rows", "status": "ready",
                "flags": ["sql"], "summary": "Computed live under RLS"},
    }
    xray = {"candidates": len(rows), "visible": len(rows), "filtered": 0}
    out = _finish(user, question, timer, sentences, [citation], [], xray, mode)
    await _audit(user, question, [], timer.total, {"mode": "sql", "sql": safe, "rows": len(rows)})
    return out


async def _kb_version(user: UserCtx) -> int | None:
    """The tenant's knowledge-base version, bumped by a trigger on every document change. Part of
    the cache key, so revocations reach every instance (serverless ones share no memory)."""
    try:
        async with secure_session(user) as conn:
            row = await (await conn.execute("SELECT version FROM kb_version")).fetchone()
        return row["version"] if row else 0
    except Exception:
        return None  # unknown: don't read or write the cache


async def run(user: UserCtx, question: str) -> dict:
    question = question.strip()[:500]
    normalised = re.sub(r"\s+", " ", question.lower())
    kbv = await _kb_version(user)
    key = f"{fingerprint(user)}:{kbv}:{normalised}" if kbv is not None else None
    hit = _cache.get(key) if key else None
    if hit and time.time() - hit[0] < CACHE_TTL:
        out = json.loads(json.dumps(hit[1]))
        out["id"], out["at"] = str(uuid.uuid4()), dt.datetime.now(dt.timezone.utc).isoformat()
        out["steps"] = [{"key": "cache", "label": "ACL-scoped cache hit",
                         "detail": f"key = question + ACL fingerprint {fingerprint(user)[:8]} + KB v{kbv}", "ms": 1}] + out["steps"]
        await _audit(user, question, [c["chunk"]["id"] for c in out["citations"]], 1,
                     {"mode": out["mode"], "refused": out["refused"], "cache": True})
        return out

    s = get_settings()
    timer = Timer()
    timer.step("ctx", "Bind signed DB context", f"rag_reader · clearance {user.clearance} · HMAC-SHA256")

    if sqlmod.is_structured(question):
        res = await _sql_answer(user, question, timer)
        if res:
            if key:
                _cache[key] = (time.time(), res)
            return res

    qvec = await embeddings.embed_query(question)
    timer.step("embed", "Embed question", f"{embeddings.provider()} · {s.embedding_dim}-d" if qvec else "embedding unavailable → lexical only")
    async with secure_session(user) as conn:
        h = await hybrid(conn, question, qvec)
    timer.step("search", "Hybrid search under RLS",
               f"HNSW {h['vector']} + BM25 {h['lexical']} authorised · iterative scan")

    qn = len(terms(question))
    cands = h["candidates"]
    quarantined_rows = [c for c in cands[:8] if c["injection"] and c["features"]["coverage"] >= 0.25]
    semantic = qvec is not None and embeddings.provider() == "gemini"
    asked = mentioned_departments(question)
    usable = [c for c in cands if not c["injection"] and relevant(c, qn, semantic)
              and not (asked and c["department"] and c["department"] not in asked)][:6]
    timer.step("rerank", "RRF fusion + rerank", f"{len(usable)} kept of {len(cands)} fused")
    timer.step("guard", "Injection scan",
               f"{len(quarantined_rows)} chunk quarantined (prompt-injection pattern)" if quarantined_rows else "no injection patterns")

    sources = [{"n": i + 1, "title": c["title"], "text": c["content"]} for i, c in enumerate(usable)]
    sentences: list[dict] = []
    mode = "llm"

    def compose_without_llm() -> tuple[list[dict], list[dict], list[dict]]:
        # No model to judge the sources, so only chunks that clearly answer the question are quoted.
        strict = [c for c in usable if answerable(c, semantic)]
        return strict, [{"n": i + 1, "title": c["title"], "text": c["content"]} for i, c in enumerate(strict)], \
            (extractive(question, strict) if strict else [])

    if usable:
        if s.llm_enabled:
            try:
                out = await llm.answer(question, sources)
                if not out.get("insufficient"):
                    sentences = [{"text": x["text"].strip(), "cites": [int(n) for n in x.get("citations", [])]}
                                 for x in out.get("sentences", []) if x.get("text", "").strip()]
                timer.step("gen", "Generate with citations", f"{gemini.last_model() or s.llm_model} · {len(sentences)} sentences"
                           + (" · model judged sources insufficient" if out.get("insufficient") else ""))
            except gemini.LLMUnavailable as e:
                usable, sources, sentences = compose_without_llm()
                mode = "extractive"
                timer.step("gen", "Generate with citations",
                           f"LLM unavailable ({str(e)[:40]}) → extractive composer · {len(usable)} answerable")
        else:
            usable, sources, sentences = compose_without_llm()
            mode = "extractive"
            timer.step("gen", "Generate with citations", f"extractive composer · {len(sentences)} sentences")
    else:
        timer.step("gen", "Generate with citations", "insufficient evidence → refuse")

    if sentences:
        sentences, method = await verify(sentences, {x["n"]: x["text"] for x in sources})
        kept = len([x for x in sentences if not x.get("removed")])
        timer.step("verify", "Citation verifier", f"{method} · {kept} supported · {len(sentences) - kept} removed")
    else:
        timer.step("verify", "Citation verifier", "refusal is uniform (no existence leak)")

    order: list[int] = []
    for x in sentences:
        for n in x["cites"]:
            if n not in order:
                order.append(n)
    remap = {old: new for new, old in enumerate(order, 1)}
    for x in sentences:
        x["cites"] = [remap[n] for n in x["cites"]]
        if x.get("reason"):
            x["reason"] = re.sub(r"\[(\d+(?:, \d+)*)\]", lambda m: "[" + ", ".join(str(remap.get(int(n), n)) for n in m.group(1).split(", ")) + "]", x["reason"])
    citations = [{"n": remap[n], "score": usable[n - 1]["score"], "chunk": chunk_view(usable[n - 1]), "doc": doc_view(usable[n - 1])} for n in order]
    quarantined = [{"n": 100 + i, "score": c["score"], "chunk": chunk_view(c), "doc": doc_view(c)} for i, c in enumerate(quarantined_rows)]

    xray = {"candidates": h["visible"], "visible": h["visible"], "filtered": 0}
    if s.demo_mode:
        total = await _unfiltered_count(user.tid, question, qvec)
        xray = {"candidates": total, "visible": h["visible"], "filtered": max(0, total - h["visible"])}

    out = _finish(user, question, timer, sentences, citations, quarantined, xray, mode)
    await _audit(user, question, [c["chunk"]["id"] for c in citations], out["latencyMs"],
                 {"mode": out["mode"], "refused": out["refused"], "filtered": xray["filtered"]})
    if key:
        _cache[key] = (time.time(), out)
    return out
