"""Security X-ray: shows what the database itself believes about the caller.

Used by the demo UI to make retrieval-layer enforcement visible: the DB role in use,
the context Postgres verified, and how many rows of each table that context can see.
"""

from fastapi import APIRouter

from ..config import get_settings
from ..db import writer_session
from ..deps import CurrentUser, ReaderConn

router = APIRouter(prefix="/security", tags=["security"])

_TABLES = ("documents", "chunks", "students", "fee_payments", "employees_secure")


@router.get("/xray")
async def xray(user: CurrentUser, conn: ReaderConn) -> dict:
    head = await (
        await conn.execute("SELECT current_user AS db_role, app_ctx() AS verified_context")
    ).fetchone()
    visible = {}
    for table in _TABLES:
        visible[table] = (await (await conn.execute(f"SELECT count(*) AS n FROM {table}")).fetchone())["n"]

    total = None
    if get_settings().demo_mode:
        total = {}
        async with writer_session() as w:
            for table in _TABLES:
                base = "employees" if table == "employees_secure" else table
                cur = await w.execute(f"SELECT count(*) AS n FROM {base} WHERE tenant_id = %s", (user.tid,))
                total[table] = (await cur.fetchone())["n"]

    return {**head, "visible": visible, "total": total}
