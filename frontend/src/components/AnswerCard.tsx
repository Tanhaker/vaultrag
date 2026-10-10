import { ChevronDown, CircleCheck, CornerDownRight, Cpu, Database, FileSignature, HandHeart, Languages, Loader2, MessagesSquare, Scale, ScanEye, ShieldAlert, ShieldCheck, Sparkles, Square, Volume2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Answer, Citation, Sentence } from "../lib/types";
import { ExplainModal } from "./ExplainModal";
import { ReceiptModal } from "./ReceiptModal";
import { ClassBadge, ModalityTag, SourceIcon, cx } from "./ui";

const MODE_LABEL: Record<string, string> = { llm: "Gemini · grounded", extractive: "verbatim · no generative model", sql: "Text-to-SQL · RLS" };

const CHECK_LABEL: Record<NonNullable<Sentence["check"]>, string> = {
  verbatim: "Quoted verbatim from the cited source",
  entailed: "Judged entailed by the cited source (LLM verifier) and every figure found in it",
  numeric: "Every figure found in the cited source",
  chat: "Small talk: no facts from the knowledge base, so nothing to cite",
};

export function CiteChip({ n, citation, active, onClick }: { n: number; citation?: Citation; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={citation ? `${citation.doc.title}${citation.chunk.page ? ` · p.${citation.chunk.page}` : ""}` : undefined}
      className={cx(
        "mx-[1px] inline-flex h-[17px] min-w-[17px] -translate-y-[5px] items-center justify-center rounded-[4px] px-[3px] align-middle font-mono text-[10px] font-medium transition-colors duration-200",
        active ? "bg-brand text-paper" : "bg-brand-soft text-brand hover:bg-brand hover:text-paper",
      )}
    >
      {n}
    </button>
  );
}

function PipelineTrace({ answer, upTo, collapsed, onToggle }: { answer: Answer; upTo: number; collapsed: boolean; onToggle: () => void }) {
  const done = upTo >= answer.steps.length;
  if (done && collapsed) {
    return (
      <button onClick={onToggle} className="flex items-center gap-2 text-[12px] text-ink-3 transition-colors hover:text-ink">
        <ShieldCheck className="size-3.5 text-brand" />
        {answer.steps.length} steps in {(answer.latencyMs / 1000).toFixed(2)} s, retrieval under RLS
        <ChevronDown className="size-3" />
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl bg-panel-2/55 px-3.5 py-3 ring-1 ring-line/60">
      {answer.steps.map((s, i) => {
        const state = i < upTo ? "done" : i === upTo ? "run" : "todo";
        return (
          <div key={s.key} className={cx("flex items-center gap-2.5 text-xs", state === "todo" && "opacity-35")}>
            {state === "done" ? (
              <CircleCheck className="size-3.5 shrink-0 text-brand" />
            ) : state === "run" ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-brand" />
            ) : (
              <span className="size-3.5 shrink-0 rounded-full ring-1 ring-line-2" />
            )}
            <span className="w-44 shrink-0 text-[12.5px] text-ink">{s.label}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">{state === "todo" ? "" : s.detail}</span>
            {state === "done" && <span className="font-mono text-[10.5px] tabular-nums text-ink-3">{s.ms} ms</span>}
          </div>
        );
      })}
      {done && (
        <button onClick={onToggle} className="pt-1 text-[12px] text-ink-3 hover:text-ink">
          Hide trace
        </button>
      )}
    </div>
  );
}

export function SourceRow({ c, active, onClick }: { c: Citation; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ring-1 transition-colors duration-200",
        active ? "bg-brand-soft ring-brand/40" : "bg-paper ring-line hover:ring-line-2",
      )}
    >
      <span className="w-5 font-mono text-[11px] font-medium text-brand">{c.n}</span>
      <SourceIcon type={c.doc.sourceType} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{c.doc.title}</div>
        <div className="flex items-center gap-2">
          <ModalityTag modality={c.chunk.modality} />
          {c.chunk.page && <span className="font-mono text-[10.5px] text-ink-3">p.{c.chunk.page}</span>}
          {c.chunk.rowRef && <span className="truncate font-mono text-[10.5px] text-ink-3">{c.chunk.rowRef}</span>}
        </div>
      </div>
      <ClassBadge level={c.doc.classification} compact />
    </button>
  );
}

