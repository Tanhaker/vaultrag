import { CHUNKS, DOCS, PAGE_FILLER, docById } from "./corpus";
import { aclAllows, ask as demoAsk, recordAudit } from "./engine";
import { DEMO_PASSWORD, personaFor, toUser } from "./personas";
import { mockRecords, TOTALS, type RecordKind, type Row } from "./records";
import type { Answer, AuditEntry, Chunk, Citation, Doc, PipelineStep, Receipt, SourceData, User } from "./types";

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
    if (r.status === 403) throw new Error("This account is locked. Contact an administrator.");
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

export type Tone = "auto" | "formal" | "bhai";
export type ReplyLang = "auto" | "en" | "hinglish" | "hi" | "gu";

export interface AskOptions {
  verbatim?: boolean;
  history?: { question: string }[];
  tone?: Tone;
  lang?: ReplyLang;
}

/** Ask through the real pipeline when connected; the in-browser engine otherwise. */
export async function ask(question: string, s: Session, opts: AskOptions = {}): Promise<Answer> {
  if (live(s)) {
    return call<Answer>("/query", s, {
      method: "POST",
      body: JSON.stringify({ question, verbatim: !!opts.verbatim, history: opts.history ?? [], tone: opts.tone ?? "auto", lang: opts.lang ?? "auto" }),
    });
  }
  return demoAsk(question, s.user);
}

/** Streamed variant: onStep fires as each pipeline stage finishes on the server (server-sent
 *  events). Falls back to the plain request if the stream can't be opened or breaks. */
export async function askStream(question: string, s: Session, opts: AskOptions, onStep: (step: PipelineStep) => void): Promise<Answer> {
  if (!live(s)) return demoAsk(question, s.user);
  let r: Response;
  try {
    r = await fetch(`${BASE}/query/stream`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ question, verbatim: !!opts.verbatim, history: opts.history ?? [], tone: opts.tone ?? "auto", lang: opts.lang ?? "auto" }),
    });
  } catch {
    return ask(question, s, opts);
  }
  if (r.status === 429) throw new ApiError(429, "Too many questions in a short time. Wait a minute and try again.");
  if (!r.ok || !r.body) return ask(question, s, opts);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const data = frame.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
      if (!data) continue;
      const ev = JSON.parse(data);
      if (ev.type === "step") onStep({ key: ev.key, label: ev.label, detail: ev.detail, ms: ev.ms });
      else if (ev.type === "answer") return ev.answer as Answer;
      else if (ev.type === "error") throw new ApiError(ev.status ?? 500, ev.detail ?? "Pipeline error");
    }
  }
  return ask(question, s, opts);
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

export interface GroundingRow {
  as: string;
  q: string;
  expect: "answer" | "refuse";
  refused: boolean;
  mode: string;
  latencyMs: number;
  cited: string[];
  decision_ok: boolean;
  fact_ok?: boolean;
  hit_at_5?: boolean;
  citation_precision?: number;
}

export interface Grounding {
  at: string;
  mode: string;
  summary: {
    cases: number; decision_accuracy: number; answered_when_expected: string; refused_when_expected: string;
    citation_precision: number; fact_recall: number; hit_at_5: number; groundedness: number;
    verbatim_sentences: number; p50_ms: number; p95_ms: number;
  };
  rows: GroundingRow[];
}

export interface TimingGroup { n: number; median_ms: number; mean_ms: number; p95_ms: number; stdev_ms: number; refused: number }
export interface Timing {
  at: string; persona: string; repeats: number; forbidden: TimingGroup; missing: TimingGroup;
  median_gap_ms: number; p_value: number; identical_refusal_text: boolean; verdict: string;
}

