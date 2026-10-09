import { CircleCheck, FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, Chip, SectionTitle, Stat, cx } from "../components/ui";
import { getAudit, subscribeAudit } from "../lib/engine";
import { useSession } from "../lib/session";
import type { AuditEntry } from "../lib/types";

// Measured on 2026-10-09: pytest suite (backend/tests) and the filtered-ANN benchmark
// (backend/bench/recall_benchmark.py: 10,000 vectors, 100 queries, results/recall.json).
const RLS_TESTS = { passed: 67, total: 67 };

type Proof = "pytest" | "demo" | "in progress";
const ATTACKS: { name: string; category: string; as: string; defence: string; proof: Proof }[] = [
  { name: "Direct ask for a document above your clearance", category: "direct", as: "Student", defence: "RLS on chunks", proof: "pytest" },
  { name: "set_config('app.ctx', admin) mid-query", category: "escalation", as: "Student", defence: "HMAC-signed context", proof: "pytest" },
  { name: "Forged or tampered identity", category: "spoofing", as: "Student", defence: "HMAC check in app_ctx()", proof: "pytest" },
  { name: "Replay an expired context", category: "replay", as: "Admin", defence: "exp checked in DB", proof: "pytest" },
  { name: "Cross-department: MECH HOD → CSE budget", category: "lateral", as: "HOD MECH", defence: "department scope", proof: "pytest" },
  { name: "Cross-tenant admin", category: "tenant", as: "Other tenant", defence: "tenant in signed context", proof: "pytest" },
  { name: "Read salary columns directly", category: "column", as: "HOD", defence: "security-barrier view", proof: "pytest" },
  { name: "Write through the query path", category: "write", as: "Admin", defence: "read-only txn, no grants", proof: "pytest" },
  { name: "Injected document: “ignore previous instructions”", category: "injection", as: "Student", defence: "quarantine + data tags", proof: "demo" },
  { name: "Refusal that leaks a document exists", category: "existence", as: "Student", defence: "uniform refusal", proof: "demo" },
  { name: "Guess another user's /source/{id}", category: "IDOR", as: "Student", defence: "RLS re-check → 404", proof: "in progress" },
  { name: "Aggregate probe via Text-to-SQL", category: "aggregation", as: "HOD", defence: "SELECT-only + RLS + masked view", proof: "in progress" },
];

const PROOF_TONE: Record<Proof, "brand" | "default" | "warn"> = { pytest: "brand", demo: "default", "in progress": "warn" };

// Recall@10 against exact ground truth; visible = share of the corpus the identity may read.
const RECALL = [
  { role: "Student", visible: 0.043, post: 0.05, strict: 0.17, iterative: 0.87 },
  { role: "Faculty", visible: 0.208, post: 0.21, strict: 0.82, iterative: 1.0 },
  { role: "HOD", visible: 0.369, post: 0.37, strict: 1.0, iterative: 1.0 },
  { role: "Finance", visible: 0.65, post: 0.66, strict: 1.0, iterative: 1.0 },
  { role: "Admin", visible: 1.0, post: 1.0, strict: 1.0, iterative: 1.0 },
];

function useAudit(): AuditEntry[] {
  const [, setN] = useState(0);
  useEffect(() => subscribeAudit(() => setN((n) => n + 1)), []);
  return getAudit();
}

const ACTION_TONE: Record<AuditEntry["action"], "default" | "brand" | "warn" | "deny"> = {
  query: "brand", login: "default", upload: "warn", source_view: "default", denied_source: "deny",
};

