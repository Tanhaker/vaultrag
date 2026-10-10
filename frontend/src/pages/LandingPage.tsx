import {
  ArrowDown, ArrowRight, ArrowUpRight, BadgeCheck, Binary, Building2, ChevronLeft, ChevronRight, Database, Eye, FileSignature, Fingerprint,
  GitBranch, GraduationCap, Grid3x3, Handshake, IndianRupee, KeyRound, Link2, Loader2, Lock, MessagesSquare, Quote, Radar, Scale, ScanSearch, Server, ShieldAlert, ShieldCheck, Sigma, Siren, Target, Timer, TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { HeroArt } from "../components/landing/HeroArt";
import { StoryArt } from "../components/landing/StoryArt";
import { Mark } from "../components/Layout";
import { Avatar, ClassBadge, cx } from "../components/ui";
import { MEASURED } from "../lib/measured";
import { useCountUp, useInView, useOnScroll, usePageProgress, useReveal, useSectionProgress } from "../lib/motion";
import { PERSONAS } from "../lib/personas";
import { useSession } from "../lib/session";

// --- measured numbers (generated from eval/results; never typed by hand) -------------------------
const M = MEASURED;
const STUDENT = M.recall?.identities["Student (public only)"];
const NUM = {
  tests: M.tests?.passed ?? 0,
  testsTotal: (M.tests?.passed ?? 0) + (M.tests?.failed ?? 0),
  red: M.redteam?.passed ?? 0,
  redTotal: M.redteam?.total ?? 0,
  decisions: M.grounding?.summary.decision_accuracy ?? 0,
  precision: M.grounding?.summary.citation_precision ?? 0,
  factRecall: M.grounding?.summary.fact_recall ?? 0,
  cases: M.grounding?.summary.cases ?? 0,
  post: STUDENT?.recall_at_10.post_filter ?? 0,
  strict: STUDENT?.recall_at_10.rls_strict ?? 0,
  iterative: STUDENT?.recall_at_10.rls_iterative ?? 0,
  p95: STUDENT?.latency_ms.rls_iterative.p95 ?? 0,
  gap: M.timing?.median_gap_ms ?? 0,
  pValue: M.timing?.p_value ?? 0,
};
const pct = (x: number) => `${Math.round(x * 100)}%`;

const CHAPTERS = [
  { id: "top", label: "Ask anything" },
  { id: "problem", label: "The problem" },
  { id: "how", label: "How it answers" },
  { id: "compare", label: "Three people" },
  { id: "internals", label: "Inside the database" },
  { id: "layers", label: "Ten layers" },
  { id: "proof", label: "Proof" },
  { id: "judges", label: "Where to look" },
  { id: "beyond", label: "Beyond the brief" },
  { id: "architecture", label: "Architecture" },
  { id: "business", label: "Business model" },
  { id: "try", label: "Try it" },
];

// --- navigation -------------------------------------------------------------------------------

function useGo() {
  const { session, switchTo } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const go = useCallback(async (path: string, email?: string) => {
    if (email && session?.user.email !== email) {
      setBusy(path + email);
      try {
        await switchTo(email);
      } catch {
        navigate("/login");
        return;
      } finally {
        setBusy(null);
      }
    } else if (!session) {
      navigate("/login");
      return;
    }
    navigate(path);
  }, [session, switchTo, navigate]);
  return { go, busy };
}

function TopBar() {
  const { progress, scrolled } = usePageProgress();
  const { session } = useSession();
  const [overHero, setOverHero] = useState(true);
  useOnScroll(() => setOverHero(window.scrollY < window.innerHeight * 0.82));
  const dark = overHero;
  return (
    <header className={cx("fixed inset-x-0 top-0 z-40 transition-colors duration-500",
                          scrolled && (dark ? "bg-ink/40 backdrop-blur-md" : "bg-bg/85 shadow-[0_1px_0_var(--color-line)] backdrop-blur-md"))}>
      <div className="mx-auto flex max-w-[1320px] items-center gap-6 px-5 py-3.5 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5" aria-label="VaultRAG home">
          <Mark className={cx("size-7 rounded-lg", dark && "ring-1 ring-paper/35")} />
          <span className={cx("font-display text-[23px] leading-none tracking-[-0.01em]", dark ? "text-paper" : "text-ink")}>Vault</span>
          <span className={cx("font-mono text-[11px] font-medium tracking-[0.18em]", dark ? "text-paper/60" : "text-ink-2")}>RAG</span>
        </Link>
        <nav className={cx("ml-4 hidden gap-5 text-[13px] lg:flex", dark ? "text-paper/65" : "text-ink-3")}>
          {[["problem", "Problem"], ["how", "How it works"], ["internals", "Internals"], ["proof", "Proof"], ["judges", "For judges"]].map(([id, l]) => (
            <a key={id} href={`#${id}`} className={cx("transition-colors", dark ? "hover:text-paper" : "hover:text-ink")}>{l}</a>
          ))}
        </nav>
        <Link to={session ? "/ask" : "/login"}
              className={cx("ml-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-colors",
                            dark ? "bg-paper text-ink hover:bg-mark" : "bg-brand text-paper hover:bg-brand-2")}>
          {session ? "Open the app" : "Live demo"} <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="h-[2px] origin-left bg-brand" style={{ transform: `scaleX(${progress})` }} />
    </header>
  );
}

/** Dots on the right edge, and ← / → (or J / K) to step through every stop when presenting. */
function ChapterRail() {
  const [active, setActive] = useState(0);
  useOnScroll(() => {
    const mid = window.innerHeight * 0.45;
    let idx = 0;
    CHAPTERS.forEach((c, i) => {
      const el = document.getElementById(c.id);
      if (el && el.getBoundingClientRect().top < mid) idx = i;
    });
    setActive(idx);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if ((t && typeof t.closest === "function" && t.closest("input, textarea, select, [contenteditable]")) || e.metaKey || e.ctrlKey || e.altKey) return;
      const next = ["ArrowRight", "j", "J"].includes(e.key);
      const prev = ["ArrowLeft", "k", "K"].includes(e.key);
      if (!next && !prev) return;
      e.preventDefault();
      const stops = Array.from(document.querySelectorAll<HTMLElement>("[data-stop]"));
      const y = window.scrollY;
      const tops = stops.map((s) => s.getBoundingClientRect().top + y - 72);
      const target = next ? tops.find((t2) => t2 > y + 8) : [...tops].reverse().find((t2) => t2 < y - 8);
      if (target !== undefined) window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <nav className="fixed top-1/2 right-4 z-30 hidden -translate-y-1/2 flex-col gap-2.5 xl:flex" aria-label="Chapters">
      {CHAPTERS.map((c, i) => (
        <a key={c.id} href={`#${c.id}`} className="group flex items-center justify-end gap-2.5" aria-current={i === active ? "true" : undefined}>
          <span className={cx("rounded-md bg-ink px-2 py-0.5 text-[11px] text-paper transition-opacity group-hover:opacity-100", "opacity-0")}>{c.label}</span>
          <span className={cx("block rounded-full transition-all duration-300", i === active ? "h-5 w-1.5 bg-brand" : "size-1.5 bg-ink-3/40 group-hover:bg-ink-3")} />
        </a>
      ))}
      <div className="mt-2 flex items-center justify-end gap-1 font-mono text-[10px] text-ink-3">
        <ChevronLeft className="size-3" /><ChevronRight className="size-3" /> present
      </div>
    </nav>
  );
}

// --- building blocks ------------------------------------------------------------------------

function Eyebrow({ n, children, light }: { n: string; children: ReactNode; light?: boolean }) {
  return (
    <div className={cx("flex items-center gap-3 font-mono text-[11.5px] tracking-[0.16em] uppercase", light ? "text-paper/55" : "text-ink-3")}>
      <span className={light ? "text-[#7fd1a8]" : "text-brand"}>§ {n}</span>
      <span className={cx("h-px w-10", light ? "bg-paper/25" : "bg-line-2")} />
      {children}
    </div>
  );
}

function Section({ id, children, className, dark }: { id: string; children: ReactNode; className?: string; dark?: boolean }) {
  const ref = useReveal<HTMLElement>(0.12);
  return (
    <section id={id} ref={ref} data-stop className={cx("relative scroll-mt-16", dark && "ink-grain text-paper", className)}>
      {children}
    </section>
  );
}

function Headline({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx("reveal font-display text-[42px] leading-[1.02] tracking-[-0.015em] text-balance sm:text-[62px]", className)}>{children}</h2>;
}

// --- 1. hero ------------------------------------------------------------------------------------

function Hero() {
  const [p, setP] = useState(0);
  useOnScroll(() => setP(Math.min(1, Math.max(0, window.scrollY / window.innerHeight))));
  const { session } = useSession();
  const words = ["Ask", "anything."];
  return (
    <section id="top" data-stop className="ink-grain relative min-h-dvh overflow-hidden text-paper">
      <div className="mx-auto grid min-h-dvh max-w-[1320px] items-center gap-10 px-5 pt-28 pb-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] [&>*]:min-w-0">
        <div style={{ transform: `translateY(${p * -60}px)`, opacity: 1 - p * 0.9 }}>
          <div className="rise font-mono text-[11.5px] tracking-[0.18em] text-paper/55 uppercase" style={{ ["--d" as string]: "0ms" }}>
            PS-01 · Secure multi-modal RAG with access control
          </div>
          <h1 className="mt-6 font-display text-[64px] leading-[0.92] tracking-[-0.025em] sm:text-[104px]">
            {words.map((w, i) => <span key={w} className="word mr-[0.22em]" style={{ ["--d" as string]: `${120 + i * 130}ms` }}>{w}</span>)}
            <br />
            <em className="word text-[#7fd1a8]" style={{ ["--d" as string]: "420ms" }}>Leak nothing.</em>
          </h1>
          <p className="rise mt-8 max-w-[36rem] text-[17px] leading-[1.65] text-paper/75" style={{ ["--d" as string]: "620ms" }}>
            VaultRAG answers questions over PDFs, scanned pages, photographed notices and database rows, and lets the database itself decide
            what each person may see: inside the vector search, before a single forbidden word reaches the application or the model.
          </p>
          <div className="rise mt-9 flex flex-wrap items-center gap-3" style={{ ["--d" as string]: "780ms" }}>
            <Link to={session ? "/ask" : "/login"} className="inline-flex items-center gap-2 rounded-full bg-paper px-5 py-3 text-[14px] font-medium text-ink transition-colors hover:bg-mark">
              Start the live demo <ArrowRight className="size-4" />
            </Link>
            <a href="#problem" className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14px] text-paper/80 ring-1 ring-paper/25 transition-colors hover:bg-paper/10">
              Walk through it <ArrowDown className="size-4" />
            </a>
          </div>
          <dl className="rise mt-12 grid max-w-[36rem] grid-cols-2 gap-x-6 gap-y-4 border-t border-paper/15 pt-6 sm:grid-cols-4" style={{ ["--d" as string]: "940ms" }}>
            {[[`${NUM.tests}/${NUM.testsTotal}`, "tests passing"], [`${NUM.red}/${NUM.redTotal}`, "attacks blocked"], [pct(NUM.iterative), "recall under RLS"], ["0", "canaries leaked"]].map(([v, l]) => (
              <div key={l}>
                <dt className="font-display text-[30px] leading-none">{v}</dt>
                <dd className="mt-1.5 text-[12px] text-paper/55">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rise" style={{ ["--d" as string]: "300ms" }}>
          <HeroArt progress={p} />
        </div>
      </div>
      <a href="#problem" className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 font-mono text-[10.5px] tracking-[0.2em] text-paper/45 uppercase">
        scroll
        <span className="relative h-9 w-[1.5px] overflow-hidden bg-paper/15"><span className="absolute inset-x-0 top-0 h-3 animate-[sweep_2s_ease-in-out_infinite] bg-paper/70" /></span>
      </a>
    </section>
  );
}

// --- 2. the problem -------------------------------------------------------------------------------

function ResultRow({ i, forbidden, gone, label }: { i: number; forbidden: boolean; gone: boolean; label: string }) {
  return (
    <div className={cx("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] ring-1 transition-all duration-500",
                       forbidden ? "bg-deny/[0.06] ring-deny/25" : "bg-paper ring-line", gone && "border-dashed opacity-45")}
         style={{ transitionDelay: `${i * 45}ms` }}>
      <span className="w-4 font-mono text-[10px] text-ink-3">{i + 1}</span>
      <span className={cx("min-w-0 flex-1 truncate", gone && "line-through decoration-deny/60")}>{label}</span>
      {gone && <span className="font-mono text-[10px] text-deny">dropped after ranking</span>}
      {forbidden ? <Lock className="size-3.5 text-deny" /> : <ShieldCheck className="size-3.5 text-brand" />}
    </div>
  );
}

function Problem() {
  const [ref, p] = useSectionProgress<HTMLDivElement>();
  const filtered = p > 0.36;
  const bad = ["CSE budget · allocation table", "Appraisal remarks · scanned", "MECH budget · utilisation", "CSE budget · summary", "Exam moderation policy",
               "Salary record · Prof. Mehta", "Appraisal ratings", "Fee summary · all students", "Exam paper deadlines"];
  const good = ["Handbook · 4.2 Attendance", "Handbook · 5 Examinations", "Fee structure notice · OCR", "Handbook · 6.1 Grading", "Robotics workshop · OCR",
                "Handbook · 9.3 Re-evaluation", "Handbook · 2 Academic calendar", "Handbook · 7 Library", "Fee notice · vision caption", "Handbook · 4.3 Leave"];
  return (
    <Section id="problem" className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 sm:py-36">
      <div ref={ref}>
        <Eyebrow n="01">The problem</Eyebrow>
        <Headline className="mt-6 max-w-4xl">Most RAG systems check permissions <em className="text-deny">after</em> the search. That is already too late.</Headline>
        <p className="reveal mt-6 max-w-2xl text-[16.5px] leading-[1.7] text-ink-2" style={{ ["--d" as string]: "120ms" }}>
          A typical pipeline asks the vector database for the ten nearest chunks and then drops the ones the user may not read. For a student,
          nine of those ten are confidential, so they get one weak result, and the forbidden text has already been ranked, cached and held in
          application memory. One bug and it is in the prompt.
        </p>

        <div className="mt-14 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="reveal rounded-[24px] bg-panel p-5 shadow-card ring-1 ring-line sm:p-6" style={{ ["--d" as string]: "100ms" }}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[15px] font-medium">Search, then filter in the app</div>
                <div className="text-[12.5px] text-ink-3">top-10 nearest chunks for a public-only student</div>
              </div>
              <span className="rounded-full bg-deny/10 px-2.5 py-1 font-mono text-[11px] text-deny">recall {pct(NUM.post)}</span>
            </div>
            <div className="space-y-1.5">
              <ResultRow i={0} forbidden={false} gone={false} label="Handbook · 4.2 Attendance" />
              {bad.map((b, i) => <ResultRow key={b} i={i + 1} forbidden gone={filtered} label={b} />)}
            </div>
            <div className={cx("mt-4 flex items-start gap-2 rounded-xl bg-deny/[0.07] px-3 py-2.5 text-[12.5px] text-ink-2 ring-1 ring-deny/20 transition-opacity duration-700", filtered ? "opacity-100" : "opacity-0")}>
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-deny" />
              Nine forbidden chunks were retrieved, ranked and held in memory before being thrown away. One result survives.
            </div>
          </div>

          <div className="reveal rounded-[24px] bg-panel p-5 shadow-card ring-1 ring-brand/30 sm:p-6" style={{ ["--d" as string]: "220ms" }}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[15px] font-medium">VaultRAG: filter inside the scan</div>
                <div className="text-[12.5px] text-ink-3">Postgres RLS + pgvector iterative HNSW scan</div>
              </div>
              <span className="rounded-full bg-brand-soft px-2.5 py-1 font-mono text-[11px] text-brand">recall {pct(NUM.iterative)}</span>
            </div>
            <div className="space-y-1.5">
              {good.map((g, i) => (
                <div key={g} className={cx("transition-all duration-500", filtered ? "opacity-100" : "opacity-0")} style={{ transitionDelay: `${300 + i * 60}ms` }}>
                  <ResultRow i={i} forbidden={false} gone={false} label={g} />
                </div>
              ))}
            </div>
            <div className={cx("mt-4 flex items-start gap-2 rounded-xl bg-brand-soft/70 px-3 py-2.5 text-[12.5px] text-ink-2 ring-1 ring-brand/25 transition-opacity delay-700 duration-700", filtered ? "opacity-100" : "opacity-0")}>
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
              Forbidden rows never leave the database. The scan keeps walking the graph until it has ten rows this person may read.
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

// --- 3. how it answers (pinned story) -------------------------------------------------------

const STEPS: { icon: typeof Database; title: string; body: string; link: [string, string, string?] }[] = [
  { icon: Database, title: "Every source becomes evidence with a lock on it.",
    body: "Digital PDFs keep their text blocks, tables and page coordinates. Scans and photos are read with vision OCR and captioned. Database rows become record cards. Every chunk inherits its document's access rule through a database trigger, and tripwire canaries are registered as they are found.",
    link: ["/knowledge", "Knowledge base", "admin@atmiya.test"] },
  { icon: Fingerprint, title: "Who is asking is signed, not claimed.",
    body: "The verified JWT becomes a context bound to one read-only transaction and signed with HMAC. app_ctx() checks the signature, the expiry and whether the account is locked, inside Postgres. Even SQL written by the model can't forge an identity.",
    link: ["/records", "Records", "aarav.student@atmiya.test"] },
  { icon: Radar, title: "The database removes what you can't see, inside the search.",
    body: `acl_check() runs in the same statement as the HNSW and BM25 scans, so forbidden rows are dropped before ranking. The iterative scan keeps recall at ${pct(NUM.iterative)} for a public-only user, against ${pct(NUM.post)} when filtering afterwards, and refusing takes no longer when a forbidden document exists (${NUM.gap} ms).`,
    link: ["/compare", "Compare", "hod.cse@atmiya.test"] },
  { icon: BadgeCheck, title: "Every sentence carries its source.",
    body: "The model sees only authorised chunks, passed as data. Each sentence must cite one; the verifier checks the citation, every figure, and whether the source actually says it. Unsupported sentences are removed and shown, never silently kept.",
    link: ["/ask", "Ask", "hod.cse@atmiya.test"] },
  { icon: FileSignature, title: "Nothing leaves without a final check, and a receipt.",
    body: "An egress filter blocks any answer carrying a canary from a document the reader can't open and strips phone and ID numbers. If nothing survives, the refusal is identical to 'no such document'. Every answer is signed, and anyone can re-verify it later.",
    link: ["/ask", "Ask", "aarav.student@atmiya.test"] },
  { icon: Link2, title: "Every question leaves a tamper-evident trail.",
    body: "Audit rows are hash-chained by a trigger, so editing one breaks the chain. Refusals and guessed citation links feed a probing alert, and locking an account takes effect inside the database, even for a token issued earlier.",
    link: ["/security?tab=governance", "Trust center", "admin@atmiya.test"] },
];

function Story() {
  const [ref, p] = useSectionProgress<HTMLDivElement>(true);
  const active = Math.min(STEPS.length - 1, Math.floor(p * STEPS.length));
  const { go, busy } = useGo();
  return (
    <section id="how" className="relative scroll-mt-16 bg-panel-2/40">
      <div className="mx-auto max-w-[1320px] px-5 pt-28 sm:px-8 sm:pt-36">
        <div data-stop>
          <Eyebrow n="02">How VaultRAG answers a question</Eyebrow>
          <h2 className="mt-6 max-w-4xl font-display text-[42px] leading-[1.02] tracking-[-0.015em] text-balance sm:text-[62px]">
            Six steps between your question and its answer. Four of them happen <em className="text-brand">inside Postgres.</em>
          </h2>
        </div>
      </div>
      <div ref={ref} className="relative" style={{ height: `${STEPS.length * 85}vh` }}>
        <div className="sticky top-0 mx-auto grid h-dvh max-w-[1320px] items-center gap-10 px-5 sm:px-8 lg:grid-cols-[0.95fr_1.05fr] [&>*]:min-w-0">
          <div className="relative h-[600px] sm:h-[480px] lg:h-[440px]">
            {STEPS.map((s, i) => (
              <div key={s.title} className={cx("absolute inset-0 flex flex-col justify-center transition-all duration-700 ease-[cubic-bezier(.2,.7,.2,1)]",
                                               i === active ? "translate-y-0 opacity-100" : i < active ? "-translate-y-8 opacity-0" : "translate-y-8 opacity-0",
                                               i !== active && "pointer-events-none")}>
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-2xl bg-brand text-paper shadow-card"><s.icon className="size-5" /></span>
                  <span className="font-mono text-[12px] text-ink-3">step {String(i + 1).padStart(2, "0")} of 06</span>
                </div>
                <h3 className="mt-5 font-display text-[34px] leading-[1.05] tracking-[-0.01em] sm:text-[42px]">{s.title}</h3>
                <p className="mt-4 max-w-xl text-[15.5px] leading-[1.7] text-ink-2">{s.body}</p>
                <button onClick={() => go(s.link[0], s.link[2])}
                        className="mt-6 inline-flex w-fit items-center gap-1.5 text-[13.5px] font-medium text-brand hover:underline">
                  {busy === s.link[0] + s.link[2] ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUpRight className="size-3.5" />} See it live in {s.link[1]}
                </button>
              </div>
            ))}
            <div className="absolute bottom-0 left-0 flex gap-1.5">
              {STEPS.map((_, i) => <span key={i} className={cx("h-1 rounded-full transition-all duration-500", i === active ? "w-8 bg-brand" : i < active ? "w-3 bg-brand/40" : "w-3 bg-line-2")} />)}
            </div>
          </div>
          <div className="hidden lg:block"><StoryArt active={active} /></div>
        </div>
        {/* one stop per step, for presenter navigation */}
        {STEPS.map((_, i) => <div key={i} data-stop className="absolute inset-x-0" style={{ top: `calc(${(i + 0.5) / STEPS.length} * (100% - 100vh))` }} />)}
      </div>
      {/* small screens: the visual for each step, stacked */}
      <div className="mx-auto max-w-xl space-y-6 px-5 pb-20 lg:hidden">
        {STEPS.map((_, i) => <StoryArt key={i} active={i} only={i} />)}
      </div>
    </section>
  );
}

// --- 4. three people -------------------------------------------------------------------------------

function ComparePeople() {
  const people = [
    { email: "aarav.student@atmiya.test", text: "I don't have information on that in the sources available to you.", refused: true,
      note: "Same words as for a document that doesn't exist." },
    { email: "hod.cse@atmiya.test", text: "The CSE department's approved budget for FY 2026-27 is ₹48.5 lakh.", refused: false,
      note: "Cited to page 1 of the confidential budget PDF." },
    { email: "hod.mech@atmiya.test", text: "I don't have information on that in the sources available to you.", refused: true,
      note: "Same role, other department: refused." },
  ];
  return (
    <Section id="compare" className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 sm:py-36">
      <Eyebrow n="03">Same question, three people</Eyebrow>
      <Headline className="mt-6 max-w-4xl">One question. Three clearances. <em className="text-brand">Three honest answers.</em></Headline>
      <div className="reveal mt-10 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[14px] text-paper" style={{ ["--d" as string]: "100ms" }}>
        <MessagesSquare className="size-4 text-[#7fd1a8]" /> “What is the CSE department budget for 2026-27?”
      </div>
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {people.map((x, i) => {
          const p = PERSONAS.find((q) => q.email === x.email)!;
          return (
            <div key={x.email} className="reveal rounded-[24px] bg-panel p-5 shadow-card ring-1 ring-line" style={{ ["--d" as string]: `${200 + i * 160}ms` }}>
              <div className="flex items-center gap-3 border-b border-line pb-3">
                <Avatar name={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{p.name}</div>
                  <div className="text-[12px] text-ink-3">{p.title}</div>
                </div>
                <ClassBadge level={p.clearance} />
              </div>
              <p className={cx("mt-4 min-h-[72px] text-[16px] leading-[1.6]", x.refused ? "text-ink-2" : "text-ink")}>
                {x.text}
                {!x.refused && <span className="ml-1 inline-grid h-[17px] min-w-[17px] -translate-y-[3px] place-items-center rounded-[4px] bg-brand px-[3px] align-middle font-mono text-[10px] text-paper">1</span>}
              </p>
              <div className={cx("mt-3 flex items-center gap-2 text-[12.5px]", x.refused ? "text-ink-3" : "text-brand")}>
                {x.refused ? <Eye className="size-3.5" /> : <BadgeCheck className="size-3.5" />} {x.note}
              </div>
            </div>
          );
        })}
      </div>
      <p className="reveal mt-6 max-w-2xl text-[14px] leading-relaxed text-ink-3" style={{ ["--d" as string]: "700ms" }}>
        The refusal never hints that a document exists. Run this yourself in Compare, then open the presenter X-ray to see how many
        candidate chunks the database removed for each person.
      </p>
    </Section>
  );
}

// --- 5. inside the database ---------------------------------------------------------------------------

function RecallBars() {
  const [ref, on] = useInView<HTMLDivElement>(0.4);
  const rows = [
    ["Filter top-10 in app code", NUM.post, "bg-ink-3"],
    ["RLS, strict filtered HNSW scan", NUM.strict, "bg-cls-1"],
    ["RLS + iterative HNSW scan", NUM.iterative, "bg-brand"],
  ] as const;
  return (
    <div ref={ref} className="space-y-5">
      {rows.map(([label, v, tone], i) => (
        <div key={label}>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[14px] text-ink-2">{label}</span>
            <span className="font-display text-[28px] tabular-nums leading-none">{pct(v)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-panel-2">
            <div className={cx("h-full rounded-full transition-[width] duration-[1400ms] ease-[cubic-bezier(.2,.7,.2,1)]", tone)}
                 style={{ width: on ? `${Math.max(2, v * 100)}%` : "0%", transitionDelay: `${i * 220}ms` }} />
          </div>
        </div>
      ))}
      <p className="text-[12.5px] text-ink-3">Recall@10 against exact ground truth for a user who can read {((STUDENT?.visible_share ?? 0) * 100).toFixed(1)}% of 10,000 vectors · p95 {Math.round(NUM.p95)} ms · pgvector {M.recall?.pgvector}</p>
    </div>
  );
}

function Internals() {
  return (
    <Section id="internals" className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 sm:py-36">
      <Eyebrow n="04">Inside the database</Eyebrow>
      <Headline className="mt-6 max-w-4xl">The access rule runs <em className="text-brand">inside the index scan.</em> You can watch it.</Headline>
      <div className="mt-14 grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="reveal rounded-[24px] bg-panel p-6 shadow-card ring-1 ring-line" style={{ ["--d" as string]: "100ms" }}>
          <div className="mb-5 flex items-center gap-2 text-[15px] font-medium"><Radar className="size-4 text-brand" /> Filtered vector search, measured</div>
          <RecallBars />
        </div>
        <div className="reveal space-y-4" style={{ ["--d" as string]: "220ms" }}>
          <div className="overflow-hidden rounded-[24px] bg-ink shadow-float">
            <div className="flex items-center gap-2 border-b border-paper/10 px-5 py-3 font-mono text-[11px] text-paper/55">
              <ScanSearch className="size-3.5 text-[#7fd1a8]" /> EXPLAIN ANALYZE · as the student · HNSW path · rag_reader
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-[11.5px] leading-[1.75] text-paper/85">{`Limit  (actual rows=30)
  InitPlan 1 → Result            `}<span className="text-paper/45">-- app_ctx(): HMAC verified once</span>{`
  → Index Scan using `}<span className="text-[#7fd1a8]">chunks_embedding_hnsw</span>{`
      Order By: (embedding <=> $q)
      Filter: `}<mark className="rounded bg-mark px-1 text-ink">acl_check($0, tenant_id, classification,</mark>{`
              `}<mark className="rounded bg-mark px-1 text-ink">department, allowed_roles, allowed_users)</mark>{`
      `}<span className="text-[#ff9b85]">Rows Removed by Filter: 314</span></pre>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-panel p-4 shadow-card ring-1 ring-line">
              <Timer className="size-4 text-brand" />
              <div className="mt-2 font-display text-[30px] leading-none tabular-nums">{NUM.gap} ms</div>
              <div className="mt-1.5 text-[12.5px] leading-snug text-ink-3">timing gap, forbidden vs non-existent · p = {NUM.pValue}</div>
            </div>
            <div className="rounded-2xl bg-panel p-4 shadow-card ring-1 ring-line">
              <Binary className="size-4 text-brand" />
              <div className="mt-2 font-display text-[30px] leading-none">768-d</div>
              <div className="mt-1.5 text-[12.5px] leading-snug text-ink-3">HNSW m = 16 · cosine · + BM25, fused with RRF and re-ranked</div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

// --- 6. ten layers ---------------------------------------------------------------------------------

const LAYERS: [typeof KeyRound, string, string, boolean][] = [
  [KeyRound, "Verified identity", "HS256 JWT; identity never comes from the request body", false],
  [Fingerprint, "Signed context + kill switch", "HMAC, expiry and account lock checked in app_ctx()", true],
  [Database, "Row-level security in the scan", "acl_check() inside HNSW and BM25, every table forced", true],
  [Sigma, "Masking + k-anonymity", "salaries, phones, emails masked; pay only as averages of five or more", true],
  [GitBranch, "Text-to-SQL firewall", "one validated SELECT over whitelisted views, read-only, 5 s", true],
  [ShieldAlert, "Injection quarantine", "sources are data in tags; instruction-like chunks quarantined", false],
  [BadgeCheck, "Citation verifier", "valid citation, figures in source, verbatim or entailed", false],
  [ScanSearch, "Egress DLP", "forbidden canaries block the answer; phone and ID numbers redacted", false],
  [FileSignature, "Signed receipts", "HMAC over question, answer and source hashes", false],
  [Link2, "Hash-chained audit", "tamper-evident trail with probing alerts", true],
];

function Layers() {
  return (
    <Section id="layers" className="bg-panel-2/40">
      <div className="mx-auto grid max-w-[1320px] gap-12 px-5 py-28 sm:px-8 sm:py-36 lg:grid-cols-[0.8fr_1.2fr] [&>*]:min-w-0">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Eyebrow n="05">Defence in depth</Eyebrow>
          <Headline className="mt-6">Ten layers between a question and a leak.</Headline>
          <p className="reveal mt-6 max-w-md text-[15.5px] leading-[1.7] text-ink-2" style={{ ["--d" as string]: "120ms" }}>
            Each layer would stop the attacks below it on its own. The ones marked <span className="rounded bg-brand-soft px-1.5 font-mono text-[12.5px] text-brand">Postgres</span> still
            hold if the application code has a bug, because the database refuses to return the rows.
          </p>
        </div>
        <ol className="space-y-3">
          {LAYERS.map(([Icon, name, what, db], i) => (
            <li key={name} className="reveal-x flex items-center gap-4 rounded-2xl bg-panel px-4 py-3.5 shadow-card ring-1 ring-line" style={{ ["--d" as string]: `${i * 70}ms` }}>
              <span className="w-8 font-display text-[28px] leading-none text-ink-3">{String(i + 1).padStart(2, "0")}</span>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-4.5" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">{name}</div>
                <div className="text-[13px] text-ink-3">{what}</div>
              </div>
              <span className={cx("hidden shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] sm:inline", db ? "bg-brand-soft text-brand" : "bg-panel-2 text-ink-3")}>{db ? "Postgres" : "API"}</span>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

// --- 7. proof --------------------------------------------------------------------------------------

function Counter({ to, suffix = "", prefix = "", label, sub, decimals = 0, run }: { to: number; suffix?: string; prefix?: string; label: string; sub: string; decimals?: number; run: boolean }) {
  const v = useCountUp(to, run, 1500, decimals);
  return (
    <div className="border-t border-paper/15 pt-5">
      <div className="font-display text-[54px] leading-none tabular-nums sm:text-[64px]">{prefix}{v}{suffix}</div>
      <div className="mt-3 text-[14px] text-paper/85">{label}</div>
      <div className="mt-1 text-[12.5px] text-paper/50">{sub}</div>
    </div>
  );
}

function Proof() {
  const [ref, on] = useInView<HTMLDivElement>(0.3);
  return (
    <Section id="proof" dark>
      <div ref={ref} className="relative mx-auto max-w-[1320px] px-5 py-28 sm:px-8 sm:py-36">
        <Eyebrow n="06" light>Proof, not promises</Eyebrow>
        <h2 className="reveal mt-6 max-w-4xl font-display text-[42px] leading-[1.02] tracking-[-0.015em] sm:text-[62px]">
          Every number here is <em className="text-[#7fd1a8]">measured</em>. The test suite re-runs on every push.
        </h2>
        <div className="mt-16 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          <Counter run={on} to={NUM.tests} suffix={`/${NUM.testsTotal}`} label="backend tests passing" sub="RLS matrix, trust layer, units · CI on GitHub" />
          <Counter run={on} to={NUM.red} suffix={`/${NUM.redTotal}`} label="red-team attacks blocked" sub="end-to-end through the API, 0 canaries leaked" />
          <Counter run={on} to={NUM.decisions * 100} suffix="%" label="answer / refuse decisions correct" sub={`${NUM.cases} labelled cases · citation precision ${NUM.precision.toFixed(2)}`} />
          <Counter run={on} to={NUM.iterative * 100} suffix="%" label="recall@10 for a public-only user" sub={`vs ${pct(NUM.post)} when filtering in the app`} />
          <Counter run={on} to={Math.abs(NUM.gap)} prefix={NUM.gap < 0 ? "−" : ""} suffix=" ms" decimals={1} label="timing gap that could reveal a document" sub={`permutation test p = ${NUM.pValue}`} />
          <Counter run={on} to={NUM.factRecall * 100} suffix="%" label="answers containing the expected fact" sub="verbatim mode, no generative model" />
        </div>
      </div>
    </Section>
  );
}

// --- 8. where to look ---------------------------------------------------------------------------

function Judges() {
  const { go, busy } = useGo();
  const rows: { criterion: string; built: string; path: string; as: string; label: string; icon: typeof Database }[] = [
    { icon: GitBranch, criterion: "Pipeline design", built: "Pipeline trace streamed live on every answer; ingestion steps shown on upload", path: "/ask", as: "hod.cse@atmiya.test", label: "Ask as HOD" },
    { icon: Database, criterion: "Vector DB internals", built: "HNSW iterative scan, recall benchmark, EXPLAIN ANALYZE as any identity", path: "/security?tab=retrieval", as: "admin@atmiya.test", label: "Trust center" },
    { icon: Lock, criterion: "AuthZ at the retrieval layer", built: "RLS inside the scan, same question three ways, live access matrix, kill switch", path: "/compare", as: "admin@atmiya.test", label: "Compare" },
    { icon: Grid3x3, criterion: "Multi-modal handling", built: "PDF regions, OCR box on the real photo, database rows, live SQL results", path: "/ask", as: "aarav.student@atmiya.test", label: "Ask as student" },
    { icon: BadgeCheck, criterion: "Hallucination & citation grounding", built: `Verifier, removed sentences shown, signed receipts, ${pct(NUM.decisions)} on ${NUM.cases} labelled cases`, path: "/security?tab=grounding", as: "admin@atmiya.test", label: "Grounding eval" },
  ];
  return (
    <Section id="judges" className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 sm:py-36">
      <Eyebrow n="07">For the judges</Eyebrow>
      <Headline className="mt-6 max-w-4xl">What the brief asks for, and <em className="text-brand">where to see it</em> in two clicks.</Headline>
      <div className="mt-12 divide-y divide-line overflow-hidden rounded-[24px] bg-panel shadow-card ring-1 ring-line">
        {rows.map((r, i) => (
          <div key={r.criterion} className="reveal grid items-center gap-4 px-5 py-5 sm:grid-cols-[2.4rem_15rem_1fr_auto] sm:px-6" style={{ ["--d" as string]: `${i * 90}ms` }}>
            <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand"><r.icon className="size-4.5" /></span>
            <div className="font-display text-[22px] leading-tight">{r.criterion}</div>
            <div className="text-[14px] leading-relaxed text-ink-2">{r.built}</div>
            <button onClick={() => go(r.path, r.as)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper transition-colors hover:bg-brand">
              {busy === r.path + r.as ? <Loader2 className="size-3.5 animate-spin" /> : null}{r.label} <ArrowUpRight className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

// --- 9. beyond the brief ----------------------------------------------------------------------------

function Beyond() {
  const items: [typeof Sigma, string, string][] = [
    [Sigma, "k-anonymous pay", "Heads of department see department averages, never one salary. Fixed grouping stops differencing attacks."],
    [Timer, "Timing side channel, measured", "Refusing a forbidden document takes as long as refusing a missing one."],
    [FileSignature, "Verifiable receipts", "Signed hashes of question, answer and sources; edit one character and verification fails."],
    [Link2, "Tamper-evident audit", "Every audit row hashes the one before it; one edit breaks the chain."],
    [Siren, "Probing alerts + kill switch", "Refusals and guessed links raise a score; locking works inside the database."],
    [Grid3x3, "Access matrix + what-if", "Who can read what, from acl_check() itself, and who would lose access before you save."],
    [Quote, "Quota-aware AI", "Model chain, daily budget, shared Postgres cache and a verbatim mode with no model at all."],
    [MessagesSquare, "Conversations, re-authorised", "Follow-ups are rewritten in the open, and every turn is checked again."],
  ];
  return (
    <Section id="beyond" className="bg-panel-2/40">
      <div className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 sm:py-36">
        <Eyebrow n="08">Beyond the brief</Eyebrow>
        <Headline className="mt-6 max-w-4xl">The attacks most teams won't think of, <em className="text-brand">already closed.</em></Headline>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(([Icon, t, b], i) => (
            <div key={t} className="reveal group rounded-[22px] bg-panel p-5 shadow-card ring-1 ring-line transition-transform duration-300 hover:-translate-y-1" style={{ ["--d" as string]: `${(i % 4) * 90}ms` }}>
              <span className="grid size-10 place-items-center rounded-xl bg-ink text-[#7fd1a8] transition-colors group-hover:bg-brand group-hover:text-paper"><Icon className="size-4.5" /></span>
              <div className="mt-4 text-[16px] font-medium">{t}</div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-3">{b}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// --- 10. architecture --------------------------------------------------------------------------------

function Architecture() {
  const node = "rounded-2xl bg-panel px-4 py-3 shadow-card ring-1 ring-line";
  return (
    <Section id="architecture" className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 sm:py-36">
      <Eyebrow n="09">Architecture</Eyebrow>
      <Headline className="mt-6 max-w-4xl">Small, deployable, and <em className="text-brand">running right now.</em></Headline>
      <div className="reveal relative mt-14" style={{ ["--d" as string]: "120ms" }}>
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto_1.2fr_auto_1.3fr] [&>*]:min-w-0">
          <div className={node}>
            <div className="font-mono text-[11px] text-ink-3">browser</div>
            <div className="mt-1 text-[15px] font-medium">React 19 · Vite · Tailwind</div>
            <div className="mt-1 text-[12.5px] text-ink-3">trust center, live trace over SSE, receipts</div>
          </div>
          <svg viewBox="0 0 60 12" className="mx-auto hidden h-3 w-16 text-brand lg:block"><line x1="0" y1="6" x2="60" y2="6" stroke="currentColor" strokeWidth="2" className="dash-flow" /></svg>
          <div className="rounded-2xl bg-panel px-4 py-3 shadow-card ring-1 ring-brand/40">
            <div className="font-mono text-[11px] text-ink-3">Vercel · Python function</div>
            <div className="mt-1 text-[15px] font-medium">FastAPI pipeline</div>
            <div className="mt-1 text-[12.5px] text-ink-3">JWT → signed context · retrieval · Text-to-SQL firewall · verifier · DLP · receipts</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {["CSP + HSTS", "rate limit", "quota guard"].map((t) => <span key={t} className="rounded-md bg-panel-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3">{t}</span>)}
            </div>
          </div>
          <svg viewBox="0 0 60 12" className="mx-auto hidden h-3 w-16 text-brand lg:block"><line x1="0" y1="6" x2="60" y2="6" stroke="currentColor" strokeWidth="2" className="dash-flow" /></svg>
          <div className="space-y-3">
            <div className="rounded-2xl bg-ink px-4 py-3 text-paper shadow-float">
              <div className="font-mono text-[11px] text-paper/50">Neon · Postgres + pgvector</div>
              <div className="mt-1 text-[15px] font-medium">The security boundary</div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 font-mono text-[10.5px] text-paper/75">
                {["RLS on every table", "HNSW + BM25", "app_ctx() HMAC", "masking views", "k-anon stats", "hash-chained audit", "answer cache", "canary registry"].map((t) => (
                  <span key={t} className="flex items-center gap-1"><span className="size-1 rounded-full bg-[#7fd1a8]" /> {t}</span>
                ))}
              </div>
            </div>
            <div className={node}>
              <div className="font-mono text-[11px] text-ink-3">Google Gemini (free tier)</div>
              <div className="mt-1 text-[14px] font-medium">embeddings · vision OCR · cited generation</div>
              <div className="mt-1 text-[12.5px] text-ink-3">model chain with quota parking; works fully offline too</div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

// --- 11. business model ------------------------------------------------------------------------------
// Prices, costs and margins are planning estimates, not validated with customers; the copy says so.

function Business() {
  const why: [typeof Sigma, string, string][] = [
    [GraduationCap, "Who buys", "Indian colleges and universities: 1,100+ universities and 40,000+ colleges (AISHE), most already running an ERP for fees, marks and HR."],
    [Scale, "Why now", "Everyone wants an assistant over their own documents. The DPDP Act 2023 turns a leaked mark sheet or salary into a legal liability."],
    [ShieldCheck, "Why us", "NotebookLM shares a whole notebook; enterprise copilots follow file permissions in a vendor's cloud. We enforce who-sees-what per row, in Postgres, and prove it."],
  ];
  const plans: { name: string; who: string; price: string; per: string; items: string[]; hot?: boolean }[] = [
    { name: "Starter", who: "Small college", price: "₹15–25k", per: "per month", items: ["Policies, circulars, handbooks", "PDF + OCR'd notices", "Up to ~2,000 users"] },
    { name: "Campus", who: "College or university", price: "₹50k–1.5L", per: "per month", items: ["Everything in Starter", "ERP records under row-level rules", "Trust center, audit chain, receipts"], hot: true },
    { name: "Enterprise", who: "Large university, government", price: "₹10–25L", per: "per year + setup", items: ["On their own servers", "Custom connectors + SSO", "SLA and security review"] },
  ];
  const path: [typeof Sigma, string, string][] = [
    [Target, "Pilot", "One department at Atmiya University, free. Measure staff hours saved and leaks (zero)."],
    [Building2, "First customers", "Turn the pilot into a case study; sign 3–5 paying colleges in Gujarat."],
    [Handshake, "ERP partners", "License VaultRAG as the AI module inside college ERPs. They sell, we earn per campus."],
    [TrendingUp, "New sectors", "Same engine, new roles: schools, hospitals, co-operative banks, law firms."],
  ];
  return (
    <Section id="business" className="bg-panel-2/40">
      <div className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 sm:py-36">
        <Eyebrow n="10">Business model</Eyebrow>
        <Headline className="mt-6 max-w-4xl">Every college wants an AI assistant. <em className="text-brand">None can risk a leak.</em></Headline>
        <p className="reveal mt-6 max-w-2xl text-[15.5px] leading-[1.7] text-ink-2" style={{ ["--d" as string]: "120ms" }}>
          Generic "secure AI search" is a fight with Microsoft and Google. A focused product for Indian higher education, sold as the assistant that
          plugs into the existing ERP and obeys its data rules, is an opening.
        </p>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {why.map(([Icon, t, b], i) => (
            <div key={t} className="reveal rounded-[22px] bg-panel p-6 shadow-card ring-1 ring-line" style={{ ["--d" as string]: `${i * 90}ms` }}>
              <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-4.5" /></span>
              <div className="mt-4 font-display text-[24px] leading-tight">{t}</div>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{b}</p>
            </div>
          ))}
        </div>

        <div className="mt-20 flex flex-wrap items-end justify-between gap-4">
          <h3 className="reveal font-display text-[32px] leading-tight sm:text-[40px]">SaaS per campus</h3>
          <span className="reveal rounded-md bg-mark/60 px-2 py-0.5 font-mono text-[11px] text-ink-2">illustrative pricing · to be validated with pilots</span>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {plans.map((p, i) => (
            <div key={p.name}
                 className={cx("reveal flex flex-col rounded-[24px] p-6 ring-1", p.hot ? "bg-ink text-paper shadow-float ring-ink" : "bg-panel shadow-card ring-line")}
                 style={{ ["--d" as string]: `${i * 90}ms` }}>
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-medium">{p.name}</span>
                {p.hot && <span className="rounded-full bg-[#7fd1a8]/20 px-2 py-0.5 font-mono text-[10.5px] text-[#7fd1a8]">main plan</span>}
              </div>
              <div className={cx("mt-1 text-[13px]", p.hot ? "text-paper/60" : "text-ink-3")}>{p.who}</div>
              <div className="mt-5 flex items-baseline gap-2">
                <span className="font-display text-[44px] leading-none tabular-nums">{p.price}</span>
                <span className={cx("text-[13px]", p.hot ? "text-paper/60" : "text-ink-3")}>{p.per}</span>
              </div>
              <ul className="mt-6 space-y-2 text-[13.5px]">
                {p.items.map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <BadgeCheck className={cx("mt-0.5 size-4 shrink-0", p.hot ? "text-[#7fd1a8]" : "text-brand")} /> {t}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="reveal mt-4 grid gap-4 rounded-[22px] bg-panel p-6 shadow-card ring-1 ring-line sm:grid-cols-3 [&>*]:min-w-0">
          {[
            [IndianRupee, "Under ₹1 per question", "flash-lite model, shared answer cache, verbatim mode with no model at all"],
            [Server, "Cheap to run", "one Postgres with pgvector; no separate vector database or search cluster"],
            [TrendingUp, "~70–80% gross margin", "estimated at ₹50k per campus per month; the real cost is people, not servers"],
          ].map(([Icon, t, b]) => {
            const I = Icon as typeof Sigma;
            return (
              <div key={t as string} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink text-[#7fd1a8]"><I className="size-4" /></span>
                <div>
                  <div className="text-[15px] font-medium">{t as string}</div>
                  <div className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{b as string}</div>
                </div>
              </div>
            );
          })}
        </div>

        <h3 className="reveal mt-20 font-display text-[32px] leading-tight sm:text-[40px]">Go to market</h3>
        <ol className="relative mt-8 grid gap-4 md:grid-cols-4">
          <div aria-hidden className="absolute top-5 right-[24%] left-5 hidden h-px bg-line-2 md:block" />
          {path.map(([Icon, t, b], i) => (
            <li key={t} className="reveal relative" style={{ ["--d" as string]: `${i * 110}ms` }}>
              <span className="relative grid size-10 place-items-center rounded-full bg-ink text-[#7fd1a8] ring-4 ring-bg"><Icon className="size-4.5" /></span>
              <div className="mt-4 font-mono text-[11px] text-ink-3">step {i + 1}</div>
              <div className="mt-1 text-[16px] font-medium">{t}</div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-3">{b}</p>
            </li>
          ))}
        </ol>

        <p className="reveal mt-14 max-w-3xl text-[13px] leading-relaxed text-ink-3">
          Before selling: a paid AI tier with an SLA, SSO with the college login, connectors for common ERPs, Gujarati and Hindi, a DPDP compliance pack and an
          external security review. Prices and margins above are planning estimates, not results.
        </p>
      </div>
    </Section>
  );
}

// --- 12. try it ------------------------------------------------------------------------------------

function TryIt() {
  const { go, busy } = useGo();
  const picks: [string, string, string][] = [
    ["aarav.student@atmiya.test", "/ask", "Ask as a student"],
    ["hod.cse@atmiya.test", "/compare", "Compare as a HOD"],
    ["finance@atmiya.test", "/records", "Records as finance"],
    ["admin@atmiya.test", "/security", "Trust center as admin"],
  ];
  return (
    <Section id="try" dark>
      <div className="relative mx-auto max-w-[1320px] px-5 py-28 sm:px-8 sm:py-36">
        <Eyebrow n="11" light>Try it</Eyebrow>
        <h2 className="reveal mt-6 max-w-4xl font-display text-[48px] leading-[0.98] tracking-[-0.02em] sm:text-[80px]">
          Pick a person. <em className="text-[#7fd1a8]">Ask anything.</em>
        </h2>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {picks.map(([email, path, label], i) => {
            const p = PERSONAS.find((q) => q.email === email)!;
            return (
              <button key={email} onClick={() => go(path, email)}
                      className="reveal group flex items-center gap-3 rounded-2xl bg-paper/[0.06] p-4 text-left ring-1 ring-paper/15 transition-colors hover:bg-paper/[0.12]"
                      style={{ ["--d" as string]: `${i * 90}ms` }}>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-paper text-[12px] font-medium text-ink">{p.name.split(" ").filter((w) => !w.endsWith(".")).map((w) => w[0]).slice(0, 2).join("")}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-medium">{label}</div>
                  <div className="truncate text-[12px] text-paper/55">{p.name} · {p.title}</div>
                </div>
                {busy === path + email ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4 text-paper/50 transition-transform group-hover:translate-x-0.5 group-hover:text-paper" />}
              </button>
            );
          })}
        </div>
        <div className="mt-24 flex flex-wrap items-end justify-between gap-8 border-t border-paper/15 pt-8">
          <div>
            <div className="font-display text-[30px]">Team FriendlyFire</div>
            <div className="mt-1 text-[14px] text-paper/60">Bhakti Kareliya (team leader) · Tanmay Gajjar · Team ID TXJ8</div>
            <div className="mt-1 text-[13px] text-paper/45">Code Carnival 2026 · Atmiya University · PS-01</div>
          </div>
          <div className="flex flex-wrap gap-3 text-[13px]">
            <a href="https://github.com/Tanhaker/vaultrag" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 ring-1 ring-paper/25 hover:bg-paper/10">
              Source on GitHub <ArrowUpRight className="size-3.5" />
            </a>
            <Link to="/login" className="inline-flex items-center gap-1.5 rounded-full bg-paper px-4 py-2 font-medium text-ink hover:bg-mark">
              All demo accounts <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
        <p className="mt-8 text-[12px] text-paper/40">Every person and record in this archive is fictional.</p>
      </div>
    </Section>
  );
}

export function LandingPage() {
  useEffect(() => {
    document.title = "VaultRAG · Ask anything. Leak nothing.";
    return () => {
      document.title = "VaultRAG";
    };
  }, []);
  return (
    <div className="bg-bg">
      <TopBar />
      <ChapterRail />
      <Hero />
      <Problem />
      <Story />
      <ComparePeople />
      <Internals />
      <Layers />
      <Proof />
      <Judges />
      <Beyond />
      <Architecture />
      <Business />
      <TryIt />
    </div>
  );
}
