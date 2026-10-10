import { ArrowUp, CircleCheck, FileText, HandHeart, ImageIcon, Languages, Loader2, Lock, MessageSquarePlus, Mic, Paperclip, Quote, ShieldCheck, SlidersHorizontal, Square, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { AnswerCard } from "../components/AnswerCard";
import { Mark } from "../components/Layout";
import { SourceViewer } from "../components/SourceViewer";
import { Avatar, ClassBadge, cx } from "../components/ui";
import { ApiError, askStream, attachFile, detachFile, fetchXray, isLive, type ReplyLang, type Tone, type Xray } from "../lib/api";
import { SUGGESTED_QUESTIONS } from "../lib/corpus";
import { ask as demoAsk, recordAudit } from "../lib/engine";
import { roleLabel } from "../lib/personas";
import { useSession } from "../lib/session";
import type { Answer, Citation, PipelineStep } from "../lib/types";

const threads = new Map<string, Answer[]>();
const streamedIds = new Set<string>();
const VERBATIM_KEY = "vaultrag.verbatim";

const TONE_KEY = "vaultrag.tone";
const LANG_KEY = "vaultrag.lang";
const TONES: [Tone, string, string][] = [
  ["auto", "Auto", "Match the tone of each message"],
  ["formal", "Formal", "Always polite and formal"],
  ["bhai", "Bhai mode", "Friendly, like an elder brother explaining"],
];
const REPLY_LANGS: [ReplyLang, string][] = [["auto", "Same as question"], ["en", "English"], ["hinglish", "Hinglish"], ["hi", "हिंदी"], ["gu", "ગુજરાતી"]];
const BHAI_QUESTIONS = [
  "Bhai, exam dene ke liye minimum kitni attendance chahiye?",
  "Bhai yaar, B.Tech ki fees kitni hai is saal?",
  "ભાઈ, પરીક્ષા માટે ઓછામાં ઓછી કેટલી હાજરી જોઈએ?",
];

// Voice input: the browser's own speech recognition (Chrome, Edge, Safari). No server, no AI quota.
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start: () => void; stop: () => void;
};
const SpeechAPI: (new () => Recognition) | undefined =
  typeof window === "undefined" ? undefined
    : ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => Recognition) | undefined;
const SPEECH_LANG: Record<ReplyLang, string> = { auto: "en-IN", en: "en-IN", hinglish: "hi-IN", hi: "hi-IN", gu: "gu-IN" };

function useVoice(lang: ReplyLang, onText: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  function toggle(base: string) {
    if (!SpeechAPI) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new SpeechAPI();
    r.lang = SPEECH_LANG[lang];
    r.interimResults = true;
    r.continuous = false;
    const prefix = base.trim() ? base.trim() + " " : "";
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onText(prefix + text);
    };
    r.onerror = (e) => setVoiceError(e.error === "not-allowed" ? "Microphone permission was blocked." : `Voice input stopped (${e.error}).`);
    r.onend = () => setListening(false);
    rec.current = r;
    setVoiceError(null);
    setListening(true);
    r.start();
  }
  useEffect(() => () => rec.current?.stop(), []);
  return { supported: !!SpeechAPI, listening, voiceError, toggle };
}

