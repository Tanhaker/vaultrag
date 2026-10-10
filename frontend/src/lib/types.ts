export type SourceType = "pdf" | "image" | "db_record";
export type Modality = "text" | "table" | "ocr" | "caption" | "record" | "sql";

export interface User {
  uid: string;
  tid?: string;
  email: string;
  name: string;
  roles: string[];
  depts: string[];
  clearance: number;
  department: string | null;
}

export interface Persona extends User {
  key: string;
  title: string;
  blurb: string;
}

export interface Doc {
  id: string;
  title: string;
  sourceType: SourceType;
  classification: number;
  department: string | null;
  allowedRoles: string[];
  allowedUsers: string[]; // emails with an explicit need-to-know grant
  owner: string;
  uploadedAt: string;
  pages?: number;
  size: string;
  status: "ready" | "processing" | "failed";
  flags?: string[];
  summary: string;
  chunks?: number;
}

export interface Chunk {
  id: string;
  docId: string;
  modality: Modality;
  page?: number;
  bbox?: [number, number, number, number];
  rowRef?: string;
  content: string;
  tags: string[];
  claims: string[];
  bait?: string; // a plausible sentence the LLM drafts that the citation verifier must reject
  record?: Record<string, string>;
  masked?: string[];
  injection?: boolean;
  ocrConfidence?: number | null;
  sql?: string;
  rows?: Record<string, string | number | null>[];
  columns?: string[];
}

export interface Citation {
  n: number;
  chunk: Chunk;
  doc: Doc;
  score: number;
}

export interface Sentence {
  text: string;
  cites: number[];
  removed?: boolean;
  reason?: string;
  /** How the verifier accepted it: quoted verbatim, judged entailed by the model, or figures checked. */
  check?: "verbatim" | "entailed" | "numeric" | "chat";
  /** The verifier moved the citation to the one source that holds every figure in the sentence. */
  repaired?: { from: number[]; to: number[] };
}

export interface Receipt {
  v: number;
  answer_id: string;
  issued_at: string;
  user: string;
  question_sha256: string;
  answer_sha256: string;
  mode: string;
  model: string | null;
  kb_version: number | null;
  citations: { n: number; chunk_id: string; title: string; content_sha256: string }[];
  sig: string;
}

export interface LlmUsage {
  allowed: boolean;
  reason: string;
  calls: number;
  model: string | null;
  today: number;
  budget: number;
  rateLimited: string[];
}

export interface PipelineStep {
  key: string;
  label: string;
  detail: string;
  ms: number;
}

/** Reply style ("bhai mode"): wording and language only, never what may be read. */
export interface AnswerStyle {
  lang: "en" | "hinglish" | "hi" | "gu";
  tone: "formal" | "bhai";
  label: string;
  detected: boolean;
  greeting: string | null;
}

export interface Answer {
  id: string;
  question: string;
  user: User;
  sentences: Sentence[];
  citations: Citation[];
  quarantined: Citation[];
  refused: boolean;
  groundedness: number;
  steps: PipelineStep[];
  xray: { candidates: number; visible: number; filtered: number };
  latencyMs: number;
  at: string;
  mode?: "llm" | "extractive" | "sql" | "refused" | "chat";
  rewritten?: string | null;
  dlp?: { blocked: boolean; redacted: number; canaries: string[] };
  cache?: "memory" | "postgres" | null;
  llm?: LlmUsage;
  receipt?: Receipt;
  style?: AnswerStyle;
  /** Small talk: a conversational reply with no retrieval, plus questions to try for this role. */
  chat?: { intent: string; nudge: string | null; suggestions: string[] };
}

export interface SourceData {
  chunk: Chunk;
  doc: Doc;
  blocks: Chunk[];
  image: { src: string; width: number; height: number } | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  userEmail: string;
  userName: string;
  action: "query" | "login" | "upload" | "source_view" | "denied_source" | "acl_change" | "dlp_block" | "lock_user" | "unlock_user";
  detail: string;
  chunks: number;
  filtered: number;
  latencyMs?: number;
}
