"""Structured rows -> citable "record cards". Each card's ACL mirrors the RLS policy of its table,
so the vector index never widens what a user could already read with SQL."""

from collections import Counter, defaultdict

from psycopg import AsyncConnection

DEPT_NAMES = {"CSE": "Computer Science & Engineering", "MECH": "Mechanical Engineering",
              "CIVIL": "Civil Engineering", "EC": "Electronics & Communication",
              "ACCOUNTS": "Accounts", "HR": "Human Resources", "ADMIN": "Administration"}


def inr(n) -> str:
    """Indian digit grouping: 135000 -> ₹1,35,000."""
    n = int(round(float(n)))
    s = str(abs(n))
    head, tail = s[:-3], s[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ("-" if n < 0 else "") + "₹" + ",".join(groups + [tail]) if groups else f"₹{tail}"


def card(title, row_ref, content, record, *, classification, department=None, roles=(), users=()):
    return {
        "title": title, "row_ref": row_ref, "content": content, "record": record,
        "classification": classification, "department": department,
        "allowed_roles": list(roles), "allowed_users": [u for u in users if u],
    }


async def build_cards(conn: AsyncConnection, tenant) -> list[dict]:
    """Read every structured row as rag_writer and turn it into a card with the row's ACL."""
    cards: list[dict] = []
    students = await (await conn.execute(
        "SELECT * FROM students WHERE tenant_id = %s ORDER BY department, enrollment_no", (tenant,))).fetchall()
    by_id = {s["id"]: s for s in students}
    for s in students:
        cards.append(card(
            f"students · {s['enrollment_no']}", f"db://students/{s['enrollment_no']}",
            f"Student record: {s['name']} ({s['enrollment_no']}), {DEPT_NAMES[s['department']]} ({s['department']}), "
            f"semester {s['semester']}, CGPA {s['cgpa']}, attendance {s['attendance_pct']}%.",
            {"enrollment_no": s["enrollment_no"], "name": s["name"], "department": s["department"],
             "semester": str(s["semester"]), "cgpa": str(s["cgpa"]), "attendance_pct": str(s["attendance_pct"])},
            classification=1, department=s["department"], roles=("faculty", "hod", "finance", "hr"), users=(s["user_id"],),
        ))

    fees = await (await conn.execute(
        "SELECT * FROM fee_payments WHERE tenant_id = %s", (tenant,))).fetchall()
    status = Counter()
    overdue_by_dept = Counter()
    outstanding = 0.0
    for f in fees:
        s = by_id[f["student_id"]]
        balance = float(f["amount_due"]) - float(f["amount_paid"])
        status[f["status"]] += 1
        outstanding += balance
        if f["status"] == "overdue":
            overdue_by_dept[s["department"]] += 1
        cards.append(card(
            f"fee_payments · {s['enrollment_no']}", f"db://fee_payments/{s['enrollment_no']}",
            f"Fee record {f['academic_year']} for {s['name']} ({s['enrollment_no']}, {s['department']}): "
            f"amount due {inr(f['amount_due'])}, paid {inr(f['amount_paid'])}, balance {inr(balance)}, "
            f"due date {f['due_date']:%d %B %Y}, status {f['status']}.",
            {"enrollment_no": s["enrollment_no"], "name": s["name"], "department": s["department"],
             "academic_year": f["academic_year"], "amount_due": inr(f["amount_due"]), "amount_paid": inr(f["amount_paid"]),
             "balance": inr(balance), "due_date": str(f["due_date"]), "status": f["status"]},
            classification=1, roles=("finance",), users=(s["user_id"],),
        ))
    if fees:
        od = ", ".join(f"{d} {n}" for d, n in overdue_by_dept.most_common())
        cards.append(card(
            "fee_payments · status summary", "db://fee_payments?group_by=status",
            f"Fee status 2026-27 across {len(fees)} students: {status['paid']} paid, {status['partial']} partial, "
            f"{status['pending']} pending, {status['overdue']} overdue. Total outstanding balance {inr(outstanding)}. "
            f"Overdue accounts by department: {od or 'none'}.",
            {"paid": str(status["paid"]), "partial": str(status["partial"]), "pending": str(status["pending"]),
             "overdue": str(status["overdue"]), "outstanding": inr(outstanding), "overdue_by_dept": od or "none"},
            classification=2, roles=("finance",),
        ))

    employees = await (await conn.execute(
        "SELECT * FROM employees WHERE tenant_id = %s ORDER BY department, employee_code", (tenant,))).fetchall()
    by_dept = defaultdict(list)
    for e in employees:
        by_dept[e["department"]].append(e)
        cards.append(card(
            f"employees · {e['employee_code']} (compensation)", f"db://employees_secure/{e['employee_code']}#salary",
            f"Compensation record: {e['name']} ({e['employee_code']}), {e['designation']}, {e['department']}: "
            f"annual salary (CTC) {inr(e['salary'])}.",
            {"employee_code": e["employee_code"], "name": e["name"], "designation": e["designation"],
             "department": e["department"], "salary": inr(e["salary"])},
            classification=2, roles=("hr", "finance"), users=(e["user_id"],),
        ))
        cards.append(card(
            f"employees · {e['employee_code']} (appraisal)", f"db://employees_secure/{e['employee_code']}#appraisal",
            f"Appraisal 2025-26: {e['name']} ({e['employee_code']}), {e['designation']}, rated "
            f"{e['appraisal_rating']}/5. Remarks: {e['appraisal_remarks']}",
            {"employee_code": e["employee_code"], "name": e["name"], "appraisal_rating": f"{e['appraisal_rating']} / 5",
             "appraisal_remarks": e["appraisal_remarks"]},
            classification=3, roles=("hr",), users=(e["user_id"],),
        ))
    for dept, staff in by_dept.items():
        entries = "; ".join(f"{e['name']}, {e['designation']} ({e['email']})" for e in staff)
        cards.append(card(
            f"employees · directory ({dept})", f"db://employees_secure?department={dept}",
            f"Staff directory, {DEPT_NAMES.get(dept, dept)} ({dept}): {entries}.",
            {e["name"]: e["designation"] for e in staff} | {"salary": "•••• masked"},
            classification=0, roles=("*",),
        ))
    return cards
