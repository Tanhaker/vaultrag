// Small SVG charts drawn in the theme's own colours (no chart library: they need to look like the
// rest of the archive, and the bundle stays small).

import { cx } from "./ui";

export function Sparkline({ values, secondary, height = 56, className }: { values: number[]; secondary?: number[]; height?: number; className?: string }) {
  const w = 320;
  const max = Math.max(1, ...values, ...(secondary ?? []));
  const pts = (vs: number[]) =>
    vs.map((v, i) => [vs.length === 1 ? w / 2 : (i / (vs.length - 1)) * w, height - 4 - (v / max) * (height - 10)] as const);
  const line = (vs: number[]) => pts(vs).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  if (values.length === 0) return <div className={cx("grid place-items-center text-[12px] text-ink-3", className)} style={{ height }}>No activity yet</div>;
  const area = `${line(values)} L${w},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cx("w-full", className)} style={{ height }} aria-hidden>
      <path d={area} fill="var(--color-brand)" opacity="0.10" />
      <path d={line(values)} fill="none" stroke="var(--color-brand)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
      {secondary && <path d={line(secondary)} fill="none" stroke="var(--color-deny)" strokeWidth="1.4" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

export function Gauge({ value, max, label, sub }: { value: number; max: number; label: string; sub?: string }) {
  const r = 46;
  const frac = Math.max(0, Math.min(1, max ? value / max : 0));
  const len = Math.PI * r;
  const tone = frac >= 0.9 ? "var(--color-deny)" : frac >= 0.7 ? "var(--color-warn)" : "var(--color-brand)";
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 70" className="h-[84px] w-[144px]" aria-hidden>
        <path d="M14 62 A46 46 0 0 1 106 62" fill="none" stroke="var(--color-panel-2)" strokeWidth="10" strokeLinecap="round" />
        <path d="M14 62 A46 46 0 0 1 106 62" fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${len * frac} ${len}`} style={{ transition: "stroke-dasharray 600ms cubic-bezier(.2,.7,.2,1)" }} />
      </svg>
      <div className="-mt-9 font-display text-[30px] leading-none tabular-nums">{value}<span className="text-[15px] text-ink-3">/{max}</span></div>
      <div className="mt-1.5 text-[12px] text-ink-2">{label}</div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

const DONUT = ["var(--color-brand)", "var(--color-cls-1)", "var(--color-warn)", "var(--color-ink-3)", "var(--color-deny)", "var(--color-cls-0)"];

export function Donut({ parts, size = 112, center }: { parts: { label: string; value: number }[]; size?: number; center?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = 40;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" style={{ width: size, height: size }} className="shrink-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-panel-2)" strokeWidth="14" />
        {total > 0 && parts.map((p, i) => {
          const seg = (p.value / total) * c;
          const el = <circle key={p.label} cx="50" cy="50" r={r} fill="none" stroke={DONUT[i % DONUT.length]} strokeWidth="14"
                             strokeDasharray={`${seg} ${c - seg}`} strokeDashoffset={-offset} />;
          offset += seg;
          return el;
        })}
        {center && <text x="50" y="50" transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="central"
                         className="fill-ink font-display" fontSize="20">{center}</text>}
      </svg>
      <div className="min-w-0 space-y-1">
        {parts.map((p, i) => (
          <div key={p.label} className="flex items-center gap-2 text-[12px]">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: DONUT[i % DONUT.length] }} />
            <span className="truncate text-ink-2">{p.label}</span>
            <span className="ml-auto pl-2 font-mono tabular-nums text-ink-3">{p.value}</span>
          </div>
        ))}
        {total === 0 && <div className="text-[12px] text-ink-3">Nothing recorded yet</div>}
      </div>
    </div>
  );
}

export function BarList({ items, unit = "" }: { items: { label: string; value: number; tone?: "brand" | "deny" | "warn" }[]; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[12px]">
            <span className="truncate text-ink-2">{it.label}</span>
            <span className="font-mono tabular-nums text-ink-3">{it.value}{unit}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div className={cx("h-full rounded-full transition-[width] duration-700", it.tone === "deny" ? "bg-deny" : it.tone === "warn" ? "bg-warn" : "bg-brand")}
                 style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Two latency distributions on one axis: medians marked, overlap visible at a glance. */
export function Distribution({ a, b, labels }: { a: { median: number; p95: number; mean: number; sd: number }; b: { median: number; p95: number; mean: number; sd: number }; labels: [string, string] }) {
  const lo = Math.max(0, Math.min(a.median, b.median) - 2.5 * Math.max(a.sd, b.sd));
  const hi = Math.max(a.p95, b.p95) * 1.08;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const Row = ({ g, tone, label }: { g: typeof a; tone: string; label: string }) => (
    <div>
      <div className="mb-1 flex justify-between text-[11.5px] text-ink-3">
        <span>{label}</span>
        <span className="font-mono">median {g.median.toFixed(0)} ms · p95 {g.p95.toFixed(0)} ms</span>
      </div>
      <div className="relative h-7 rounded-md bg-panel-2/60">
        <div className="absolute inset-y-2 rounded-full opacity-30" style={{ left: `${x(Math.max(lo, g.mean - g.sd))}%`, right: `${100 - x(Math.min(hi, g.mean + g.sd))}%`, background: tone }} />
        <div className="absolute inset-y-1 w-[3px] rounded-full" style={{ left: `${x(g.median)}%`, background: tone }} />
        <div className="absolute inset-y-2.5 w-[2px] rounded-full opacity-60" style={{ left: `${x(g.p95)}%`, background: tone }} />
      </div>
    </div>
  );
  return (
    <div className="space-y-3">
      <Row g={a} tone="var(--color-deny)" label={labels[0]} />
      <Row g={b} tone="var(--color-brand)" label={labels[1]} />
      <div className="flex justify-between font-mono text-[10.5px] text-ink-3">
        <span>{lo.toFixed(0)} ms</span>
        <span>{hi.toFixed(0)} ms</span>
      </div>
    </div>
  );
}
