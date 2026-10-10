import { CircleCheck, Database, FileText, Image as ImageIcon, KeyRound, Link2, Lock, ScanText, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../ui";

const CLS_BORDER = ["border-cls-0/50", "border-cls-1/60", "border-cls-2/70", "border-cls-3/70"];
const CLS_BG = ["bg-paper", "bg-cls-1/[0.07]", "bg-cls-2/[0.09]", "bg-cls-3/[0.09]"];
// 24 chunks; what a public-only student may read is level 0.
const GRID = [0, 1, 2, 0, 3, 0, 1, 2, 0, 0, 3, 1, 0, 2, 0, 1, 0, 0, 2, 3, 0, 1, 0, 0];
// Nearest neighbours of the question, in order (indices into GRID).
const NEAREST = [2, 8, 7, 13, 0, 9, 3, 14];

export const STORY_LABELS = [
  "ingest · multi-modal",
  "identity · signed context",
  "retrieval · inside Postgres",
  "compose · verify",
  "egress · receipt",
  "audit · hash chain",
];

function Layer({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <div className={cx("absolute inset-0 p-5 transition-all duration-700 ease-[cubic-bezier(.2,.7,.2,1)] sm:p-7",
                       on ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-5 opacity-0")}>
      {children}
    </div>
  );
}

function Ingest({ on }: { on: boolean }) {
  const sources = [
    { icon: FileText, label: "Digital PDF", sub: "text blocks · tables · page + bbox" },
    { icon: ScanText, label: "Scanned page", sub: "no text layer → OCR" },
    { icon: ImageIcon, label: "Photo", sub: "vision OCR + caption" },
    { icon: Database, label: "Database rows", sub: "record cards · row ACL" },
  ];
  return (
    <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center gap-3">
      <div className="space-y-2">
        {sources.map((s, i) => (
          <div key={s.label} className={cx("flex items-center gap-2.5 rounded-xl bg-paper px-3 py-2 ring-1 ring-line transition-all duration-700", on ? "opacity-100" : "-translate-x-4 opacity-0")}
               style={{ transitionDelay: `${i * 90}ms` }}>
            <s.icon className="size-4 shrink-0 text-brand" />
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium">{s.label}</div>
              <div className="truncate font-mono text-[9.5px] text-ink-3">{s.sub}</div>
            </div>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 40 160" className="h-40 w-8 text-brand">
        {[20, 60, 100, 140].map((y) => <path key={y} d={`M0 ${y} C 20 ${y}, 20 80, 40 80`} fill="none" stroke="currentColor" strokeOpacity="0.5" className="dash-flow" />)}
      </svg>
      <div>
        <div className="grid grid-cols-4 gap-1.5">
          {GRID.slice(0, 16).map((c, i) => (
            <div key={i} className={cx("grid aspect-square place-items-center rounded-md border transition-all duration-500", CLS_BORDER[c], CLS_BG[c], on ? "scale-100 opacity-100" : "scale-75 opacity-0")}
                 style={{ transitionDelay: `${300 + i * 35}ms` }}>
              {c >= 2 && <Lock className="size-2.5 text-ink-3" />}
            </div>
          ))}
        </div>
        <div className="mt-2 font-mono text-[9.5px] leading-snug text-ink-3">chunks inherit their document's ACL by trigger · L0–L3</div>
      </div>
    </div>
  );
}

function Identity({ on }: { on: boolean }) {
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <div className={cx("rounded-xl bg-ink p-3 font-mono text-[10.5px] leading-relaxed break-all text-paper/90 transition-all duration-700", on ? "opacity-100" : "opacity-0")}>
        <span className="text-[#ff9b85]">eyJhbGciOiJIUzI1NiJ9</span>.<span className="text-[#f1d58f]">eyJzdWIiOiJ1LWFhcmF2Iiwicm9sZXMiOlsic3R1ZGVudCJdfQ</span>.<span className="text-[#7fd1a8]">Qm9vdHN0cmFw…</span>
        <div className="mt-1 text-paper/45">HS256 JWT · identity never comes from the request body</div>
      </div>
      <div className="flex items-center gap-2 pl-4 font-mono text-[10px] text-ink-3"><span className="h-5 w-px bg-line-2" /> per transaction</div>
      <div className={cx("relative rounded-xl bg-paper p-3 ring-1 ring-line transition-all delay-200 duration-700", on ? "opacity-100" : "translate-y-3 opacity-0")}>
        <pre className="font-mono text-[10.5px] leading-relaxed text-ink-2">{`set_config('app.ctx', {
  "uid": "u-aarav", "roles": ["student"],
  "depts": ["CSE"], "clr": 0, "exp": 1791…
}, true)
set_config('app.ctx_sig', hmac_sha256(ctx), true)`}</pre>
        <div className="absolute -top-3 -right-2 flex items-center gap-1.5 rounded-full bg-brand px-2.5 py-1 font-mono text-[10px] text-paper shadow-card">
          <ShieldCheck className="size-3.5" /> app_ctx() verified
        </div>
      </div>
      <div className={cx("flex flex-wrap gap-2 transition-opacity delay-500 duration-700", on ? "opacity-100" : "opacity-0")}>
        {["forged → NULL → 0 rows", "expired → NULL", "locked account → NULL"].map((t) => (
          <span key={t} className="rounded-full bg-deny/[0.08] px-2.5 py-1 font-mono text-[10px] text-deny ring-1 ring-deny/20">{t}</span>
        ))}
      </div>
    </div>
  );
}

function Retrieval({ on }: { on: boolean }) {
  const allowedNearest = NEAREST.filter((i) => GRID[i] === 0).slice(0, 4);
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-ink-3">
        <span>HNSW + BM25 over chunks, as rag_reader</span>
        <span className="text-deny">acl_check() removes rows inside the scan</span>
      </div>
      <div className="relative">
        <div className="grid grid-cols-6 gap-1.5">
          {GRID.map((c, i) => {
            const forbidden = c > 0;
            const rank = allowedNearest.indexOf(i);
            return (
              <div key={i}
                   className={cx("relative grid aspect-[1.25] place-items-center rounded-md border transition-all duration-700",
                                 CLS_BORDER[c], CLS_BG[c],
                                 on && forbidden && "scale-90 border-dashed opacity-25",
                                 on && rank >= 0 && "border-brand bg-brand-soft ring-2 ring-brand/40")}
                   style={{ transitionDelay: on ? `${forbidden ? 250 + i * 25 : 900 + rank * 120}ms` : "0ms" }}>
                {on && forbidden && <span className="absolute inset-x-1 top-1/2 h-px -rotate-12 bg-deny/70" />}
                {on && rank >= 0 && <span className="font-mono text-[10px] font-medium text-brand">{rank + 1}</span>}
              </div>
            );
          })}
        </div>
      </div>
      <div className={cx("mt-3 grid grid-cols-3 gap-2 transition-opacity delay-[1200ms] duration-700", on ? "opacity-100" : "opacity-0")}>
        {[["recall@10", "87%", "vs 5% post-filter"], ["timing gap", "−1.1 ms", "p = 0.94"], ["p95 query", "16 ms", "10k vectors"]].map(([k, v, s]) => (
          <div key={k} className="rounded-lg bg-paper px-2.5 py-2 text-center ring-1 ring-line">
            <div className="font-display text-[20px] leading-none text-brand">{v}</div>
            <div className="mt-1 font-mono text-[9px] text-ink-3">{k} · {s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Compose({ on }: { on: boolean }) {
  const lines: { t: string; c?: number; bad?: boolean }[] = [
    { t: "The CSE department's approved budget for FY 2026-27 is ₹48.5 lakh.", c: 1 },
    { t: "₹21.7 lakh had been spent by 30 September 2026.", c: 2 },
    { t: "The budget is expected to double next year.", bad: true },
  ];
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <div className="rounded-xl bg-paper p-4 ring-1 ring-line">
        <div className="mb-2 font-mono text-[10px] text-ink-3">answer · every sentence must cite a source</div>
        <div className="space-y-1.5 text-[13px] leading-relaxed">
          {lines.map((l, i) => (
            <div key={i} className={cx("transition-all duration-700", on ? "opacity-100" : "translate-y-2 opacity-0", l.bad && on && "text-deny/70 line-through decoration-deny/60")}
                 style={{ transitionDelay: `${i * 260}ms` }}>
              {l.t}
              {l.c && <span className="ml-1 inline-grid h-[15px] min-w-[15px] place-items-center rounded-[4px] bg-brand-soft px-[3px] align-middle font-mono text-[9.5px] text-brand">{l.c}</span>}
              {l.bad && <span className="ml-1.5 font-mono text-[9.5px] text-deny no-underline">unsupported · removed</span>}
            </div>
          ))}
        </div>
      </div>
      <div className={cx("grid grid-cols-3 gap-2 transition-opacity delay-700 duration-700", on ? "opacity-100" : "opacity-0")}>
        {["citation is valid", "every figure is in the source", "quoted or entailed"].map((t) => (
          <div key={t} className="flex items-center gap-1.5 rounded-lg bg-brand-soft/60 px-2.5 py-2 text-[11px] text-ink-2 ring-1 ring-brand/20">
            <CircleCheck className="size-3.5 shrink-0 text-brand" /> {t}
          </div>
        ))}
      </div>
    </div>
  );
}

function Egress({ on }: { on: boolean }) {
  return (
    <div className="flex h-full items-center gap-3">
      <div className={cx("relative flex-1 overflow-hidden rounded-xl bg-paper p-4 ring-1 ring-line", on && "sweep")}>
        <div className="font-mono text-[10px] text-ink-3">egress filter</div>
        <div className="mt-2 space-y-1.5 text-[12px]">
          <div className="flex items-center gap-2"><CircleCheck className="size-3.5 text-brand" /> no canary from a forbidden document</div>
          <div className="flex items-center gap-2"><CircleCheck className="size-3.5 text-brand" /> phone / ID numbers redacted</div>
          <div className="flex items-center gap-2"><CircleCheck className="size-3.5 text-brand" /> uniform refusal if nothing survives</div>
        </div>
      </div>
      <div className={cx("w-[46%] rounded-xl bg-ink p-3.5 font-mono text-[10px] leading-relaxed text-paper/85 shadow-float transition-all delay-300 duration-700", on ? "translate-x-0 opacity-100" : "translate-x-6 opacity-0")}>
        <div className="mb-1.5 flex items-center gap-1.5 text-[#7fd1a8]"><KeyRound className="size-3.5" /> answer receipt</div>
        <div>question  sha256 36adc5…bff259</div>
        <div>answer    sha256 201267…5da67b</div>
        <div>source 1  sha256 75f81d…224f90</div>
        <div className="mt-1 text-[#f1d58f]">sig hmac-sha256 e7f62c…a2661d</div>
        <div className="mt-1.5 text-paper/45">anyone can re-verify it later</div>
      </div>
    </div>
  );
}

function Audit({ on }: { on: boolean }) {
  const blocks = ["login", "query", "source_view", "query", "acl_change"];
  return (
    <div className="flex h-full flex-col justify-center gap-4">
      <div className="flex items-center gap-1 overflow-hidden">
        {blocks.map((b, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={cx("w-[88px] rounded-lg bg-paper p-2 ring-1 transition-all duration-700", i === 3 ? "ring-brand" : "ring-line", on ? "opacity-100" : "translate-y-3 opacity-0")}
                 style={{ transitionDelay: `${i * 140}ms` }}>
              <div className="font-mono text-[9px] text-ink-3">#{1021 + i}</div>
              <div className="text-[11px] font-medium">{b}</div>
              <div className="mt-1 truncate font-mono text-[8.5px] text-ink-3">prev {["0000", "9f2a", "c41e", "7b03", "e8d5"][i]}…</div>
            </div>
            {i < blocks.length - 1 && <Link2 className={cx("size-3.5 shrink-0 text-brand transition-opacity duration-700", on ? "opacity-100" : "opacity-0")} style={{ transitionDelay: `${i * 140 + 120}ms` }} />}
          </div>
        ))}
      </div>
      <div className={cx("flex items-center gap-2.5 rounded-xl bg-brand-soft/60 px-3.5 py-2.5 text-[12.5px] ring-1 ring-brand/25 transition-opacity delay-700 duration-700", on ? "opacity-100" : "opacity-0")}>
        <ShieldCheck className="size-4 text-brand" />
        audit_chain_verify(): every row re-hashed, chain intact. One edited row breaks it.
      </div>
      <div className={cx("grid grid-cols-2 gap-2 transition-opacity delay-1000 duration-700", on ? "opacity-100" : "opacity-0")}>
        <div className="rounded-lg bg-paper px-3 py-2 text-[11.5px] ring-1 ring-line"><span className="font-medium">Probing alerts</span><div className="text-ink-3">refusals + guessed links → score</div></div>
        <div className="rounded-lg bg-paper px-3 py-2 text-[11.5px] ring-1 ring-line"><span className="font-medium">Kill switch</span><div className="text-ink-3">lock → the database stops answering</div></div>
      </div>
    </div>
  );
}

const STATES = [Ingest, Identity, Retrieval, Compose, Egress, Audit];

export function StoryArt({ active, only }: { active: number; only?: number }) {
  return (
    <div className="overflow-hidden rounded-[26px] bg-panel shadow-float ring-1 ring-line">
      <div className="flex items-center gap-2 border-b border-line bg-panel-2/50 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-deny/50" />
        <span className="size-2.5 rounded-full bg-warn/50" />
        <span className="size-2.5 rounded-full bg-brand/50" />
        <span className="ml-2 font-mono text-[11px] text-ink-3">defrag · {STORY_LABELS[only ?? active]}</span>
        <span className="ml-auto font-mono text-[11px] text-ink-3">{String((only ?? active) + 1).padStart(2, "0")}/06</span>
      </div>
      <div className="relative h-[380px] sm:h-[420px]">
        {STATES.map((S, i) => (only === undefined || only === i ? <Layer key={i} on={(only ?? active) === i}><S on={(only ?? active) === i} /></Layer> : null))}
      </div>
    </div>
  );
}
