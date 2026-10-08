"""End-to-end through FastAPI against the seeded Atmiya tenant (run `python -m app.cli seed` first)."""

import pytest
from httpx import ASGITransport, AsyncClient

from app import db
from app.main import app
from seed.dataset import DEMO_PASSWORD, STUDENTS_PER_DEPT, DEPARTMENTS

TOTAL_STUDENTS = STUDENTS_PER_DEPT * len(DEPARTMENTS)


@pytest.fixture
async def client(pools):
    async with db.writer_session() as conn:
        row = await (await conn.execute("SELECT count(*) AS n FROM users WHERE email = 'admin@atmiya.test'")).fetchone()
    if row["n"] == 0:
        pytest.skip("demo tenant not seeded")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def auth(client, email: str) -> dict:
    r = await client.post("/auth/login", json={"email": email, "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_login_rejects_bad_password(client):
    r = await client.post("/auth/login", json={"email": "admin@atmiya.test", "password": "nope"})
    assert r.status_code == 401
    r = await client.post("/auth/login", json={"email": "ghost@atmiya.test", "password": "nope"})
    assert r.status_code == 401


async def test_requires_token(client):
    assert (await client.get("/records/students")).status_code == 401
    r = await client.get("/records/students", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


@pytest.mark.parametrize(
    "email, students, fees",
    [
        ("aarav.student@atmiya.test", 1, 1),
        ("prof.mehta@atmiya.test", STUDENTS_PER_DEPT, 0),
        ("hod.cse@atmiya.test", STUDENTS_PER_DEPT, 0),
        ("finance@atmiya.test", TOTAL_STUDENTS, TOTAL_STUDENTS),
        ("admin@atmiya.test", TOTAL_STUDENTS, TOTAL_STUDENTS),
    ],
)
async def test_same_endpoint_different_rows(client, email, students, fees):
    h = await auth(client, email)
    assert (await client.get("/records/students", headers=h)).json()["count"] == students
    assert (await client.get("/records/fees", headers=h)).json()["count"] == fees


async def test_student_sees_only_self(client):
    h = await auth(client, "aarav.student@atmiya.test")
    rows = (await client.get("/records/students", headers=h)).json()["rows"]
    assert [r["name"] for r in rows] == ["Aarav Shah"]


async def test_salary_masked_for_hod_visible_for_hr(client):
    hod = (await client.get("/records/employees", headers=await auth(client, "hod.cse@atmiya.test"))).json()
    hr = (await client.get("/records/employees", headers=await auth(client, "hr@atmiya.test"))).json()
    assert hod["count"] == hr["count"] > 0
    assert all(r["salary"] is None for r in hod["rows"] if r["name"] != "Dr. Rajesh Trivedi")
    assert all(r["salary"] is not None and r["appraisal_remarks"] for r in hr["rows"])


async def test_xray_reports_db_enforced_scope(client):
    h = await auth(client, "aarav.student@atmiya.test")
    body = (await client.get("/security/xray", headers=h)).json()
    assert body["db_role"] == "rag_reader"
    assert body["verified_context"]["roles"] == ["student"]
    assert body["visible"]["students"] == 1
    assert body["total"]["students"] == TOTAL_STUDENTS
