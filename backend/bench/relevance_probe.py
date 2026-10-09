"""Print hybrid-retrieval features for a fixed question set, to calibrate the relevance gate.

    python -m bench.relevance_probe [email]

Runs as the given demo user (default admin) under RLS, so it shows exactly what the gate sees."""

import asyncio
import sys

from app import db
from app.ai import embeddings
from app.models import UserCtx
from app.rag.retrieve import hybrid, relevant, terms

QUESTIONS = [
    "What is the CSE department budget for 2026-27?",
    "How much money does the computer science department get this year?",
    "What is the Mars campus budget for 2026-27?",
    "When is the robotics workshop?",
    "What is the minimum attendance needed to sit the exam?",
    "What is the B.Tech fee for MECH?",
    "Who won the cricket match yesterday?",
    "What is the grace marks policy?",
    "What is the capital of France?",
]


async def main(email: str) -> None:
    await db.open_pools()
    try:
        async with db.writer_session() as conn:
            u = await (await conn.execute(
                "SELECT id, tenant_id, email, name, roles, dept_scope, clearance, department FROM users WHERE email = %s",
                (email,))).fetchone()
        user = UserCtx(uid=u["id"], tid=u["tenant_id"], email=u["email"], name=u["name"], roles=u["roles"],
                       depts=u["dept_scope"], clearance=u["clearance"], department=u["department"])
        for q in QUESTIONS:
            qvec = await embeddings.embed_query(q)
            async with db.secure_session(user) as conn:
                h = await hybrid(conn, q, qvec)
            print(f"\n## {q}   (embeddings: {'yes' if qvec else 'lexical only'})")
            for c in h["candidates"][:6]:
                f = c["features"]
                gate = relevant(c, len(terms(q)), qvec is not None and embeddings.provider() == "gemini")
                print(f"  {'KEEP' if gate else '    '} sim={f['sim']:.3f} cov={f['coverage']:.2f} "
                      f"score={c.get('score', 0):.3f}  {c['title'][:44]:44s} | {c['content'][:60]!r}")
    finally:
        await db.close_pools()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "admin@atmiya.test"))
