import { ArrowUp, CircleCheck, Loader2, MessageSquarePlus, Quote, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnswerCard } from "../components/AnswerCard";
import { Mark } from "../components/Layout";
import { SourceViewer } from "../components/SourceViewer";
import { Avatar, ClassBadge, cx } from "../components/ui";
import { ApiError, askStream, fetchXray, type Xray } from "../lib/api";
import { SUGGESTED_QUESTIONS } from "../lib/corpus";
import { ask as demoAsk, recordAudit } from "../lib/engine";
import { roleLabel } from "../lib/personas";
import { useSession } from "../lib/session";
import type { Answer, Citation, PipelineStep } from "../lib/types";

const threads = new Map<string, Answer[]>();
const streamedIds = new Set<string>();
const VERBATIM_KEY = "vaultrag.verbatim";

function loadVerbatim(): boolean {
  try {
    return localStorage.getItem(VERBATIM_KEY) === "1";
  } catch {
    return false;
  }
}

function LiveTrace({ question, steps }: { question: string; steps: PipelineStep[] }) {
  return (
    <div className="fade-up space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[18px] rounded-br-[6px] bg-ink px-4 py-2.5 text-[14.5px] text-paper">{question}</div>
      </div>
      <div className="flex gap-3">
        <Mark className="mt-0.5 size-7 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2 rounded-xl bg-panel-2/55 px-3.5 py-3 ring-1 ring-line/60">
          {steps.map((s, i) => (
            <div key={`${s.key}-${i}`} className="fade-up flex items-center gap-2.5 text-xs">
              <CircleCheck className="size-3.5 shrink-0 text-brand" />
              <span className="w-44 shrink-0 text-[12.5px] text-ink">{s.label}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">{s.detail}</span>
              <span className="font-mono text-[10.5px] tabular-nums text-ink-3">{s.ms} ms</span>
            </div>
          ))}
          <div className="flex items-center gap-2.5 text-[12.5px] text-ink-3">
            <Loader2 className="size-3.5 shrink-0 animate-spin text-brand" />
            {steps.length === 0 ? "Binding your signed context…" : "Running…"}
            <span className="ml-auto font-mono text-[10.5px]">live from the server</span>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const [pending, setPending] = useState<{ question: string; steps: PipelineStep[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verbatim, setVerbatim] = useState(loadVerbatim);
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
  }, [thread.length, pending?.steps.length]);

  function toggleVerbatim() {
    setVerbatim((v) => {
      try {
        localStorage.setItem(VERBATIM_KEY, v ? "0" : "1");
      } catch {
        /* preference just isn't remembered */
      }
      return !v;
    });
  }

  function newConversation() {
    threads.set(user.email, []);
    setThread([]);
    setSource(null);
    setError(null);
  }

  async function submit(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    const history = (threads.get(user.email) ?? []).slice(-3).map((a) => ({ question: a.rewritten ?? a.question }));
    setPending({ question, steps: [] });
    let a: Answer;
    try {
      a = await askStream(question, session!, { verbatim, history }, (step) =>
        setPending((p) => (p ? { ...p, steps: [...p.steps, step] } : p)),
      );
      if (session!.mode === "live") streamedIds.add(a.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setPending(null);
        setBusy(false);
        setError(e.message);
        return;
      }
      a = await demoAsk(question, user);
      a.steps.unshift({ key: "offline", label: "Backend unavailable", detail: `${String((e as Error).message ?? e).slice(0, 50)} → in-browser engine`, ms: 1 });
    }
    setPending(null);
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
    if (session!.mode === "demo") {
      recordAudit({ userEmail: user.email, userName: user.name, action: "source_view", detail: `GET /source/${c.chunk.id}`, chunks: 1, filtered: 0 });
    }
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
          <div className="flex items-center gap-4">
            <XrayStrip xray={xray} />
            {thread.length > 0 && (
              <button onClick={newConversation} disabled={busy} className="inline-flex items-center gap-1.5 text-[12px] text-ink-3 transition-colors hover:text-ink disabled:opacity-40">
                <MessageSquarePlus className="size-3.5" /> New conversation
              </button>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {thread.length === 0 && !pending ? (
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
                        streamed={streamedIds.has(a.id)}
                        activeCite={source?.chunk.id ?? null}
                        onCite={openSource}
                        onDone={() => setBusy(false)}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {pending && <LiveTrace question={pending.question} steps={pending.steps} />}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="border-t border-line bg-bg/90 px-4 py-3 backdrop-blur sm:px-6">
          {error && (
            <div className="fade-up mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-xl bg-warn/[0.09] px-3 py-2 text-[12.5px] text-ink-2 ring-1 ring-warn/25">
              <TriangleAlert className="size-4 shrink-0 text-warn" /> {error}
            </div>
          )}
          <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-center justify-between gap-2 text-[12px]">
            <button
              type="button"
              onClick={toggleVerbatim}
              aria-pressed={verbatim}
              title="Quote the sources word for word, without a generative model. Uses no AI quota."
              className={cx(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 transition-colors",
                verbatim ? "bg-brand text-paper ring-brand" : "text-ink-3 ring-line-2 hover:text-ink",
              )}
            >
              <Quote className="size-3.5" /> Verbatim mode {verbatim ? "on" : "off"}
            </button>
            {thread.length > 0 && (
              <span className="truncate text-ink-3">Follow-ups use the previous question as context</span>
            )}
          </div>
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
