import { ArrowUpRight, BookX, Clock, Languages, Loader2, Lock, MessagesSquare, Search, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarList, Donut } from "../components/charts";
import { Card, Chip, SectionTitle, Stat, cx } from "../components/ui";
import { fetchInsights, isLive, type InsightQuestion, type Insights } from "../lib/api";
import { useSession } from "../lib/session";

const STYLE_LABEL: Record<string, string> = {
  "en-formal": "English", "en-bhai": "English · bhai", "hinglish-bhai": "Hinglish · bhai", "hinglish-formal": "Hinglish",
  "hi-formal": "हिंदी", "hi-bhai": "हिंदी · bhai", "gu-formal": "ગુજરાતી", "gu-bhai": "ગુજરાતી · bhai",
};
const MODE_LABEL: Record<string, string> = { llm: "AI, grounded", extractive: "verbatim quotes", sql: "Text-to-SQL", refused: "refused" };

function Hours({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  return (
    <div>
      <div className="flex h-28 items-end gap-[3px]">
        {hours.map((n, h) => (
          <div key={h} title={`${String(h).padStart(2, "0")}:00 IST · ${n} questions`}
               className={cx("flex-1 rounded-t-[3px] transition-[height] duration-700", n ? "bg-brand" : "bg-panel-2")}
               style={{ height: `${Math.max(4, (n / max) * 100)}%`, opacity: n ? 0.35 + 0.65 * (n / max) : 1 }} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-ink-3"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
    </div>
  );
}

function QuestionList({ items, empty, tone }: { items: InsightQuestion[]; empty: string; tone?: "deny" | "warn" }) {
  if (!items.length) return <p className="text-[13px] text-ink-3">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((q) => (
        <li key={q.question} className="flex items-start gap-3 py-2.5">
          <span className={cx("mt-0.5 w-8 shrink-0 text-right font-display text-[20px] leading-none tabular-nums",
                              tone === "deny" ? "text-deny" : tone === "warn" ? "text-warn" : "text-ink")}>{q.asked}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] text-ink" title={q.question}>{q.question}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {q.roles.map((r) => <Chip key={r}>{r}</Chip>)}
              {q.refused > 0 && <Chip tone={q.refused === q.asked ? "deny" : "warn"}>{q.refused === q.asked ? "always refused" : `${q.refused} refused`}</Chip>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function InsightsPage() {
  const { session } = useSession();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = session?.user.roles.includes("admin");

  useEffect(() => {
    if (!session || !isAdmin) return;
    if (!isLive(session)) {
      setError("Insights read the live audit log. Connect the backend to see them.");
      return;
    }
    setData(null);
    fetchInsights(session, days).then(setData).catch((e) => setError((e as Error).message));
  }, [session, days, isAdmin]);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <Lock className="mx-auto size-8 text-ink-3" />
        <h1 className="mt-4 font-display text-[34px]">Insights are for administrators</h1>
        <p className="mt-2 text-[14px] text-ink-2">They summarise everyone's questions from the audit log, so only the admin role can open them.</p>
      </div>
    );
  }

  const t = data?.totals;
  const refusalRate = t && t.queries ? t.refused / t.queries : 0;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <SectionTitle eyebrow="What the campus is asking" title="Insights">
        <div className="flex gap-1 rounded-lg border border-line bg-panel p-1">
          {[1, 7, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)}
                    className={cx("rounded-md px-3 py-1.5 text-[13px]", days === d ? "bg-panel-2 text-ink ring-1 ring-line-2" : "text-ink-3 hover:text-ink-2")}>
              {d === 1 ? "24 h" : `${d} days`}
            </button>
          ))}
        </div>
      </SectionTitle>

      {error && <Card className="p-5 text-[14px] text-ink-2">{error}</Card>}
      {!data && !error && <div className="flex items-center gap-2 text-[13px] text-ink-3"><Loader2 className="size-4 animate-spin" /> Reading the audit log…</div>}

      {data && t && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Questions asked" value={t.queries} hint={`${t.users} people · last ${data.days === 1 ? "24 hours" : `${data.days} days`}`} />
            <Stat label="Answered" value={`${Math.round((1 - refusalRate) * 100)}%`} tone="brand" hint={`${t.refused} refused, all uniformly`} />
            <Stat label="Served from cache" value={t.cached} hint={`${t.aiCalls} AI calls in total`} />
            <Stat label="Median answer time" value={t.p50 != null ? `${(t.p50 / 1000).toFixed(1)}s` : "–"} hint={t.p95 != null ? `p95 ${(t.p95 / 1000).toFixed(1)}s, uncached` : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
            <Card className="p-5">
              <h2 className="flex items-center gap-2 text-[14px] font-medium"><MessagesSquare className="size-4 text-brand" /> Most asked</h2>
              <div className="mt-3"><QuestionList items={data.topQuestions} empty="No questions in this period yet." /></div>
            </Card>
            <Card className="p-5">
              <h2 className="flex items-center gap-2 text-[14px] font-medium"><BookX className="size-4 text-deny" /> Knowledge gaps</h2>
              <p className="mt-1 text-[12.5px] text-ink-3">Refused every time, even for senior staff: probably a missing document, not a forbidden one.</p>
              <div className="mt-3"><QuestionList items={data.gaps} empty="No gaps: everything asked by staff was answered." tone="deny" /></div>
              <Link to="/knowledge" className="mt-3 inline-flex items-center gap-1 text-[12.5px] text-brand hover:underline">
                Upload a document to close a gap <ArrowUpRight className="size-3.5" />
              </Link>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <Card className="p-5">
              <h2 className="flex items-center gap-2 text-[14px] font-medium"><Users className="size-4 text-brand" /> Refusals by role</h2>
              <p className="mt-1 text-[12.5px] text-ink-3">High for students is expected: the access rules are working.</p>
              <div className="mt-4">
                <BarList items={data.byRole.map((r) => ({ label: `${r.role} · ${r.queries} asked`, value: r.queries ? Math.round((r.refused / r.queries) * 100) : 0,
                                                          tone: r.role === "student" ? "warn" : "brand" }))} unit="%" />
              </div>
            </Card>
            <Card className="p-5">
              <h2 className="flex items-center gap-2 text-[14px] font-medium"><Clock className="size-4 text-brand" /> When people ask (IST)</h2>
              <div className="mt-4"><Hours hours={data.hours} /></div>
            </Card>
            <Card className="p-5">
              <h2 className="flex items-center gap-2 text-[14px] font-medium"><Languages className="size-4 text-brand" /> How answers were made</h2>
              <div className="mt-4 min-w-0">
                <Donut parts={data.modes.map((m) => ({ label: MODE_LABEL[m.label] ?? m.label, value: m.count }))} center={String(t.queries)} />
              </div>
              <div className="mt-4 border-t border-line pt-3">
                <div className="text-[12px] text-ink-3">Reply language and tone</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.styles.slice(0, 6).map((s) => (
                    <Chip key={s.label} tone={s.label === "en-formal" ? "default" : "brand"}>{STYLE_LABEL[s.label] ?? s.label} · {s.count}</Chip>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-[14px] font-medium"><Search className="size-4 text-warn" /> Refused for some, answered for others</h2>
            <p className="mt-1 text-[12.5px] text-ink-3">The same question gets different answers by role. This is access control doing its job, and a hint of what each role looks for.</p>
            <div className="mt-3"><QuestionList items={data.refusedForSome} empty="Nothing yet." tone="warn" /></div>
          </Card>

          <p className="font-mono text-[11px] text-ink-3">source · {data.source} · admin only</p>
        </div>
      )}
    </div>
  );
}
