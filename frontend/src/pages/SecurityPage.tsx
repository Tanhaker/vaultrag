import {
  Activity, BadgeCheck, CircleCheck, CircleX, Database, Fingerprint, FileSignature, Filter, Gauge as GaugeIcon, KeyRound, Link2,
  Loader2, Lock, LockOpen, Radar, ScanSearch, ScrollText, ShieldAlert, ShieldCheck, Siren, Sigma, Timer, Unplug, UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { BarList, Distribution, Donut, Gauge, Sparkline } from "../components/charts";
import { PlanModal } from "../components/PlanModal";
import { Button, Card, Chip, SectionTitle, cx } from "../components/ui";
import {
  fetchAlerts, fetchAudit, fetchAuditChain, fetchEval, fetchMetrics, lockUser, unlockUser,
  type Alerts, type AuditChain, type EvalResults, type Metrics,
} from "../lib/api";
import { getAudit, subscribeAudit } from "../lib/engine";
import { MEASURED } from "../lib/measured";
import { PERSONAS } from "../lib/personas";
import { useSession } from "../lib/session";
import type { AuditEntry } from "../lib/types";

type Tab = "overview" | "attacks" | "grounding" | "retrieval" | "operations" | "governance";
const TABS: { key: Tab; label: string; icon: typeof ShieldCheck }[] = [
  { key: "overview", label: "Overview", icon: ShieldCheck },
  { key: "attacks", label: "Red team", icon: Siren },
  { key: "grounding", label: "Grounding", icon: BadgeCheck },
  { key: "retrieval", label: "Retrieval & timing", icon: Radar },
  { key: "operations", label: "Operations", icon: Activity },
  { key: "governance", label: "Governance", icon: ScrollText },
];

const ACTION_TONE: Record<AuditEntry["action"], "default" | "brand" | "warn" | "deny"> = {
  query: "brand", login: "default", upload: "warn", source_view: "default", denied_source: "deny", acl_change: "warn",
  dlp_block: "deny", lock_user: "deny", unlock_user: "warn",
};

const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? "–" : `${(x * 100).toFixed(digits)}%`);

function useAudit(): AuditEntry[] {
  const [, setN] = useState(0);
  useEffect(() => subscribeAudit(() => setN((n) => n + 1)), []);
  return getAudit();
}

function LiveOnly({ children, live }: { children: ReactNode; live: boolean }) {
  if (live) return <>{children}</>;
  return (
    <Card className="flex items-center gap-3 p-5 text-[13px] text-ink-2">
      <Unplug className="size-5 text-warn" /> This panel reads the live audit log. Connect the backend (it is running on the deployed site) to see it.
    </Card>
  );
}

// --- Overview -----------------------------------------------------------------------------------

const LAYERS: { icon: typeof KeyRound; name: string; where: string; what: string; proof: string }[] = [
  { icon: KeyRound, name: "Verified identity", where: "API", what: "HS256 JWT; identity never comes from the request body", proof: "forged alg=none → 401" },
  { icon: Fingerprint, name: "Signed DB context + kill switch", where: "Postgres", what: "app_ctx() checks the HMAC, expiry and account lock on every statement", proof: "locked user's live token reads 0 rows" },
  { icon: Database, name: "Row-level security inside the vector scan", where: "Postgres", what: "acl_check() filters the HNSW and BM25 scans; iterative scan keeps recall", proof: "EXPLAIN shows the filter in the index scan" },
  { icon: Sigma, name: "Column masking + k-anonymous aggregates", where: "Postgres", what: "salaries, phones and emails masked by views; pay only as department averages, k = 5", proof: "differencing attack recovers 0 salaries" },
  { icon: Filter, name: "Text-to-SQL firewall", where: "API + Postgres", what: "one validated SELECT over whitelisted views, read-only transaction, 5 s timeout", proof: "SQL injection & vector exfiltration blocked" },
  { icon: ShieldAlert, name: "Prompt-injection quarantine", where: "API", what: "documents are data in <source> tags; instruction-like chunks are quarantined", proof: "injected notice never reaches the model" },
  { icon: BadgeCheck, name: "Citation verifier", where: "API", what: "every sentence cited; figures must appear in the source; verbatim or LLM-entailed", proof: "unsupported sentences removed & shown" },
  { icon: ScanSearch, name: "Egress DLP", where: "API + Postgres", what: "canaries checked against RLS before an answer leaves; phone/ID numbers redacted", proof: "forbidden canary blocks the whole answer" },
  { icon: FileSignature, name: "Signed answer receipts", where: "API", what: "HMAC over question, answer and source hashes; anyone can re-verify later", proof: "edited answer or receipt detected" },
  { icon: ScrollText, name: "Tamper-evident audit + probing alerts", where: "Postgres", what: "hash-chained audit rows; refusals and guessed links raise an alert", proof: "one edited row breaks the chain" },
];

