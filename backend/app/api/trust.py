"""Trust-centre endpoints: proof and governance on top of the RLS core.

  POST /security/plan          EXPLAIN ANALYZE of the vector scan under the caller's RLS (presenter)
  GET  /access/matrix          every user x document decision, from the same acl_check() RLS uses
  POST /access/preview         what-if: who gains or loses access if a document's ACL changes
  POST /receipts/verify        check a signed answer receipt against the live sources
  GET  /security/metrics       usage, latency, cache and AI-budget figures from the audit log
  GET  /security/alerts        probing detection: identities collecting refusals and 404s
  POST /admin/users/{id}/lock  kill switch, enforced inside app_ctx()
  GET  /security/audit-chain   walk the hash chain over the audit log
"""

import json
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from psycopg import sql
from pydantic import BaseModel, Field

from ..ai import embeddings, gemini
from ..ai.embeddings import literal
from ..config import get_settings
from ..db import secure_session, writer_session
from ..deps import CurrentUser
from ..models import UserCtx
from ..rag import answer, receipts

router = APIRouter(tags=["trust"])

USER_CTX = ("jsonb_build_object('uid', u.id, 'tid', u.tenant_id, 'roles', to_jsonb(u.roles),"
            " 'depts', to_jsonb(u.dept_scope), 'clr', u.clearance)")


def _admin(user: UserCtx) -> None:
    if "admin" not in user.roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrators only.")


# --- query plan ------------------------------------------------------------------------------

class PlanIn(BaseModel):
    question: str = Field(min_length=2, max_length=300)


def _walk(node: dict, out: list[dict], depth: int = 0) -> None:
    out.append({
        "depth": depth, "node": node.get("Node Type"), "index": node.get("Index Name"),
        "relation": node.get("Relation Name"), "filter": node.get("Filter"), "order": node.get("Order By"),
        "rows": node.get("Actual Rows"), "loops": node.get("Actual Loops"),
        "removed": node.get("Rows Removed by Filter"), "ms": node.get("Actual Total Time"),
        "subplan": node.get("Subplan Name") or node.get("Parent Relationship"),
    })
    for child in node.get("Plans", []):
        _walk(child, out, depth + 1)


async def _explain(conn, stmt) -> dict:
    plan = (await (await conn.execute(
        sql.SQL("EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) ") + stmt)).fetchone())["QUERY PLAN"]
    text = "\n".join(r["QUERY PLAN"] for r in await (await conn.execute(
        sql.SQL("EXPLAIN (ANALYZE, COSTS OFF, VERBOSE) ") + stmt)).fetchall())
    root = plan[0] if isinstance(plan, list) else json.loads(plan)[0]
    nodes: list[dict] = []
    _walk(root["Plan"], nodes)
    scan = next((n for n in nodes if n["relation"] == "chunks"), {})
    return {"text": text, "nodes": nodes, "executionMs": root.get("Execution Time"), "planningMs": root.get("Planning Time"),
            "scanNode": scan.get("node"), "index": scan.get("index"), "rlsFilter": scan.get("filter"),
            "removedByFilter": scan.get("removed") or 0, "scanned": (scan.get("rows") or 0) + (scan.get("removed") or 0)}


@router.post("/security/plan")
async def query_plan(body: PlanIn, user: CurrentUser) -> dict:
    """The vector leg exactly as retrieval runs it, with EXPLAIN ANALYZE, as the caller: the plan the
    optimiser chose, and the same query with the HNSW index forced. Either way the RLS predicate is
    evaluated inside the scan of chunks, before any row reaches the application."""
    if not get_settings().demo_mode and "admin" not in user.roles:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    qvec = await embeddings.embed_query(body.question)
    if qvec is None:
        raise HTTPException(503, "Embedding provider unavailable; try again shortly.")
    lit = sql.Literal(literal(qvec))
    stmt = sql.SQL("SELECT id, 1 - (embedding <=> {v}::vector) AS sim FROM chunks"
                   " WHERE embedding IS NOT NULL ORDER BY embedding <=> {v}::vector LIMIT 40").format(v=lit)
    async with secure_session(user) as conn:
        planner = await _explain(conn, stmt)
        visible = (await (await conn.execute("SELECT count(*) AS n FROM chunks")).fetchone())["n"]
        # On a small corpus an exact sequential scan is cheaper, so the optimiser may skip HNSW.
        # Forcing the index shows the path every query takes at scale.
        await conn.execute("SELECT set_config('enable_seqscan', 'off', true)")
        hnsw = await _explain(conn, stmt)
        returned_iterative = len(await (await conn.execute(stmt)).fetchall())
        await conn.execute("SELECT set_config('hnsw.iterative_scan', 'off', true)")
        returned_strict = len(await (await conn.execute(stmt)).fetchall())
    return {
        "question": body.question, "dbRole": "rag_reader", "planner": planner, "hnsw": hnsw,
        "returned": {"iterative": returned_iterative, "strict": returned_strict, "k": 40}, "visibleChunks": visible,
    }


