"""Load the synthetic dataset as rag_writer. Idempotent: wipes and reloads the demo tenant."""

import psycopg

from app.config import get_settings
from app.db import conninfo
from app.security import hash_password

from . import dataset


async def load() -> None:
    s = get_settings()
    tid = s.tenant_id
    data = dataset.build()
    password_hash = hash_password(dataset.DEMO_PASSWORD)

    async with await psycopg.AsyncConnection.connect(conninfo("rag_writer", s.db_writer_password)) as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM audit_log WHERE tenant_id = %s", (tid,))
            await conn.execute("DELETE FROM tenants WHERE id = %s", (tid,))  # cascades to everything else
            await conn.execute("INSERT INTO tenants (id, name) VALUES (%s, %s)", (tid, dataset.TENANT_NAME))

            async with conn.cursor() as cur:
                await cur.executemany(
                    "INSERT INTO users (id, tenant_id, email, name, password_hash, roles, department,"
                    "                   clearance, dept_scope)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    [(u["id"], tid, u["email"], u["name"], password_hash, u["roles"], u["department"],
                      u["clearance"], u["dept_scope"]) for u in data["users"]],
                )
                await cur.executemany(
                    "INSERT INTO students (id, tenant_id, user_id, enrollment_no, name, department,"
                    "                      semester, cgpa, attendance_pct, email, phone)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    [(r["id"], tid, r["user_id"], r["enrollment_no"], r["name"], r["department"],
                      r["semester"], r["cgpa"], r["attendance_pct"], r["email"], r["phone"])
                     for r in data["students"]],
                )
                await cur.executemany(
                    "INSERT INTO fee_payments (id, tenant_id, student_id, academic_year, amount_due,"
                    "                          amount_paid, due_date, status, last_payment_on)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    [(r["id"], tid, r["student_id"], r["academic_year"], r["amount_due"], r["amount_paid"],
                      r["due_date"], r["status"], r["last_payment_on"]) for r in data["fees"]],
                )
                await cur.executemany(
                    "INSERT INTO employees (id, tenant_id, user_id, employee_code, name, department,"
                    "                       designation, email, phone, joined_on, salary,"
                    "                       appraisal_rating, appraisal_remarks)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    [(r["id"], tid, r["user_id"], r["employee_code"], r["name"], r["department"],
                      r["designation"], r["email"], r["phone"], r["joined_on"], r["salary"],
                      r["appraisal_rating"], r["appraisal_remarks"]) for r in data["employees"]],
                )

    print(f"seeded tenant {tid}: {len(data['users'])} users, {len(data['students'])} students, "
          f"{len(data['employees'])} employees, {len(data['fees'])} fee records")
