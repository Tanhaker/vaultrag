import { Database, Loader2, ScanSearch, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchPlan, sessionFor, type PlanRun, type QueryPlan } from "../lib/api";
import { cx } from "./ui";

function highlight(filter: string) {
  const i = filter.indexOf("acl_check");
  if (i < 0) return filter;
  return (
    <>
      {filter.slice(0, i)}
      <mark className="rounded bg-mark px-0.5 text-ink">acl_check</mark>
      {filter.slice(i + "acl_check".length)}
    </>
  );
}

function Run({ run, raw }: { run: PlanRun; raw: boolean }) {
  return (
    <div className="space-y-3">
      {run.rlsFilter && (
        <div>
          <div className="mb-1 text-[12px] font-medium text-ink-3">Filter on the {run.scanNode ?? "scan"} of chunks</div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-paper p-3 font-mono text-[11px] leading-relaxed text-ink-2 ring-1 ring-line">{highlight(run.rlsFilter)}</pre>
        </div>
      )}
      {raw ? (
        <pre className="max-h-80 overflow-auto rounded-lg bg-ink p-3 font-mono text-[10.5px] leading-relaxed text-paper/90">{run.text}</pre>
      ) : (
        <div className="space-y-1">
          {run.nodes.map((n, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg bg-paper px-2.5 py-1.5 ring-1 ring-line" style={{ marginLeft: n.depth * 18 }}>
              <Database className={cx("size-3.5 shrink-0", n.relation === "chunks" ? "text-brand" : "text-ink-3")} />
              <span className="text-[12.5px] font-medium">{n.node}</span>
              {n.index && <span className="font-mono text-[11px] text-brand">{n.index}</span>}
              {n.subplan && <span className="font-mono text-[10.5px] text-ink-3">{n.subplan}</span>}
              <span className="ml-auto flex gap-3 font-mono text-[10.5px] tabular-nums text-ink-3">
                {n.rows !== null && <span>rows {n.rows}</span>}
                {n.removed ? <span className="text-deny">−{n.removed} by RLS</span> : null}
                {n.ms !== null && <span>{n.ms.toFixed(2)} ms</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** EXPLAIN ANALYZE of the vector leg, run as the chosen identity. Shows the plan the optimiser
 *  picked and the HNSW plan; in both the RLS predicate runs inside the scan of chunks. */
export function PlanModal({ email, name, question, onClose }: { email: string; name: string; question: string; onClose: () => void }) {
  const [plan, setPlan] = useState<QueryPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [which, setWhich] = useState<"planner" | "hnsw">("planner");
  const [raw, setRaw] = useState(false);

  useEffect(() => {
    let alive = true;
    sessionFor(email)
      .then((s) => fetchPlan(s, question))
      .then((p) => alive && setPlan(p))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [email, question]);

  const run = plan ? plan[which] : null;
  const seq = plan?.planner.scanNode === "Seq Scan";

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div className="fade-up flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-panel shadow-float ring-1 ring-line" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-line p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><ScanSearch className="size-4.5" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium">Query plan as {name}</div>
            <div className="truncate text-[12px] text-ink-3">EXPLAIN ANALYZE · vector leg of “{question}” · run as rag_reader under this identity's signed context</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Close"><X className="size-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!plan && !error && <div className="grid h-48 place-items-center text-ink-3"><Loader2 className="size-5 animate-spin" /></div>}
          {error && <div className="rounded-lg bg-deny/10 px-3 py-2 text-[13px] text-deny">{error}</div>}
          {plan && run && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["chunks this identity sees", `${plan.visibleChunks}`],
                  ["rows removed by RLS", plan.planner.removedByFilter.toLocaleString()],
                  ["HNSW, iterative scan", `${plan.returned.iterative}/${plan.returned.k} rows`],
                  ["HNSW, strict scan", `${plan.returned.strict}/${plan.returned.k} rows`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-paper px-3 py-2.5 ring-1 ring-line">
                    <div className="text-[11px] text-ink-3">{k}</div>
                    <div className="mt-0.5 truncate font-mono text-[14px] text-ink">{v}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-brand-soft/50 p-3 text-[12.5px] leading-relaxed text-ink-2 ring-1 ring-brand/20">
                {seq ? (
                  <>
                    This corpus is small ({plan.planner.scanned.toLocaleString()} chunks), so the optimiser chose an exact sequential scan. The access rule
                    ran <b>inside</b> that scan and removed {plan.planner.removedByFilter.toLocaleString()} rows before any reached the application. At
                    scale the HNSW index is used: the second tab forces it, with the same filter inside the index scan.
                  </>
                ) : (
                  <>The access rule is evaluated <b>inside</b> the {plan.planner.scanNode} of chunks and removed {plan.planner.removedByFilter.toLocaleString()} unauthorised rows before any reached the application.</>
                )}{" "}
                With <span className="font-mono">hnsw.iterative_scan</span> the index scan keeps walking the graph and returns {plan.returned.iterative} of {plan.returned.k};
                a strict filtered scan returns {plan.returned.strict}.
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1 rounded-lg border border-line bg-panel p-1">
                  {([["planner", `Planner's choice · ${plan.planner.scanNode ?? "?"}`], ["hnsw", "HNSW index (forced)"]] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setWhich(k)}
                            className={cx("whitespace-nowrap rounded-md px-3 py-1 text-[12.5px]", which === k ? "bg-panel-2 text-ink ring-1 ring-line-2" : "text-ink-3 hover:text-ink-2")}>
                      {label}
                    </button>
                  ))}
                </div>
                <span className="flex items-center gap-3 text-[12px] text-ink-3">
                  <span className="font-mono">{run.executionMs?.toFixed(1)} ms</span>
                  <button onClick={() => setRaw((r) => !r)} className="hover:text-ink">{raw ? "Show tree" : "Show raw EXPLAIN"}</button>
                </span>
              </div>
              <Run run={run} raw={raw} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
