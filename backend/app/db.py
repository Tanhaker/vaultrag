"""Connections and the secure session that binds a user's identity to a transaction.

Two app roles, neither of which can bypass RLS:
  rag_reader  every user-facing query. Sees only what the policies allow for the signed context.
  rag_writer  ingestion, login lookup and admin ACL changes. Never used to answer a question.

Long-running servers (Docker) use connection pools. Serverless functions (Vercel) open one
connection per request through the database's own pooler; the security context is
transaction-local, so it is safe behind PgBouncer in transaction mode.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from psycopg import AsyncConnection
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .config import get_settings
from .models import UserCtx
from .security import sign_db_context

_reader: AsyncConnectionPool | None = None
_writer: AsyncConnectionPool | None = None

CONN_KWARGS = {"autocommit": True, "row_factory": dict_row, "prepare_threshold": None}


def conninfo(user: str, password: str) -> str:
    p = get_settings().db_params()
    return make_conninfo(
        host=p["host"], port=p["port"], dbname=p["dbname"], sslmode=p["sslmode"],
        user=user, password=password, application_name="vaultrag", connect_timeout=10,
    )


def role_conninfo(role: str) -> str:
    s = get_settings()
    return conninfo(role, s.db_reader_password if role == "rag_reader" else s.db_writer_password)


async def _reset(conn: AsyncConnection) -> None:
    # Session vars are transaction-local already; this is belt-and-braces before reuse.
    await conn.execute("RESET ALL")


def make_pool(user: str, password: str, *, min_size: int = 1, max_size: int = 10) -> AsyncConnectionPool:
    return AsyncConnectionPool(
        conninfo(user, password), min_size=min_size, max_size=max_size, open=False,
        kwargs=dict(CONN_KWARGS), reset=_reset,
    )


async def open_pools() -> None:
    global _reader, _writer
    s = get_settings()
    if s.serverless:
        return
    _reader = make_pool("rag_reader", s.db_reader_password)
    _writer = make_pool("rag_writer", s.db_writer_password, max_size=5)
    await _reader.open(wait=True)
    await _writer.open(wait=True)


async def close_pools() -> None:
    global _reader, _writer
    for pool in (_reader, _writer):
        if pool is not None:
            await pool.close()
    _reader = _writer = None


def reader_pool() -> AsyncConnectionPool:
    assert _reader is not None, "pools not opened"
    return _reader


def writer_pool() -> AsyncConnectionPool:
    assert _writer is not None, "pools not opened"
    return _writer


@asynccontextmanager
async def _connection(role: str, pool: AsyncConnectionPool | None = None) -> AsyncIterator[AsyncConnection]:
    pool = pool or (_reader if role == "rag_reader" else _writer)
    if pool is not None:
        async with pool.connection() as conn:
            yield conn
        return
    conn = await AsyncConnection.connect(role_conninfo(role), **CONN_KWARGS)
    try:
        yield conn
    finally:
        await conn.close()


@asynccontextmanager
async def secure_session(
    user: UserCtx,
    *,
    read_only: bool = True,
    pool: AsyncConnectionPool | None = None,
) -> AsyncIterator[AsyncConnection]:
    """A rag_reader transaction carrying the user's HMAC-signed context.

    Every statement on the yielded connection is filtered by Postgres RLS. The context is
    set with is_local=true, so it disappears at COMMIT/ROLLBACK and cannot bleed into the
    next request that borrows this connection.
    """
    payload, sig = sign_db_context(user)
    async with _connection("rag_reader", pool) as conn:
        async with conn.transaction():
            if read_only:
                await conn.execute("SET TRANSACTION READ ONLY")
            await conn.execute(
                "SELECT set_config('app.ctx', %s, true),"
                "       set_config('app.ctx_sig', %s, true),"
                "       set_config('statement_timeout', '15s', true),"
                "       set_config('hnsw.iterative_scan', 'relaxed_order', true)",
                (payload, sig),
            )
            yield conn


@asynccontextmanager
async def writer_session() -> AsyncIterator[AsyncConnection]:
    async with _connection("rag_writer") as conn:
        async with conn.transaction():
            yield conn