export interface EvalResults {
  grounding?: Grounding;
  timing?: Timing;
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

// --- trust centre -------------------------------------------------------------------------

export interface ReceiptCheck {
  signature: boolean;
  answerMatches: boolean | null;
  sources: { n: number; title: string; status: "unchanged" | "changed" | "not-visible" | "live-query" }[];
  verdict: "valid" | "forged" | "stale";
}

export interface AccessDecision { allowed: boolean; tenant: boolean; grant: boolean; clearance: boolean; role: boolean; dept: boolean }
export interface Explanation {
  identity: { email: string; roles: string[]; depts: string[]; clearance: number; department: string | null; source: string };
  sources: { chunkId: string; title: string; sourceType: string; classification: number; department: string | null;
             allowedRoles: string[]; grantedUsers: number; decision: AccessDecision }[];
  engine: string;
}

/** acl_explain() on the caller's own signed context, for the sources cited in an answer. */
export async function explainAnswer(s: Session, chunkIds: string[]): Promise<Explanation> {
  if (!live(s)) throw new Error("offline");
  return call<Explanation>("/answers/explain", s, { method: "POST", body: JSON.stringify({ chunkIds }) });
}

export const verifyReceipt = (s: Session, receipt: Receipt, sentences?: string[]) =>
  call<ReceiptCheck>("/receipts/verify", s, { method: "POST", body: JSON.stringify({ receipt, sentences }) });

export interface PlanNode {
  depth: number; node: string; index: string | null; relation: string | null; filter: string | null; order: string | null;
  rows: number | null; loops: number | null; removed: number | null; ms: number | null; subplan: string | null;
}
export interface PlanRun {
  text: string; nodes: PlanNode[]; executionMs: number; planningMs: number; scanNode: string | null;
  index: string | null; rlsFilter: string | null; removedByFilter: number; scanned: number;
}
export interface QueryPlan {
  question: string; dbRole: string; planner: PlanRun; hnsw: PlanRun;
  returned: { iterative: number; strict: number; k: number }; visibleChunks: number;
}

export const fetchPlan = (s: Session, question: string) =>
  call<QueryPlan>("/security/plan", s, { method: "POST", body: JSON.stringify({ question }) });

export interface AclExplain { allowed: boolean; tenant: boolean; grant: boolean; clearance: boolean; role: boolean; dept: boolean }
export interface AccessMatrix {
  users: { id: string; email: string; name: string; roles: string[]; department: string | null; clearance: number; depts: string[]; locked: boolean }[];
  documents: { id: string; title: string; sourceType: string; classification: number; department: string | null; allowedRoles: string[] }[];
  cells: Record<string, Record<string, AclExplain>>;
  source: string;
}

export const fetchMatrix = (s: Session) => call<AccessMatrix>("/access/matrix", s);

export interface AclPreview {
  users: { id: string; name: string; email: string; locked: boolean; before: boolean; after: boolean }[];
  gains: string[];
  loses: string[];
}

export const previewAcl = (s: Session, docId: string, acl: { classification: number; department: string | null; allowedRoles: string[] }) =>
  call<AclPreview>("/access/preview", s, { method: "POST", body: JSON.stringify({ docId, ...acl }) });

export interface Metrics {
  scope: "tenant" | "you";
  hours: number;
  totals: {
    queries: number; refused: number; cache_hits: number; denied_sources: number; dlp_blocks: number; uploads: number;
    acl_changes: number; llm_calls: number; users: number; p50: number | null; p95: number | null;
  };
  modes: { mode: string; n: number }[];
  series: { hour: string; queries: number; refused: number; llm: number }[];
  models: { model: string; calls: number }[];
  topQuestions: { query: string; n: number; refused: boolean }[];
  budget: { today: number; limit: number; perUser10min: number; queriesPer10min: number; chain: string[]; parked: Record<string, number>; enabled: boolean };
}

export const fetchMetrics = (s: Session, hours = 24) => call<Metrics>(`/security/metrics?hours=${hours}`, s);

export interface Alerts {
  alerts: { userId: string; name: string; email: string; roles: string[]; locked: boolean; queries: number; refusals: number;
            denied: number; dlp: number; score: number; level: "low" | "medium" | "high"; lastAt: string }[];
  locked: { userId: string; name: string; email: string }[];
  window: string;
  rule: string;
}

export const fetchAlerts = (s: Session) => call<Alerts>("/security/alerts", s);
export const lockUser = (s: Session, userId: string, reason: string) =>
  call<{ locked: boolean }>(`/admin/users/${userId}/lock`, s, { method: "POST", body: JSON.stringify({ reason }) });
export const unlockUser = (s: Session, userId: string) =>
  call<{ locked: boolean }>(`/admin/users/${userId}/unlock`, s, { method: "POST" });

export interface AuditChain { entries: number; intact: boolean; first_bad_id: number | null; head: string; walked_to: string }
export const fetchAuditChain = (s: Session) => call<AuditChain>("/security/audit-chain", s);

export interface SalaryStat { department: string; employees: number; avg_salary: number | null; suppressed: boolean }
export async function fetchSalaryStats(s: Session): Promise<{ count: number; rows: SalaryStat[] } | null> {
  if (!live(s)) return null;
  try {
    return await call("/records/salary-stats", s);
  } catch {
    return null;
  }
}

export const isLive = live;

export { docById };
export type { Chunk };
