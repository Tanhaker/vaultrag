"""Retrieval-layer authorisation: everything here is enforced by Postgres, not Python."""

import json
import time

import psycopg
import pytest

from app import db
from app.config import get_settings
from app.security import sign_db_context, sign_payload

from .conftest import USERS

ALL_DOCS = {"handbook", "exam_policy", "cse_budget", "mech_budget", "appraisal", "personal_letter"}

EXPECTED_DOCS = {
    "student_cse": {"handbook", "personal_letter"},  # explicit grant overrides clearance
    "student_mech": {"handbook"},
    "faculty_cse": {"handbook", "exam_policy"},
    "hod_cse": {"handbook", "exam_policy", "cse_budget"},
    "hod_mech": {"handbook", "exam_policy", "mech_budget"},
    "finance": {"handbook", "cse_budget", "mech_budget"},
    "hr": {"handbook", "appraisal"},
    "admin": ALL_DOCS,
    "outsider_admin": set(),  # admin of another tenant sees nothing here
}

EXPECTED_STUDENTS = {
    "student_cse": {"S-CSE-A"},
    "student_mech": {"S-MECH-B"},
    "faculty_cse": {"S-CSE-A", "S-CSE-C"},
    "hod_cse": {"S-CSE-A", "S-CSE-C"},
    "hod_mech": {"S-MECH-B"},
    "finance": {"S-CSE-A", "S-MECH-B", "S-CSE-C"},
    "hr": {"S-CSE-A", "S-MECH-B", "S-CSE-C"},
    "admin": {"S-CSE-A", "S-MECH-B", "S-CSE-C"},
    "outsider_admin": set(),
}

EXPECTED_FEES = {
    "student_cse": {"S-CSE-A"},
    "student_mech": {"S-MECH-B"},
    "faculty_cse": set(),
    "hod_cse": set(),
    "hod_mech": set(),
    "finance": {"S-CSE-A", "S-MECH-B", "S-CSE-C"},
    "hr": set(),
    "admin": {"S-CSE-A", "S-MECH-B", "S-CSE-C"},
    "outsider_admin": set(),
}


async def chunk_keys(user, pool=None) -> set[str]:
    async with db.secure_session(user, pool=pool) as conn:
        rows = await (await conn.execute("SELECT meta->>'key' AS key FROM chunks")).fetchall()
    return {r["key"] for r in rows}


async def count(conn, table: str) -> int:
    return (await (await conn.execute(f"SELECT count(*) AS n FROM {table}")).fetchone())["n"]


async def bind_raw(conn, payload: str, sig: str) -> None:
    await conn.execute(
        "SELECT set_config('app.ctx', %s, true), set_config('app.ctx_sig', %s, true)", (payload, sig)
    )


# --- ACL matrix -----------------------------------------------------------------------------

@pytest.mark.parametrize("who", EXPECTED_DOCS)
async def test_chunk_visibility_matrix(world, who):
    assert await chunk_keys(USERS[who]) == EXPECTED_DOCS[who]


@pytest.mark.parametrize("who", EXPECTED_DOCS)
async def test_document_visibility_matches_chunks(world, who):
    async with db.secure_session(USERS[who]) as conn:
        rows = await (await conn.execute("SELECT title FROM documents")).fetchall()
    assert {r["title"] for r in rows} == EXPECTED_DOCS[who]


@pytest.mark.parametrize("who", EXPECTED_STUDENTS)
async def test_student_rows(world, who):
    async with db.secure_session(USERS[who]) as conn:
        rows = await (await conn.execute("SELECT enrollment_no FROM students")).fetchall()
    assert {r["enrollment_no"] for r in rows} == EXPECTED_STUDENTS[who]


@pytest.mark.parametrize("who", EXPECTED_FEES)
async def test_fee_rows(world, who):
    async with db.secure_session(USERS[who]) as conn:
        rows = await (
            await conn.execute(
                "SELECT s.enrollment_no FROM fee_payments f JOIN students s ON s.id = f.student_id"
            )
        ).fetchall()
        n = await count(conn, "fee_payments")
    assert {r["enrollment_no"] for r in rows} == EXPECTED_FEES[who]
    assert n == len(EXPECTED_FEES[who])


@pytest.mark.parametrize(
    "who, salary_visible, remarks_visible",
    [
        ("student_cse", set(), set()),
        ("hod_cse", set(), set()),
        ("faculty_cse", {"E-FAC-CSE"}, {"E-FAC-CSE"}),  # own record only
        ("finance", {"E-FAC-CSE", "E-MECH"}, set()),
        ("hr", {"E-FAC-CSE", "E-MECH"}, {"E-FAC-CSE", "E-MECH"}),
    ],
)
async def test_employee_column_masking(world, who, salary_visible, remarks_visible):
    async with db.secure_session(USERS[who]) as conn:
        rows = await (
            await conn.execute("SELECT employee_code, salary, appraisal_remarks FROM employees_secure")
        ).fetchall()
    assert {r["employee_code"] for r in rows} == {"E-FAC-CSE", "E-MECH"}
    assert {r["employee_code"] for r in rows if r["salary"] is not None} == salary_visible
    assert {r["employee_code"] for r in rows if r["appraisal_remarks"] is not None} == remarks_visible


# --- Fail-closed context ----------------------------------------------------------------------

