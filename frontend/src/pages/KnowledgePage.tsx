import { CircleCheck, EyeOff, Loader2, Pencil, ShieldAlert, Upload, X } from "lucide-react";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Button, Card, ClassBadge, SectionTitle, SourceIcon, Chip, cx } from "../components/ui";
import { fetchDocuments, patchAcl, previewAcl, uploadDocument, type AclPreview, type IngestResult, type RecordGroup } from "../lib/api";
import { AccessMatrix } from "../components/AccessMatrix";
import { CHUNKS, DOCS } from "../lib/corpus";
import { aclAllows, recordAudit } from "../lib/engine";
import { CLASSIFICATION } from "../lib/personas";
import { useSession } from "../lib/session";
import type { Doc, SourceType } from "../lib/types";

const ROLES = ["*", "student", "faculty", "hod", "finance", "hr"];
const DEPTS = ["", "CSE", "MECH", "CIVIL", "EC"];
const FILTERS: { key: "all" | SourceType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pdf", label: "PDFs" },
  { key: "image", label: "Images" },
  { key: "db_record", label: "DB records" },
];

function AclFields({ value, onChange }: { value: Pick<Doc, "classification" | "department" | "allowedRoles">; onChange: (v: Pick<Doc, "classification" | "department" | "allowedRoles">) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 text-xs text-ink-2">Classification</div>
        <div className="grid grid-cols-4 gap-1.5">
          {CLASSIFICATION.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => onChange({ ...value, classification: i })}
              className={cx(
                "rounded-lg border px-2 py-2 text-[12px] transition-colors",
                value.classification === i ? "border-brand/50 bg-brand/10 text-ink" : "border-line text-ink-3 hover:border-line-2",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="text-xs text-ink-2">Department scope</span>
        <select
          value={value.department ?? ""}
          onChange={(e) => onChange({ ...value, department: e.target.value || null })}
          className="mt-1.5 w-full rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm outline-none"
        >
          {DEPTS.map((d) => (
            <option key={d} value={d}>{d || "All departments"}</option>
          ))}
        </select>
      </label>
      <div>
        <div className="mb-1.5 text-xs text-ink-2">Allowed roles</div>
        <div className="flex flex-wrap gap-1.5">
          {ROLES.map((r) => {
            const on = value.allowedRoles.includes(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() => onChange({ ...value, allowedRoles: on ? value.allowedRoles.filter((x) => x !== r) : [...value.allowedRoles, r] })}
                className={cx(
                  "rounded-md border px-2.5 py-1 font-mono text-[11.5px] transition-colors",
                  on ? "border-brand/50 bg-brand/10 text-brand" : "border-line text-ink-3 hover:border-line-2",
                )}
              >
                {r === "*" ? "* any role" : r}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const INGEST_STEPS = ["Upload & sha256 dedupe", "Detect type / text layer", "Extract text · OCR · caption", "Layout-aware chunking", "Embed (768-d)", "Index with inherited ACL"];

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: (d: Doc | null) => void }) {
  const { session } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [acl, setAcl] = useState<Pick<Doc, "classification" | "department" | "allowedRoles">>({ classification: 1, department: null, allowedRoles: ["faculty", "hod"] });
  const [step, setStep] = useState(-1);

  function pick(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);

  function animate(until: () => boolean) {
    let i = 0;
    const tick = () => {
      if (until()) return;
      i = Math.min(i + 1, INGEST_STEPS.length - 1);
      setStep(i);
      setTimeout(tick, 650 + Math.random() * 400);
    };
    setTimeout(tick, 400);
  }

  async function start() {
    if (!file) return;
    setStep(0);
    setError(null);
    if (session!.mode === "live") {
      let finished = false;
      animate(() => finished);
      try {
        const r = await uploadDocument(session!, file, acl);
        finished = true;
        setResult(r);
        setStep(INGEST_STEPS.length);
        setTimeout(() => onDone(null), 1600);
      } catch (e) {
        finished = true;
        setError((e as Error).message);
        setStep(-1);
      }
      return;
    }
    let i = 0;
    const tick = () => {
      i += 1;
      setStep(i);
      if (i < INGEST_STEPS.length) setTimeout(tick, 450 + Math.random() * 350);
      else {
        const type: SourceType = file.type.startsWith("image/") ? "image" : "pdf";
        const doc: Doc = {
          id: `up-${crypto.randomUUID().slice(0, 8)}`, title: file.name, sourceType: type, ...acl, allowedUsers: [],
          owner: session!.user.name, uploadedAt: new Date().toISOString().slice(0, 10),
          size: `${Math.max(1, Math.round(file.size / 1024))} KB`, status: "ready", flags: type === "image" ? ["ocr", "caption"] : [],
          summary: "Uploaded in this session (offline demo: not searchable).",
        };
        recordAudit({ userEmail: session!.user.email, userName: session!.user.name, action: "upload", detail: `${file.name} · ${CLASSIFICATION[acl.classification]}`, chunks: 0, filtered: 0 });
        setTimeout(() => onDone(doc), 500);
      }
    };
    setTimeout(tick, 450);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 backdrop-blur-[2px] p-4">
      <Card className="fade-up w-full max-w-lg shadow-float">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-semibold">Ingest a document</h3>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {step < 0 ? (
          <div className="space-y-5 p-5">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line-2 bg-paper px-4 py-8 text-center hover:border-brand/40">
              <Upload className="size-6 text-ink-3" />
              <span className="text-sm">{file ? file.name : "Choose a PDF or image"}</span>
              <span className="text-[11.5px] text-ink-3">Scanned pages are OCR'd automatically; images also get a vision caption</span>
              <input type="file" accept=".pdf,image/*" className="hidden" onChange={pick} />
            </label>
            <AclFields value={acl} onChange={setAcl} />
            {error && <div className="rounded-[10px] bg-deny/10 px-3 py-2 text-[13px] text-deny">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={start} disabled={!file || acl.allowedRoles.length === 0}>
                <Upload className="size-4" /> Ingest
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 p-5">
            {(result?.steps ?? INGEST_STEPS.map((label) => ({ key: label, label, detail: "", ms: 0 }))).map((st, i) => (
              <div key={st.key} className={cx("flex items-center gap-3 text-sm", !result && i > step && "opacity-35")}>
                {result || i < step ? <CircleCheck className="size-4 shrink-0 text-brand" /> : i === step ? <Loader2 className="size-4 shrink-0 animate-spin text-brand" /> : <span className="size-4 shrink-0 rounded-full border border-line-2" />}
                <span className="w-44 shrink-0">{st.label}</span>
                {result && <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">{st.detail}</span>}
                {result && <span className="font-mono text-[11px] tabular-nums text-ink-3">{st.ms} ms</span>}
              </div>
            ))}
            {result && (
              <div className="pt-2 text-[13px] text-ink-2">
                {result.duplicate ? "Already in the index (same SHA-256)." : `Indexed ${result.chunks} chunks.`}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function WhatIf({ doc, acl }: { doc: Doc; acl: Pick<Doc, "classification" | "department" | "allowedRoles"> }) {
  const { session } = useSession();
  const [p, setP] = useState<AclPreview | null>(null);
  useEffect(() => {
    if (session?.mode !== "live" || acl.allowedRoles.length === 0) return;
    let alive = true;
    const t = setTimeout(() => {
      previewAcl(session, doc.id, acl).then((r) => alive && setP(r)).catch(() => alive && setP(null));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [session, doc.id, acl]);
  if (session?.mode !== "live") return null;
  if (!p) return <div className="flex items-center gap-2 text-[12px] text-ink-3"><Loader2 className="size-3.5 animate-spin" /> Asking Postgres who could read this…</div>;
  const after = p.users.filter((u) => u.after && !u.locked);
  return (
    <div className="space-y-2 rounded-xl bg-panel-2/55 p-3 ring-1 ring-line/60">
      <div className="text-[12px] font-medium text-ink-3">What-if preview · evaluated by acl_check() before saving</div>
      <div className="flex flex-wrap gap-1">
        {after.map((u) => <Chip key={u.id} tone={u.before ? "default" : "brand"}>{u.name}</Chip>)}
        {after.length === 0 && <span className="text-[12px] text-ink-3">Nobody but explicit grants.</span>}
      </div>
      {(p.gains.length > 0 || p.loses.length > 0) ? (
        <div className="space-y-0.5 text-[12px]">
          {p.gains.length > 0 && <div className="text-brand">+ gains access: {p.gains.join(", ")}</div>}
          {p.loses.length > 0 && <div className="text-deny">− loses access instantly: {p.loses.join(", ")}</div>}
        </div>
      ) : (
        <div className="text-[12px] text-ink-3">No change in who can read it.</div>
      )}
    </div>
  );
}

function AclDrawer({ doc, onClose, onSave, error }: { doc: Doc; onClose: () => void; onSave: (v: Pick<Doc, "classification" | "department" | "allowedRoles">) => void; error?: string | null }) {
  const [acl, setAcl] = useState({ classification: doc.classification, department: doc.department, allowedRoles: doc.allowedRoles });
  const chunks = doc.chunks ?? CHUNKS.filter((c) => c.docId === doc.id).length;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="fade-up fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-panel">
        <div className="flex items-start gap-3 border-b border-line p-4">
          <SourceIcon type={doc.sourceType} className="mt-0.5 size-5" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{doc.title}</div>
            <div className="text-[11.5px] text-ink-3">{doc.summary}</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <AclFields value={acl} onChange={setAcl} />
          <WhatIf doc={doc} acl={acl} />
          {doc.allowedUsers.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs text-ink-2">Explicit user grants</div>
              {doc.allowedUsers.map((u) => (
                <div key={u} className="font-mono text-[12px] text-ink-3">{u}</div>
              ))}
            </div>
          )}
          <pre className="overflow-x-auto rounded-xl bg-panel-2/60 p-3.5 font-mono text-[11px] leading-relaxed text-ink-2">
            <span className="text-brand">UPDATE</span> documents <span className="text-brand">SET</span>
            {"\n  "}classification = {acl.classification},{"\n  "}department = {acl.department ? `'${acl.department}'` : "NULL"},
            {"\n  "}allowed_roles = '{"{"}{acl.allowedRoles.join(",")}{"}"}'{"\n"}
            <span className="text-brand">WHERE</span> id = <span className="text-warn">'{doc.id}'</span>;{"\n"}
            <span className="text-ink-3">-- trigger documents_acl → {chunks} chunk{chunks === 1 ? "" : "s"} updated instantly</span>
          </pre>
        </div>
        {error && <div className="mx-4 mb-2 rounded-[10px] bg-deny/10 px-3 py-2 text-[13px] text-deny">{error}</div>}
        <div className="flex justify-end gap-2 border-t border-line p-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(acl)} disabled={acl.allowedRoles.length === 0}>Save &amp; propagate</Button>
        </div>
      </aside>
    </>
  );
}

export function KnowledgePage() {
  const { session } = useSession();
  const user = session!.user;
  const isAdmin = user.roles.includes("admin");
  const canUpload = !(user.roles.length === 1 && user.roles[0] === "student");
  const [filter, setFilter] = useState<"all" | SourceType>("all");
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [records, setRecords] = useState<RecordGroup[]>([]);
  const [uploads, setUploads] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [aclError, setAclError] = useState<string | null>(null);
  const [view, setView] = useState<"sources" | "matrix">("sources");
  const showMatrix = isAdmin && session!.mode === "live";

  const load = useCallback(async () => {
    try {
      const r = await fetchDocuments(session!);
      setDocs(r.documents);
      setRecords(r.records);
    } catch {
      setDocs(DOCS.filter((d) => aclAllows(user, d) && d.sourceType !== "db_record"));
    }
  }, [session, user]);

  useEffect(() => {
    load();
  }, [load]);

  const all = [...uploads, ...(docs ?? [])];
  const visible = all.filter((d) => filter === "all" || d.sourceType === filter);

  async function saveAcl(doc: Doc, v: Pick<Doc, "classification" | "department" | "allowedRoles">) {
    setAclError(null);
    if (session!.mode === "live") {
      try {
        await patchAcl(session!, doc.id, v);
      } catch (e) {
        setAclError((e as Error).message);
        return;
      }
      setEditing(null);
      await load();
      return;
    }
    const demoDoc = DOCS.find((d) => d.id === doc.id);
    if (demoDoc) Object.assign(demoDoc, v); // the demo engine reads ACLs at query time, so revocation is instant
    recordAudit({ userEmail: user.email, userName: user.name, action: "acl_change", detail: `ACL change on ${doc.title} → ${CLASSIFICATION[v.classification]} · ${v.allowedRoles.join(",")}`, chunks: 0, filtered: 0 });
    setEditing(null);
    await load();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <SectionTitle eyebrow="Unified vector + metadata index" title="Knowledge base">
        {canUpload && (
          <Button onClick={() => setUploading(true)}>
            <Upload className="size-4" /> Ingest document
          </Button>
        )}
      </SectionTitle>

      {showMatrix && (
        <div className="mb-4 flex gap-1 rounded-lg border border-line bg-panel p-1 sm:inline-flex">
          {([["sources", "Sources"], ["matrix", "Access matrix"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={cx("flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px]", view === k ? "bg-panel-2 text-ink ring-1 ring-line-2" : "text-ink-3 hover:text-ink-2")}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {showMatrix && view === "matrix" ? <AccessMatrix /> : <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-line bg-panel p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cx("rounded-md px-3 py-1.5 text-[13px]", filter === f.key ? "bg-panel-2 text-ink ring-1 ring-line-2" : "text-ink-3 hover:text-ink-2")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <EyeOff className="size-3.5" />
          You can see {all.length} documents{records.length ? ` and ${records.reduce((a, r) => a + r.rows, 0)} record cards` : ""}. Ones you can't access are not listed, not even by title.
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="border-b border-line bg-panel-2/40 text-[12px] font-medium text-ink-3">
              <tr>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Classification</th>
                <th className="px-4 py-2.5 font-medium">Dept</th>
                <th className="px-4 py-2.5 font-medium">Allowed roles</th>
                <th className="px-4 py-2.5 font-medium">Pipeline</th>
                <th className="px-4 py-2.5 font-medium">Updated</th>
                {isAdmin && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((d) => (
                <tr key={d.id} className="hover:bg-panel-2/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <SourceIcon type={d.sourceType} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{d.title}</div>
                        <div className="truncate text-[11.5px] text-ink-3">{d.summary}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><ClassBadge level={d.classification} /></td>
                  <td className="px-4 py-3 font-mono text-[12px] text-ink-2">{d.department ?? "all"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {d.allowedRoles.map((r) => <Chip key={r}>{r === "*" ? "any" : r}</Chip>)}
                      {d.allowedUsers.length > 0 && <Chip tone="brand">+{d.allowedUsers.length} user</Chip>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {d.flags?.includes("prompt_injection") && (
                        <Chip tone="warn"><ShieldAlert className="size-3" /> injection flagged</Chip>
                      )}
                      {d.flags?.includes("ocr") && <Chip>OCR</Chip>}
                      {d.flags?.includes("caption") && <Chip>caption</Chip>}
                      <Chip tone="brand">{d.pages ? `${d.pages} pp · ` : ""}{d.size}</Chip>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[12px] text-ink-3">{d.uploadedAt}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" className="px-2 py-1" onClick={() => setEditing(d)}>
                        <Pencil className="size-3.5" /> ACL
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
              {docs === null && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-ink-3"><Loader2 className="mx-auto size-5 animate-spin" /></td>
                </tr>
              )}
              {docs !== null && visible.length === 0 && filter !== "db_record" && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-ink-3">No sources of this type are available to you.</td>
                </tr>
              )}
              {(filter === "all" || filter === "db_record") && records.map((g) => (
                <tr key={g.relation} className="bg-panel-2/25">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <SourceIcon type="db_record" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{g.relation}</div>
                        <div className="truncate text-[11.5px] text-ink-3">{g.rows} record card{g.rows === 1 ? "" : "s"} you can read · each row keeps its own ACL</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1"><ClassBadge level={g.min_cls} compact />{g.max_cls !== g.min_cls && <ClassBadge level={g.max_cls} compact />}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-ink-2">per row</td>
                  <td className="px-4 py-3"><Chip>row policy</Chip></td>
                  <td className="px-4 py-3"><Chip tone="brand">{g.rows} rows</Chip></td>
                  <td className="px-4 py-3 text-[12px] text-ink-3">synced</td>
                  {isAdmin && <td />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      </>}

      {uploading && (
        <UploadModal
          onClose={() => setUploading(false)}
          onDone={(d) => {
            if (d) setUploads((u) => [d, ...u]);
            setUploading(false);
            load();
          }}
        />
      )}
      {editing && (
        <AclDrawer doc={editing} error={aclError} onClose={() => { setEditing(null); setAclError(null); }} onSave={(v) => saveAcl(editing, v)} />
      )}
    </div>
  );
}
