"""Two dashboards built on data the system already keeps.

/me/summary     a student's own record, fees and attendance, read as rag_reader under RLS. The query
                filters to the caller's own row for clarity; RLS would hide everyone else's anyway.
/insights       what people ask, what gets refused and where the knowledge base has gaps, from the
                audit log. Administrators only.
"""

import datetime as dt
import re

from fastapi import APIRouter, HTTPException, status

from ..db import secure_session, writer_session
from ..deps import CurrentUser

router = APIRouter(tags=["insights"])

# From the Academic Handbook 2026-27, p.4 (the source the Ask page cites for these numbers).
ATTENDANCE_MIN = 75.0
CONDONATION_MIN = 65.0
HANDBOOK = "Academic Handbook 2026-27, p.4"


def _num(v):
    return float(v) if v is not None else None


@router.get("/me/summary")
async def my_summary(user: CurrentUser) -> dict:
    async with secure_session(user) as conn:
        me = await (await conn.execute(
            "SELECT enrollment_no, name, department, semester, cgpa, attendance_pct, email"
            "  FROM students_secure WHERE user_id = %s", (user.uid,))).fetchone()
        fees = await (await conn.execute(
            "SELECT f.academic_year, f.amount_due, f.amount_paid, f.due_date, f.status, f.last_payment_on"
            "  FROM fee_payments f JOIN students s ON s.id = f.student_id"
            " WHERE s.user_id = %s ORDER BY f.due_date", (user.uid,))).fetchall()
    if not me:
        return {"student": None, "fees": [], "reminders": [], "rules": None}

    today = dt.date.today()
    att = _num(me["attendance_pct"])
    reminders: list[dict] = []
    if att is not None:
        if att < CONDONATION_MIN:
            reminders.append({"kind": "attendance", "level": "high", "title": "Attendance below condonation limit",
                              "detail": f"{att:.1f}% is under {CONDONATION_MIN:.0f}%: not eligible for the end-semester exam.",
                              "source": HANDBOOK})
        elif att < ATTENDANCE_MIN:
            reminders.append({"kind": "attendance", "level": "medium", "title": "Attendance below 75%",
                              "detail": f"{att:.1f}%: apply for condonation on medical grounds, with documents.",
                              "source": HANDBOOK})
        else:
            reminders.append({"kind": "attendance", "level": "ok", "title": "Attendance on track",
                              "detail": f"{att:.1f}% meets the {ATTENDANCE_MIN:.0f}% rule.", "source": HANDBOOK})
    out_fees = []
    for f in fees:
        due, paid = _num(f["amount_due"]) or 0.0, _num(f["amount_paid"]) or 0.0
        balance = max(0.0, due - paid)
        days = (f["due_date"] - today).days
        out_fees.append({"academicYear": f["academic_year"], "amountDue": due, "amountPaid": paid, "balance": balance,
                         "dueDate": f["due_date"].isoformat(), "daysLeft": days, "status": f["status"],
                         "lastPaymentOn": f["last_payment_on"].isoformat() if f["last_payment_on"] else None})
        if balance > 0:
            level = "high" if days < 0 or f["status"] == "overdue" else "medium" if days <= 14 else "low"
            when = f"{-days} days overdue" if days < 0 else "due today" if days == 0 else f"due in {days} days"
            reminders.append({"kind": "fee", "level": level, "title": f"Fee balance ₹{balance:,.0f}",
                              "detail": f"{f['academic_year']} · {when} ({f['due_date']:%d %b %Y})", "source": "fee_payments · your row",
                              "fee": len(out_fees) - 1})
    order = {"high": 0, "medium": 1, "low": 2, "ok": 3}
    reminders.sort(key=lambda r: order[r["level"]])
    return {
        "student": {"enrollmentNo": me["enrollment_no"], "name": me["name"], "department": me["department"],
                    "semester": me["semester"], "cgpa": _num(me["cgpa"]), "attendance": att, "email": me["email"]},
        "fees": out_fees,
        "reminders": reminders,
        "rules": {"attendanceMin": ATTENDANCE_MIN, "condonationMin": CONDONATION_MIN, "source": HANDBOOK},
        "scope": "rag_reader under RLS: only your own student and fee rows are visible",
    }


_NOISE = {"hello there", "hello", "hi", "test"}  # greetings and the test suite's warm-up message


