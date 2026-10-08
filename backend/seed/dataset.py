"""Deterministic synthetic dataset for "Atmiya University". All people here are fictional.

IDs are uuid5-derived so citations stay stable across reseeds.
"""

import random
import uuid
from datetime import date, timedelta

from faker import Faker

NS = uuid.UUID("5a1d0c3e-7b2f-4c1a-9e8d-6f4b3a2c1d0e")

TENANT_NAME = "Atmiya University"

DEPARTMENTS = {
    "CSE": "Computer Science & Engineering",
    "MECH": "Mechanical Engineering",
    "CIVIL": "Civil Engineering",
    "EC": "Electronics & Communication",
}
STUDENTS_PER_DEPT = 30
FACULTY_PER_DEPT = 5
ANNUAL_FEE = {"CSE": 135000, "EC": 125000, "MECH": 115000, "CIVIL": 110000}
ACADEMIC_YEAR = "2026-27"

# Test credentials for the demo accounts (all share one password).
DEMO_PASSWORD = "Demo@123"

DEMO_USERS = [
    dict(key="student_cse", email="aarav.student@atmiya.test", name="Aarav Shah",
         roles=["student"], department="CSE", clearance=0, dept_scope=["CSE"]),
    dict(key="student_mech", email="diya.student@atmiya.test", name="Diya Patel",
         roles=["student"], department="MECH", clearance=0, dept_scope=["MECH"]),
    dict(key="faculty_cse", email="prof.mehta@atmiya.test", name="Prof. Kavita Mehta",
         roles=["faculty"], department="CSE", clearance=1, dept_scope=["CSE"]),
    dict(key="hod_cse", email="hod.cse@atmiya.test", name="Dr. Rajesh Trivedi",
         roles=["faculty", "hod"], department="CSE", clearance=2, dept_scope=["CSE"]),
    dict(key="hod_mech", email="hod.mech@atmiya.test", name="Dr. Nisha Joshi",
         roles=["faculty", "hod"], department="MECH", clearance=2, dept_scope=["MECH"]),
    dict(key="finance", email="finance@atmiya.test", name="Hitesh Desai",
         roles=["finance"], department="ACCOUNTS", clearance=2, dept_scope=["*"]),
    dict(key="hr", email="hr@atmiya.test", name="Pooja Rana",
         roles=["hr"], department="HR", clearance=3, dept_scope=["*"]),
    dict(key="admin", email="admin@atmiya.test", name="System Admin",
         roles=["admin"], department="ADMIN", clearance=3, dept_scope=["*"]),
]

APPRAISAL_REMARKS = {
    5: ["Outstanding research output and student feedback; recommended for promotion.",
        "Led two funded projects this year; exemplary mentoring of juniors."],
    4: ["Strong teaching scores; should publish more in indexed journals.",
        "Reliable and well-liked by students; good committee contributions."],
    3: ["Meets expectations. Lab sessions frequently start late.",
        "Adequate performance; needs to update course material for new syllabus."],
    2: ["Student feedback below department average; mentoring plan advised.",
        "Missed two exam-paper submission deadlines; formal warning issued."],
    1: ["Performance improvement plan initiated after repeated absences."],
}


def uid(kind: str, key: str) -> uuid.UUID:
    return uuid.uuid5(NS, f"{kind}:{key}")


