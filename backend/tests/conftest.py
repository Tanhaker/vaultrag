import uuid

import pytest

from app import db
from app.models import UserCtx

NS = uuid.UUID("0b8e1c52-3f7a-4d3b-9a61-2e5c7d9f1a04")
TEST_TENANT = uuid.uuid5(NS, "tenant:test")
OTHER_TENANT = uuid.uuid5(NS, "tenant:other")


def tid(key: str) -> uuid.UUID:
    return uuid.uuid5(NS, key)


def make_user(key: str, roles: list[str], depts: list[str], clearance: int, tenant=TEST_TENANT) -> UserCtx:
    return UserCtx(
        uid=tid(f"user:{key}"),
        tid=tenant,
        email=f"{key}@rls.test",
        name=key,
        roles=roles,
        depts=depts,
        clearance=clearance,
    )


USERS = {
    "student_cse": make_user("student_cse", ["student"], ["CSE"], 0),
    "student_mech": make_user("student_mech", ["student"], ["MECH"], 0),
    "faculty_cse": make_user("faculty_cse", ["faculty"], ["CSE"], 1),
    "hod_cse": make_user("hod_cse", ["faculty", "hod"], ["CSE"], 2),
    "hod_mech": make_user("hod_mech", ["faculty", "hod"], ["MECH"], 2),
    "finance": make_user("finance", ["finance"], ["*"], 2),
    "hr": make_user("hr", ["hr"], ["*"], 3),
    "admin": make_user("admin", ["admin"], ["*"], 3),
    "outsider_admin": make_user("outsider_admin", ["admin"], ["*"], 3, tenant=OTHER_TENANT),
}

# key -> (classification, department, allowed_roles, allowed_users)
DOCS = {
    "handbook": (0, None, ["*"], []),
    "exam_policy": (1, None, ["faculty", "hod"], []),
    "cse_budget": (2, "CSE", ["hod", "finance"], []),
    "mech_budget": (2, "MECH", ["hod", "finance"], []),
    "appraisal": (3, None, ["hr"], []),
    "personal_letter": (3, None, [], [USERS["student_cse"].uid]),
}


async def _cleanup(conn) -> None:
    for t in (TEST_TENANT, OTHER_TENANT):
        await conn.execute("DELETE FROM audit_log WHERE tenant_id = %s", (t,))
        await conn.execute("DELETE FROM tenants WHERE id = %s", (t,))


@pytest.fixture
async def pools():
    await db.open_pools()
    yield
    await db.close_pools()


@pytest.fixture
async def world(pools):
    """A self-contained tenant with an ACL matrix of documents and structured rows."""
    async with db.writer_session() as conn:
        await _cleanup(conn)
        await conn.execute("INSERT INTO tenants (id, name) VALUES (%s, 'RLS test'), (%s, 'Other')",
                           (TEST_TENANT, OTHER_TENANT))
        for u in USERS.values():
            await conn.execute(
                "INSERT INTO users (id, tenant_id, email, name, password_hash, roles, department,"
                "                   clearance, dept_scope)"
                " VALUES (%s, %s, %s, %s, 'unused', %s, %s, %s, %s)",
                (u.uid, u.tid, u.email, u.name, u.roles, u.department, u.clearance, u.depts),
            )
        for key, (cls, dept, roles, users) in DOCS.items():
            await conn.execute(
                "INSERT INTO documents (id, tenant_id, title, source_type, department, classification,"
                "                       allowed_roles, allowed_users, status)"
                " VALUES (%s, %s, %s, 'text', %s, %s, %s, %s, 'ready')",
                (tid(f"doc:{key}"), TEST_TENANT, key, dept, cls, roles, users),
            )
            # Chunk ACL values sent here are deliberately wrong (public, any role): the
            # inheritance trigger must overwrite them with the document's ACL.
            await conn.execute(
                "INSERT INTO chunks (document_id, modality, content, meta, tenant_id, department,"
                "                    classification, allowed_roles, allowed_users)"
                " VALUES (%s, 'text', %s, %s, %s, NULL, 0, '{*}', '{}')",
                (tid(f"doc:{key}"), f"CANARY-{key}", f'{{"key": "{key}"}}', OTHER_TENANT),
            )

        students = [
            ("S-CSE-A", "CSE", USERS["student_cse"].uid),
            ("S-MECH-B", "MECH", USERS["student_mech"].uid),
            ("S-CSE-C", "CSE", None),
        ]
        for enrollment, dept, user_id in students:
            await conn.execute(
                "INSERT INTO students (id, tenant_id, user_id, enrollment_no, name, department, semester, cgpa)"
                " VALUES (%s, %s, %s, %s, %s, %s, 5, 8.0)",
                (tid(f"student:{enrollment}"), TEST_TENANT, user_id, enrollment, enrollment, dept),
            )
            await conn.execute(
                "INSERT INTO fee_payments (tenant_id, student_id, academic_year, amount_due, due_date, status)"
                " VALUES (%s, %s, '2026-27', 100000, '2026-10-31', 'pending')",
                (TEST_TENANT, tid(f"student:{enrollment}")),
            )
        for code, dept, user_id in (("E-FAC-CSE", "CSE", USERS["faculty_cse"].uid), ("E-MECH", "MECH", None)):
            await conn.execute(
                "INSERT INTO employees (tenant_id, user_id, employee_code, name, department, designation,"
                "                       salary, appraisal_rating, appraisal_remarks)"
                " VALUES (%s, %s, %s, %s, %s, 'Professor', 1000000, 4, %s)",
                (TEST_TENANT, user_id, code, code, dept, f"REMARK-{code}"),
            )
    yield
    async with db.writer_session() as conn:
        await _cleanup(conn)
