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
}

export interface PipelineStep {
  key: string;
  label: string;
  detail: string;
  ms: number;
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
  mode?: "llm" | "extractive" | "sql" | "refused";
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
  action: "query" | "login" | "upload" | "source_view" | "denied_source" | "acl_change";
  detail: string;
  chunks: number;
  filtered: number;
  latencyMs?: number;
}