# --- access matrix ---------------------------------------------------------------------------

class PreviewIn(BaseModel):
    docId: UUID
    classification: int = Field(ge=0, le=3)
    department: str | None = None
    allowedRoles: list[str]


async def _users_docs(tid: UUID) -> tuple[list[dict], list[dict]]:
    async with writer_session() as conn:
        users = await (await conn.execute(
            "SELECT id, email, name, roles, department, clearance, dept_scope, locked_at IS NOT NULL AS locked"
            "  FROM users WHERE tenant_id = %s ORDER BY clearance, email", (tid,))).fetchall()
        docs = await (await conn.execute(
            "SELECT id, title, source_type, classification, department, allowed_roles, allowed_users FROM documents"
            " WHERE tenant_id = %s AND source_type <> 'db_record' ORDER BY classification, title", (tid,))).fetchall()
    return users, docs


@router.get("/access/matrix")
async def access_matrix(user: CurrentUser) -> dict:
    _admin(user)
    users, docs = await _users_docs(user.tid)
    async with writer_session() as conn:
        rows = await (await conn.execute(
            f"SELECT u.id AS uid, d.id AS did, acl_explain({USER_CTX}, d.tenant_id, d.classification, d.department,"
            "        d.allowed_roles, d.allowed_users) AS e"
            "  FROM users u CROSS JOIN documents d"
            " WHERE u.tenant_id = %s AND d.tenant_id = %s AND d.source_type <> 'db_record'", (user.tid, user.tid))).fetchall()
    cells: dict[str, dict] = {}
    for r in rows:
        cells.setdefault(str(r["uid"]), {})[str(r["did"])] = r["e"]
    return {
        "users": [{"id": str(u["id"]), "email": u["email"], "name": u["name"], "roles": u["roles"],
                   "department": u["department"], "clearance": u["clearance"], "depts": u["dept_scope"],
                   "locked": u["locked"]} for u in users],
        "documents": [{"id": str(d["id"]), "title": d["title"], "sourceType": d["source_type"],
                       "classification": d["classification"], "department": d["department"],
                       "allowedRoles": d["allowed_roles"]} for d in docs],
        "cells": cells,
        "source": "acl_check() — the function every RLS policy calls",
    }


@router.post("/access/preview")
async def access_preview(body: PreviewIn, user: CurrentUser) -> dict:
    """Evaluate a proposed ACL without saving it: acl_check() is pure, so the database can answer
    "who would see this?" before anything changes."""
    _admin(user)
    dept = (body.department or "").upper() or None
    async with writer_session() as conn:
        rows = await (await conn.execute(
            f"SELECT u.id, u.name, u.email, u.locked_at IS NOT NULL AS locked,"
            f"       acl_check({USER_CTX}, d.tenant_id, d.classification, d.department, d.allowed_roles, d.allowed_users) AS before,"
            f"       acl_check({USER_CTX}, d.tenant_id, %s, %s, %s, d.allowed_users) AS after"
            "  FROM users u JOIN documents d ON d.tenant_id = u.tenant_id"
            " WHERE d.id = %s AND u.tenant_id = %s ORDER BY u.clearance, u.email",
            (body.classification, dept, sorted(set(body.allowedRoles)), body.docId, user.tid))).fetchall()
    if not rows:
        raise HTTPException(404)
    users = [{"id": str(r["id"]), "name": r["name"], "email": r["email"], "locked": r["locked"],
              "before": r["before"], "after": r["after"]} for r in rows]
    return {"users": users,
            "gains": [u["name"] for u in users if u["after"] and not u["before"]],
            "loses": [u["name"] for u in users if u["before"] and not u["after"]]}


# --- receipts --------------------------------------------------------------------------------

class VerifyIn(BaseModel):
    receipt: dict
    sentences: list[str] | None = None