def build(seed: int = 42) -> dict:
    fake = Faker("en_IN")
    Faker.seed(seed)
    rng = random.Random(seed)

    users = []
    for u in DEMO_USERS:
        users.append({**u, "id": uid("user", u["email"])})
    by_key = {u["key"]: u for u in users}

    def phone() -> str:
        return f"+91 9{rng.randint(100000000, 999999999)}"

    students, fees = [], []
    for dept in DEPARTMENTS:
        for i in range(1, STUDENTS_PER_DEPT + 1):
            enrollment = f"AU23{dept}{i:03d}"
            linked = None
            if dept == "CSE" and i == 1:
                linked = by_key["student_cse"]
            elif dept == "MECH" and i == 1:
                linked = by_key["student_mech"]
            name = linked["name"] if linked else fake.name()
            sid = uid("student", enrollment)
            students.append({
                "id": sid,
                "user_id": linked["id"] if linked else None,
                "enrollment_no": enrollment,
                "name": name,
                "department": dept,
                "semester": rng.choice([1, 3, 5, 7]),
                "cgpa": round(rng.uniform(5.5, 9.8), 2),
                "attendance_pct": round(rng.uniform(58, 98), 2),
                "email": linked["email"] if linked else f"{enrollment.lower()}@atmiya.test",
                "phone": phone(),
            })

            due = ANNUAL_FEE[dept]
            if linked is by_key.get("student_cse"):
                status = "partial"
            elif linked is by_key.get("student_mech"):
                status = "paid"
            else:
                status = rng.choices(["paid", "partial", "pending", "overdue"], [60, 20, 12, 8])[0]
            paid = {"paid": due, "partial": round(due * rng.uniform(0.4, 0.8), -3)}.get(status, 0)
            fees.append({
                "id": uid("fee", f"{enrollment}:{ACADEMIC_YEAR}"),
                "student_id": sid,
                "academic_year": ACADEMIC_YEAR,
                "amount_due": due,
                "amount_paid": paid,
                "due_date": date(2026, 8, 31) if status in ("paid", "overdue") else date(2026, 10, 31),
                "status": status,
                "last_payment_on": date(2026, 7, 1) + timedelta(days=rng.randint(0, 50)) if paid else None,
            })

    employees = []

    def employee(code, name, dept, designation, salary_range, linked=None, joined_year=None):
        rating = rng.choices([5, 4, 3, 2, 1], [15, 40, 30, 12, 3])[0]
        employees.append({
            "id": uid("employee", code),
            "user_id": linked["id"] if linked else None,
            "employee_code": code,
            "name": name,
            "department": dept,
            "designation": designation,
            "email": linked["email"] if linked else f"{code.lower()}@atmiya.test",
            "phone": phone(),
            "joined_on": date(joined_year or rng.randint(2005, 2024), rng.randint(1, 12), 1),
            "salary": round(rng.uniform(*salary_range), -3),
            "appraisal_rating": rating,
            "appraisal_remarks": rng.choice(APPRAISAL_REMARKS[rating]),
        })

    for dept in DEPARTMENTS:
        hod = by_key.get(f"hod_{dept.lower()}")
        employee(f"EMP{dept}H", hod["name"] if hod else f"Dr. {fake.name()}", dept,
                 "Professor & Head", (2_000_000, 2_400_000), linked=hod)
        for i in range(1, FACULTY_PER_DEPT + 1):
            linked = by_key["faculty_cse"] if dept == "CSE" and i == 1 else None
            designation = "Associate Professor" if i <= 2 else "Assistant Professor"
            rng_salary = (1_400_000, 1_800_000) if i <= 2 else (800_000, 1_200_000)
            employee(f"EMP{dept}{i:02d}", linked["name"] if linked else f"Prof. {fake.name()}",
                     dept, designation, rng_salary, linked=linked)

    employee("EMPACC01", by_key["finance"]["name"], "ACCOUNTS", "Accounts Officer",
             (900_000, 1_100_000), linked=by_key["finance"])
    employee("EMPACC02", fake.name(), "ACCOUNTS", "Accounts Assistant", (450_000, 600_000))
    employee("EMPHR01", by_key["hr"]["name"], "HR", "HR Manager", (1_000_000, 1_300_000), linked=by_key["hr"])
    employee("EMPADM01", by_key["admin"]["name"], "ADMIN", "IT Administrator",
             (900_000, 1_200_000), linked=by_key["admin"])

    return {"users": users, "students": students, "fees": fees, "employees": employees}
