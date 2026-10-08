import { ArrowRight, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Logo } from "../components/Layout";
import { Avatar, Button, ClassBadge, cx } from "../components/ui";
import { DEMO_PASSWORD, PERSONAS } from "../lib/personas";
import { useSession } from "../lib/session";

const POINTS = [
  {
    title: "Authorisation lives in the database.",
    body: "Postgres Row-Level Security runs inside the same statement as the vector search, so a forbidden row never leaves the database.",
  },
  {
    title: "One index for every kind of record.",
    body: "Layout-aware PDF text, OCR'd scans, photographed notices with vision captions, and rows from the student and staff tables.",
  },
  {
    title: "Every sentence carries its source.",
    body: "Each claim links to the exact page region, image crop or table row. Sentences the sources don't support are removed before you see them.",
  },
];

export function LoginPage() {
  const { session, login, backend } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to="/ask" replace />;

  async function signIn(e: string, p: string) {
    setBusy(e);
    setError(null);
    try {
      await login(e, p);
      navigate("/ask");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    signIn(email, password);
  }

  return (
    <div className="min-h-dvh">
      <div className="mx-auto grid max-w-[1320px] gap-12 px-5 py-8 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20 lg:py-12">
        <section className="flex flex-col">
          <div className="flex items-center justify-between">
            <Logo />
            <span className="text-[12px] text-ink-3">PS-01 · Code Carnival, Atmiya University</span>
          </div>

          <div className="ruled -mx-2 mt-14 px-2 pb-2 lg:mt-24">
            <h1 className="font-display text-[56px] leading-[0.95] tracking-[-0.02em] sm:text-[84px]">
              Ask anything.
              <br />
              <em className="text-brand">Leak nothing.</em>
            </h1>
          </div>
          <p className="mt-7 max-w-[34rem] text-[16px] leading-[1.65] text-ink-2">
            VaultRAG answers questions over the university's PDFs, scanned notices and database records. Ask the same question as a
            student, a head of department and the finance office, and you get three different answers, each one cited, none of them
            showing more than that person is cleared to read.
          </p>

          <ol className="stagger mt-12 max-w-[38rem] divide-y divide-line border-y border-line">
            {POINTS.map((p, i) => (
              <li key={p.title} className="grid grid-cols-[3rem_1fr] gap-x-4 py-5">
                <span className="font-display text-[30px] leading-none text-ink-3 italic">{["i", "ii", "iii"][i]}.</span>
                <div>
                  <div className="text-[15px] font-medium">{p.title}</div>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">{p.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 hidden flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-ink-3 lg:flex">
            {["JWT", "HMAC-signed DB context", "RLS + HNSW", "RRF + rerank", "LLM", "citation verifier"].map((s, i, a) => (
              <span key={s} className="flex items-center gap-2">
                {s}
                {i < a.length - 1 && <ArrowRight className="size-3 text-line-2" />}
              </span>
            ))}
          </div>
        </section>

        <section className="lg:pt-16">
          <div className="rounded-[22px] bg-panel p-6 shadow-float ring-1 ring-line sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-[30px] leading-none">Sign in</h2>
                <p className="mt-2 text-[13px] text-ink-3">Choose who you are. Each identity reads a different slice of the same archive.</p>
              </div>
              <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-3">
                <span className={cx("size-1.5 rounded-full", backend ? "bg-brand" : backend === false ? "bg-warn" : "bg-line-2")} />
                {backend === null ? "checking…" : backend ? "backend online" : "offline demo"}
              </span>
            </div>

            <div className="stagger mt-5 divide-y divide-line overflow-hidden rounded-2xl ring-1 ring-line">
              {PERSONAS.map((p) => (
                <button
                  key={p.email}
                  disabled={busy !== null}
                  onClick={() => signIn(p.email, DEMO_PASSWORD)}
                  className="group flex w-full items-center gap-3 bg-paper px-3.5 py-2.5 text-left transition-colors hover:bg-brand-soft/60 disabled:opacity-60"
                >
                  <Avatar name={p.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[13.5px] font-medium">{p.name}</span>
                      <span className="truncate text-[12px] text-ink-3">{p.title}</span>
                    </div>
                    <div className="truncate text-[12px] text-ink-3">{p.blurb}</div>
                  </div>
                  {busy === p.email ? (
                    <Loader2 className="size-4 animate-spin text-brand" />
                  ) : (
                    <>
                      <ClassBadge level={p.clearance} compact />
                      <ArrowRight className="size-4 -translate-x-1 text-brand opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
                    </>
                  )}
                </button>
              ))}
            </div>

            <form onSubmit={onSubmit} className="mt-6 space-y-3" noValidate={false}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[12px] text-ink-2">Email</span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@atmiya.test"
                    className="mt-1 w-full rounded-[10px] bg-paper px-3 py-2 text-[13.5px] ring-1 ring-line-2 outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-brand"
                  />
                </label>
                <label className="block">
                  <span className="text-[12px] text-ink-2">Password</span>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full rounded-[10px] bg-paper px-3 py-2 text-[13.5px] ring-1 ring-line-2 outline-none focus:ring-2 focus:ring-brand"
                  />
                </label>
              </div>
              {error && <div className="rounded-[10px] bg-deny/10 px-3 py-2 text-[13px] text-deny">{error}</div>}
              <Button type="submit" className="w-full" disabled={busy !== null}>
                Sign in with email
              </Button>
            </form>

            <p className="mt-5 text-[12px] leading-relaxed text-ink-3">
              Demo accounts share the password <span className="font-mono text-ink-2">{DEMO_PASSWORD}</span>. Every person and record in
              this archive is fictional.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
