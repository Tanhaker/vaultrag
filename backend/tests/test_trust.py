"""Trust layer, enforced in Postgres: kill switch, PII masking, k-anonymous pay, tamper-evident audit
log, access-matrix consistency with RLS, cache isolation and the egress filter."""

import json

import psycopg
import pytest

from app import db
from app.rag import guard

from .conftest import DOCS, TEST_TENANT, USERS, tid


async def visible_titles(user) -> set[str]:
    async with db.secure_session(user) as conn:
        return {r["title"] for r in await (await conn.execute("SELECT title FROM documents")).fetchall()}


async def test_kill_switch_revokes_a_live_token(world):
    student = USERS["student_cse"]
    assert await visible_titles(student)
    async with db.writer_session() as conn:
        await conn.execute("UPDATE users SET locked_at = now() WHERE id = %s", (student.uid,))
    try:
        # Same signed context as before the lock: app_ctx() now resolves to NULL.
        assert await visible_titles(student) == set()
        async with db.secure_session(student) as conn:
            assert (await (await conn.execute("SELECT app_ctx() AS c")).fetchone())["c"] is None
    finally:
        async with db.writer_session() as conn:
            await conn.execute("UPDATE users SET locked_at = NULL WHERE id = %s", (student.uid,))
    assert await visible_titles(student)


async def test_access_matrix_agrees_with_rls(world):
    """acl_explain()['allowed'] must equal what RLS actually returns, for every user and document."""
    async with db.writer_session() as conn:
        rows = await (await conn.execute(
            "SELECT u.id AS uid, d.title, (acl_explain(jsonb_build_object('uid', u.id, 'tid', u.tenant_id,"
            "  'roles', to_jsonb(u.roles), 'depts', to_jsonb(u.dept_scope), 'clr', u.clearance),"
            "  d.tenant_id, d.classification, d.department, d.allowed_roles, d.allowed_users)->>'allowed')::boolean AS ok"
            "  FROM users u CROSS JOIN documents d WHERE u.tenant_id = %s AND d.tenant_id = %s",
            (TEST_TENANT, TEST_TENANT))).fetchall()
    predicted: dict = {}
    for r in rows:
        predicted.setdefault(r["uid"], set())
        if r["ok"]:
            predicted[r["uid"]].add(r["title"])
    for key, user in USERS.items():
        if user.tid != TEST_TENANT:
            continue
        assert predicted[user.uid] == await visible_titles(user), key


async def test_student_contact_details_are_masked(world):
    s_a = tid("student:S-CSE-A")
    async with db.writer_session() as conn:
        await conn.execute("UPDATE students SET email = 'a@rls.test', phone = '+91 9876543210' WHERE id = %s", (s_a,))

    async def contact(user):
        async with db.secure_session(user) as conn:
            return await (await conn.execute(
                "SELECT email, phone FROM students_secure WHERE id = %s", (s_a,))).fetchone()

    assert await contact(USERS["student_cse"]) == {"email": "a@rls.test", "phone": "+91 9876543210"}  # own row
    assert await contact(USERS["faculty_cse"]) == {"email": "a@rls.test", "phone": None}
    assert await contact(USERS["finance"]) == {"email": "a@rls.test", "phone": None}
    assert (await contact(USERS["admin"]))["phone"] == "+91 9876543210"
    assert await contact(USERS["student_mech"]) is None  # row not visible at all

    # The base table no longer hands contact columns to rag_reader, whatever the SQL.
    async with db.secure_session(USERS["admin"]) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            await conn.execute("SELECT phone FROM students")


async def test_salary_stats_are_k_anonymous(world):
    async def stats(user):
        async with db.secure_session(user) as conn:
            return await (await conn.execute("SELECT * FROM salary_stats ORDER BY department")).fetchall()

    hr = await stats(USERS["hr"])
    assert [r["department"] for r in hr] == ["CSE", "MECH"]
    assert all(r["suppressed"] and r["avg_salary"] is None for r in hr)  # one employee each: below k = 5
    assert [r["department"] for r in await stats(USERS["hod_cse"])] == ["CSE"]
    assert await stats(USERS["student_cse"]) == []
    assert await stats(USERS["faculty_cse"]) == []


