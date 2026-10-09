import { Loader2, Lock, ShieldCheck, Sigma } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, Chip, SectionTitle, cx } from "../components/ui";
import { fetchRecords, fetchSalaryStats, fetchXray, type SalaryStat, type Xray } from "../lib/api";
import type { RecordKind, Row } from "../lib/records";
import { useSession } from "../lib/session";

const TABS: { key: RecordKind; label: string; table: string; xray: string; sql: string; cols: string[] }[] = [
  {
    key: "students", label: "Students", table: "students", xray: "students",
    sql: "SELECT id, enrollment_no, name, department, semester, cgpa,\n       attendance_pct, email, phone\n  FROM students_secure ORDER BY department, enrollment_no;",
    cols: ["enrollment_no", "name", "department", "semester", "cgpa", "attendance_pct", "email", "phone"],
  },
  {
    key: "fees", label: "Fee payments", table: "fee_payments", xray: "fee_payments",
    sql: "SELECT f.id, s.enrollment_no, s.name, s.department, f.academic_year,\n       f.amount_due, f.amount_paid, f.due_date, f.status\n  FROM fee_payments f JOIN students s ON s.id = f.student_id;",
    cols: ["enrollment_no", "name", "department", "amount_due", "amount_paid", "due_date", "status"],
  },
  {
    key: "employees", label: "Employees", table: "employees_secure", xray: "employees_secure",
    sql: "SELECT id, employee_code, name, department, designation, email,\n       salary, appraisal_rating\n  FROM employees_secure ORDER BY department, employee_code;",
    cols: ["employee_code", "name", "department", "designation", "salary", "appraisal_rating"],
  },
];

const STATUS_TONE: Record<string, "brand" | "warn" | "deny" | "default"> = { paid: "brand", partial: "warn", pending: "default", overdue: "deny" };

function fmt(col: string, v: Row[string]) {
  if (v === null || v === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-ink-3" title={col === "phone" || col === "email" ? "Masked by the students_secure view (column grants keep it off the base table too)" : "Masked by the employees_secure view"}>
        <Lock className="size-3" /> masked
      </span>
    );
  }
  if (col === "status") return <Chip tone={STATUS_TONE[String(v)] ?? "default"}>{String(v)}</Chip>;
  if (["amount_due", "amount_paid", "salary"].includes(col)) return <span className="tabular-nums">₹{Number(v).toLocaleString("en-IN")}</span>;
  return String(v);
}

export function RecordsPage() {
  const { session } = useSession();
  const [tab, setTab] = useState(TABS[0]);
  const [data, setData] = useState<{ count: number; rows: Row[] } | null>(null);
  const [xray, setXray] = useState<Xray | null>(null);
  const [pay, setPay] = useState<SalaryStat[] | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    fetchRecords(tab.key, session!).then((d) => alive && setData(d));
    fetchXray(session!).then((x) => alive && setXray(x));
    if (tab.key === "employees") fetchSalaryStats(session!).then((p) => alive && setPay(p?.rows ?? null));
    return () => {
      alive = false;
    };
  }, [tab, session]);

  const total = xray?.total?.[tab.xray];
  const visible = data?.count ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <SectionTitle eyebrow="Structured modality" title="Records">
        <div className="flex gap-1 rounded-lg border border-line bg-panel p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t)}
              className={cx("rounded-md px-3 py-1.5 text-[13px]", tab.key === t.key ? "bg-panel-2 text-ink ring-1 ring-line-2" : "text-ink-3 hover:text-ink-2")}
            >
              {t.label}
            </button>
          ))}
        </div>
      </SectionTitle>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-medium text-ink-3">Query sent by the API</span>
            <Chip tone="brand">no WHERE on the user</Chip>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-paper p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">{tab.sql}</pre>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
            The handler doesn't filter by user. Postgres applies the RLS policy for the signed context
            {tab.key === "employees" ? ", and the security-barrier view masks salary and appraisal columns" : ""}
            {tab.key === "students" ? ", and the masking view hides phone numbers (and emails for some roles); rag_reader has no grant on those base columns at all" : ""}.
          </p>
        </Card>
        <Card className="flex flex-col justify-between p-4">
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink-3">
            <ShieldCheck className="size-3.5 text-brand" /> What the database returned
            <span className="ml-auto normal-case tracking-normal">{xray?.source === "live" ? "live Postgres" : "demo data"}</span>
          </div>
          <div className="mt-3 flex items-end gap-3">
            <span className="text-4xl font-semibold tabular-nums tracking-tight">{data ? visible : "–"}</span>
            {total !== undefined && <span className="pb-1 text-sm text-ink-3">of {total} rows in {tab.table}</span>}
          </div>
          {total !== undefined && data && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.max(2, (visible / Math.max(total, 1)) * 100)}%` }} />
            </div>
          )}
          <div className="mt-3 font-mono text-[11px] text-ink-3">
            role {xray?.db_role ?? "rag_reader"} · ctx {JSON.stringify(xray?.verified_context ? { roles: xray.verified_context.roles, depts: xray.verified_context.depts, clr: xray.verified_context.clr } : {})}
          </div>
        </Card>
      </div>

      {tab.key === "employees" && pay && (
        <Card className="mt-4 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <Sigma className="size-4 text-brand" /> Aggregate-only pay · <span className="font-mono text-[12px] font-normal text-ink-3">salary_stats</span>
            </div>
            <Chip tone="brand">k-anonymity · k = 5</Chip>
          </div>
          {pay.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">No department statistics are visible to you.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {pay.map((p) => (
                <div key={p.department} className="rounded-xl bg-paper px-3 py-2.5 ring-1 ring-line">
                  <div className="flex items-center justify-between text-[12px] text-ink-3">
                    <span className="font-mono">{p.department}</span>
                    <span>{p.employees} staff</span>
                  </div>
                  <div className="mt-1 font-display text-[24px] tabular-nums">
                    {p.suppressed || p.avg_salary === null ? <span className="text-[15px] text-ink-3">withheld (fewer than 5)</span> : `₹${Number(p.avg_salary).toLocaleString("en-IN")}`}
                  </div>
                  <div className="text-[11px] text-ink-3">average annual salary</div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            Heads of department see their department's average for planning, never an individual salary. Grouping is fixed inside the view, so two
            overlapping queries can't be subtracted to isolate one person (a differencing attack), and groups under five are withheld.
          </p>
        </Card>
      )}

      <Card className="mt-4 overflow-hidden">
        {!data ? (
          <div className="grid h-40 place-items-center text-ink-3">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : data.rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-ink-3">The policy returns zero rows for your context.</div>
        ) : (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="sticky top-0 border-b border-line bg-panel-2 text-[12px] font-medium text-ink-3">
                <tr>
                  {tab.cols.map((c) => (
                    <th key={c} className="px-4 py-2.5 font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.slice(0, 200).map((r, i) => (
                  <tr key={String(r.id ?? i)} className="hover:bg-panel-2/40">
                    {tab.cols.map((c) => (
                      <td key={c} className={cx("px-4 py-2", c.endsWith("_no") || c === "employee_code" ? "font-mono text-[12px] text-ink-2" : "")}>
                        {fmt(c, r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
