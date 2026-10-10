"""Query orchestration. Output matches the frontend's Answer type.

run():  preflight (data version, usage, Postgres cache: one RLS-scoped round trip)
        -> rate limit -> follow-up rewrite -> quota guard
        -> Text-to-SQL under RLS, or hybrid retrieval under RLS -> compose (LLM or verbatim)
        -> verifier -> egress DLP -> signed receipt -> audit row + cache write (one transaction)
"""

import datetime as dt
import decimal
import hashlib
import json
import re
import time
import uuid
from collections.abc import Callable

from psycopg.types.json import Jsonb

from ..ai import embeddings, gemini, llm
from ..ai.embeddings import literal
from ..config import get_settings
from ..db import secure_session, writer_session
from ..ingest.records import inr
from ..models import UserCtx
from . import guard, receipts
from . import sql as sqlmod
from . import style as stylemod
from .retrieve import answerable, coverage, hybrid, relevant, terms
from .verify import verify

REFUSAL = llm.REFUSAL
_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9₹(])")
# Instance-memory tier of the answer cache: (user, key, data version) -> (time, answer).
_cache: dict[tuple[str, str, int], tuple[float, dict]] = {}
CACHE_TTL = 600

mentioned_departments = guard.mentioned_departments
StepSink = Callable[[dict], None] | None


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
    """Pipeline trace. Each step is also pushed to on_step, which is how /query/stream shows the
    pipeline live while it runs."""

    def __init__(self, on_step: StepSink = None):
        self.steps: list[dict] = []
        self.t = time.perf_counter()
        self.start = self.t
        self.on_step = on_step

    def step(self, key: str, label: str, detail: str) -> None:
        now = time.perf_counter()
        s = {"key": key, "label": label, "detail": detail, "ms": max(1, round((now - self.t) * 1000))}
        self.steps.append(s)
        self.t = now
        if self.on_step:
            try:
                self.on_step({"type": "step", **s})
            except Exception:
                pass

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


def _dumps(o) -> str:
    return json.dumps(o, default=str)


async def _record(user: UserCtx, question: str, out: dict, meta: dict, *, key: str,
                  kbv: int | None, cache_layer: str | None) -> None:
    """One read-write RLS transaction: the audit row (hash-chained by a trigger), a DLP alert if the
    egress filter blocked the answer, and the Postgres cache entry. Never breaks answering."""
    chunk_ids = [c["chunk"]["id"] for c in out.get("citations", []) if not c["chunk"]["id"].startswith("sql")]
    try:
        async with secure_session(user, read_only=False) as conn:
            await conn.execute(
                "INSERT INTO audit_log (tenant_id, user_id, action, query, retrieved_chunk_ids, meta, latency_ms)"
                " VALUES (%s, %s, 'query', %s, %s::uuid[], %s, %s)",
                (user.tid, user.uid, question[:500], chunk_ids, Jsonb(meta, dumps=_dumps), out.get("latencyMs")),
            )
            dlp = out.get("dlp") or {}
            if dlp.get("blocked"):
                await conn.execute(
                    "INSERT INTO audit_log (tenant_id, user_id, action, query, meta) VALUES (%s, %s, 'dlp_block', %s, %s)",
                    (user.tid, user.uid, question[:500], Jsonb({"canaries": dlp.get("canaries", [])})))
            if kbv is not None:
                if cache_layer == "postgres":
                    await conn.execute("UPDATE answer_cache SET hits = hits + 1 WHERE user_id = %s AND key = %s",
                                       (user.uid, key))
                elif cache_layer is None:
                    stored = {k: v for k, v in out.items() if k != "receipt"}
                    await conn.execute(
                        "INSERT INTO answer_cache (tenant_id, user_id, key, kb_version, answer) VALUES (%s, %s, %s, %s, %s)"
                        " ON CONFLICT (user_id, key) DO UPDATE SET answer = EXCLUDED.answer,"
                        " kb_version = EXCLUDED.kb_version, created_at = now(), hits = 0",
                        (user.tid, user.uid, key, kbv, Jsonb(stored, dumps=_dumps)))
    except Exception:
        pass


def _finish(user, question, timer, sentences, citations, quarantined, xray, mode, refusal: str = REFUSAL) -> dict:
    kept = [s for s in sentences if not s.get("removed")]
    refused = not kept
    final = [{"text": refusal, "cites": []}] if refused else sentences
    removed = len([s for s in sentences if s.get("removed")])
    return {
        "id": str(uuid.uuid4()), "question": question, "user": user.model_dump(mode="json"),
        "sentences": final, "citations": [] if refused else citations, "quarantined": quarantined,
        "refused": refused, "groundedness": 1.0 if refused else len(kept) / (len(kept) + removed),
        "steps": timer.steps, "xray": xray, "latencyMs": timer.total,
        "at": dt.datetime.now(dt.timezone.utc).isoformat(), "mode": "refused" if refused else mode,
    }