@router.post("/receipts/verify")
async def verify_receipt(body: VerifyIn, user: CurrentUser) -> dict:
    r = body.receipt
    if not isinstance(r.get("citations"), list) or "sig" not in r:
        raise HTTPException(422, "Not a VaultRAG receipt.")
    signature = receipts.check_signature(r)
    answer_ok = None if body.sentences is None else receipts.answer_digest(body.sentences) == r.get("answer_sha256")
    sources = []
    async with secure_session(user) as conn:
        for c in r["citations"]:
            cid = str(c.get("chunk_id", ""))
            if cid.startswith("sql-"):
                sources.append({"n": c.get("n"), "title": c.get("title"), "status": "live-query"})
                continue
            try:
                row = await (await conn.execute("SELECT content FROM chunks WHERE id = %s::uuid", (cid,))).fetchone()
            except Exception:
                row = None
            if row is None:
                st = "not-visible"
            else:
                st = "unchanged" if receipts.sha(row["content"]) == c.get("content_sha256") else "changed"
            sources.append({"n": c.get("n"), "title": c.get("title"), "status": st})
    ok = signature and answer_ok is not False and all(s["status"] in ("unchanged", "live-query") for s in sources)
    return {"signature": signature, "answerMatches": answer_ok, "sources": sources,
            "verdict": "valid" if ok else ("forged" if not signature else "stale")}


# --- metrics, alerts, kill switch, audit chain -----------------------------------------------

@router.get("/security/metrics")
async def metrics(user: CurrentUser, hours: int = 24) -> dict:
    """RLS decides the scope: an admin sees the tenant, anyone else sees their own activity."""
    s = get_settings()
    hours = max(1, min(hours, 168))
    window = "created_at > now() - make_interval(hours => %(h)s)"
    p = {"h": hours}
    async with secure_session(user) as conn:
        head = await (await conn.execute(
            "SELECT count(*) FILTER (WHERE action = 'query') AS queries,"
            "       count(*) FILTER (WHERE action = 'query' AND (meta->>'refused')::boolean) AS refused,"
            "       count(*) FILTER (WHERE action = 'query' AND meta ? 'cache') AS cache_hits,"
            "       count(*) FILTER (WHERE action = 'denied_source') AS denied_sources,"
            "       count(*) FILTER (WHERE action = 'dlp_block') AS dlp_blocks,"
            "       count(*) FILTER (WHERE action = 'upload') AS uploads,"
            "       count(*) FILTER (WHERE action = 'acl_change') AS acl_changes,"
            "       coalesce(sum((meta->>'llm_calls')::int), 0) AS llm_calls,"
            "       count(DISTINCT user_id) AS users,"
            "       percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)"
            "         FILTER (WHERE action = 'query' AND NOT meta ? 'cache') AS p50,"
            "       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)"
            "         FILTER (WHERE action = 'query' AND NOT meta ? 'cache') AS p95"
            f"  FROM audit_log WHERE {window}", p)).fetchone()
        modes = await (await conn.execute(
            f"SELECT coalesce(meta->>'mode', 'other') AS mode, count(*) AS n FROM audit_log"
            f" WHERE action = 'query' AND {window} GROUP BY 1 ORDER BY 2 DESC", p)).fetchall()
        series = await (await conn.execute(
            "SELECT date_trunc('hour', created_at) AS hour,"
            "       count(*) FILTER (WHERE action = 'query') AS queries,"
            "       count(*) FILTER (WHERE action = 'query' AND (meta->>'refused')::boolean) AS refused,"
            "       coalesce(sum((meta->>'llm_calls')::int), 0) AS llm"
            f"  FROM audit_log WHERE {window} GROUP BY 1 ORDER BY 1", p)).fetchall()
        models = await (await conn.execute(
            "SELECT m.key AS model, sum(m.value::int) AS calls FROM audit_log a, jsonb_each_text(a.meta->'models') m"
            f" WHERE a.{window} GROUP BY 1 ORDER BY 2 DESC", p)).fetchall()
        top = await (await conn.execute(
            "SELECT query, count(*) AS n, bool_or((meta->>'refused')::boolean) AS refused FROM audit_log"
            f" WHERE action = 'query' AND {window} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8", p)).fetchall()
        today = (await (await conn.execute("SELECT llm_calls_today() AS n")).fetchone())["n"]
    return {
        "scope": "tenant" if "admin" in user.roles else "you", "hours": hours,
        "totals": {k: (float(v) if isinstance(v, float) or v.__class__.__name__ == "Decimal" else v)
                   for k, v in head.items()},
        "modes": modes,
        "series": [{"hour": r["hour"].isoformat(), "queries": r["queries"], "refused": r["refused"], "llm": r["llm"]}
                   for r in series],
        "models": [{"model": r["model"], "calls": int(r["calls"])} for r in models],
        "topQuestions": top,
        "budget": {"today": int(today), "limit": s.llm_daily_budget, "perUser10min": s.user_llm_per_10min,
                   "queriesPer10min": s.query_limit_per_10min, "chain": gemini.models(), "parked": gemini.parked(),
                   "enabled": s.llm_enabled},
    }


