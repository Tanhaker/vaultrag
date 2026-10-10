// Offline demo of the DefRAG query pipeline. The real system runs these steps in
// FastAPI + Postgres; here they run in the browser so the UI works without a backend.
// aclAllows() mirrors acl_check() in backend/migrations/003_security.sql exactly.

import { CHUNKS, docById } from "./corpus";
import type { Answer, AuditEntry, Chunk, Citation, Doc, PipelineStep, Sentence, User } from "./types";

export const REFUSAL = "I don't have information on that in the sources available to you.";

export function aclAllows(user: User, doc: Doc): boolean {
  if (doc.allowedUsers.includes(user.email)) return true;
  if (doc.classification > user.clearance) return false;
  const roleOk =
    user.roles.includes("admin") || doc.allowedRoles.includes("*") || doc.allowedRoles.some((r) => user.roles.includes(r));
  const deptOk = doc.department === null || user.depts.includes("*") || user.depts.includes(doc.department);
  return roleOk && deptOk;
}

const STOP = new Set(
  "a an the is are was were be of for to in on at by with and or what who whom whose which how when where why do does did i me my our we you your it its this that these those there their them they please tell give show list about from can could would should much many any all summarise summarize".split(
    " ",
  ),
);

const DEPT_WORDS: Record<string, string[]> = {
  CSE: ["cse", "computer"],
  MECH: ["mech", "mechanical"],
  CIVIL: ["civil"],
  EC: ["ec", "electronics"],
};

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9₹%\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function termMatch(q: string, t: string): boolean {
  if (q === t || q + "s" === t || t + "s" === q) return true;
  if (q.length >= 4 && t.length >= 4) return q.startsWith(t.slice(0, 4)) && t.startsWith(q.slice(0, 4)) && Math.abs(q.length - t.length) <= 3;
  return false;
}

function score(question: string, chunk: Chunk, doc: Doc): number {
  const q = tokens(question);
  const body = tokens(chunk.content);
  let s = 0;
  for (const term of q) {
    if (chunk.tags.some((t) => termMatch(term, t))) s += 2;
    else if (body.some((t) => termMatch(term, t))) s += 0.75;
  }
  const mentioned = Object.entries(DEPT_WORDS)
    .filter(([, words]) => q.some((t) => words.includes(t)))
    .map(([d]) => d);
  if (mentioned.length && doc.department && !mentioned.includes(doc.department)) s *= 0.2;
  const tagDept = Object.entries(DEPT_WORDS).find(([, w]) => chunk.tags.some((t) => w.includes(t)))?.[0];
  if (mentioned.length && tagDept && !mentioned.includes(tagDept)) s *= 0.3;
  return s;
}

const THRESHOLD = 3.5;
const TOP_K = 4;

// --- tiny audit store, shared by every page -----------------------------------------------------

type Listener = () => void;
const auditLog: AuditEntry[] = [
  { id: "seed-1", at: "2026-10-07T18:42:10", userEmail: "hod.cse@atmiya.test", userName: "Dr. Rajesh Trivedi", action: "query", detail: "Lab upgrade spend so far", chunks: 2, filtered: 1, latencyMs: 1840 },
  { id: "seed-2", at: "2026-10-07T18:44:31", userEmail: "aarav.student@atmiya.test", userName: "Aarav Shah", action: "query", detail: "What is the CSE department budget?", chunks: 0, filtered: 3, latencyMs: 1210 },
  { id: "seed-3", at: "2026-10-07T18:45:02", userEmail: "aarav.student@atmiya.test", userName: "Aarav Shah", action: "denied_source", detail: "GET /source/c-cse-alloc → 404", chunks: 0, filtered: 1 },
  { id: "seed-4", at: "2026-10-07T19:02:55", userEmail: "finance@atmiya.test", userName: "Hitesh Desai", action: "query", detail: "Overdue fee accounts by department", chunks: 1, filtered: 2, latencyMs: 2010 },
  { id: "seed-5", at: "2026-10-07T19:10:17", userEmail: "admin@atmiya.test", userName: "System Admin", action: "upload", detail: "Visitor Feedback Form (scanned).jpg — prompt-injection flagged", chunks: 1, filtered: 0 },
];
const listeners = new Set<Listener>();

export function getAudit(): AuditEntry[] {
  return auditLog;
}

