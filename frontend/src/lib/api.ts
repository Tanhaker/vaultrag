import { CHUNKS, DOCS, PAGE_FILLER, docById } from "./corpus";
import { aclAllows, ask as demoAsk, recordAudit } from "./engine";
import { DEMO_PASSWORD, personaFor, toUser } from "./personas";
import { mockRecords, TOTALS, type RecordKind, type Row } from "./records";
import type { Answer, AuditEntry, Chunk, Citation, Doc, SourceData, User } from "./types";

export type Mode = "live" | "demo";

export interface Session {
  user: User;
  token: string | null;
  mode: Mode;
}

const BASE = "/api";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function backendAlive(): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(`${BASE}/health`, { signal: ctl.signal });
    return r.ok && (await r.json()).status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function call<T>(path: string, s: Session, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${s.token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const r = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      const body = await r.json();
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* not JSON */
    }
    throw new ApiError(r.status, msg);
  }
  return r.json() as Promise<T>;
}

const live = (s: Session) => s.mode === "live" && !!s.token;

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
      return { user: body.user, token: body.access_token, mode: "live" };
    }
  }
  const persona = personaFor(email);
  if (!persona || password !== DEMO_PASSWORD) throw new Error("Invalid email or password");
  recordAudit({ userEmail: persona.email, userName: persona.name, action: "login", detail: "offline demo session", chunks: 0, filtered: 0 });
  return { user: toUser(persona), token: null, mode: "demo" };
}

// Demo identities for Compare: one live session per persona, created on demand.
const personaSessions = new Map<string, Promise<Session>>();
export function sessionFor(email: string): Promise<Session> {
  if (!personaSessions.has(email)) {
    const p = login(email, DEMO_PASSWORD);
    p.catch(() => personaSessions.delete(email));
    personaSessions.set(email, p);
  }
  return personaSessions.get(email)!;
}

/** Ask through the real pipeline when connected; the in-browser engine otherwise. */
export async function ask(question: string, s: Session): Promise<Answer> {
  if (live(s)) return call<Answer>("/query", s, { method: "POST", body: JSON.stringify({ question }) });
  return demoAsk(question, s.user);
}

/** Resolve what the source viewer needs for a citation (RLS re-checked server-side when live). */
export async function fetchSource(c: Citation, s: Session): Promise<SourceData> {
  if (c.chunk.modality === "sql") return { chunk: c.chunk, doc: c.doc, blocks: [], image: null };
  if (c.chunk.id.startsWith("c-")) {
    const blocks = CHUNKS.filter((k) => k.docId === c.doc.id && (k.page ?? null) === (c.chunk.page ?? null));
    return { chunk: c.chunk, doc: c.doc, blocks, image: null };
  }
  return call<SourceData>(`/source/${c.chunk.id}`, s);
}

export function pageHeader(doc: Doc): [string, string] {
  const filler = PAGE_FILLER[doc.id];
  return filler ? [filler[0] ?? "", filler[1] ?? ""] : [doc.title.replace(/\.(pdf|jpe?g|png)$/i, ""), ""];
}

export interface RecordGroup {
  relation: string;
  rows: number;
  min_cls: number;
  max_cls: number;
}

export async function fetchDocuments(s: Session): Promise<{ documents: Doc[]; records: RecordGroup[]; source: Mode }> {
  if (live(s)) {
    const r = await call<{ documents: Doc[]; records: RecordGroup[] }>("/documents", s);
    return { ...r, source: "live" };
  }
  const visible = DOCS.filter((d) => aclAllows(s.user, d));
  return { documents: visible.filter((d) => d.sourceType !== "db_record"), records: [], source: "demo" };
}

export interface IngestResult {
  id: string;
  title: string;
  duplicate: boolean;
  chunks: number;
  flags?: string[];
  steps: { key: string; label: string; detail: string; ms: number }[];
}

export async function uploadDocument(
  s: Session,
  file: File,
  acl: { classification: number; department: string | null; allowedRoles: string[] },
): Promise<IngestResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("classification", String(acl.classification));
  form.append("department", acl.department ?? "");
  form.append("allowed_roles", acl.allowedRoles.join(","));
  return call<IngestResult>("/ingest", s, { method: "POST", body: form });
}

export async function patchAcl(
  s: Session,
  docId: string,
  acl: { classification: number; department: string | null; allowedRoles: string[] },
): Promise<{ id: string; title: string; chunksUpdated: number }> {
  return call(`/documents/${docId}/acl`, s, { method: "PATCH", body: JSON.stringify(acl) });
}

export async function fetchAudit(s: Session): Promise<AuditEntry[] | null> {
  if (!live(s)) return null;
  try {
    return await call<AuditEntry[]>("/audit?limit=100", s);
  } catch {
    return null;
  }
}

export interface EvalResults {
  tests?: { passed: number; failed: number; at: string };
  redteam?: { passed: number; total: number; at: string; attacks: { name: string; category: string; persona: string; defence: string; passed: boolean; detail: string }[] };
  recall?: { pgvector: string; chunks: number; queries: number; identities: Record<string, { visible_share: number; recall_at_10: Record<string, number>; latency_ms: Record<string, { p50: number; p95: number }> }> };
}

export async function fetchEval(s: Session): Promise<EvalResults | null> {
  if (!live(s)) return null;
  try {
    return await call<EvalResults>("/eval/latest", s);
  } catch {
    return null;
  }
}

const PATHS: Record<RecordKind, string> = { students: "/records/students", fees: "/records/fees", employees: "/records/employees" };

export async function fetchRecords(kind: RecordKind, s: Session): Promise<{ count: number; rows: Row[] }> {
  if (live(s)) {
    try {
      return await call(PATHS[kind], s);
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
  if (live(s)) {
    try {
      const x = await call<Omit<Xray, "source">>("/security/xray", s);
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

export { docById };
export type { Chunk };