@router.get("/security/alerts")
async def alerts(user: CurrentUser) -> dict:
    """Identities whose last hour looks like probing: many refusals, guessed citation links (404s),
    or answers stopped by the egress filter."""
    _admin(user)
    async with secure_session(user) as conn:
        rows = await (await conn.execute(
            "SELECT user_id,"
            "       count(*) FILTER (WHERE action = 'query') AS queries,"
            "       count(*) FILTER (WHERE action = 'query' AND (meta->>'refused')::boolean) AS refusals,"
            "       count(*) FILTER (WHERE action = 'denied_source') AS denied,"
            "       count(*) FILTER (WHERE action = 'dlp_block') AS dlp,"
            "       max(created_at) AS last_at"
            "  FROM audit_log WHERE created_at > now() - interval '60 minutes' GROUP BY 1")).fetchall()
    users, _ = await _users_docs(user.tid)
    by_id = {u["id"]: u for u in users}
    out = []
    for r in rows:
        u = by_id.get(r["user_id"])
        if not u:
            continue
        score = r["refusals"] + 3 * r["denied"] + 5 * r["dlp"]
        ratio = r["refusals"] / r["queries"] if r["queries"] else 0
        suspicious = ratio >= 0.5 or r["denied"] >= 2 or r["dlp"] > 0
        level = "high" if score >= 8 and suspicious else "medium" if score >= 4 and (suspicious or ratio >= 0.34) else "low"
        out.append({"userId": str(u["id"]), "name": u["name"], "email": u["email"], "roles": u["roles"],
                    "locked": u["locked"], "queries": r["queries"], "refusals": r["refusals"], "denied": r["denied"],
                    "dlp": r["dlp"], "score": score, "level": level, "lastAt": r["last_at"].isoformat()})
    out.sort(key=lambda a: -a["score"])
    locked = [{"userId": str(u["id"]), "name": u["name"], "email": u["email"]} for u in users if u["locked"]]
    return {"alerts": out, "locked": locked, "window": "60 minutes",
            "rule": "score = refusals + 3 × guessed /source links + 5 × DLP blocks"}


class LockIn(BaseModel):
    reason: str = Field(default="Locked from the trust centre", max_length=200)


async def _set_lock(user: UserCtx, target: UUID, lock: bool, reason: str) -> dict:
    _admin(user)
    if target == user.uid:
        raise HTTPException(400, "You cannot lock your own account.")
    async with writer_session() as conn:
        row = await (await conn.execute(
            "UPDATE users SET locked_at = CASE WHEN %s THEN now() END, locked_reason = CASE WHEN %s THEN %s END"
            " WHERE id = %s AND tenant_id = %s RETURNING name, email",
            (lock, lock, reason, target, user.tid))).fetchone()
    if not row:
        raise HTTPException(404)
    answer._cache.clear()
    async with secure_session(user, read_only=False) as conn:
        await conn.execute("INSERT INTO audit_log (tenant_id, user_id, action, query) VALUES (%s, %s, %s, %s)",
                           (user.tid, user.uid, "lock_user" if lock else "unlock_user",
                            f"{row['name']} <{row['email']}>" + (f" · {reason}" if lock else "")))
    return {"userId": str(target), "name": row["name"], "locked": lock}


@router.post("/admin/users/{user_id}/lock")
async def lock_user(user_id: UUID, body: LockIn, user: CurrentUser) -> dict:
    return await _set_lock(user, user_id, True, body.reason)


@router.post("/admin/users/{user_id}/unlock")
async def unlock_user(user_id: UUID, user: CurrentUser) -> dict:
    return await _set_lock(user, user_id, False, "")


@router.get("/security/audit-chain")
async def audit_chain(user: CurrentUser) -> dict:
    _admin(user)
    async with secure_session(user) as conn:
        v = (await (await conn.execute("SELECT audit_chain_verify() AS v")).fetchone())["v"]
    if v is None:
        raise HTTPException(403)
    return v
