import { ArrowUpRight, BellRing, CalendarClock, CircleCheck, GraduationCap, HandHeart, IndianRupee, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, SectionTitle, cx } from "../components/ui";
import { fetchMySummary, isLive, type MySummary, type Reminder } from "../lib/api";
import { useSession } from "../lib/session";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const TONE_KEY = "vaultrag.tone";

/** The same reminder, said like an elder brother. Facts are filled in from the data, never invented. */
function bhai(r: Reminder, s: MySummary): { title: string; detail: string } {
  const att = s.student?.attendance ?? 0;
  if (r.kind === "attendance") {
    if (r.level === "ok") return { title: "Attendance ekdum sahi hai", detail: `Bhai, ${att.toFixed(1)}% hai, 75% wala rule pass. Aise hi chalne de!` };
    if (r.level === "high") return { title: "Bhai, attendance bahut kam hai", detail: `${att.toFixed(1)}% hai, 65% se bhi kam. Exam ke liye eligible nahi hoga, jaldi HOD se baat kar.` };
    return { title: "Bhai, attendance 75% se kam hai", detail: `${att.toFixed(1)}% hai. Medical grounds pe condonation ke liye documents ke saath apply kar de.` };
  }
  const f = r.fee !== undefined ? s.fees[r.fee] : undefined;
  if (!f) return { title: r.title, detail: r.detail };
  const when = f.daysLeft < 0 ? `${-f.daysLeft} din late ho gaya` : f.daysLeft === 0 ? "aaj last date hai" : `${f.daysLeft} din bache hain`;
  return { title: `Bhai, ${inr(f.balance)} fees baaki hai`, detail: `${when} (${new Date(f.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}). Time pe bhar de, tension free reh.` };
}

const LEVEL = {
  high: { ring: "ring-deny/30 bg-deny/[0.06]", icon: TriangleAlert, color: "text-deny", label: "urgent" },
  medium: { ring: "ring-warn/30 bg-warn/[0.07]", icon: BellRing, color: "text-warn", label: "soon" },
  low: { ring: "ring-line bg-panel", icon: CalendarClock, color: "text-ink-2", label: "upcoming" },
  ok: { ring: "ring-brand/25 bg-brand-soft/60", icon: CircleCheck, color: "text-brand", label: "on track" },
} as const;

function AttendanceDial({ value, min, condone }: { value: number; min: number; condone: number }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, value / 100));
  const tone = value >= min ? "var(--color-brand)" : value >= condone ? "var(--color-warn)" : "var(--color-deny)";
  const tick = (p: number) => {
    const a = (p / 100) * 2 * Math.PI - Math.PI / 2;
    return { x1: 90 + 60 * Math.cos(a), y1: 90 + 60 * Math.sin(a), x2: 90 + 82 * Math.cos(a), y2: 90 + 82 * Math.sin(a) };
  };
  return (
    <svg viewBox="0 0 180 180" className="size-[180px]" role="img" aria-label={`Attendance ${value}%`}>
      <circle cx="90" cy="90" r={r} fill="none" stroke="var(--color-panel-2)" strokeWidth="14" />
      <circle cx="90" cy="90" r={r} fill="none" stroke={tone} strokeWidth="14" strokeLinecap="round"
              strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 90 90)" style={{ transition: "stroke-dasharray 900ms cubic-bezier(.2,.7,.2,1)" }} />
      <line {...tick(min)} stroke="var(--color-ink)" strokeWidth="2" />
      <line {...tick(condone)} stroke="var(--color-ink-3)" strokeWidth="1.5" strokeDasharray="2 2" />
      <text x="90" y="88" textAnchor="middle" className="fill-ink font-display" fontSize="38">{value.toFixed(0)}%</text>
      <text x="90" y="110" textAnchor="middle" className="fill-ink-3" fontSize="11">attendance</text>
    </svg>
  );
}

