"""Text-to-SQL for aggregate questions. The model proposes SQL; sqlglot validates it to a single
SELECT over whitelisted relations with whitelisted functions; it then runs read-only as rag_reader,
so RLS and the masking view decide which rows (and which salary values) are counted."""

import re

import sqlglot
from sqlglot import exp

from ..ai import gemini, llm

ALLOWED_TABLES = {"students", "fee_payments", "employees_secure"}
ALLOWED_FUNCS = (exp.Count, exp.Avg, exp.Sum, exp.Min, exp.Max, exp.Round, exp.Coalesce, exp.Lower, exp.Upper,
                 exp.Cast, exp.Case, exp.If, exp.Nullif)
FORBIDDEN = (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create, exp.Alter, exp.Command, exp.Into, exp.Lock)

AGG = re.compile(r"\b(average|avg|mean|how many|count|number of|total|sum of|highest|lowest|top \d+|"
                 r"per department|by department|each department|list (all|every)|rank)\b", re.I)
# Rules and policies are documents, not data: "minimum attendance needed", "maximum books allowed".
POLICY = re.compile(r"\b(needed|required|must|eligib\w*|allowed|permitted|rule|policy|regulation)\b", re.I)
TABLE = re.compile(r"\b(students?|cgpa|attendance|fees?|dues|payments?|salar(y|ies)|employees?|staff|faculty|ctc|"
                   r"appraisals?|ratings?)\b", re.I)


class SqlRejected(Exception):
    pass


def is_structured(question: str) -> bool:
    return bool(AGG.search(question) and TABLE.search(question) and not POLICY.search(question))


def validate(sql: str) -> str:
    sql = sql.strip().rstrip(";")
    if not sql:
        raise SqlRejected("empty query")
    try:
        stmts = sqlglot.parse(sql, read="postgres")
    except sqlglot.errors.ParseError as e:
        raise SqlRejected(f"unparseable: {str(e)[:80]}") from e
    if len(stmts) != 1 or not isinstance(stmts[0], exp.Select):
        raise SqlRejected("only a single SELECT is allowed")
    stmt = stmts[0]
    for node in stmt.walk():
        if isinstance(node, FORBIDDEN):
            raise SqlRejected(f"{type(node).__name__} is not allowed")
        if isinstance(node, exp.Anonymous):
            raise SqlRejected(f"function {node.name}() is not allowed")
        if isinstance(node, exp.Func) and not isinstance(node, ALLOWED_FUNCS):
            raise SqlRejected(f"function {node.key}() is not allowed")
    ctes = {c.alias_or_name for c in stmt.find_all(exp.CTE)}
    for t in stmt.find_all(exp.Table):
        if t.db or t.catalog or (t.name not in ALLOWED_TABLES and t.name not in ctes):
            raise SqlRejected(f"relation {t.sql()} is not allowed")
    return stmt.sql(dialect="postgres")


TEMPLATES = [
    (re.compile(r"average cgpa|avg cgpa|mean cgpa", re.I),
     "SELECT department, ROUND(AVG(cgpa), 2) AS avg_cgpa, COUNT(*) AS students FROM students GROUP BY department ORDER BY department"),
    (re.compile(r"average attendance", re.I),
     "SELECT department, ROUND(AVG(attendance_pct), 1) AS avg_attendance, COUNT(*) AS students FROM students GROUP BY department ORDER BY department"),
    (re.compile(r"how many students|number of students|count of students", re.I),
     "SELECT department, COUNT(*) AS students FROM students GROUP BY department ORDER BY department"),
    (re.compile(r"(pending|overdue|unpaid).*(fee|dues)|(fee|dues).*(pending|overdue|status)", re.I),
     "SELECT status, COUNT(*) AS students, SUM(amount_due - amount_paid) AS balance FROM fee_payments GROUP BY status ORDER BY status"),
    (re.compile(r"salar|ctc", re.I),
     "SELECT department, COUNT(salary) AS visible_salaries, ROUND(AVG(salary)) AS avg_salary FROM employees_secure GROUP BY department ORDER BY department"),
]


def template_for(question: str) -> str | None:
    for pattern, sql in TEMPLATES:
        if pattern.search(question):
            return sql
    return None


async def propose(question: str) -> tuple[str, str]:
    """Returns (sql, source) where source is 'llm' or 'template'."""
    try:
        sql = await llm.text_to_sql(question)
        if sql:
            return sql, "llm"
    except gemini.LLMUnavailable:
        pass
    t = template_for(question)
    if t:
        return t, "template"
    raise SqlRejected("no SQL for this question")


def tables_of(sql: str) -> list[str]:
    return sorted({t.name for t in sqlglot.parse_one(sql, read="postgres").find_all(exp.Table)} & ALLOWED_TABLES)


def all_null(rows: list[dict]) -> bool:
    if not rows:
        return True
    numeric_cols = [k for k in rows[0] if k not in ("department", "status", "name", "designation")]
    return all(r.get(k) in (None, 0) for r in rows for k in numeric_cols) if numeric_cols else False
