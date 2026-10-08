import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { backendAlive, login as apiLogin, type Session } from "./api";
import { DEMO_PASSWORD } from "./personas";

interface SessionCtx {
  session: Session | null;
  backend: boolean | null;
  login: (email: string, password: string) => Promise<void>;
  switchTo: (email: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);
const KEY = "vaultrag.session";

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function save(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: session lives in memory only */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(load);
  const [backend, setBackend] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const check = () => backendAlive().then((ok) => alive && setBackend(ok));
    check();
    const t = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const s = await apiLogin(email, password);
    setSession(s);
    save(s);
  }, []);

  const switchTo = useCallback((email: string) => login(email, DEMO_PASSWORD), [login]);

  const logout = useCallback(() => {
    setSession(null);
    save(null);
  }, []);

  const value = useMemo(() => ({ session, backend, login, switchTo, logout }), [session, backend, login, switchTo, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