export function subscribeAudit(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function recordAudit(entry: Omit<AuditEntry, "id" | "at">): void {
  auditLog.unshift({ ...entry, id: crypto.randomUUID(), at: new Date().toISOString().slice(0, 19) });
  listeners.forEach((fn) => fn());
}

// --- pipeline -------------------------------------------------------------------------------------

function jitter(base: number): number {
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export function retrieve(question: string, user: User) {
  const scored = CHUNKS.map((chunk) => {
    const doc = docById(chunk.docId);
    return { chunk, doc, score: score(question, chunk, doc) };
  })
    .filter((c) => c.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score);

  // In Postgres this filter is the RLS policy on the same statement as the ANN scan;
  // denied rows never leave the database.
  const visible = scored.filter((c) => aclAllows(user, c.doc));
  return { candidates: scored.length, visible };
}

export async function ask(question: string, user: User, opts: { audit?: boolean } = {}): Promise<Answer> {
  const { candidates, visible } = retrieve(question, user);
  const q = tokens(question);
  const relevantClaims = (chunk: Chunk) =>
    chunk.claims.filter((claim) => tokens(claim).some((t) => q.some((term) => termMatch(term, t)))).slice(0, 2);

  const top = visible.slice(0, TOP_K + 1);
  const quarantinedRaw = top.filter((c) => c.chunk.injection);
  const usable = top.filter((c) => !c.chunk.injection && relevantClaims(c.chunk).length > 0).slice(0, TOP_K);

  const citations: Citation[] = usable.map((c, i) => ({ n: i + 1, chunk: c.chunk, doc: c.doc, score: c.score }));
  const quarantined: Citation[] = quarantinedRaw.map((c, i) => ({ n: 100 + i, chunk: c.chunk, doc: c.doc, score: c.score }));

  const sentences: Sentence[] = [];
  let claimBudget = 5;
  for (const cit of citations) {
    for (const claim of relevantClaims(cit.chunk)) {
      if (claimBudget-- <= 0) break;
      sentences.push({ text: claim, cites: [cit.n] });
    }
    if (cit.chunk.bait && sentences.length < 6) {
      sentences.push({ text: cit.chunk.bait, cites: [cit.n], removed: true, reason: `Not entailed by [${cit.n}]` });
    }
  }

  const refused = sentences.filter((s) => !s.removed).length === 0;
  const final = refused ? [{ text: REFUSAL, cites: [] }] : sentences;
  const kept = final.filter((s) => !s.removed).length;
  const removed = final.filter((s) => s.removed).length;
  const groundedness = refused ? 1 : kept / (kept + removed);

  const steps: PipelineStep[] = [
    { key: "ctx", label: "Bind signed DB context", detail: `rag_reader · clearance ${user.clearance} · HMAC verified`, ms: jitter(40) },
    { key: "search", label: "Hybrid search under RLS", detail: `HNSW + BM25 · ${visible.length} authorised chunk${visible.length === 1 ? "" : "s"} matched`, ms: jitter(180) },
    { key: "rerank", label: "RRF fusion + rerank", detail: `top ${citations.length + quarantined.length} kept`, ms: jitter(120) },
    {
      key: "guard", label: "Injection scan",
      detail: quarantined.length ? `${quarantined.length} chunk quarantined (prompt-injection pattern)` : "no injection patterns",
      ms: jitter(30),
    },
    { key: "gen", label: "Generate with citations", detail: refused ? "insufficient evidence → refuse" : `${sentences.length} sentences drafted`, ms: jitter(900) },
    {
      key: "verify", label: "Citation verifier",
      detail: refused ? "refusal is uniform (no existence leak)" : `${kept} supported · ${removed} removed`,
      ms: jitter(260),
    },
  ];
  const latencyMs = steps.reduce((a, s) => a + s.ms, 0);

  const answer: Answer = {
    id: crypto.randomUUID(),
    question,
    user,
    sentences: final,
    citations: refused ? [] : citations,
    quarantined,
    refused,
    groundedness,
    steps,
    xray: { candidates, visible: visible.length, filtered: candidates - visible.length },
    latencyMs,
    at: new Date().toISOString(),
  };

  if (opts.audit !== false) {
    recordAudit({
      userEmail: user.email, userName: user.name, action: "query", detail: question,
      chunks: answer.citations.length, filtered: answer.xray.filtered, latencyMs,
    });
  }
  return answer;
}

export function visibleDocs(user: User, docs: Doc[]): Doc[] {
  return docs.filter((d) => aclAllows(user, d));
}
