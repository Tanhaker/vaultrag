import { ArrowUp, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnswerCard } from "../components/AnswerCard";
import { Mark } from "../components/Layout";
import { SourceViewer } from "../components/SourceViewer";
import { Avatar, ClassBadge, cx } from "../components/ui";
import { fetchXray, type Xray } from "../lib/api";
import { SUGGESTED_QUESTIONS } from "../lib/corpus";
import { ask, recordAudit } from "../lib/engine";
import { roleLabel } from "../lib/personas";
import { useSession } from "../lib/session";
import type { Answer, Citation } from "../lib/types";

const threads = new Map<string, Answer[]>();

function XrayStrip({ xray }: { xray: Xray | null }) {
  if (!xray) return null;
  const items: [string, string][] = [
    ["documents", "docs"],
    ["students", "students"],
    ["fee_payments", "fee rows"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ink-3">
      <span className="inline-flex items-center gap-1.5 text-brand">
        <ShieldCheck className="size-3.5" /> {xray.db_role}
      </span>
      {items.map(([k, label]) =>
        xray.visible[k] !== undefined ? (
          <span key={k}>
            {label} <span className="text-ink-2">{xray.visible[k]}</span>
          </span>
        ) : null,
      )}
    </div>
  );
}

export function AskPage() {
  const { session } = useSession();
  const user = session!.user;
  const [thread, setThread] = useState<Answer[]>(() => threads.get(user.email) ?? []);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<Citation | null>(null);
  const [xray, setXray] = useState<Xray | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setThread(threads.get(user.email) ?? []);
    setSource(null);
    setBusy(false);
    setLiveId(null);
    fetchXray(session!).then(setXray);
  }, [user.email, session]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread.length]);

  async function submit(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    setInput("");
    const a = await ask(question, user);
    const next = [...(threads.get(user.email) ?? []), a];
    threads.set(user.email, next);
    setThread(next);
    setLiveId(a.id);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit(input);
  }

  function openSource(c: Citation) {
    setSource(c);
    recordAudit({ userEmail: user.email, userName: user.name, action: "source_view", detail: `GET /source/${c.chunk.id}`, chunks: 1, filtered: 0 });
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} email={user.email} />
            <div>
              <div className="text-[13.5px] font-medium">Asking as {user.name}</div>
              <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
                {roleLabel(user)} · scope {user.depts.join(", ")} <ClassBadge level={user.clearance} />
              </div>
            </div>
          </div>
          <XrayStrip xray={xray} />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {thread.length === 0 ? (
            <div className="mx-auto mt-4 grid max-w-5xl gap-10 sm:mt-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
              <div>
                <h2 className="font-display text-[44px] leading-[1] tracking-[-0.01em] sm:text-[56px]">
                  What would you
                  <br />
                  like to <em>look up</em>?
                </h2>
                <p className="mt-5 max-w-sm text-[14.5px] leading-relaxed text-ink-2">
                  Answers come only from sources {user.name.replace(/^(Dr\.|Prof\.)\s*/, "").split(" ")[0]} is cleared to read, and every sentence is cited. Ask something,
                  then switch identity from the menu above and ask it again.
                </p>
              </div>
              <div className="stagger divide-y divide-line self-end border-y border-line">
                {SUGGESTED_QUESTIONS.map((q, i) => (
                  <button
                    key={q}
                    onClick={() => submit(q)}
                    className="group flex w-full items-baseline gap-4 py-3.5 text-left transition-colors"
                  >
                    <span className="w-5 font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                    <span className="flex-1 text-[15px] text-ink-2 transition-colors group-hover:text-ink">{q}</span>
                    <ArrowUp className="size-4 rotate-45 text-ink-3 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-8">
              {thread.map((a) => (
                <div key={a.id} className="fade-up space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-[18px] rounded-br-[6px] bg-ink px-4 py-2.5 text-[14.5px] text-paper">{a.question}</div>
                  </div>
                  <div className="flex gap-3">
                    <Mark className="mt-0.5 size-7 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <AnswerCard
                        answer={a}
                        live={a.id === liveId}
                        activeCite={source?.chunk.id ?? null}
                        onCite={openSource}
                        onDone={() => setBusy(false)}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="border-t border-line bg-bg/90 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-[18px] bg-paper p-2 shadow-card ring-1 ring-line-2 transition-shadow focus-within:ring-2 focus-within:ring-brand">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              placeholder="Ask about budgets, fees, policies…"
              className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[14.5px] outline-none placeholder:text-ink-3"
            />
            <button
              type="submit"
              disabled={!input.trim() || busy}
              className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-brand text-paper transition-colors duration-200 hover:bg-brand-2 disabled:bg-panel-2 disabled:text-ink-3"
              aria-label="Ask"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11.5px] text-ink-3">
            Retrieval runs as <span className="font-mono">rag_reader</span> under Postgres RLS. The model only ever sees chunks you're
            authorised to read.
          </p>
        </form>
      </div>

      {source && (
        <>
          <div className="fixed inset-0 z-30 bg-ink/25 backdrop-blur-[2px] xl:hidden" onClick={() => setSource(null)} />
          <aside
            className={cx(
              "fade-up fixed inset-y-0 right-0 z-40 w-full max-w-md bg-panel shadow-float ring-1 ring-line",
              "xl:static xl:z-auto xl:w-[440px] xl:max-w-none xl:shadow-none",
            )}
          >
            <SourceViewer citation={source} onClose={() => setSource(null)} />
          </aside>
        </>
      )}
    </div>
  );
}