async def test_no_context_sees_nothing(world):
    async with db.reader_pool().connection() as conn:
        async with conn.transaction():
            for table in ("chunks", "documents", "students", "fee_payments", "employees_secure"):
                assert await count(conn, table) == 0, table


async def test_tampered_context_sees_nothing(world):
    payload, sig = sign_db_context(USERS["student_cse"])
    forged = json.loads(payload) | {"roles": ["admin"], "depts": ["*"], "clr": 3}
    async with db.reader_pool().connection() as conn:
        async with conn.transaction():
            await bind_raw(conn, json.dumps(forged, separators=(",", ":"), sort_keys=True), sig)
            assert await count(conn, "chunks") == 0


async def test_context_signed_with_wrong_key_sees_nothing(world):
    import hashlib
    import hmac

    payload = json.loads(sign_db_context(USERS["admin"])[0])
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    bad_sig = hmac.new(b"guessed-key", body.encode(), hashlib.sha256).hexdigest()
    async with db.reader_pool().connection() as conn:
        async with conn.transaction():
            await bind_raw(conn, body, bad_sig)
            assert await count(conn, "chunks") == 0


async def test_expired_context_sees_nothing(world):
    payload = json.loads(sign_db_context(USERS["admin"])[0]) | {"exp": int(time.time()) - 5}
    async with db.reader_pool().connection() as conn:
        async with conn.transaction():
            await bind_raw(conn, *sign_payload(payload))
            assert await count(conn, "chunks") == 0


async def test_in_query_escalation_is_blocked(world):
    """SQL running as rag_reader (e.g. LLM-generated) tries to rewrite its own context."""
    async with db.secure_session(USERS["student_cse"]) as conn:
        assert await count(conn, "chunks") == 2
        forged = json.dumps({"uid": str(USERS["student_cse"].uid), "tid": str(USERS["student_cse"].tid),
                             "roles": ["admin"], "depts": ["*"], "clr": 3,
                             "exp": int(time.time()) + 300}, separators=(",", ":"), sort_keys=True)
        await conn.execute("SELECT set_config('app.ctx', %s, true)", (forged,))
        assert await count(conn, "chunks") == 0


# --- Privileges ---------------------------------------------------------------------------------

@pytest.mark.parametrize(
    "statement",
    [
        "SELECT * FROM employees",
        "SELECT * FROM app_secrets",
        "SELECT * FROM users",
        "INSERT INTO tenants (id, name) VALUES (gen_random_uuid(), 'x')",
        "UPDATE documents SET classification = 0",
        "DELETE FROM chunks",
    ],
)
async def test_reader_role_privileges(world, statement):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.secure_session(USERS["admin"], read_only=False) as conn:
            await conn.execute(statement)


async def test_query_sessions_are_read_only(world):
    with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
        async with db.secure_session(USERS["admin"]) as conn:
            await conn.execute(
                "INSERT INTO audit_log (tenant_id, user_id, action) VALUES (%s, %s, 'x')",
                (USERS["admin"].tid, USERS["admin"].uid),
            )


async def test_audit_rows_must_belong_to_caller(world):
    me, other = USERS["student_cse"], USERS["hr"]
    async with db.secure_session(me, read_only=False) as conn:
        await conn.execute(
            "INSERT INTO audit_log (tenant_id, user_id, action) VALUES (%s, %s, 'query')", (me.tid, me.uid)
        )
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        async with db.secure_session(me, read_only=False) as conn:
            await conn.execute(
                "INSERT INTO audit_log (tenant_id, user_id, action) VALUES (%s, %s, 'query')",
                (other.tid, other.uid),
            )


# --- Pooling and ACL lifecycle -------------------------------------------------------------------

async def test_context_does_not_bleed_across_pooled_connections(world):
    s = get_settings()
    pool = db.make_pool("rag_reader", s.db_reader_password, min_size=1, max_size=1)
    await pool.open(wait=True)
    try:
        assert await chunk_keys(USERS["admin"], pool=pool) == ALL_DOCS
        async with pool.connection() as conn:  # same physical connection, no context bound
            async with conn.transaction():
                assert await count(conn, "chunks") == 0
                assert await count(conn, "fee_payments") == 0
    finally:
        await pool.close()


async def test_chunks_inherit_document_acl(world):
    async with db.writer_session() as conn:
        rows = await (
            await conn.execute(
                "SELECT c.meta->>'key' AS key, c.classification, c.allowed_roles, c.tenant_id,"
                "       d.classification AS d_class, d.allowed_roles AS d_roles, d.tenant_id AS d_tenant"
                "  FROM chunks c JOIN documents d ON d.id = c.document_id"
                " WHERE d.tenant_id = %s",
                (USERS["admin"].tid,),
            )
        ).fetchall()
    assert len(rows) == len(ALL_DOCS)
    for r in rows:
        assert (r["classification"], r["allowed_roles"], r["tenant_id"]) == (
            r["d_class"], r["d_roles"], r["d_tenant"]
        ), r["key"]


async def test_acl_revocation_is_immediate(world):
    assert "cse_budget" in await chunk_keys(USERS["hod_cse"])
    async with db.writer_session() as conn:
        await conn.execute("UPDATE documents SET allowed_roles = '{finance}' WHERE title = 'cse_budget'")
    assert "cse_budget" not in await chunk_keys(USERS["hod_cse"])
    assert "cse_budget" in await chunk_keys(USERS["finance"])
