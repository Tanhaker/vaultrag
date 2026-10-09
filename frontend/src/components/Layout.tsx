import { ChevronDown, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { PERSONAS, roleLabel } from "../lib/personas";
import { useSession } from "../lib/session";
import { Avatar, ClassBadge, cx } from "./ui";

const NAV = [
  { to: "/", label: "Story" },
  { to: "/ask", label: "Ask" },
  { to: "/compare", label: "Compare" },
  { to: "/knowledge", label: "Knowledge base" },
  { to: "/records", label: "Records" },
  { to: "/security", label: "Trust center" },
];

export function Mark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#1d1b17" />
      <circle cx="16" cy="13" r="4.2" fill="#fffdf8" />
      <path d="M13.6 15.6h4.8l1.5 8.4h-7.8z" fill="#fffdf8" />
      <circle cx="16" cy="13" r="1.5" fill="#24543f" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cx("flex items-center gap-2.5", className)}>
      <Mark />
      <div className="flex items-baseline gap-1 leading-none">
        <span className="font-display text-[23px] tracking-[-0.01em]">Vault</span>
        <span className="font-mono text-[11px] font-medium tracking-[0.18em] text-ink-2">RAG</span>
      </div>
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
  return (
    <div className="flex h-dvh flex-col">
      <header className="relative z-30 shrink-0 border-b border-line bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-8 gap-y-1 px-4 pt-2.5 sm:px-6 lg:flex-nowrap lg:pt-0">
          <Link to="/" aria-label="VaultRAG story"><Logo className="lg:py-3" /></Link>
          <div className="ml-auto flex items-center gap-4 lg:order-3">
            <BackendStatus />
            <UserSwitcher />
          </div>
          <nav className="-mx-1 flex w-full gap-1 overflow-x-auto lg:order-2 lg:w-auto">
            {NAV.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cx(
                    "relative shrink-0 px-2.5 py-3 text-[13.5px] transition-colors lg:py-[18px]",
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
