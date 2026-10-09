import { ChevronDown, CircleCheck, Loader2, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Answer, Citation } from "../lib/types";
import { ClassBadge, ModalityTag, SourceIcon, cx } from "./ui";

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
  compact?: boolean;
  activeCite?: string | null;
  onCite?: (c: Citation) => void;
  onDone?: () => void;
}

export function AnswerCard({ answer, live = false, compact = false, activeCite, onCite, onDone }: Props) {
  const kept = useMemo(() => answer.sentences.filter((s) => !s.removed), [answer]);
  const totalChars = useMemo(() => kept.reduce((a, s) => a + s.text.length + 1, 0), [kept]);
  const [stepIdx, setStepIdx] = useState(live ? 0 : answer.steps.length);
  const [chars, setChars] = useState(live ? 0 : totalChars);
  const [traceCollapsed, setTraceCollapsed] = useState(!live || compact);

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

      {answer.quarantined.length > 0 && stepIdx > 3 && (
        <div className="fade-up flex gap-2.5 rounded-lg bg-warn/[0.08] p-3 text-[12.5px] text-ink-2 ring-1 ring-warn/25">
          <ShieldAlert className="size-4 shrink-0 text-warn" />
          <div>
            <span className="font-medium">Prompt injection quarantined.</span> A retrieved chunk from “{answer.quarantined[0].doc.title}” contained
            instructions (“ignore all previous instructions…”). It was treated as data and excluded from the model's context.
          </div>
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
              <span key={i} className={cx(!complete && "caret")}>
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
          {answer.refused ? (
            <div className="flex items-center gap-2 text-[12px] text-ink-3">
              <ShieldCheck className="size-3.5 text-brand" />
              Uniform refusal: identical whether the data doesn't exist or you aren't authorised.
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
    </div>
  );
}
