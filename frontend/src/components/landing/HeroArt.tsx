import { useEffect, useRef } from "react";
import { cx } from "../ui";

/** The vault seal: concentric rings with engraved text, the mark at the centre, and the four kinds
 *  of source orbiting it. Scroll pushes the sources outward; the pointer tilts the composition. */
export function HeroArt({ progress }: { progress: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", String((e.clientX - r.left) / r.width - 0.5));
      el.style.setProperty("--my", String((e.clientY - r.top) / r.height - 0.5));
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  const spread = 1 + progress * 0.55;
  const card = (depth: number) =>
    ({
      transform: `translate3d(calc(var(--mx, 0) * ${depth * 26}px), calc(var(--my, 0) * ${depth * 26}px), 0) scale(${1 - progress * 0.08})`,
      opacity: 1 - progress * 0.6,
    }) as const;

  return (
    <div ref={ref} className="relative mx-auto aspect-square w-full max-w-[560px] select-none" aria-hidden>
      <svg viewBox="0 0 400 400" className="absolute inset-0 size-full" style={{ transform: `rotate(${progress * 40}deg)` }}>
        <defs>
          <path id="ring-text" d="M200,200 m-168,0 a168,168 0 1,1 336,0 a168,168 0 1,1 -336,0" />
          <radialGradient id="core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3f8a66" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#24543f" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="200" cy="200" r="120" fill="url(#core)" />
        {[188, 150, 112, 74].map((r, i) => (
          <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="#fffdf8" strokeOpacity={0.07 + i * 0.03} strokeWidth="1" />
        ))}
        <g className="spin-slow">
          {Array.from({ length: 72 }).map((_, i) => (
            <line key={i} x1="200" y1="44" x2="200" y2={i % 6 === 0 ? 54 : 49} stroke="#fffdf8" strokeOpacity={i % 6 === 0 ? 0.4 : 0.16}
                  transform={`rotate(${i * 5} 200 200)`} />
          ))}
        </g>
        <g className="spin-slower">
          <text fill="#fffdf8" fillOpacity="0.38" fontSize="9.5" letterSpacing="3.2" fontFamily="Geist Mono, monospace">
            <textPath href="#ring-text">ROW-LEVEL SECURITY · HMAC-SIGNED CONTEXT · RLS INSIDE THE VECTOR SCAN · EVERY SENTENCE CITED · SIGNED RECEIPTS ·</textPath>
          </text>
        </g>
        <circle cx="200" cy="200" r="74" fill="none" stroke="#7fd1a8" strokeOpacity="0.5" strokeWidth="1.2" strokeDasharray="2 5" className="spin-slow" />
        <circle cx="200" cy="200" r="46" fill="#24543f" fillOpacity="0.25" className="pulse-ring" />
      </svg>

      {/* the mark */}
      <div className="absolute top-1/2 left-1/2 grid size-[19%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[26%] bg-paper shadow-[0_20px_60px_-10px_rgba(36,84,63,0.7)]">
        <svg viewBox="0 0 32 32" className="size-[62%]">
          <circle cx="16" cy="13" r="4.2" fill="#1d1b17" />
          <path d="M13.6 15.6h4.8l1.5 8.4h-7.8z" fill="#1d1b17" />
          <circle cx="16" cy="13" r="1.5" fill="#3f8a66" />
        </svg>
      </div>

      {/* orbiting sources */}
      <div className="absolute" style={{ left: `${50 - 41 * spread}%`, top: `${50 - 33 * spread}%` }}>
        <div className="float" style={{ ["--r" as string]: "-6deg" }}>
          <div className="w-[150px] rounded-xl bg-paper p-3 shadow-float ring-1 ring-white/40" style={card(1.2)}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[8px] tracking-[0.14em] text-ink-3">PDF · p.1</span>
              <span className="rounded-[3px] border border-cls-2/60 px-1 font-mono text-[7px] tracking-[0.12em] text-cls-2">CONFIDENTIAL</span>
            </div>
            <div className="mt-1.5 text-[10.5px] font-medium leading-tight text-ink">CSE Department Budget</div>
            <div className="mt-2 space-y-1">
              {[92, 78, 86, 54].map((w, i) => (
                <div key={i} className={cx("h-[3px] rounded-full", i === 1 ? "bg-mark" : "bg-line-2/80")} style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="absolute" style={{ left: `${50 + 18 * spread}%`, top: `${50 - 40 * spread}%` }}>
        <div className="float" style={{ ["--d" as string]: "-2.5s", ["--r" as string]: "5deg" }}>
          <div className="w-[136px] overflow-hidden rounded-xl bg-paper shadow-float ring-1 ring-white/40" style={card(0.8)}>
            <div className="relative h-[70px] bg-gradient-to-br from-[#8a6a48] to-[#5d4630]">
              <div className="absolute top-2 left-1/2 h-[56px] w-[64%] -translate-x-1/2 rotate-[-2deg] bg-paper/95 p-1.5 shadow">
                <div className="h-[3px] w-2/3 rounded bg-ink/70" />
                <div className="mt-1 h-[2px] w-full rounded bg-ink/30" />
                <div className="mt-0.5 h-[2px] w-5/6 rounded bg-ink/30" />
              </div>
              <div className="absolute top-[14px] left-[22%] h-[24px] w-[58%] rounded-sm border border-dashed border-[#7fd1a8] bg-[#7fd1a8]/15" />
            </div>
            <div className="px-2.5 py-1.5 font-mono text-[8px] text-ink-3">photo · OCR box · 17 Oct</div>
          </div>
        </div>
      </div>

      <div className="absolute" style={{ left: `${50 - 44 * spread}%`, top: `${50 + 22 * spread}%` }}>
        <div className="float" style={{ ["--d" as string]: "-4s", ["--r" as string]: "4deg" }}>
          <div className="w-[158px] rounded-xl bg-paper px-3 py-2.5 shadow-float ring-1 ring-white/40" style={card(1)}>
            <div className="flex items-center justify-between font-mono text-[8px] text-ink-3">
              <span>db://students/AU23CSE001</span>
              <span className="rounded-[3px] border border-cls-1/50 px-1 text-cls-1">L1</span>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1 font-mono text-[8.5px] text-ink-2">
              <span>CGPA</span><span>8.42</span><span className="text-ink-3">own row</span>
              <span>fees</span><span>₹73,000</span><span className="text-ink-3">RLS</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute" style={{ left: `${50 + 12 * spread}%`, top: `${50 + 26 * spread}%` }}>
        <div className="float" style={{ ["--d" as string]: "-1.2s", ["--r" as string]: "-3deg" }}>
          <div className="w-[176px] rounded-xl bg-paper px-3 py-2.5 shadow-float ring-1 ring-white/40" style={card(1.4)}>
            <div className="text-[10.5px] leading-snug text-ink">
              Approved budget is ₹48.5 lakh
              <span className="ml-1 inline-grid h-[13px] min-w-[13px] place-items-center rounded-[3px] bg-brand px-[2px] align-middle font-mono text-[8px] text-paper">1</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[8px] text-brand">
              <span className="size-1.5 rounded-full bg-brand" /> verified · signed receipt
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