def _norm(q: str) -> str:
    return re.sub(r"\s+", " ", (q or "").strip().lower()).rstrip("?.! ")


@router.get("/insights")
async def insights(user: CurrentUser, days: int = 7) -> dict:
    if "admin" not in user.roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrators only.")
    days = max(1, min(days, 30))
    async with writer_session() as conn:
        rows = await (await conn.execute(
            "SELECT a.query, a.meta, a.latency_ms, a.created_at, u.roles, u.email"
            "  FROM audit_log a JOIN users u ON u.id = a.user_id"
            " WHERE a.tenant_id = %s AND a.action = 'query' AND a.created_at > now() - make_interval(days => %s)"
            " ORDER BY a.created_at", (user.tid, days))).fetchall()

    total = len(rows)
    refused = sum(1 for r in rows if (r["meta"] or {}).get("refused"))
    cached = sum(1 for r in rows if (r["meta"] or {}).get("cache"))
    ai_calls = sum(int((r["meta"] or {}).get("llm_calls") or 0) for r in rows)
    lat = sorted(r["latency_ms"] for r in rows if r["latency_ms"] is not None and not (r["meta"] or {}).get("cache"))

    by_role: dict[str, dict] = {}
    for r in rows:
        role = next((x for x in ("admin", "hr", "finance", "hod", "faculty", "student") if x in (r["roles"] or [])), "other")
        b = by_role.setdefault(role, {"role": role, "queries": 0, "refused": 0})
        b["queries"] += 1
        b["refused"] += 1 if (r["meta"] or {}).get("refused") else 0

    questions: dict[str, dict] = {}
    for r in rows:
        k = _norm(r["query"])
        if not k or k in _NOISE:
            continue
        q = questions.setdefault(k, {"question": r["query"].strip(), "asked": 0, "refused": 0, "roles": set(), "staffRefused": 0})
        q["asked"] += 1
        role_set = set(r["roles"] or [])
        q["roles"] |= role_set
        if (r["meta"] or {}).get("refused"):
            q["refused"] += 1
            if role_set & {"admin", "finance", "hr", "hod"}:
                q["staffRefused"] += 1
    top = sorted(questions.values(), key=lambda q: (-q["asked"], q["question"]))[:8]
    # A gap: refused every time, including for privileged staff, so it is most likely missing, not forbidden.
    gaps = sorted((q for q in questions.values()
                   if q["refused"] == q["asked"] and q["staffRefused"] > 0 and len(q["question"].split()) >= 3),
                  key=lambda q: -q["asked"])[:6]
    forbidden = sorted((q for q in questions.values() if q["refused"] and q["refused"] < q["asked"]),
                       key=lambda q: -q["refused"])[:6]

    ist = dt.timezone(dt.timedelta(hours=5, minutes=30))
    hours = [0] * 24
    for r in rows:
        hours[r["created_at"].astimezone(ist).hour] += 1
    per_day: dict[str, int] = {}
    for r in rows:
        d = r["created_at"].astimezone(ist).date().isoformat()
        per_day[d] = per_day.get(d, 0) + 1

    def tally(key: str, default: str) -> list[dict]:
        out: dict[str, int] = {}
        for r in rows:
            v = (r["meta"] or {}).get(key) or default
            out[str(v)] = out.get(str(v), 0) + 1
        return [{"label": k, "count": v} for k, v in sorted(out.items(), key=lambda kv: -kv[1])]

    def pub(q: dict) -> dict:
        return {"question": q["question"], "asked": q["asked"], "refused": q["refused"], "roles": sorted(q["roles"])}

    return {
        "days": days,
        "totals": {"queries": total, "refused": refused, "cached": cached, "aiCalls": ai_calls,
                   "users": len({r["email"] for r in rows}),
                   "p50": lat[len(lat) // 2] if lat else None, "p95": lat[int(len(lat) * 0.95)] if lat else None},
        "byRole": sorted(by_role.values(), key=lambda b: -b["queries"]),
        "topQuestions": [pub(q) for q in top],
        "gaps": [pub(q) for q in gaps],
        "refusedForSome": [pub(q) for q in forbidden],
        "hours": hours,
        "perDay": [{"day": k, "count": v} for k, v in sorted(per_day.items())],
        "modes": tally("mode", "unknown"),
        "styles": tally("style", "en-formal"),
        "source": "audit_log (hash-chained), last %d days" % days,
    }
