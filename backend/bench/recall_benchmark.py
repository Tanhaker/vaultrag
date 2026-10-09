"""Filtered-ANN benchmark: does access control starve low-privilege users of results?

Loads a synthetic corpus (clustered 768-d vectors spread over documents with mixed ACLs),
then for each identity compares three ways of getting the 10 nearest *authorised* chunks
against exact ground truth:

  post_filter   HNSW top-10 without RLS, then drop unauthorised rows in app code
  rls_strict    RLS inside Postgres, hnsw.iterative_scan = off
  rls_iterative RLS inside Postgres, hnsw.iterative_scan = relaxed_order (pgvector >= 0.8)

Usage (inside the api container):  python -m bench.recall_benchmark [--chunks 10000] [--queries 100]
Writes bench/results/recall.json and removes the benchmark tenant afterwards.
"""

import argparse
import asyncio
import json
import statistics
import time
import uuid
from pathlib import Path

import numpy as np

from app import db
from app.models import UserCtx

DIM = 768
K = 10
TENANT = uuid.UUID("b3c40000-0000-4000-8000-00000000be0c")
OUT = Path(__file__).resolve().parent / "results" / "recall.json"

# (share of documents, classification, department, allowed roles)
ACL_MIX = [
    (0.05, 0, None, ["*"]),                 # public
    (0.15, 1, None, ["faculty", "hod"]),    # internal policies
    (0.20, 2, "CSE", ["hod", "finance"]),   # CSE confidential
    (0.20, 2, "MECH", ["hod", "finance"]),  # MECH confidential
    (0.20, 2, None, ["finance"]),           # finance only
    (0.20, 3, None, ["hr"]),                # restricted HR
]

IDENTITIES = {
    "Student (public only)": (["student"], ["CSE"], 0),
    "Faculty": (["faculty"], ["CSE"], 1),
    "HOD, CSE": (["faculty", "hod"], ["CSE"], 2),
    "Finance": (["finance"], ["*"], 2),
    "Admin": (["admin"], ["*"], 3),
}


def ctx(name: str) -> UserCtx:
    roles, depts, clr = IDENTITIES[name]
    return UserCtx(uid=uuid.uuid5(TENANT, name), tid=TENANT, email=f"{len(name)}@bench.test", name=name,
                   roles=roles, depts=depts, clearance=clr)


def allows(user: UserCtx, cls: int, dept: str | None, roles: list[str]) -> bool:
    """Python copy of acl_check() for ground truth."""
    if cls > user.clearance:
        return False
    role_ok = "admin" in user.roles or "*" in roles or any(r in user.roles for r in roles)
    dept_ok = dept is None or "*" in user.depts or dept in user.depts
    return role_ok and dept_ok


def vec_literal(v: np.ndarray) -> str:
    return "[" + ",".join(f"{x:.5f}" for x in v) + "]"


async def load(n_chunks: int, rng: np.random.Generator):
    n_docs = n_chunks // 25
    centers = rng.normal(size=(64, DIM))
    centers /= np.linalg.norm(centers, axis=1, keepdims=True)
    shares = np.array([m[0] for m in ACL_MIX])
    doc_acl = rng.choice(len(ACL_MIX), size=n_docs, p=shares / shares.sum())

    async with db.writer_session() as conn:
        await conn.execute("DELETE FROM tenants WHERE id = %s", (TENANT,))
        await conn.execute("INSERT INTO tenants (id, name) VALUES (%s, 'recall benchmark')", (TENANT,))
        doc_ids = [uuid.uuid4() for _ in range(n_docs)]
        async with conn.cursor() as cur:
            await cur.executemany(
                "INSERT INTO documents (id, tenant_id, title, source_type, department, classification, allowed_roles, status)"
                " VALUES (%s, %s, %s, 'text', %s, %s, %s, 'ready')",
                [(d, TENANT, f"bench-{i}", ACL_MIX[a][2], ACL_MIX[a][1], ACL_MIX[a][3]) for i, (d, a) in enumerate(zip(doc_ids, doc_acl))],
            )
        chunk_doc = rng.integers(0, n_docs, size=n_chunks)
        emb = centers[rng.integers(0, 64, size=n_chunks)] + rng.normal(scale=0.35, size=(n_chunks, DIM)) / np.sqrt(DIM) * 6
        emb /= np.linalg.norm(emb, axis=1, keepdims=True)
        ids = [uuid.uuid4() for _ in range(n_chunks)]
        # COPY is rejected on RLS-enabled tables, so insert in batches. ACL columns are
        # overwritten by the inheritance trigger; the placeholders only satisfy NOT NULL.
        async with conn.cursor() as cur:
            for start in range(0, n_chunks, 1000):
                await cur.executemany(
                    "INSERT INTO chunks (id, document_id, modality, content, embedding, tenant_id, classification, allowed_roles, allowed_users)"
                    " VALUES (%s, %s, 'text', %s, %s::vector, %s, 0, '{}', '{}')",
                    [(ids[i], doc_ids[chunk_doc[i]], f"bench chunk {i}", vec_literal(emb[i]), TENANT)
                     for i in range(start, min(start + 1000, n_chunks))],
                )
        await conn.execute("ANALYZE chunks")

    meta = [(ACL_MIX[doc_acl[chunk_doc[i]]][1], ACL_MIX[doc_acl[chunk_doc[i]]][2], ACL_MIX[doc_acl[chunk_doc[i]]][3]) for i in range(n_chunks)]
    return ids, emb, meta, centers


