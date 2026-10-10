import { ChevronDown, LogOut, Moon, Sun } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { PERSONAS, roleLabel } from "../lib/personas";
import { useSession } from "../lib/session";
import { Avatar, ClassBadge, cx } from "./ui";

const NAV: { to: string; label: string; role?: string }[] = [
  { to: "/", label: "Story" },
  { to: "/me", label: "Dashboard", role: "student" },
  { to: "/ask", label: "Ask" },
  { to: "/compare", label: "Compare" },
  { to: "/knowledge", label: "Knowledge" },
  { to: "/records", label: "Records" },
  { to: "/insights", label: "Insights", role: "admin" },
  { to: "/security", label: "Trust center" },
];

const THEME_KEY = "vaultrag.theme";

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } };

function useTheme(): [boolean, (e?: { clientX: number; clientY: number }) => void] {
  const [dark, setDark] = useState(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v ? v === "dark" : window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("theme-dark", dark);
    return () => document.documentElement.classList.remove("theme-dark");  // the story page keeps its own palette
  }, [dark]);

  /** Switch theme with a circular wipe that grows from the toggle (View Transitions API).
   *  Browsers without it, and reduced-motion users, switch instantly. */
  const toggle = (e?: { clientX: number; clientY: number }) => {
    const next = !dark;
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* preference just isn't remembered */
    }
    const doc = document as ViewTransitionDoc;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduce) {
      setDark(next);
      return;
    }
    const x = e?.clientX ?? window.innerWidth - 40;
    const y = e?.clientY ?? 32;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const t = doc.startViewTransition(() => {
      document.documentElement.classList.toggle("theme-dark", next);
      flushSync(() => setDark(next));
    });
    t.ready
      .then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          { duration: 650, easing: "cubic-bezier(.2,.7,.2,1)", pseudoElement: "::view-transition-new(root)" },
        );
      })
      .catch(() => {
        /* the browser skipped the transition (hidden tab, embedded view): the theme still switched */
      });
  };
  return [dark, toggle];
}

/** The DefRAG mark: a D assembled from fragments, on a transparent background. On dark surfaces
 *  (the story hero, dark theme) the D's ink end turns light so it keeps its contrast. */
export function Glyph({ className, light }: { className?: string; light?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="11 9 46 46" className={className} aria-hidden>
      <defs>
        <linearGradient id={`d${id}`} x1="0.15" y1="0.1" x2="0.95" y2="0.95"><stop offset="0.55" stopColor={light ? "#e9f3ee" : "var(--logo-ink, #0f1b2b)"} /><stop offset="1" stopColor="#16a37f" /></linearGradient>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4cc46e" /><stop offset="1" stopColor="#139a7f" /></linearGradient>
        <linearGradient id={`t${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#14a085" /><stop offset="1" stopColor="#0f3b4a" /></linearGradient>
      </defs>
      <path d="M24.5 13.5h12.5a17.5 17.5 0 0 1 0 37h-9.6v-7.2h9.6a10.3 10.3 0 0 0 0-20.6h-7.3z" fill={`url(#d${id})`} />
      <rect x="27.6" y="23.6" width="9.4" height="8.4" rx="1.4" fill={`url(#t${id})`} />
      <rect x="34.2" y="29.2" width="5.6" height="5.6" rx="1.2" fill={light ? "#7fd1b4" : "var(--logo-step, #0f3b4a)"} />
      <rect x="20" y="18.6" width="6.6" height="6.6" rx="1.4" fill={`url(#g${id})`} />
      <rect x="13.6" y="23.4" width="3.8" height="3.8" rx="0.9" fill="#4cc46e" />
      <rect x="17.4" y="27.6" width="4" height="4" rx="0.9" fill={`url(#g${id})`} />
      <rect x="20.8" y="33.4" width="7" height="7" rx="1.4" fill={`url(#g${id})`} />
    </svg>
  );
}

export function Mark({ className = "size-7", light }: { className?: string; light?: boolean }) {
  return <Glyph className={cx("shrink-0", className)} light={light} />;
}

/** Wordmark: "Def" in ink, "RAG" in the mark's green. */
export function Wordmark({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cx("font-sans text-[21px] font-semibold leading-none tracking-[-0.025em]", light ? "text-paper" : "text-ink", className)}>
      Def<span className="bg-gradient-to-r from-[#22b07a] to-[#139a7f] bg-clip-text text-transparent">RAG</span>
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cx("flex items-center gap-2.5", className)}>
      <Mark />
      <Wordmark />
    </div>
  );
}

