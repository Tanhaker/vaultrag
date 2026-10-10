"""Run the guided-demo questions (app.cli DEMO) without the cache and print what each persona gets.
python -m bench.demo_check [--llm]"""

import asyncio
import sys

from app import db
from app.cli import DEMO
from app.models import UserCtx
from app.rag import answer


async def main() -> None:
    verbatim = "--llm" not in sys.argv
    await db.open_pools()
    try:
        only = [a for a in sys.argv[1:] if not a.startswith("--")]
        for email, questions in DEMO.items():
            questions = [q for q in questions if not only or any(o.lower() in q.lower() for o in only)]
            async with db.writer_session() as conn:
                u = await (await conn.execute(
                    "SELECT id, tenant_id, email, name, roles, dept_scope, clearance, department FROM users WHERE email = %s",
                    (email,))).fetchone()
            user = UserCtx(uid=u["id"], tid=u["tenant_id"], email=u["email"], name=u["name"], roles=u["roles"],
                           depts=u["dept_scope"], clearance=u["clearance"], department=u["department"])
            for q in questions:
                a = await answer.run(user, q, verbatim=verbatim, use_cache=False)
                kept = [s["text"] for s in a["sentences"] if not s.get("removed")]
                print(f"\n{email.split('@')[0]:14s} {'REFUSED ' if a['refused'] else 'answered'} {q}")
                print(f"   sources: {sorted({c['doc']['title'] for c in a['citations']})} quarantined={len(a['quarantined'])}")
                print(f"   > {(kept[0] if kept else '')[:150]}")
                for x in a["sentences"]:
                    if x.get("removed"):
                        print(f"   REMOVED: {x['text'][:160]} :: {x.get('reason')}")
                if "--steps" in sys.argv:
                    for st in a["steps"]:
                        print(f"     {st['label']:26s} {st['detail'][:110]}")
    finally:
        await db.close_pools()


if __name__ == "__main__":
    asyncio.run(main())