async def _egress(user: UserCtx, sentences: list[dict], timer: Timer) -> tuple[list[dict], dict]:
    sentences, report = await guard.egress(user, sentences)
    if report["blocked"]:
        timer.step("dlp", "Egress DLP", f"blocked: canary {', '.join(report['canaries'])} from a document you cannot read")
    elif report["redacted"]:
        timer.step("dlp", "Egress DLP", f"{report['redacted']} phone/ID number{'s' if report['redacted'] != 1 else ''} redacted")
    else:
        timer.step("dlp", "Egress DLP", "no forbidden canaries or personal identifiers")
    return sentences, report


_MARKER = re.compile(r"\s*\[(\d+(?:\s*,\s*\d+)*)\]")


def _split_markers(text: str, cites: list) -> dict:
    """Models sometimes write "[1]" into the sentence as well as the citations field. Move the markers
    into the citations, so the verifier never reads a citation number as a figure."""
    found = [int(n) for m in _MARKER.finditer(text) for n in re.split(r"\s*,\s*", m.group(1))]
    clean = _MARKER.sub("", text).strip()
    clean = re.sub(r"\s+([.,;:!?।])", r"", clean)
    return {"text": clean, "cites": list(dict.fromkeys([int(n) for n in cites] + found))}


# --- structured questions --------------------------------------------------------------------

_LABELS = ("department", "status", "designation", "enrollment_no", "name")
_MONEY = re.compile(r"balance|amount|salary|fee|due|paid|\bpay", re.I)


def _fmt(col: str, v) -> str:
    if v is None:
        return "masked"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, (int, float)):
        if _MONEY.search(col):
            return inr(v)
        return f"{v:g}" if isinstance(v, float) else str(v)
    return str(v)


def _rows_sentences(rows: list[dict]) -> list[dict]:
    """Deterministic, cited sentences for a result set (no model call)."""
    cols = list(rows[0].keys())
    labels = [c for c in cols if c in _LABELS]
    values = [c for c in cols if c not in labels and c != "suppressed"]
    out = []
    for r in rows[:6]:
        head = " · ".join(str(r[c]) for c in labels) or "Result"
        if r.get("suppressed"):
            body = f"average withheld, fewer than 5 employees ({r.get('employees')})"
        else:
            body = ", ".join(f"{c.replace('_', ' ')} {_fmt(c, r[c])}" for c in values)
        out.append({"text": f"{head}: {body}.", "cites": [1]})
    if len(rows) > 6:
        out.append({"text": f"{len(rows) - 6} more rows are in the cited result.", "cites": [1]})
    return out


def _numbers_of(rows: list[dict]) -> str:
    forms = []
    for r in rows:
        for v in r.values():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                forms.append(str(int(v)) if float(v).is_integer() else str(v))
    return " ".join(forms)


async def _sql_answer(user: UserCtx, question: str, timer: Timer, allow_llm: bool) -> tuple[list[dict], dict, dict] | None:
    try:
        proposal, source = await sqlmod.propose(question, use_llm=allow_llm)
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
    masked = sum(1 for r in rows for v in r.values() if v is None)
    timer.step("sql_run", "Run under RLS", f"{len(rows)} rows · read-only as rag_reader"
               + (f" · {masked} values masked by the database" if masked else ""))
    if sqlmod.all_null(rows):
        timer.step("sql_empty", "Result check", "no visible values → document search")
        return None

    sentences: list[dict] = []
    if source == "llm" and allow_llm:
        try:
            sentences = [{"text": t if t.endswith(".") else t + ".", "cites": [1]}
                         for t in await llm.summarise_rows(question, safe, rows)]
        except gemini.LLMUnavailable:
            sentences = []
    if not sentences:
        sentences = _rows_sentences(rows)
    source_text = {1: f"{json.dumps(rows, default=str)} {_numbers_of(rows)} rows={len(rows)} more={max(0, len(rows) - 6)} k=5"}
    sentences, _ = await verify(sentences, source_text, use_llm=False)
    timer.step("verify", "Citation verifier",
               f"every figure checked against the result rows · {len([s for s in sentences if not s.get('removed')])} supported")
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
    return sentences, citation, {"sql": safe, "rows": len(rows), "sql_source": source}


# --- cache -----------------------------------------------------------------------------------