function BackendStatus() {
  const { session, backend } = useSession();
  const live = session?.mode === "live" && backend;
  return (
    <span
      title={live ? "Connected to FastAPI + Postgres (RLS enforced)" : "Backend offline: running the in-browser demo engine"}
      className="hidden items-center gap-1.5 text-[12px] text-ink-3 md:inline-flex"
    >
      <span className={cx("size-1.5 rounded-full", live ? "bg-brand" : "bg-warn")} />
      {live ? "Live backend" : "Demo mode"}
    </span>
  );
}

function UserSwitcher() {
  const { session, switchTo, logout } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!session) return null;
  const u = session.user;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-xl py-1 pr-2 pl-1 transition-colors hover:bg-panel-2"
      >
        <Avatar name={u.name} />
        <div className="hidden text-left leading-tight sm:block">
          <div className="text-[13px] font-medium">{u.name}</div>
          <div className="text-[11.5px] text-ink-3">{roleLabel(u)}</div>
        </div>
        <ChevronDown className="size-4 text-ink-3" />
      </button>
      {open && (
        <div className="fade-up absolute top-full right-0 z-40 mt-2 w-80 overflow-hidden rounded-2xl bg-panel shadow-float ring-1 ring-line">
          <div className="px-4 pt-3 pb-2 font-display text-[16px] italic text-ink-3">View the archive as…</div>
          <div className="max-h-[22rem] overflow-y-auto px-1.5 pb-1.5">
            {PERSONAS.map((p) => (
              <button
                key={p.email}
                onClick={async () => {
                  setOpen(false);
                  await switchTo(p.email);
                }}
                className={cx(
                  "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-panel-2",
                  p.email === u.email && "bg-panel-2",
                )}
              >
                <Avatar name={p.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{p.name}</div>
                  <div className="truncate text-[11.5px] text-ink-3">{p.title}</div>
                </div>
                <ClassBadge level={p.clearance} compact />
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-[13px] text-ink-2 hover:bg-panel-2 hover:text-ink"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { session } = useSession();
  const [dark, toggleTheme] = useTheme();
  const roles = session?.user.roles ?? [];
  return (
    <div className="flex h-dvh flex-col">
      <header className="relative z-30 shrink-0 border-b border-line bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-1 px-4 pt-2.5 sm:px-6 lg:flex-nowrap lg:pt-0">
          <Link to="/" aria-label="DefRAG story"><Logo className="lg:py-3" /></Link>
          <div className="ml-auto flex items-center gap-4 lg:order-3">
            <BackendStatus />
            <button onClick={(e) => toggleTheme(e)} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title={dark ? "Light theme" : "Dark theme"}
                    className="grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-panel-2 hover:text-ink">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <UserSwitcher />
          </div>
          <nav className="-mx-1 flex w-full gap-1 overflow-x-auto lg:order-2 lg:w-auto">
            {NAV.filter((n) => !n.role || roles.includes(n.role)).map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cx(
                    "relative shrink-0 px-2.5 py-3 text-[13.5px] transition-colors lg:px-2 lg:py-[18px]",
                    isActive
                      ? "font-medium text-ink after:absolute after:inset-x-2.5 after:bottom-0 after:h-[2px] after:rounded-full after:bg-brand"
                      : "text-ink-3 hover:text-ink",
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