interface Props {
  answer: Answer;
  live?: boolean;
  /** The trace was already shown live while streaming: skip the replay, type the answer only. */
  streamed?: boolean;
  compact?: boolean;
  activeCite?: string | null;
  onCite?: (c: Citation) => void;
  onDone?: () => void;
  /** Ask a follow-up question (suggestion chips under a small-talk reply). */
  onAsk?: (q: string) => void;
}

function UsageChips({ answer }: { answer: Answer }) {
  const chips: { icon: typeof Cpu; text: string; title: string; tone?: "brand" | "warn" | "deny" }[] = [];
  if (answer.cache) {
    chips.push({ icon: Database, text: answer.cache === "postgres" ? "cached · Postgres" : "cached · memory", tone: "brand",
                 title: "Served from the RLS-scoped answer cache: 0 AI calls. Invalidated by any document or ACL change." });
  } else if (answer.llm) {
    const l = answer.llm;
    if (l.calls > 0) chips.push({ icon: Cpu, text: `${l.calls} AI call${l.calls === 1 ? "" : "s"}${l.model ? ` · ${l.model}` : ""}`,
                                  title: `Tenant AI budget today: ${l.today}/${l.budget}` });
    else if (l.reason.startsWith("small talk")) chips.push({ icon: Cpu, text: "0 AI calls", title: "Small talk is answered without a model" });
    else if (!l.allowed && l.reason.startsWith("verbatim")) chips.push({ icon: Cpu, text: "0 AI calls · verbatim mode", title: "Quoted from sources by choice" });
    else if (!l.allowed && l.reason) chips.push({ icon: Cpu, text: "0 AI calls · quota guard", tone: "warn", title: l.reason });
    else chips.push({ icon: Cpu, text: "0 AI calls", title: "Answered without a generative model" });
  }
  if (answer.style && (answer.style.tone !== "formal" || answer.style.lang !== "en"))
    chips.push({ icon: answer.style.tone === "bhai" ? HandHeart : Languages, text: answer.style.label, tone: "brand",
                 title: `${answer.style.detected ? "Matched to how you wrote the question" : "Your pick"}. Wording only: same sources, citations and access rules. Nothing about you is stored.` });
  if (answer.dlp?.redacted) chips.push({ icon: ScanEye, text: `${answer.dlp.redacted} redacted`, tone: "warn", title: "Egress DLP removed phone or ID numbers" });
  if (answer.dlp?.blocked) chips.push({ icon: ShieldAlert, text: "blocked by egress DLP", tone: "deny", title: `Canary ${answer.dlp.canaries.join(", ")}` });
  return (
    <>
      {chips.map((c) => (
        <span key={c.text} title={c.title} className={cx("inline-flex items-center gap-1 font-mono text-[11px]",
          c.tone === "brand" ? "text-brand" : c.tone === "warn" ? "text-warn" : c.tone === "deny" ? "text-deny" : "")}>
          <c.icon className="size-3" /> {c.text}
        </span>
      ))}
    </>
  );
}

const VOICE_LANG: Record<string, string> = { en: "en-IN", hinglish: "hi-IN", hi: "hi-IN", gu: "gu-IN" };

