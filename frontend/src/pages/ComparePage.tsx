import { Eye, EyeOff, Play, ShieldOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import { AnswerCard, SourceRow } from "../components/AnswerCard";
import { SourceViewer } from "../components/SourceViewer";
import { Avatar, Button, ClassBadge, SectionTitle, cx } from "../components/ui";
import { SUGGESTED_QUESTIONS } from "../lib/corpus";
import { ask } from "../lib/engine";
import { PERSONAS, toUser } from "../lib/personas";
import type { Answer, Citation } from "../lib/types";

const DEFAULT_SLOTS = ["aarav.student@atmiya.test", "hod.cse@atmiya.test", "finance@atmiya.test"];

export function ComparePage() {
  const [slots, setSlots] = useState<string[]>(DEFAULT_SLOTS);
  const [question, setQuestion] = useState(SUGGESTED_QUESTIONS[0]);
  const [answers, setAnswers] = useState<(Answer | null)[]>([null, null, null]);
  const [runId, setRunId] = useState(0);
  const [xray, setXray] = useState(false);
  const [source, setSource] = useState<Citation | null>(null);

  async function run(q = question) {
    if (!q.trim()) return;
    setQuestion(q);
    const results = await Promise.all(
      slots.map((email) => ask(q, toUser(PERSONAS.find((p) => p.email === email)!))),
    );
    setAnswers(results);
    setRunId((n) => n + 1);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    run();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <SectionTitle eyebrow="Same question · different clearance" title="Compare users side by side">
        <Button variant={xray ? "primary" : "outline"} onClick={() => setXray((v) => !v)}>
          {xray ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          Presenter X-ray
        </Button>
      </SectionTitle>

      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="flex-1 rounded-xl bg-panel ring-1 ring-line-2 px-4 py-2.5 text-[14.5px] outline-none focus:border-brand/50"
          placeholder="Ask one question for all three users"
        />
        <Button type="submit" className="px-5">
          <Play className="size-4" /> Run for all three
        </Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => run(q)}
            className={cx(
              "rounded-full border px-3 py-1 text-[12px] transition-colors",
              q === question ? "border-brand/40 bg-brand/10 text-brand" : "border-line text-ink-3 hover:border-line-2 hover:text-ink-2",
            )}
          >
            {q}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {slots.map((email, i) => {
          const p = PERSONAS.find((x) => x.email === email)!;
          const a = answers[i];
          return (
            <div key={i} className="flex min-h-[340px] flex-col rounded-2xl bg-panel shadow-card ring-1 ring-line/70">
              <div className="flex items-center gap-3 border-b border-line p-3">
                <Avatar name={p.name} email={p.email} />
                <div className="min-w-0 flex-1">
                  <select
                    value={email}
                    onChange={(e) => {
                      const next = [...slots];
                      next[i] = e.target.value;
                      setSlots(next);
                      setAnswers((prev) => prev.map((x, j) => (j === i ? null : x)));
                    }}
                    className="w-full cursor-pointer truncate bg-transparent text-sm font-medium outline-none"
                  >
                    {PERSONAS.map((o) => (
                      <option key={o.email} value={o.email} className="bg-panel">
                        {o.name} · {o.title}
                      </option>
                    ))}
                  </select>
                  <div className="text-[11.5px] text-ink-3">scope {p.depts.join(", ")}</div>
                </div>
                <ClassBadge level={p.clearance} />
              </div>

              <div className="flex-1 p-4">
                {a ? (
                  <AnswerCard key={`${runId}-${i}`} answer={a} live compact activeCite={source?.chunk.id ?? null} onCite={setSource} />
                ) : (
                  <div className="grid h-full place-items-center text-center text-[13px] text-ink-3">Run a question to see what {p.name.split(" ")[0]} gets.</div>
                )}
              </div>

              {a && a.citations.length > 0 && (
                <div className="space-y-1.5 border-t border-line p-3">
                  {a.citations.map((c) => (
                    <SourceRow key={c.n} c={c} active={source?.chunk.id === c.chunk.id} onClick={() => setSource(c)} />
                  ))}
                </div>
              )}

              {xray && a && (
                <div className="fade-up flex items-center gap-2 border-t border-dashed border-line-2 bg-panel-2/50 px-3 py-2 font-mono text-[11px] text-ink-3">
                  <ShieldOff className="size-3.5 text-deny" />
                  RLS dropped <span className="text-deny">{a.xray.filtered}</span> of {a.xray.candidates} candidate chunks inside Postgres
                </div>
              )}
            </div>
          );
        })}
      </div>

      {xray && (
        <p className="mt-3 text-[12px] text-ink-3">
          Presenter X-ray is an admin-only demo view built from the audit log. End users never see filtered counts, so a refusal can't reveal
          that a document exists.
        </p>
      )}

      {source && (
        <>
          <div className="fixed inset-0 z-30 bg-ink/25 backdrop-blur-[2px]" onClick={() => setSource(null)} />
          <aside className="fade-up fixed inset-y-0 right-0 z-40 w-full max-w-md bg-panel shadow-float ring-1 ring-line">
            <SourceViewer citation={source} onClose={() => setSource(null)} />
          </aside>
        </>
      )}
    </div>
  );
}
