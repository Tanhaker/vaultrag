// Scroll-driven motion without a library: IntersectionObserver for reveals, one rAF-throttled
// scroll listener for progress. Everything degrades to static when the user prefers less motion.

import { useEffect, useRef, useState, type RefObject } from "react";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Sets data-in="true" on the element once it enters the viewport (CSS does the animating). */
export function useReveal<T extends HTMLElement = HTMLDivElement>(threshold = 0.18): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      el.dataset.in = "true";
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.dataset.in = "true";
          io.disconnect();
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return ref;
}

/** True once the element has been on screen (for count-ups and one-shot animations). */
export function useInView<T extends HTMLElement = HTMLDivElement>(threshold = 0.3): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (!("IntersectionObserver" in window)) {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, seen]);
  return [ref, seen];
}

type Listener = () => void;
const listeners = new Set<Listener>();
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    listeners.forEach((l) => l());
  });
}
function subscribe(l: Listener) {
  if (listeners.size === 0) {
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
  }
  listeners.add(l);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    }
  };
}

/** 0 when the section's top reaches the bottom of the viewport... 1 when its bottom leaves the top.
 *  With `pinned`, 0..1 spans only the part of a tall section during which its sticky child is pinned. */
export function useSectionProgress<T extends HTMLElement = HTMLDivElement>(pinned = false): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const v = pinned ? -r.top / Math.max(1, r.height - vh) : (vh - r.top) / (vh + r.height);
      setP(Math.min(1, Math.max(0, v)));
    };
    update();
    return subscribe(update);
  }, [pinned]);
  return [ref, p];
}

/** Page-wide scroll progress 0..1 and whether the page has scrolled at all. */
export function usePageProgress(): { progress: number; scrolled: boolean } {
  const [s, setS] = useState({ progress: 0, scrolled: false });
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setS({ progress: max > 0 ? window.scrollY / max : 0, scrolled: window.scrollY > 24 });
    };
    update();
    return subscribe(update);
  }, []);
  return s;
}

/** Animated number: eases from 0 to `to` once `run` turns true. */
export function useCountUp(to: number, run: boolean, ms = 1400, decimals = 0): string {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return;
    if (prefersReducedMotion()) {
      setV(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setV(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, run, ms]);
  return v.toFixed(decimals);
}

/** Run a callback on every (rAF-throttled) scroll or resize. */
export function useOnScroll(cb: () => void): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const run = () => ref.current();
    run();
    return subscribe(run);
  }, []);
}