/** Read the answer aloud with the browser's own voices (no server, no AI quota). */
function ListenButton({ answer }: { answer: Answer }) {
  const [speaking, setSpeaking] = useState(false);
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  useEffect(() => () => synth?.cancel(), [synth]);
  if (!synth) return null;
  function toggle() {
    if (!synth) return;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const text = [answer.style?.greeting, ...answer.sentences.filter((s) => !s.removed).map((s) => s.text)].filter(Boolean).join(" ");
    const u = new SpeechSynthesisUtterance(text.replace(/₹/g, "rupees "));
    u.lang = VOICE_LANG[answer.style?.lang ?? "en"] ?? "en-IN";
    const voice = synth.getVoices().find((v) => v.lang === u.lang) ?? synth.getVoices().find((v) => v.lang.startsWith(u.lang.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = 0.98;
    u.onend = u.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(u);
    setSpeaking(true);
  }
  return (
    <button onClick={toggle} aria-pressed={speaking} title="Read this answer aloud"
            className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] ring-1 transition-colors",
                          speaking ? "bg-ink text-paper ring-ink" : "text-ink-2 ring-line-2 hover:text-ink")}>
      {speaking ? <Square className="size-3 fill-current" /> : <Volume2 className="size-3.5" />} {speaking ? "Stop" : "Listen"}
    </button>
  );
}

function WhyButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} title="See the access decision behind this answer"
            className="inline-flex items-center gap-1 rounded-md bg-brand px-1.5 py-0.5 text-[12px] text-paper transition-colors hover:bg-brand/90">
      <Scale className="size-3.5" /> Why this answer?
    </button>
  );
}

