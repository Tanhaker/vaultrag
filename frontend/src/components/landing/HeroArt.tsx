import { useEffect, useRef } from "react";
import { Glyph } from "../Layout";

/** The DefRAG seal: concentric rings with engraved text and the mark at the centre. Scroll turns the
 *  rings; the pointer tilts the mark. */
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
      <div className="absolute top-1/2 left-1/2 grid size-[22%] place-items-center drop-shadow-[0_10px_30px_rgba(63,138,102,0.55)]"
           style={{ transform: "translate(-50%, -50%) translate3d(calc(var(--mx, 0) * 18px), calc(var(--my, 0) * 18px), 0)", transition: "transform 200ms ease-out" }}>
        <Glyph className="size-full" light />
      </div>

    </div>
  );
}
