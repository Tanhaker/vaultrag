"""python -m app.cli migrate | seed"""

import argparse
import asyncio
import sys
from pathlib import Path

import psycopg
from psycopg import sql

from .config import get_settings
from .db import conninfo

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"
APP_ROLES = ("rag_reader", "rag_writer")


async def migrate() -> None:
    s = get_settings()
    passwords = {"rag_reader": s.db_reader_password, "rag_writer": s.db_writer_password}
    async with await psycopg.AsyncConnection.connect(
        conninfo(*s.owner_credentials()), autocommit=True, prepare_threshold=None
    ) as conn:
        for role in APP_ROLES:
            exists = await (await conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,))).fetchone()
            if not exists:
                await conn.execute(
                    sql.SQL("CREATE ROLE {} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE").format(
                        sql.Identifier(role)
                    )
                )
            await conn.execute(
                sql.SQL("ALTER ROLE {} WITH LOGIN NOBYPASSRLS PASSWORD {}").format(
                    sql.Identifier(role), sql.Literal(passwords[role])
                )
            )

        await conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations"
            " (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        applied = {r[0] for r in await (await conn.execute("SELECT name FROM schema_migrations")).fetchall()}
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name in applied:
                continue
            async with conn.transaction():
                await conn.execute(path.read_text(encoding="utf-8"))
                await conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
            print(f"applied {path.name}")

        await conn.execute(
            "INSERT INTO app_secrets (k, v) VALUES ('ctx_hmac', %s)"
            " ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v",
            (s.ctx_hmac_secret,),
        )
    print("migrations up to date")


async def seed() -> None:
    from seed.loader import load

    await load()


async def ingest_demo() -> None:
    """Generate the demo documents and (re)ingest them plus every record card for the demo tenant."""
    import mimetypes

    from seed import demo_docs

    from . import db
    from .ingest.pipeline import ingest_file, ingest_records

    s = get_settings()
    files = demo_docs.generate()
    await db.open_pools()
    try:
        async with db.writer_session() as conn:
            await conn.execute("DELETE FROM documents WHERE tenant_id = %s", (s.tenant_id,))
        for name, path in files.items():
            cls, dept, roles = demo_docs.MANIFEST[name]
            mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
            r = await ingest_file(tenant=s.tenant_id, filename=name, data=path.read_bytes(), mime=mime,
                                  classification=cls, department=dept, allowed_roles=roles)
            print(f"  {r['chunks']:3d} chunks  L{cls}  {name}  {' '.join(r.get('flags', []))}")
        n = await ingest_records(s.tenant_id)
        print(f"  {n:3d} record cards from students, fee_payments, employees")
    finally:
        await db.close_pools()


def main() -> None:
    parser = argparse.ArgumentParser(prog="app.cli")
    parser.add_argument("command", choices=["migrate", "seed", "ingest-demo"])
    args = parser.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run({"migrate": migrate, "seed": seed, "ingest-demo": ingest_demo}[args.command]())


if __name__ == "__main__":
    main()