export function AnswerCard({ answer, live = false, streamed = false, compact = false, activeCite, onCite, onDone, onAsk }: Props) {
  const kept = useMemo(() => answer.sentences.filter((s) => !s.removed), [answer]);
  const totalChars = useMemo(() => kept.reduce((a, s) => a + s.text.length + 1, 0), [kept]);
  const [receipt, setReceipt] = useState(false);
  const [explain, setExplain] = useState(false);
  const [stepIdx, setStepIdx] = useState(live && !streamed ? 0 : answer.steps.length);
  const [chars, setChars] = useState(live ? 0 : totalChars);
  const [traceCollapsed, setTraceCollapsed] = useState(!live || compact || streamed);

  const streaming = stepIdx >= answer.steps.length && chars < totalChars;
  const done = stepIdx >= answer.steps.length && chars >= totalChars;

  useEffect(() => {
    if (stepIdx >= answer.steps.length) return;
    const t = setTimeout(() => setStepIdx((i) => i + 1), Math.min(answer.steps[stepIdx].ms, 650) * 0.55 + 90);
    return () => clearTimeout(t);
  }, [stepIdx, answer.steps]);

  useEffect(() => {
    if (!streaming) return;
    const t = setTimeout(() => setChars((c) => c + 5), 14);
    return () => clearTimeout(t);
  }, [streaming, chars]);

  useEffect(() => {
    if (done && live) {
      onDone?.();
      if (!compact) setTraceCollapsed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const byN = new Map(answer.citations.map((c) => [c.n, c]));
  let budget = chars;

  return (
    <div className="space-y-3">
      <PipelineTrace answer={answer} upTo={stepIdx} collapsed={traceCollapsed} onToggle={() => setTraceCollapsed((v) => !v)} />

      {answer.rewritten && (
        <div className="flex items-start gap-1.5 text-[12px] text-ink-3">
          <CornerDownRight className="mt-0.5 size-3.5 shrink-0" />
          <span>Follow-up read as <span className="text-ink-2">“{answer.rewritten}”</span>. Access is checked again for this turn.</span>
        </div>
      )}

      {answer.quarantined.length > 0 && stepIdx > 3 && (
        <div className="fade-up flex gap-2.5 rounded-lg bg-warn/[0.08] p-3 text-[12.5px] text-ink-2 ring-1 ring-warn/25">
          <ShieldAlert className="size-4 shrink-0 text-warn" />
          <div>
            <span className="font-medium">Prompt injection quarantined.</span> A retrieved chunk from “{answer.quarantined[0].doc.title}” contained
            instructions (“ignore all previous instructions…”). It was treated as data and excluded from the model's context.
          </div>
        </div>
      )}

      {stepIdx >= answer.steps.length && answer.style?.greeting && !answer.refused && (
        <div className="fade-up flex items-center gap-1.5 text-[14px] text-brand">
          <HandHeart className="size-4 shrink-0" /> {answer.style.greeting}
        </div>
      )}

      {stepIdx >= answer.steps.length && (
        <div className={cx("leading-[1.7] text-ink", compact ? "text-[14px]" : "text-[16px]", answer.refused && "text-ink-2")}>
          {answer.sentences.map((s, i) => {
            if (s.removed) {
              if (!done) return null;
              return (
                <span key={i} className="fade-up mx-0.5 rounded-[4px] bg-deny/[0.07] px-1 text-deny/75 line-through decoration-deny/50" title={`Removed by citation verifier: ${s.reason}`}>
                  {s.text}
                  <span className="ml-1 font-mono text-[10px] text-deny">unsupported</span>
                </span>
              );
            }
            if (budget <= 0) return null;
            const shown = s.text.slice(0, budget);
            const complete = budget >= s.text.length;
            budget -= s.text.length + 1;
            return (
              <span key={i} className={cx(!complete && "caret")} title={complete && s.check ? CHECK_LABEL[s.check] + (s.repaired ? " · citation corrected by the verifier to the source holding these figures" : "") : undefined}>
                {shown}
                {complete &&
                  s.cites.map((n) => (
                    <CiteChip key={n} n={n} citation={byN.get(n)} active={activeCite === byN.get(n)?.chunk.id} onClick={() => byN.get(n) && onCite?.(byN.get(n)!)} />
                  ))}{" "}
              </span>
            );
          })}
        </div>
      )}

      {done && (
        <div className="fade-up space-y-2">
          {answer.mode === "chat" ? (
            <div className="space-y-2.5">
              {answer.chat?.nudge && answer.chat.suggestions.length > 0 && (
                <div>
                  <div className="text-[13px] text-ink-2">{answer.chat.nudge}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {answer.chat.suggestions.map((q) => (
                      <button key={q} onClick={() => onAsk?.(q)} disabled={!onAsk}
                              className="rounded-full bg-paper px-3 py-1.5 text-left text-[13px] text-ink-2 ring-1 ring-line-2 transition-colors hover:text-ink hover:ring-brand">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
                <span className="inline-flex items-center gap-1.5"><MessagesSquare className="size-3.5 text-brand" /> Small talk · no documents read, so nothing to cite</span>
                <UsageChips answer={answer} />
                <ListenButton answer={answer} />
              </div>
            </div>
          ) : answer.refused ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="size-3.5 text-brand" />
                Uniform refusal: identical whether the data doesn't exist or you aren't authorised.
              </span>
              <UsageChips answer={answer} />
              <WhyButton onClick={() => setExplain(true)} />
              <ListenButton answer={answer} />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-brand" />
                  Every sentence cited
                </span>
                <span title={`Draft support rate ${Math.round(answer.groundedness * 100)}%`}>
                  {answer.sentences.filter((s) => !s.removed).length} verified
                  {answer.sentences.some((s) => s.removed) && ` · ${answer.sentences.filter((s) => s.removed).length} unsupported removed`}
                </span>
                <span>{answer.citations.length} {answer.citations.length === 1 ? "source" : "sources"}</span>
                {answer.mode && answer.mode !== "refused" && <span className="font-mono text-[11px]">{MODE_LABEL[answer.mode]}</span>}
                <UsageChips answer={answer} />
                <WhyButton onClick={() => setExplain(true)} />
                <ListenButton answer={answer} />
                {answer.receipt && (
                  <button onClick={() => setReceipt(true)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-brand ring-1 ring-brand/30 transition-colors hover:bg-brand-soft">
                    <FileSignature className="size-3.5" /> Receipt
                  </button>
                )}
              </div>
              {!compact && (
                <div className="grid gap-1.5">
                  {answer.citations.map((c) => (
                    <SourceRow key={c.n} c={c} active={activeCite === c.chunk.id} onClick={() => onCite?.(c)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {receipt && answer.receipt && <ReceiptModal answer={answer} onClose={() => setReceipt(false)} />}
      {explain && <ExplainModal answer={answer} onClose={() => setExplain(false)} />}
    </div>
  );
}
