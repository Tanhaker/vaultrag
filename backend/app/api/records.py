"""Structured records, read through rag_reader.

These queries deliberately have no WHERE clause on the user. Row scope and column
masking are applied by Postgres (RLS policies and the students_secure, employees_secure and
salary_stats views), so a missing filter in application code cannot leak data.
"""

from fastapi import APIRouter

from ..deps import ReaderConn

router = APIRouter(prefix="/records", tags=["records"])


async def _rows(conn, query: str) -> dict:
    rows = await (await conn.execute(query)).fetchall()
    return {"count": len(rows), "rows": rows}


@router.get("/students")
async def students(conn: ReaderConn) -> dict:
    return await _rows(
        conn,
        "SELECT id, enrollment_no, name, department, semester, cgpa, attendance_pct, email, phone"
        "  FROM students_secure ORDER BY department, enrollment_no",
    )


@router.get("/fees")
async def fees(conn: ReaderConn) -> dict:
    return await _rows(
        conn,
        "SELECT f.id, s.enrollment_no, s.name, s.department, f.academic_year,"
        "       f.amount_due, f.amount_paid, f.due_date, f.status"
        "  FROM fee_payments f JOIN students s ON s.id = f.student_id"
        " ORDER BY s.department, s.enrollment_no",
    )


@router.get("/employees")
async def employees(conn: ReaderConn) -> dict:
    return await _rows(
        conn,
        "SELECT id, employee_code, name, department, designation, email, joined_on,"
        "       salary, appraisal_rating, appraisal_remarks"
        "  FROM employees_secure ORDER BY department, employee_code",
    )


@router.get("/salary-stats")
async def salary_stats(conn: ReaderConn) -> dict:
    """Aggregate-only pay: department averages, withheld below k = 5 employees."""
    return await _rows(conn, "SELECT department, employees, avg_salary, suppressed FROM salary_stats ORDER BY department")