export function MePage() {
  const { session } = useSession();
  const [data, setData] = useState<MySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bhaiMode, setBhaiMode] = useState(() => {
    try {
      return localStorage.getItem(TONE_KEY) === "bhai";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!session || !isLive(session)) {
      setError("The student dashboard reads your rows from the live database. Connect the backend to see it.");
      return;
    }
    fetchMySummary(session).then(setData).catch((e) => setError((e as Error).message));
  }, [session]);

  const st = data?.student;
  const fee = data?.fees[0];
  const paidFrac = fee ? Math.min(1, fee.amountPaid / (fee.amountDue || 1)) : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      <SectionTitle eyebrow="Only your own rows" title={st ? `Hi, ${st.name.split(" ")[0]}` : "My dashboard"}>
        <button
          onClick={() => setBhaiMode((v) => !v)}
          aria-pressed={bhaiMode}
          className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] ring-1 transition-colors",
                        bhaiMode ? "bg-brand text-paper ring-brand" : "text-ink-2 ring-line-2 hover:text-ink")}
        >
          <HandHeart className="size-4" /> Bhai mode {bhaiMode ? "on" : "off"}
        </button>
      </SectionTitle>

      {error && <Card className="p-5 text-[14px] text-ink-2">{error}</Card>}
      {!data && !error && <div className="flex items-center gap-2 text-[13px] text-ink-3"><Loader2 className="size-4 animate-spin" /> Reading your rows…</div>}

      {data && !st && (
        <Card className="p-6">
          <div className="font-display text-[26px]">No student record for this account</div>
          <p className="mt-2 max-w-xl text-[14px] text-ink-2">
            This dashboard shows the signed-in student's own record. Staff accounts have none, and the database will not show anyone else's.
          </p>
        </Card>
      )}

      {data && st && (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
            <Card className="p-5">
              <div className="flex items-center gap-2 text-[12px] font-medium tracking-[0.08em] text-ink-3 uppercase">
                <BellRing className="size-3.5" /> Reminders
              </div>
              <ul className="mt-4 space-y-2.5">
                {data.reminders.map((r, i) => {
                  const L = LEVEL[r.level];
                  const text = bhaiMode ? bhai(r, data) : { title: r.title, detail: r.detail };
                  return (
                    <li key={i} className={cx("fade-up flex items-start gap-3 rounded-xl p-3.5 ring-1", L.ring)} style={{ animationDelay: `${i * 80}ms` }}>
                      <L.icon className={cx("mt-0.5 size-4.5 shrink-0", L.color)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14.5px] font-medium">{text.title}</span>
                          <span className={cx("rounded px-1.5 font-mono text-[10px] uppercase", L.color)}>{L.label}</span>
                        </div>
                        <div className="mt-0.5 text-[13px] text-ink-2">{text.detail}</div>
                        <div className="mt-1 font-mono text-[10.5px] text-ink-3">source · {r.source}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card className="flex flex-col items-center justify-center p-5">
              <AttendanceDial value={st.attendance ?? 0} min={data.rules!.attendanceMin} condone={data.rules!.condonationMin} />
              <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-ink" /> {data.rules!.attendanceMin}% to sit the exam</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 border-l border-dashed border-ink-3" /> {data.rules!.condonationMin}% with condonation</span>
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-ink-3">{data.rules!.source}</div>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 [&>*]:min-w-0">
            <Card className="p-5">
              <div className="flex items-center gap-2 text-[12.5px] text-ink-3"><IndianRupee className="size-3.5" /> Fee balance {fee?.academicYear}</div>
              <div className="mt-1.5 font-display text-[40px] leading-none tabular-nums">{fee ? inr(fee.balance) : "–"}</div>
              {fee && (
                <>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel-2">
                    <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${paidFrac * 100}%` }} />
                  </div>
                  <div className="mt-1.5 text-[12px] text-ink-3">{inr(fee.amountPaid)} paid of {inr(fee.amountDue)} · {fee.status}</div>
                </>
              )}
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 text-[12.5px] text-ink-3"><CalendarClock className="size-3.5" /> Due date</div>
              <div className={cx("mt-1.5 font-display text-[40px] leading-none tabular-nums", fee && fee.daysLeft < 0 && "text-deny")}>
                {fee ? (fee.daysLeft < 0 ? `${-fee.daysLeft}d late` : `${fee.daysLeft} days`) : "–"}
              </div>
              <div className="mt-2 text-[12px] text-ink-3">{fee ? new Date(fee.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : ""}</div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 text-[12.5px] text-ink-3"><GraduationCap className="size-3.5" /> CGPA · semester {st.semester}</div>
              <div className="mt-1.5 font-display text-[40px] leading-none tabular-nums">{st.cgpa?.toFixed(2) ?? "–"}</div>
              <div className="mt-2 text-[12px] text-ink-3">{st.enrollmentNo} · {st.department}</div>
            </Card>
          </div>

          <Card className="flex flex-wrap items-center gap-3 p-4">
            <ShieldCheck className="size-4 text-brand" />
            <span className="min-w-0 flex-1 text-[13px] text-ink-2">
              Read as <span className="font-mono">rag_reader</span> under RLS: the database returns your own student and fee rows and nothing else.
            </span>
            {[
              bhaiMode ? "Bhai, exam dene ke liye minimum kitni attendance chahiye?" : "What is the minimum attendance needed to sit the exam?",
              "What is the B.Tech fee structure this year?",
            ].map((q) => (
              <Link key={q} to={`/ask?q=${encodeURIComponent(q)}`}
                    className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-[12.5px] text-paper hover:bg-brand">
                Ask: {q.length > 34 ? q.slice(0, 32) + "…" : q} <ArrowUpRight className="size-3.5" />
              </Link>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
