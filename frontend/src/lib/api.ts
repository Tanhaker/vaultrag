import { DOCS } from "./corpus";
import { aclAllows, recordAudit } from "./engine";
import { DEMO_PASSWORD, personaFor, toUser } from "./personas";
import { mockRecords, TOTALS, type RecordKind, type Row } from "./records";
import type { User } from "./types";

export type Mode = "live" | "demo";

export interface Session {
  user: User;
  token: string | null;
  mode: Mode;
}

const BASE = "/api";

export async function backendAlive(): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 1500);
  try {
    const r = await fetch(`${BASE}/health`, { signal: ctl.signal });
    return r.ok && (await r.json()).status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function authed<T>(path: string, s: Session): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${s.token}` } });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<Session> {
  if (await backendAlive()) {
    const r = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (r.status === 401) throw new Error("Invalid email or password");
    if (r.ok) {
      const body = await r.json();
      const persona = personaFor(body.user.email);
      // Keep the backend's identity, but use the persona's stable id for demo-corpus grants.
      const user: User = { ...body.user, uid: persona?.uid ?? body.user.uid };
      recordAudit({ userEmail: user.email, userName: user.name, action: "login", detail: "JWT issued by backend", chunks: 0, filtered: 0 });
      return { user, token: body.access_token, mode: "live" };
    }
  }
  const persona = personaFor(email);
  if (!persona || password !== DEMO_PASSWORD) throw new Error("Invalid email or password");
  recordAudit({ userEmail: persona.email, userName: persona.name, action: "login", detail: "offline demo session", chunks: 0, filtered: 0 });
  return { user: toUser(persona), token: null, mode: "demo" };
}

const PATHS: Record<RecordKind, string> = { students: "/records/students", fees: "/records/fees", employees: "/records/employees" };

export async function fetchRecords(kind: RecordKind, s: Session): Promise<{ count: number; rows: Row[] }> {
  if (s.mode === "live" && s.token) {
    try {
      return await authed(PATHS[kind], s);
    } catch {
      /* fall through to the offline copy */
    }
  }
  return mockRecords(kind, s.user);
}

export interface Xray {
  db_role: string;
  verified_context: Record<string, unknown> | null;
  visible: Record<string, number>;
  total: Record<string, number> | null;
  source: Mode;
}

export async function fetchXray(s: Session): Promise<Xray> {
  if (s.mode === "live" && s.token) {
    try {
      const x = await authed<Omit<Xray, "source">>("/security/xray", s);
      return { ...x, source: "live" };
    } catch {
      /* fall through */
    }
  }
  const u = s.user;
  return {
    db_role: "rag_reader",
    verified_context: { uid: u.uid, roles: u.roles, depts: u.depts, clr: u.clearance },
    visible: {
      documents: DOCS.filter((d) => aclAllows(u, d)).length,
      students: mockRecords("students", u).count,
      fee_payments: mockRecords("fees", u).count,
      employees_secure: mockRecords("employees", u).count,
    },
    total: { documents: DOCS.length, students: TOTALS.students, fee_payments: TOTALS.fees, employees_secure: TOTALS.employees },
    source: "demo",
  };
}
