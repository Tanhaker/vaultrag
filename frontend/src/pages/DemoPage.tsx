import { ArrowLeft, ArrowUpRight, CircleCheck, Eye, Loader2, Play, ShieldX, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Logo } from "../components/Layout";
import { Avatar, Chip, cx } from "../components/ui";
import { ACTS, SCENARIOS, type Scenario } from "../lib/demo";
import { personaFor } from "../lib/personas";
import { useSession } from "../lib/session";

function useRun() {
  const { session, switchTo } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async (s: Scenario) => {
    setBusy(s.id);
    try {
      if (session?.user.email !== s.as) await switchTo(s.as);
      navigate(s.question ? `/ask?q=${encodeURIComponent(s.question)}` : s.path ?? "/ask");
    } catch {
      navigate("/login");
    } finally {
      setBusy(null);
    }
  }, [session, switchTo, navigate]);
  return { run, busy };
}

function ScenarioCard({ s, n, onRun, busy }: { s: Scenario; n: number; onRun: () => void; busy: boolean }) {
  const p = personaFor(s.as)!;
  return (
    <article className="fade-up flex flex-col rounded-2xl bg-panel p-5 shadow-card ring-1 ring-line">
      <div className="flex items-start gap-3">
        <span className="font-display text-[30px] leading-none text-ink-3 tabular-nums">{String(n).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-medium leading-snug">{s.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip tone={s.expect === "answer" ? "brand" : "deny"}>
              {s.expect === "answer" ? <CircleCheck className="size-3" /> : <ShieldX className="size-3" />} {s.expect === "answer" ? "answers" : "refuses"}
            </Chip>
            <Chip>{s.criterion}</Chip>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-panel-2/60 px-3 py-2">
        <Avatar name={p.name} size="sm" />
        <div className="min-w-0 flex-1 text-[12.5px]">
          <div className="truncate font-medium">{p.name}</div>
          <div className="truncate text-ink-3">{p.title}</div>
        </div>
      </div>
      {s.question ? (
        <p className="mt-3 rounded-xl border border-dashed border-line-2 px-3 py-2 text-[14px] text-ink">“{s.question}”</p>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-line-2 px-3 py-2 font-mono text-[12.5px] text-ink-2">opens {s.path}</p>
      )}

      <div className="mt-4 flex items-center gap-1.5 text-[11.5px] font-medium tracking-[0.08em] text-ink-3 uppercase"><Eye className="size-3.5" /> Look for</div>
      <ul className="mt-1.5 space-y-1 text-[13px] text-ink-2">
        {s.look.map((l) => <li key={l} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-brand" />{l}</li>)}
      </ul>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-3"><span className="font-medium text-ink-2">Why it matters: </span>{s.why}</p>

      <div className="mt-auto pt-4">
        <button onClick={onRun} disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[13.5px] font-medium text-paper transition-colors hover:bg-brand disabled:opacity-60">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run as {p.name.split(" ").slice(-2).join(" ")}
          <ArrowUpRight className="size-4 opacity-60" />
        </button>
      </div>
    </article>
  );
}

export function DemoPage() {
  const { run, busy } = useRun();
  useEffect(() => {
    document.title = "Guided demo · DefRAG";
  }, []);
  let n = 0;
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/" aria-label="DefRAG story"><Logo /></Link>
          <Link to="/" className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4" /> Story</Link>
          <Link to="/login" className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] text-paper hover:bg-brand">All accounts</Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="mb-1.5 font-display text-[17px] italic text-ink-3">A script for the pitch, with real data</div>
        <h1 className="font-display text-[40px] leading-[1.02] tracking-[-0.01em] sm:text-[56px]">Guided demo</h1>
        <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-ink-2">
          Fifteen documents (PDFs, scans and photos), 120 students with fee records, 28 staff and eight people with different access. Each
          scenario signs in as the right person and asks the question for you. Read what to look for, press Run, then come back here.
        </p>
        <div className="mt-5 flex flex-wrap gap-2 text-[12.5px] text-ink-2">
          {[["Public", "handbook, calendar, scholarships, fee and library notices"], ["Internal", "exam policy, placement report"],
            ["Confidential", "four department budgets, finance minutes"], ["Restricted", "scanned faculty appraisal"]].map(([k, v]) => (
            <span key={k} className="rounded-full bg-panel px-3 py-1 ring-1 ring-line"><span className="font-medium text-ink">{k}</span> · {v}</span>
          ))}
        </div>

        {ACTS.map((act) => (
          <section key={act} className="mt-12">
            <h2 className="flex items-center gap-2 font-display text-[28px]"><Sparkles className="size-5 text-brand" /> {act}</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {SCENARIOS.filter((s) => s.act === act).map((s) => {
                n += 1;
                return <ScenarioCard key={s.id} s={s} n={n} busy={busy === s.id} onRun={() => run(s)} />;
              })}
            </div>
          </section>
        ))}

        <p className="mt-12 text-[12px] text-ink-3">Every person and record here is fictional. Answers to these questions are pre-computed in the database cache so the demo runs without spending AI quota.</p>
      </div>
    </div>
  );
}