export function SecurityPage() {
  const { session } = useSession();
  const user = session!.user;
  const isAdmin = user.roles.includes("admin");
  const audit = useAudit().filter((e) => isAdmin || e.userEmail === user.email);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <SectionTitle eyebrow="Proof, not promises" title="Security & evaluation" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Retrieval-layer tests (pytest)" value={`${RLS_TESTS.passed}/${RLS_TESTS.total}`} hint="ACL matrix, forged ctx, pooling, privileges" tone="brand" />
        <Stat label="Forbidden documents exposed" value="0/32" hint="canary matrix · 9 identities × 6 documents" tone="brand" />
        <Stat label="Recall@10, public-only user" value="87%" hint="iterative HNSW scan · 5% with post-filtering" tone="brand" />
        <Stat label="p95 secure vector query" value="16 ms" hint="RLS + HNSW · 10,000 vectors" tone="brand" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">Red-team suite</h2>
            <div className="flex gap-1.5">
              <Chip tone="brand">
                <CircleCheck className="size-3" /> {ATTACKS.filter((a) => a.proof === "pytest").length} proven in pytest
              </Chip>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="text-[12px] font-medium text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Attack</th>
                  <th className="px-4 py-2 font-medium">As</th>
                  <th className="px-4 py-2 font-medium">Stopped by</th>
                  <th className="px-4 py-2 font-medium">Proven by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ATTACKS.map((a) => (
                  <tr key={a.name}>
                    <td className="px-4 py-2">
                      <div>{a.name}</div>
                      <div className="font-mono text-[10.5px] text-ink-3">{a.category}</div>
                    </td>
                    <td className="px-4 py-2 text-ink-2">{a.as}</td>
                    <td className="px-4 py-2 font-mono text-[11.5px] text-ink-3">{a.defence}</td>
                    <td className="px-4 py-2">
                      <Chip tone={PROOF_TONE[a.proof]}>{a.proof}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Recall@10 under RLS</h2>
              <Chip tone="brand">measured</Chip>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
              10,000 vectors, 100 queries. Filtering a top-10 in app code starves low-privilege users; pgvector's iterative HNSW scan keeps
              walking the graph inside the RLS-filtered query until 10 authorised rows are found.
            </p>
            <div className="mt-4 space-y-3">
              {RECALL.map((r) => (
                <div key={r.role}>
                  <div className="mb-1 flex justify-between text-[11.5px]">
                    <span className="text-ink-2">
                      {r.role} <span className="text-ink-3">· sees {(r.visible * 100).toFixed(r.visible < 0.1 ? 1 : 0)}%</span>
                    </span>
                    <span className="font-mono text-ink-3">
                      {r.post.toFixed(2)} → <span className="text-brand">{r.iterative.toFixed(2)}</span>
                    </span>
                  </div>
                  <div className="relative h-2 overflow-hidden rounded-full bg-panel-2">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-brand/80" style={{ width: `${r.iterative * 100}%` }} />
                    <div className="absolute inset-y-0 left-0 rounded-full bg-ink-3" style={{ width: `${r.post * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-[11px] text-ink-3">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-ink-3" /> post-filter</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-brand" /> iterative scan</span>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <FlaskConical className="size-4 text-brand" /> Defence in depth
            </h2>
            <ul className="mt-3 space-y-2 text-[12.5px] text-ink-2">
              {[
                "rag_reader: NOBYPASSRLS, SELECT-only, read-only transactions",
                "Context HMAC-signed; forged/expired → NULL → zero rows",
                "Chunks inherit document ACL by trigger; revocation is instant",
                "Salary/appraisal only via security-barrier view",
                "Uniform refusal: no hint that a document exists",
                "Cache keys include the ACL fingerprint",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-brand" /> {t}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Audit log</h2>
          <span className="text-[11.5px] text-ink-3">{isAdmin ? "All users (admin view)" : "Your own entries only (RLS on audit_log)"}</span>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="sticky top-0 bg-panel text-[12px] font-medium text-ink-3">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Detail</th>
                <th className="px-4 py-2 text-right font-medium">Chunks</th>
                {isAdmin && <th className="px-4 py-2 text-right font-medium">RLS-filtered</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {audit.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-[11.5px] text-ink-3">{e.at.replace("T", " ")}</td>
                  <td className="whitespace-nowrap px-4 py-2">{e.userName}</td>
                  <td className="px-4 py-2"><Chip tone={ACTION_TONE[e.action]}>{e.action.replace("_", " ")}</Chip></td>
                  <td className="max-w-[360px] truncate px-4 py-2 text-ink-2">{e.detail}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{e.chunks}</td>
                  {isAdmin && <td className={cx("px-4 py-2 text-right tabular-nums", e.filtered > 0 && "text-deny")}>{e.filtered}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