async def audit(user, query: str) -> None:
    async with db.secure_session(user, read_only=False) as conn:
        await conn.execute("INSERT INTO audit_log (tenant_id, user_id, action, query) VALUES (%s, %s, 'query', %s)",
                           (user.tid, user.uid, query))


async def chain(admin) -> dict:
    async with db.secure_session(admin) as conn:
        return (await (await conn.execute("SELECT audit_chain_verify() AS v")).fetchone())["v"]


async def test_audit_chain_detects_tampering(world):
    admin = USERS["admin"]
    for i, key in enumerate(("student_cse", "hod_cse", "finance", "student_cse")):
        await audit(USERS[key], f"question {i}")
    v = await chain(admin)
    assert v["intact"] and v["entries"] >= 4

    async with db.writer_session() as conn:
        target = (await (await conn.execute(
            "SELECT id, query FROM audit_log WHERE tenant_id = %s ORDER BY id OFFSET 1 LIMIT 1", (TEST_TENANT,))).fetchone())
        await conn.execute("UPDATE audit_log SET query = 'nothing to see here' WHERE id = %s", (target["id"],))
    try:
        v = await chain(admin)
        assert not v["intact"] and v["first_bad_id"] == target["id"]
    finally:
        async with db.writer_session() as conn:
            await conn.execute("UPDATE audit_log SET query = %s WHERE id = %s", (target["query"], target["id"]))
    assert (await chain(admin))["intact"]

    # Deleting a row breaks the chain as well.
    async with db.writer_session() as conn:
        await conn.execute("DELETE FROM audit_log WHERE id = %s", (target["id"],))
    assert not (await chain(admin))["intact"]


async def test_chain_verification_is_admin_only(world):
    assert await chain(USERS["hod_cse"]) is None


async def test_answer_cache_is_private_to_its_user(world):
    a, b = USERS["hod_cse"], USERS["hod_mech"]
    async with db.secure_session(a, read_only=False) as conn:
        await conn.execute("INSERT INTO answer_cache (tenant_id, user_id, key, kb_version, answer) VALUES (%s, %s, 'k1', 1, %s)",
                           (a.tid, a.uid, json.dumps({"secret": True})))
    async with db.secure_session(b) as conn:
        assert (await (await conn.execute("SELECT count(*) AS n FROM answer_cache")).fetchone())["n"] == 0
    async with db.secure_session(b, read_only=False) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):  # RLS WITH CHECK: cannot plant entries for others
            await conn.execute("INSERT INTO answer_cache (tenant_id, user_id, key, kb_version, answer) VALUES (%s, %s, 'k2', 1, '{}')",
                               (a.tid, a.uid))
    async with db.writer_session() as conn:
        await conn.execute("DELETE FROM answer_cache WHERE tenant_id = %s", (TEST_TENANT,))


async def test_egress_blocks_a_forbidden_canary(world):
    async with db.writer_session() as conn:
        await conn.execute("INSERT INTO canaries (token, tenant_id, document_id) VALUES ('CANARY-TESTBUD-1A2B', %s, %s)"
                           " ON CONFLICT (token) DO UPDATE SET document_id = EXCLUDED.document_id",
                           (TEST_TENANT, tid("doc:cse_budget")))
    leaked = [{"text": "The budget reference is CANARY-TESTBUD-1A2B.", "cites": [1]}]
    _, report = await guard.egress(USERS["student_cse"], [dict(s) for s in leaked])
    assert report["blocked"] and report["canaries"] == ["CANARY-TESTBUD-1A2B"]
    kept, report = await guard.egress(USERS["hod_cse"], [dict(s) for s in leaked])  # may read the budget
    assert not report["blocked"] and kept
    _, report = await guard.egress(USERS["hod_cse"], [{"text": "See CANARY-UNKNOWN-0000.", "cites": [1]}])
    assert report["blocked"]  # an unregistered tripwire is never let through


async def test_egress_redacts_phone_numbers(world):
    out, report = await guard.egress(USERS["faculty_cse"], [{"text": "Call +91 9876543210 or 9123456789.", "cites": [1]}])
    assert report["redacted"] == 2 and "987654" not in out[0]["text"]
    out, report = await guard.egress(USERS["admin"], [{"text": "Call +91 9876543210.", "cites": [1]}])
    assert report["redacted"] == 0


def test_documents_matrix_covers_every_doc():
    assert {"handbook", "cse_budget", "appraisal", "personal_letter"} <= set(DOCS)