def pct(values: list[float], p: float) -> float:
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p / 100 * (len(values) - 1))))]


async def run(n_chunks: int, n_queries: int):
    rng = np.random.default_rng(7)
    t0 = time.time()
    ids, emb, meta, centers = await load(n_chunks, rng)
    print(f"loaded {n_chunks} chunks in {time.time() - t0:.1f}s")

    queries = centers[rng.integers(0, 64, size=n_queries)] + rng.normal(scale=0.3, size=(n_queries, DIM)) / np.sqrt(DIM) * 6
    queries /= np.linalg.norm(queries, axis=1, keepdims=True)
    id_index = {str(c): i for i, c in enumerate(ids)}

    async with db.writer_session() as conn:
        version = (await (await conn.execute("SELECT extversion FROM pg_extension WHERE extname = 'vector'")).fetchone())["extversion"]

    results = {"pgvector": version, "chunks": n_chunks, "queries": n_queries, "k": K, "identities": {}}
    for name in IDENTITIES:
        user = ctx(name)
        visible = np.array([allows(user, *m) for m in meta])
        rec = {"post_filter": [], "rls_strict": [], "rls_iterative": []}
        lat = {"post_filter": [], "rls_iterative": []}
        returned = {"post_filter": [], "rls_strict": [], "rls_iterative": []}
        for q in queries:
            sims = emb @ q
            sims[~visible] = -np.inf
            truth = {str(ids[i]) for i in np.argsort(-sims)[:K]}
            lit = vec_literal(q)

            t = time.perf_counter()
            async with db.writer_session() as conn:
                await conn.execute("SET LOCAL hnsw.iterative_scan = off")
                rows = await (await conn.execute(
                    "SELECT id FROM chunks WHERE tenant_id = %s ORDER BY embedding <=> %s::vector LIMIT %s", (TENANT, lit, K))).fetchall()
            kept = [str(r["id"]) for r in rows if visible[id_index[str(r["id"])]]]
            lat["post_filter"].append((time.perf_counter() - t) * 1000)
            rec["post_filter"].append(len(set(kept) & truth) / K)
            returned["post_filter"].append(len(kept))

            for mode, setting in (("rls_strict", "off"), ("rls_iterative", "relaxed_order")):
                t = time.perf_counter()
                async with db.secure_session(user) as conn:
                    await conn.execute(f"SET LOCAL hnsw.iterative_scan = {setting}")
                    rows = await (await conn.execute(
                        "SELECT id FROM chunks ORDER BY embedding <=> %s::vector LIMIT %s", (lit, K))).fetchall()
                got = {str(r["id"]) for r in rows}
                if mode == "rls_iterative":
                    lat["rls_iterative"].append((time.perf_counter() - t) * 1000)
                assert all(visible[id_index[g]] for g in got), "RLS returned an unauthorised chunk"
                rec[mode].append(len(got & truth) / K)
                returned[mode].append(len(got))

        results["identities"][name] = {
            "visible_share": round(float(visible.mean()), 4),
            "recall_at_10": {m: round(statistics.mean(v), 4) for m, v in rec.items()},
            "avg_results_returned": {m: round(statistics.mean(v), 2) for m, v in returned.items()},
            "latency_ms": {m: {"p50": round(pct(v, 50), 1), "p95": round(pct(v, 95), 1)} for m, v in lat.items()},
        }
        r = results["identities"][name]
        print(f"{name:24s} visible {r['visible_share']*100:5.1f}%  recall@10 post {r['recall_at_10']['post_filter']:.2f}"
              f"  strict {r['recall_at_10']['rls_strict']:.2f}  iterative {r['recall_at_10']['rls_iterative']:.2f}"
              f"  p95 {r['latency_ms']['rls_iterative']['p95']} ms")

    async with db.secure_session(ctx("Student (public only)")) as conn:
        await conn.execute("SET LOCAL hnsw.iterative_scan = relaxed_order")
        plan = await (await conn.execute(
            "EXPLAIN (ANALYZE, COSTS OFF) SELECT id FROM chunks ORDER BY embedding <=> %s::vector LIMIT 10", (vec_literal(queries[0]),))).fetchall()
    results["explain_student"] = [r["QUERY PLAN"] for r in plan]
    print("\n".join(results["explain_student"]))

    async with db.writer_session() as conn:
        await conn.execute("DELETE FROM tenants WHERE id = %s", (TENANT,))

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(results, indent=2))
    print("wrote", OUT)


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--chunks", type=int, default=10000)
    p.add_argument("--queries", type=int, default=100)
    a = p.parse_args()
    await db.open_pools()
    try:
        await run(a.chunks, a.queries)
    finally:
        await db.close_pools()


if __name__ == "__main__":
    asyncio.run(main())