async def _serve_cached(user: UserCtx, question: str, hit: dict, layer: str, key: str, kbv: int,
                        on_step: StepSink) -> dict:
    out = json.loads(json.dumps(hit))
    out["id"], out["at"] = str(uuid.uuid4()), dt.datetime.now(dt.timezone.utc).isoformat()
    out["question"] = question
    where = "Postgres, RLS-scoped, shared by every instance" if layer == "postgres" else "instance memory"
    step = {"key": "cache", "label": "Answer cache hit", "detail": f"{where} · data v{kbv} · 0 AI calls", "ms": 1}
    if on_step:
        on_step({"type": "step", **step})
    out["steps"] = [step] + out["steps"]
    out["cache"] = layer
    if out.get("llm"):
        out["llm"] = {**out["llm"], "calls": 0}
    out["receipt"] = receipts.issue(out, kbv, (out.get("llm") or {}).get("model"))
    await _record(user, question, out, {"mode": out["mode"], "refused": out["refused"], "cache": layer, "llm_calls": 0},
                  key=key, kbv=kbv, cache_layer=layer)
    if layer == "postgres":
        _cache[(str(user.uid), key, kbv)] = (time.time(), hit)
    return out


# --- question embeddings, cached per user ------------------------------------------------------

async def _embed_cached(user: UserCtx, text: str) -> tuple[list[float] | None, bool]:
    """The question's vector, from query_embeddings when this user asked it before (RLS: own rows
    only, keyed by a hash), else from the embedding model, stored for next time."""
    if embeddings.provider() != "gemini":
        return await embeddings.embed_query(text), False
    key = hashlib.sha256(re.sub(r"\s+", " ", text.strip().lower()).encode()).hexdigest()[:32]
    model = embeddings.model_tag()
    try:
        async with secure_session(user) as conn:
            row = await (await conn.execute(
                "SELECT embedding::text AS v FROM query_embeddings WHERE key = %s AND model = %s", (key, model))).fetchone()
        if row:
            return json.loads(row["v"]), True
    except Exception:
        pass  # table not migrated yet, or a transient error: embed directly
    vec = await embeddings.embed_query(text)
    if vec:
        try:
            async with secure_session(user, read_only=False) as conn:
                await conn.execute(
                    "INSERT INTO query_embeddings (tenant_id, user_id, key, model, embedding) VALUES (%s, %s, %s, %s, %s::vector)"
                    " ON CONFLICT DO NOTHING", (user.tid, user.uid, key, model, literal(vec)))
        except Exception:
            pass
    return vec, False


# --- main entry ------------------------------------------------------------------------------