function Overview({ ev, chain }: { ev: EvalResults; chain: AuditChain | null }) {
  const red = ev.redteam;
  const g = ev.grounding?.summary;
  const t = ev.timing;
  const student = ev.recall?.identities["Student (public only)"];
  const stats: { label: string; value: string; hint: string; icon: typeof ShieldCheck }[] = [
    { label: "Backend tests", value: ev.tests ? `${ev.tests.passed}/${ev.tests.passed + ev.tests.failed}` : "–", hint: "RLS matrix · trust layer · units", icon: CircleCheck },
    { label: "Red-team attacks blocked", value: red ? `${red.passed}/${red.total}` : "–", hint: "end-to-end through the API", icon: Siren },
    { label: "Answer/refuse accuracy", value: g ? pct(g.decision_accuracy) : "–", hint: g ? `${g.cases} labelled cases · fact recall ${pct(g.fact_recall)}` : "", icon: BadgeCheck },
    { label: "Recall@10, public-only user", value: student ? pct(student.recall_at_10.rls_iterative) : "–", hint: student ? `${pct(student.recall_at_10.post_filter)} with app-side post-filtering` : "", icon: Radar },
    { label: "Timing side channel", value: t ? `${t.median_gap_ms >= 0 ? "+" : ""}${t.median_gap_ms} ms` : "–", hint: t ? `forbidden vs missing · p = ${t.p_value}` : "", icon: Timer },
    { label: "Audit chain", value: chain ? (chain.intact ? "intact" : "BROKEN") : "hashed", hint: chain ? `${chain.entries} entries verified` : "verify it in Governance", icon: Link2 },
  ];
  return (
    <div className="space-y-6">
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label} className="px-4 pt-3.5 pb-4">
            <div className="flex items-center gap-1.5 text-[12px] text-ink-3"><s.icon className="size-3.5 text-brand" /> {s.label}</div>
            <div className={cx("mt-1.5 font-display text-[34px] leading-none tabular-nums", s.value === "BROKEN" ? "text-deny" : "text-brand")}>{s.value}</div>
            <div className="mt-2 text-[11.5px] leading-snug text-ink-3">{s.hint}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <h2 className="mb-1 font-display text-[26px]">Ten layers between a question and a leak</h2>
          <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-ink-3">
            Each layer would stop the attacks below it on its own. The ones marked Postgres hold even if the application code has a bug,
            because the database refuses to return the rows.
          </p>
          <ol className="relative space-y-2 before:absolute before:top-3 before:bottom-3 before:left-[19px] before:w-px before:bg-line-2">
            {LAYERS.map((l, i) => (
              <li key={l.name} className="fade-up relative flex gap-3" style={{ animationDelay: `${i * 45}ms` }}>
                <span className="relative z-10 grid size-10 shrink-0 place-items-center rounded-xl bg-panel text-brand shadow-card ring-1 ring-line">
                  <l.icon className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1 rounded-xl bg-panel px-3.5 py-2.5 ring-1 ring-line/70">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10.5px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-[13.5px] font-medium">{l.name}</span>
                    <Chip tone={l.where.startsWith("Postgres") ? "brand" : "default"}>{l.where}</Chip>
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-ink-2">{l.what}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-3"><CircleCheck className="size-3 text-brand" /> {l.proof}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="text-[13px] font-medium">Why retrieval-layer authorisation</h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
              Filtering search results in application code is too late: forbidden chunks were already ranked, and low-privilege users lose recall.
              VaultRAG binds an HMAC-signed identity to every transaction and lets Postgres remove forbidden rows <em>inside</em> the vector scan.
            </p>
          </Card>
          <Card className="p-4">
            <h3 className="text-[13px] font-medium">Beyond the problem statement</h3>
            <ul className="mt-2 space-y-1.5 text-[12.5px] text-ink-2">
              {["k-anonymous pay statistics against differencing", "timing side-channel measured, not assumed", "signed, re-verifiable answer receipts",
                "hash-chained audit log", "probing detection with a database kill switch", "live access matrix and what-if ACL preview",
                "quota-aware AI: model chain, budget guard, verbatim mode"].map((t) => (
                <li key={t} className="flex gap-2"><CircleCheck className="mt-0.5 size-3.5 shrink-0 text-brand" /> {t}</li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

// --- Red team -----------------------------------------------------------------------------------

function Attacks({ ev }: { ev: EvalResults }) {
  const red = ev.redteam;
  const [cat, setCat] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  if (!red) return null;
  const cats = ["all", ...Array.from(new Set(red.attacks.map((a) => a.category)))];
  const rows = red.attacks.filter((a) => cat === "all" || a.category === cat);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-medium">Red-team suite</h2>
          <div className="text-[12px] text-ink-3">Each attack runs end-to-end through the API against the ingested corpus · {red.at.slice(0, 16).replace("T", " ")} UTC</div>
        </div>
        <Chip tone={red.passed < red.total ? "deny" : "brand"}><CircleCheck className="size-3" /> {red.passed}/{red.total} blocked · 0 canaries leaked</Chip>
      </div>
      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
        {cats.map((c) => (
          <button key={c} onClick={() => setCat(c)}
                  className={cx("rounded-full px-2.5 py-0.5 text-[12px] ring-1 transition-colors", c === cat ? "bg-ink text-paper ring-ink" : "text-ink-3 ring-line hover:text-ink")}>
            {c}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-[13px]">
          <thead className="text-[12px] font-medium text-ink-3">
            <tr className="border-b border-line">
              <th className="px-4 py-2 font-medium">Attack</th>
              <th className="px-4 py-2 font-medium">As</th>
              <th className="px-4 py-2 font-medium">Stopped by</th>
              <th className="px-4 py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((a) => (
              <tr key={a.name} className="cursor-pointer hover:bg-panel-2/40" onClick={() => setOpen(open === a.name ? null : a.name)}>
                <td className="px-4 py-2.5">
                  <div>{a.name}</div>
                  <div className="font-mono text-[10.5px] text-ink-3">{a.category}</div>
                  {open === a.name && <div className="fade-up mt-1.5 font-mono text-[11px] text-ink-2">observed: {a.detail}</div>}
                </td>
                <td className="px-4 py-2.5 text-ink-2">{a.persona}</td>
                <td className="px-4 py-2.5 font-mono text-[11.5px] text-ink-3">{a.defence}</td>
                <td className="px-4 py-2.5">{a.passed ? <Chip tone="brand"><CircleCheck className="size-3" /> blocked</Chip> : <Chip tone="deny"><CircleX className="size-3" /> leaked</Chip>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// --- Grounding ----------------------------------------------------------------------------------

function Grounding({ ev }: { ev: EvalResults }) {
  const g = ev.grounding;
  if (!g) return <Card className="p-5 text-[13px] text-ink-3">No grounding run recorded yet (python -m bench.grounding_eval).</Card>;
  const s = g.summary;
  const metrics: [string, string, string][] = [
    ["Answer / refuse decisions", pct(s.decision_accuracy), `${s.answered_when_expected} answered · ${s.refused_when_expected} refused`],
    ["Citation precision", pct(s.citation_precision), "cited sources from the expected document"],
    ["Fact recall", pct(s.fact_recall), "expected figure present in the answer"],
    ["Retrieval hit@5", pct(s.hit_at_5), "expected document in the top 5 under RLS"],
    ["Verbatim sentences", pct(s.verbatim_sentences), "quoted word for word from a source"],
    ["Latency p50 / p95", `${s.p50_ms} / ${s.p95_ms} ms`, "end to end, including embedding"],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map(([k, v, h]) => (
          <Card key={k} className="px-4 py-3.5">
            <div className="text-[12px] text-ink-3">{k}</div>
            <div className="mt-1 font-display text-[32px] leading-none tabular-nums text-brand">{v}</div>
            <div className="mt-1.5 text-[11.5px] text-ink-3">{h}</div>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">{s.cases} labelled cases across 8 identities</h2>
            <div className="text-[12px] text-ink-3">
              Mode: {g.mode === "verbatim" ? "verbatim composer (no generative model), the strictest setting" : "Gemini model chain"} · {g.at.slice(0, 10)}
            </div>
          </div>
          <Chip tone="brand">eval/gold.json</Chip>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead className="sticky top-0 bg-panel text-[12px] text-ink-3">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">As</th>
                <th className="px-4 py-2 font-medium">Question</th>
                <th className="px-4 py-2 font-medium">Expected</th>
                <th className="px-4 py-2 font-medium">Got</th>
                <th className="px-4 py-2 font-medium">Cited</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {g.rows.map((r, i) => {
                const ok = r.decision_ok && (r.fact_ok ?? true);
                return (
                  <tr key={i} className={cx(!ok && "bg-warn/[0.06]")}>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-[11px] text-ink-3">{r.as}</td>
                    <td className="px-4 py-2">{r.q}</td>
                    <td className="px-4 py-2"><Chip tone={r.expect === "refuse" ? "default" : "brand"}>{r.expect}</Chip></td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1">
                        {ok ? <CircleCheck className="size-3.5 text-brand" /> : <CircleX className="size-3.5 text-warn" />}
                        <span className="font-mono text-[11px] text-ink-2">{r.refused ? "refused" : r.mode}{r.fact_ok === false ? " · fact missing" : ""}</span>
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-2 text-[11.5px] text-ink-3">{r.cited.join(", ") || "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// --- Retrieval & timing -------------------------------------------------------------------------

const ROLE_LABEL: Record<string, string> = { "Student (public only)": "Student", "HOD, CSE": "HOD" };

function Retrieval({ ev, live }: { ev: EvalResults; live: boolean }) {
  const [planFor, setPlanFor] = useState(PERSONAS[0].email);
  const [planQ, setPlanQ] = useState("What is the CSE department budget for 2026-27?");
  const [plan, setPlan] = useState(false);
  const recall = ev.recall
    ? Object.entries(ev.recall.identities).map(([role, v]) => ({
        role: ROLE_LABEL[role] ?? role, visible: v.visible_share, post: v.recall_at_10.post_filter,
        strict: v.recall_at_10.rls_strict, iterative: v.recall_at_10.rls_iterative,
      }))
    : [];
  const t = ev.timing;
  const persona = PERSONAS.find((p) => p.email === planFor)!;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Recall@10 under RLS</h2>
          <Chip tone="brand">pgvector {ev.recall?.pgvector ?? ""}</Chip>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
          10,000 vectors, 100 queries against exact ground truth. Filtering a top-10 in app code starves low-privilege users; a strict filtered
          HNSW scan returns too few rows; the iterative scan keeps walking the graph until 10 authorised rows are found.
        </p>
        <div className="mt-4 space-y-3">
          {recall.map((r) => (
            <div key={r.role}>
              <div className="mb-1 flex justify-between text-[11.5px]">
                <span className="text-ink-2">{r.role} <span className="text-ink-3">· sees {(r.visible * 100).toFixed(r.visible < 0.1 ? 1 : 0)}%</span></span>
                <span className="font-mono text-ink-3">{r.post.toFixed(2)} · {r.strict.toFixed(2)} · <span className="text-brand">{r.iterative.toFixed(2)}</span></span>
              </div>
              <div className="relative h-2.5 overflow-hidden rounded-full bg-panel-2">
                <div className="absolute inset-y-0 left-0 rounded-full bg-brand/85" style={{ width: `${r.iterative * 100}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-cls-1/70" style={{ width: `${r.strict * 100}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-ink-3" style={{ width: `${r.post * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-ink-3">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-ink-3" /> app post-filter</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-cls-1" /> RLS strict scan</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-brand" /> RLS + iterative scan</span>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Timing side-channel test</h2>
          {t && <Chip tone={t.p_value >= 0.05 ? "brand" : "deny"}>{t.verdict}</Chip>}
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
          The refusal text is identical, but could response time reveal that a forbidden document exists? A student asks about documents that
          exist but are forbidden, and about documents that don't exist; trials are interleaved and compared with a permutation test.
        </p>
        {t ? (
          <div className="mt-4 space-y-4">
            <Distribution
              a={{ median: t.forbidden.median_ms, p95: t.forbidden.p95_ms, mean: t.forbidden.mean_ms, sd: t.forbidden.stdev_ms }}
              b={{ median: t.missing.median_ms, p95: t.missing.p95_ms, mean: t.missing.mean_ms, sd: t.missing.stdev_ms }}
              labels={[`Forbidden but exists · n = ${t.forbidden.n}`, `Does not exist · n = ${t.missing.n}`]}
            />
            <div className="grid grid-cols-3 gap-2 text-center">
              {[["median gap", `${t.median_gap_ms} ms`], ["p-value", String(t.p_value)], ["refusal text", t.identical_refusal_text ? "identical" : "differs"]].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-paper py-2 ring-1 ring-line">
                  <div className="font-display text-[22px] tabular-nums">{v}</div>
                  <div className="text-[11px] text-ink-3">{k}</div>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-ink-3">Forbidden rows are removed inside the index scan, so the work done is the same as when nothing exists.</p>
          </div>
        ) : (
          <div className="mt-4 text-[12.5px] text-ink-3">Not measured yet.</div>
        )}
      </Card>

      <Card className="p-4 lg:col-span-2">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium">See the query plan</h2>
            <p className="mt-0.5 text-[12px] text-ink-3">Run EXPLAIN ANALYZE on the vector search as any identity: the RLS predicate appears inside the HNSW index scan.</p>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select value={planFor} onChange={(e) => setPlanFor(e.target.value)} className="rounded-xl bg-paper px-3 py-2 text-[13px] ring-1 ring-line-2 outline-none">
            {PERSONAS.map((p) => <option key={p.email} value={p.email}>{p.name} · {p.title}</option>)}
          </select>
          <input value={planQ} onChange={(e) => setPlanQ(e.target.value)} className="min-w-0 flex-1 rounded-xl bg-paper px-3 py-2 text-[13px] ring-1 ring-line-2 outline-none focus:ring-brand" />
          <Button onClick={() => setPlan(true)} disabled={!live || planQ.trim().length < 2}><ScanSearch className="size-4" /> Explain</Button>
        </div>
        {!live && <div className="mt-2 text-[12px] text-ink-3">Needs the live backend.</div>}
      </Card>
      {plan && <PlanModal email={planFor} name={persona.name} question={planQ} onClose={() => setPlan(false)} />}
    </div>
  );
}

// --- Operations ---------------------------------------------------------------------------------

function Operations() {
  const { session } = useSession();
  const [hours, setHours] = useState(24);
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setM(null);
    fetchMetrics(session!, hours).then((r) => alive && setM(r)).catch((e) => alive && setError((e as Error).message));
    const t = setInterval(() => fetchMetrics(session!, hours).then((r) => alive && setM(r)).catch(() => {}), 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [session, hours]);

  if (error) return <Card className="p-5 text-[13px] text-deny">{error}</Card>;
  if (!m) return <div className="grid h-48 place-items-center text-ink-3"><Loader2 className="size-5 animate-spin" /></div>;
  const T = m.totals;
  const refusalRate = T.queries ? T.refused / T.queries : 0;
  const cacheRate = T.queries ? T.cache_hits / T.queries : 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12.5px] text-ink-3">
          {m.scope === "tenant" ? "Tenant-wide, from the audit log (admin view)" : "Your own activity only: RLS on audit_log decides the scope"} · refreshes every 20 s
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-panel p-1">
          {[24, 168].map((h) => (
            <button key={h} onClick={() => setHours(h)} className={cx("rounded-md px-3 py-1 text-[12.5px]", hours === h ? "bg-panel-2 text-ink ring-1 ring-line-2" : "text-ink-3")}>
              {h === 24 ? "24 hours" : "7 days"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Questions", String(T.queries), `${T.users} identit${T.users === 1 ? "y" : "ies"}`],
          ["Refusal rate", pct(refusalRate), `${T.refused} uniform refusals`],
          ["Cache hit rate", pct(cacheRate), "RLS-scoped, 0 AI calls"],
          ["Latency p50 / p95", T.p50 ? `${Math.round(T.p50)} / ${Math.round(T.p95 ?? 0)}` : "–", "ms, uncached answers"],
          ["Guarded events", String(T.denied_sources + T.dlp_blocks), `${T.denied_sources} guessed links · ${T.dlp_blocks} DLP blocks`],
        ].map(([k, v, h]) => (
          <Card key={k} className="px-4 py-3.5">
            <div className="text-[12px] text-ink-3">{k}</div>
            <div className="mt-1 font-display text-[30px] leading-none tabular-nums">{v}</div>
            <div className="mt-1.5 text-[11.5px] text-ink-3">{h}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Questions per hour</h2>
            <span className="flex gap-3 text-[11px] text-ink-3">
              <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-brand" /> answered + refused</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-3 border-t border-dashed border-deny" /> refused</span>
            </span>
          </div>
          <Sparkline values={m.series.map((x) => x.queries)} secondary={m.series.map((x) => x.refused)} height={120} />
          <div className="mt-1 flex justify-between font-mono text-[10.5px] text-ink-3">
            <span>{m.series[0]?.hour.slice(5, 13).replace("T", " ") ?? ""}</span>
            <span>{m.series.at(-1)?.hour.slice(5, 13).replace("T", " ") ?? ""}</span>
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium">How answers were composed</h2>
          <Donut parts={m.modes.map((x) => ({ label: x.mode, value: x.n }))} center={String(T.queries)} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col items-center p-4">
          <h2 className="mb-2 self-start text-sm font-medium">AI budget today</h2>
          <Gauge value={m.budget.today} max={m.budget.limit} label="generation calls (Pacific day)" sub={`fair use: ${m.budget.perUser10min} per user per 10 min`} />
          <p className="mt-3 text-center text-[11.5px] leading-relaxed text-ink-3">
            Over budget, answers are quoted verbatim from sources instead of failing. Cached answers cost nothing.
          </p>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium">Model chain</h2>
          <div className="space-y-1.5">
            {m.budget.chain.map((model, i) => {
              const parked = m.budget.parked[model];
              const used = m.models.find((x) => x.model === model)?.calls ?? 0;
              return (
                <div key={model} className="flex items-center gap-2 rounded-lg bg-paper px-2.5 py-1.5 ring-1 ring-line">
                  <span className="font-mono text-[10.5px] text-ink-3">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{model}</span>
                  {parked !== undefined ? <Chip tone="warn">rate-limited · {Math.ceil(parked / 60)} min</Chip> : <Chip tone="brand">ready</Chip>}
                  <span className="w-10 text-right font-mono text-[11px] tabular-nums text-ink-3">{used}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11.5px] text-ink-3">Free-tier quotas are per model; a 429 parks a model until Google's retry time and the next one answers.</p>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium">Most asked</h2>
          {m.topQuestions.length ? (
            <BarList items={m.topQuestions.slice(0, 6).map((q) => ({ label: q.query, value: q.n, tone: q.refused ? "deny" : "brand" }))} />
          ) : (
            <div className="text-[12px] text-ink-3">No questions yet.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

// --- Governance ---------------------------------------------------------------------------------

function Governance({ isAdmin, live }: { isAdmin: boolean; live: boolean }) {
  const { session } = useSession();
  const user = session!.user;
  const localAudit = useAudit().filter((e) => isAdmin || e.userEmail === user.email);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [chain, setChain] = useState<AuditChain | null>(null);
  const [checking, setChecking] = useState(false);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchAudit(session!).then(setAudit);
    if (isAdmin && live) fetchAlerts(session!).then(setAlerts).catch(() => setAlerts(null));
  }, [session, isAdmin, live]);

  useEffect(() => {
    load();
  }, [load]);

  async function verifyChain() {
    setChecking(true);
    try {
      setChain(await fetchAuditChain(session!));
    } finally {
      setChecking(false);
    }
  }

  async function toggleLock(id: string, locked: boolean) {
    setBusyUser(id);
    try {
      if (locked) await unlockUser(session!, id);
      else await lockUser(session!, id, "Locked from the trust centre after a probing alert");
      load();
    } finally {
      setBusyUser(null);
    }
  }

  const rows = audit ?? localAudit;
  return (
    <div className="space-y-4">
      {isAdmin && live && (
        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium"><Siren className="size-4 text-deny" /> Probing alerts · last {alerts?.window ?? "60 minutes"}</h2>
                <div className="font-mono text-[11px] text-ink-3">{alerts?.rule}</div>
              </div>
              <Button variant="outline" className="py-1" onClick={load}>Refresh</Button>
            </div>
            {!alerts ? (
              <div className="grid h-24 place-items-center text-ink-3"><Loader2 className="size-4 animate-spin" /></div>
            ) : alerts.alerts.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-ink-3">No activity in the window.</div>
            ) : (
              <div className="divide-y divide-line">
                {alerts.alerts.map((a) => (
                  <div key={a.userId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <span className={cx("size-2.5 rounded-full", a.level === "high" ? "bg-deny" : a.level === "medium" ? "bg-warn" : "bg-line-2")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[13px]">{a.name}{a.locked && <Lock className="size-3 text-deny" />}</div>
                      <div className="font-mono text-[11px] text-ink-3">{a.queries} questions · {a.refusals} refused · {a.denied} guessed links · {a.dlp} DLP</div>
                    </div>
                    <Chip tone={a.level === "high" ? "deny" : a.level === "medium" ? "warn" : "default"}>score {a.score}</Chip>
                    {a.userId !== user.uid && (
                      <Button variant={a.locked ? "outline" : "primary"} className={cx("py-1", !a.locked && "bg-deny hover:bg-deny/90")}
                              disabled={busyUser === a.userId} onClick={() => toggleLock(a.userId, a.locked)}>
                        {a.locked ? <><LockOpen className="size-3.5" /> Unlock</> : <><Lock className="size-3.5" /> Lock</>}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-line bg-panel-2/40 px-4 py-2 text-[11.5px] text-ink-3">
              Locking takes effect inside the database: app_ctx() stops resolving that identity, so even a still-valid token reads nothing.
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="flex items-center gap-2 text-sm font-medium"><Link2 className="size-4 text-brand" /> Tamper-evident audit log</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
              Every audit row stores the SHA-256 of the previous row. Editing, deleting or reordering any entry breaks the chain from that point on.
            </p>
            <Button className="mt-3 w-full" onClick={verifyChain} disabled={checking}>
              {checking ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4" />} Verify the whole chain
            </Button>
            {chain && (
              <div className={cx("fade-up mt-3 rounded-xl p-3 ring-1", chain.intact ? "bg-brand-soft/60 ring-brand/30" : "bg-deny/[0.07] ring-deny/30")}>
                <div className={cx("flex items-center gap-2 text-[13px] font-medium", chain.intact ? "text-brand" : "text-deny")}>
                  {chain.intact ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
                  {chain.intact ? `Intact: ${chain.entries} entries re-hashed` : `Broken at entry #${chain.first_bad_id}`}
                </div>
                <div className="mt-1 break-all font-mono text-[10.5px] text-ink-3">head {chain.head}</div>
              </div>
            )}
          </Card>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Audit log</h2>
          <span className="text-[11.5px] text-ink-3">{isAdmin ? "All users (admin view)" : "Your own entries only (RLS on audit_log)"}</span>
        </div>
        <div className="max-h-[440px] overflow-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="sticky top-0 bg-panel text-[12px] font-medium text-ink-3">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Detail</th>
                <th className="px-4 py-2 text-right font-medium">Chunks</th>
                {isAdmin && <th className="px-4 py-2 text-right font-medium">RLS-filtered</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-[11.5px] text-ink-3">{e.at.replace("T", " ")}</td>
                  <td className="whitespace-nowrap px-4 py-2">{e.userName}</td>
                  <td className="px-4 py-2"><Chip tone={ACTION_TONE[e.action] ?? "default"}>{e.action.replace("_", " ")}</Chip></td>
                  <td className="max-w-[360px] truncate px-4 py-2 text-ink-2">{e.detail}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{e.chunks}</td>
                  {isAdmin && <td className={cx("px-4 py-2 text-right tabular-nums", e.filtered > 0 && "text-deny")}>{e.filtered}</td>}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-3">No entries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// --- Page ---------------------------------------------------------------------------------------

export function SecurityPage() {
  const { session } = useSession();
  const user = session!.user;
  const isAdmin = user.roles.includes("admin");
  const live = session!.mode === "live";
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("tab") as Tab | null;
  const [tab, setTabState] = useState<Tab>(fromUrl && TABS.some((t) => t.key === fromUrl) ? fromUrl : "overview");
  const setTab = (t: Tab) => {
    setTabState(t);
    setParams(t === "overview" ? {} : { tab: t }, { replace: true });
  };
  const [evalData, setEvalData] = useState<EvalResults | null>(null);
  const [chain, setChain] = useState<AuditChain | null>(null);

  useEffect(() => {
    let alive = true;
    fetchEval(session!).then((e) => alive && setEvalData(e));
    if (isAdmin && live) fetchAuditChain(session!).then((c) => alive && setChain(c)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [session, isAdmin, live]);

  const ev = useMemo<EvalResults>(() => ({ ...MEASURED, ...(evalData ?? {}) }), [evalData]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <SectionTitle eyebrow="Proof, not promises" title="Trust center">
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          <GaugeIcon className="size-3.5" /> {evalData ? "live results from /api/eval/latest" : "last measured results"}
        </div>
      </SectionTitle>

      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
              tab === t.key ? "bg-ink text-paper" : "text-ink-3 hover:bg-panel-2 hover:text-ink",
            )}
          >
            <t.icon className="size-3.5" /> {t.label}
          </button>
        ))}
      </div>

      <div key={tab} className="fade-up">
        {tab === "overview" && <Overview ev={ev} chain={chain} />}
        {tab === "attacks" && <Attacks ev={ev} />}
        {tab === "grounding" && <Grounding ev={ev} />}
        {tab === "retrieval" && <Retrieval ev={ev} live={live} />}
        {tab === "operations" && <LiveOnly live={live}><Operations /></LiveOnly>}
        {tab === "governance" && <Governance isAdmin={isAdmin} live={live} />}
      </div>
    </div>
  );
}