function loadPref<T extends string>(key: string, fallback: T, allowed: readonly string[]): T {
  try {
    const v = localStorage.getItem(key);
    return v && allowed.includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* preference just isn't remembered */
  }
}

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
  const [tone, setTone] = useState<Tone>(() => loadPref<Tone>(TONE_KEY, "auto", TONES.map((t) => t[0])));
  const [lang, setLang] = useState<ReplyLang>(() => loadPref<ReplyLang>(LANG_KEY, "auto", REPLY_LANGS.map((l) => l[0])));
  const [showOpts, setShowOpts] = useState(false);
  const [attached, setAttached] = useState<{ id: string; title: string; chunks: number; image: boolean } | null>(null);
  const [focusFile, setFocusFile] = useState(true);
  const [attaching, setAttaching] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onAttach(f: File | undefined) {
    if (!f || !session) return;
    if (!isLive(session)) {
      setError("Attaching files needs the live backend.");
      return;
    }
    setError(null);
    setAttaching(f.name);
    try {
      const r = await attachFile(session, f);
      setAttached({ id: r.id, title: r.title, chunks: r.chunks, image: /\.(png|jpe?g|webp)$/i.test(r.title) });
      setFocusFile(true);
      setInput("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The file could not be read. Try a PDF or a clear photo.");
    } finally {
      setAttaching(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onDetach() {
    if (!attached || !session) return;
    const id = attached.id;
    setAttached(null);
    try {
      await detachFile(session, id);
    } catch {
      /* already gone */
    }
  }
  const voice = useVoice(lang, setInput);
  const [params, setParams] = useSearchParams();
  const asked = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setThread(threads.get(user.email) ?? []);
    setSource(null);
    setBusy(false);
    setLiveId(null);
    fetchXray(session!).then(setXray);
  }, [user.email, session]);

  useEffect(() => {
    const q = params.get("q");
    if (q && !asked.current && session) {
      asked.current = true;
      setParams({}, { replace: true });
      submit(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, session]);

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
      a = await askStream(question, session!, { verbatim, history, tone, lang, doc: attached && focusFile ? attached.id : undefined }, (step) =>
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
              <div className="lg:col-span-2">
                <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.12em] text-ink-3 uppercase">
                  <HandHeart className="size-3.5 text-brand" /> Try bhai mode · Hinglish, हिंदी, ગુજરાતી
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {BHAI_QUESTIONS.map((q) => (
                    <button key={q} onClick={() => submit(q)}
                            className="rounded-full bg-paper px-3.5 py-2 text-left text-[13.5px] text-ink-2 ring-1 ring-line-2 transition-colors hover:text-ink hover:ring-brand">
                      {q}
                    </button>
                  ))}
                </div>
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
                        onAsk={submit}
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
          {(error || voice.voiceError) && (
            <div className="fade-up mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-xl bg-warn/[0.09] px-3 py-2 text-[12.5px] text-ink-2 ring-1 ring-warn/25">
              <TriangleAlert className="size-4 shrink-0 text-warn" /> {error ?? voice.voiceError}
            </div>
          )}
          <div className={cx("mx-auto mb-2 max-w-3xl flex-wrap items-center justify-between gap-2 text-[12px] sm:flex", showOpts ? "flex" : "hidden")}>
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
            <div className="flex flex-wrap items-center gap-2">
              <div role="radiogroup" aria-label="Reply tone" className="inline-flex rounded-full p-0.5 ring-1 ring-line-2">
                {TONES.map(([t, label, hint]) => (
                  <button key={t} type="button" role="radio" aria-checked={tone === t} title={hint}
                          onClick={() => { setTone(t); savePref(TONE_KEY, t); }}
                          className={cx("rounded-full px-2.5 py-0.5 transition-colors",
                                        tone === t ? (t === "bhai" ? "bg-brand text-paper" : "bg-ink text-paper") : "text-ink-3 hover:text-ink")}>
                    {label}
                  </button>
                ))}
              </div>
              <label className="inline-flex items-center gap-1 text-ink-3" title="Reply language. Wording only: sources, citations and access rules are the same.">
                <Languages className="size-3.5" />
                <select value={lang} onChange={(e) => { const v = e.target.value as ReplyLang; setLang(v); savePref(LANG_KEY, v); }}
                        aria-label="Reply language" className="rounded-md bg-transparent py-0.5 text-ink-2 outline-none hover:text-ink">
                  {REPLY_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            {thread.length > 0 && (
              <span className="truncate text-ink-3">Follow-ups use the previous question as context</span>
            )}
          </div>
          {(attached || attaching) && (
            <div className="fade-up mx-auto mb-2 flex max-w-3xl flex-wrap items-center gap-2 text-[12.5px]">
              <span className="inline-flex min-w-0 items-center gap-2 rounded-xl bg-panel px-3 py-1.5 ring-1 ring-line-2">
                {attaching ? <Loader2 className="size-4 animate-spin text-brand" /> : attached!.image ? <ImageIcon className="size-4 text-brand" /> : <FileText className="size-4 text-brand" />}
                <span className="max-w-[16rem] truncate font-medium text-ink">{attaching ?? attached!.title}</span>
                <span className="text-ink-3">{attaching ? "reading, OCR and indexing…" : `${attached!.chunks} chunks`}</span>
                {!attaching && <span className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] text-brand"><Lock className="size-3" /> only you</span>}
                {!attaching && (
                  <button type="button" onClick={onDetach} aria-label="Remove the file" title="Remove the file (deletes it from the database)"
                          className="rounded p-0.5 text-ink-3 hover:bg-panel-2 hover:text-ink"><X className="size-3.5" /></button>
                )}
              </span>
              {attached && !attaching && (
                <>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-ink-2">
                    <input type="checkbox" checked={focusFile} onChange={(e) => setFocusFile(e.target.checked)} className="accent-[var(--color-brand)]" />
                    Ask about this file only
                  </label>
                  {focusFile && (
                    <button type="button" onClick={() => submit(attached.image ? "What does this image say?" : "Summarise this document.")}
                            className="rounded-full bg-ink px-3 py-1 text-paper hover:bg-brand">Summarise it</button>
                  )}
                </>
              )}
            </div>
          )}
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-[18px] bg-paper p-2 shadow-card ring-1 ring-line-2 transition-shadow focus-within:ring-2 focus-within:ring-brand">
            <input ref={fileRef} id="chat-attach" type="file" accept=".pdf,image/png,image/jpeg,image/webp" className="hidden"
                   onChange={(e) => onAttach(e.target.files?.[0])} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={!!attaching}
                    aria-label="Attach a PDF or image" title="Attach a PDF or image. Only you will be able to read it."
                    className="grid size-9 shrink-0 place-items-center rounded-[12px] text-ink-3 transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-50">
              <Paperclip className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowOpts((v) => !v)}
              aria-expanded={showOpts}
              aria-label="Reply style and verbatim options"
              className={cx("relative grid size-9 shrink-0 place-items-center rounded-[12px] transition-colors sm:hidden",
                            showOpts ? "bg-ink text-paper" : "text-ink-3 hover:bg-panel-2 hover:text-ink")}
            >
              <SlidersHorizontal className="size-4" />
              {(verbatim || tone !== "auto" || lang !== "auto") && !showOpts && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-brand" />}
            </button>
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
              placeholder={voice.listening ? "Listening…" : attached && focusFile ? `Ask about ${attached.title}…` : "Ask anything: fees, exams, policies…"}
              className="max-h-40 min-h-[40px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[14.5px] placeholder:truncate outline-none placeholder:text-ink-3"
            />
            {voice.supported && (
              <button
                type="button"
                onClick={() => voice.toggle(input)}
                aria-pressed={voice.listening}
                aria-label={voice.listening ? "Stop voice input" : "Ask by voice"}
                title={`Ask by voice (${SPEECH_LANG[lang]}). Speech is recognised by your browser.`}
                className={cx("grid size-9 shrink-0 place-items-center rounded-[12px] transition-colors",
                              voice.listening ? "pulse-ring bg-deny text-paper" : "text-ink-3 hover:bg-panel-2 hover:text-ink")}
              >
                {voice.listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
              </button>
            )}
            <button
              type="submit"
              disabled={!input.trim() || busy}
              className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-brand text-paper transition-colors duration-200 hover:bg-brand-2 disabled:bg-panel-2 disabled:text-ink-3"
              aria-label="Ask"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </button>
          </div>
          <p className="mx-auto mt-2 hidden max-w-3xl text-center text-[11.5px] text-ink-3 sm:block">
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