async def run(user: UserCtx, question: str, *, verbatim: bool = False, history: list[dict] | None = None,
              on_step: StepSink = None, use_cache: bool = True, tone: str = "auto", lang: str = "auto") -> dict:
    s = get_settings()
    question = question.strip()[:500]
    history = (history or [])[-3:]
    rewritten = guard.rewrite_followup(question, history)
    effective = rewritten or question
    st = stylemod.resolve(question, tone, lang)
    unclaimed, claim = guard.strip_identity_claims(effective)
    search = stylemod.search_text(unclaimed or effective)   # regional words -> English search terms
    key = guard.cache_key(effective, verbatim, st.key)
    usage = gemini.begin_usage()

    pf = await guard.preflight(user, key)
    guard.enforce_rate_limit(pf)

    if use_cache and pf.kb_version is not None:
        mem = _cache.get((str(user.uid), key, pf.kb_version))
        if mem and time.time() - mem[0] < CACHE_TTL:
            return await _serve_cached(user, question, mem[1], "memory", key, pf.kb_version, on_step)
        if pf.cached:
            return await _serve_cached(user, question, pf.cached, "postgres", key, pf.kb_version, on_step)

    allow_llm, why = guard.llm_allowed(pf, verbatim)
    timer = Timer(on_step)
    timer.step("ctx", "Bind signed DB context", f"rag_reader · clearance {user.clearance} · HMAC-SHA256")
    if rewritten:
        timer.step("followup", "Follow-up rewritten", f"“{question}” → “{rewritten}”")
    if not allow_llm:
        timer.step("budget", "Quota guard", f"{why} → verbatim composer")
    if claim:
        timer.step("claim", "Identity claim ignored",
                   f"“{claim[:60]}” · identity comes only from your signed login ({', '.join(user.roles)})")
    if st.key:
        how = "matched to your message" if st.detected else "your pick"
        timer.step("style", "Reply style", f"{st.label} · {how} · wording only, same sources and rules"
                   + (" · search terms translated" if search != effective else ""))

    citations: list[dict] = []
    quarantined: list[dict] = []
    xray = {"candidates": 0, "visible": 0, "filtered": 0}
    meta: dict = {}
    mode = "llm"
    sentences: list[dict] = []
    handled = False

    if sqlmod.is_structured(search):
        res = await _sql_answer(user, search, timer, allow_llm)
        if res:
            sentences, citation, meta = res
            citations, mode, handled = [citation], "sql", True
            n_rows = len(citation["chunk"]["rows"])
            xray = {"candidates": n_rows, "visible": n_rows, "filtered": 0}

    if not handled:
        qvec, vec_cached = await _embed_cached(user, search)
        timer.step("embed", "Embed question",
                   (f"{embeddings.provider()} · {s.embedding_dim}-d" + (" · cached vector, 0 quota" if vec_cached else ""))
                   if qvec else "embedding unavailable → lexical only")
        async with secure_session(user) as conn:
            h = await hybrid(conn, search, qvec)
        timer.step("search", "Hybrid search under RLS",
                   f"HNSW {h['vector']} + BM25 {h['lexical']} authorised · iterative scan")

        qn = len(terms(search))
        cands = h["candidates"]
        quarantined_rows = [c for c in cands[:8] if c["injection"] and c["features"]["coverage"] >= 0.25]
        semantic = qvec is not None and embeddings.provider() == "gemini"
        asked = mentioned_departments(effective)
        usable = [c for c in cands if not c["injection"] and relevant(c, qn, semantic)
                  and not (asked and c["department"] and c["department"] not in asked)][:6]
        timer.step("rerank", "RRF fusion + rerank", f"{len(usable)} kept of {len(cands)} fused")
        timer.step("guard", "Injection scan",
                   f"{len(quarantined_rows)} chunk quarantined (prompt-injection pattern)" if quarantined_rows else "no injection patterns")

        sources = [{"n": i + 1, "title": c["title"], "text": c["content"]} for i, c in enumerate(usable)]

        def compose_without_llm() -> tuple[list[dict], list[dict], list[dict]]:
            # No model to judge the sources, so only chunks that clearly answer the question are quoted.
            strict = [c for c in usable if answerable(c, semantic)]
            return strict, [{"n": i + 1, "title": c["title"], "text": c["content"]} for i, c in enumerate(strict)], \
                (extractive(search, strict) if strict else [])

        if usable:
            if allow_llm:
                try:
                    out = await llm.answer(effective, sources, context=history[-1].get("question") if history else None,
                                           style_rules=stylemod.prompt_rules(st))
                    if not out.get("insufficient"):
                        sentences = [_split_markers(x["text"], x.get("citations", []))
                                     for x in out.get("sentences", []) if x.get("text", "").strip()]
                    timer.step("gen", "Generate with citations", f"{gemini.last_model() or s.llm_model} · {len(sentences)} sentences"
                               + (" · model judged sources insufficient" if out.get("insufficient") else ""))
                except gemini.LLMUnavailable as e:
                    usable, sources, sentences = compose_without_llm()
                    mode = "extractive"
                    timer.step("gen", "Generate with citations",
                               f"LLM unavailable ({str(e)[:40]}) → verbatim composer · {len(usable)} answerable")
            else:
                usable, sources, sentences = compose_without_llm()
                mode = "extractive"
                timer.step("gen", "Compose verbatim", f"sentences quoted from sources · {len(sentences)} sentences")
        else:
            timer.step("gen", "Generate with citations", "insufficient evidence → refuse")

        if sentences:
            sentences, method = await verify(sentences, {x["n"]: x["text"] for x in sources}, use_llm=allow_llm)
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
            total = await _unfiltered_count(user.tid, effective, qvec)
            xray = {"candidates": total, "visible": h["visible"], "filtered": max(0, total - h["visible"])}

    sentences, report = await _egress(user, sentences, timer)
    out = _finish(user, question, timer, sentences, citations, quarantined, xray, mode, refusal=stylemod.refusal(st))
    out["style"] = {"lang": st.lang, "tone": st.tone, "label": st.label, "detected": st.detected,
                    "greeting": None if out["refused"] else stylemod.greeting(st)}
    usage_meta = usage.as_meta()
    model = usage.calls[-1] if usage.calls else None
    out["rewritten"] = rewritten
    out["dlp"] = report
    out["cache"] = None
    out["llm"] = {"allowed": allow_llm, "reason": why, "calls": usage_meta["llm_calls"], "model": model,
                  "today": pf.llm_today + usage_meta["llm_calls"], "budget": s.llm_daily_budget,
                  "rateLimited": usage_meta["rate_limited"]}
    out["receipt"] = receipts.issue(out, pf.kb_version, model)

    meta.update({"mode": out["mode"], "refused": out["refused"], "filtered": xray["filtered"], **usage_meta,
                 "verbatim": verbatim, "followup": bool(rewritten), "style": st.key or "en-formal"})
    if report["blocked"] or report["redacted"]:
        meta["dlp"] = report
    await _record(user, question, out, meta, key=key, kbv=pf.kb_version if use_cache else None, cache_layer=None)
    if use_cache and pf.kb_version is not None:
        _cache[(str(user.uid), key, pf.kb_version)] = (time.time(), {k: v for k, v in out.items() if k != "receipt"})
    return out
