import { CircleCheck, EyeOff, Loader2, Pencil, ShieldAlert, Upload, X } from "lucide-react";
import { useMemo, useState, type ChangeEvent } from "react";
import { Button, Card, ClassBadge, SectionTitle, SourceIcon, Chip, cx } from "../components/ui";
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

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: (d: Doc) => void }) {
  const { session } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [acl, setAcl] = useState<Pick<Doc, "classification" | "department" | "allowedRoles">>({ classification: 1, department: null, allowedRoles: ["faculty", "hod"] });
  const [step, setStep] = useState(-1);

  function pick(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  function start() {
    if (!file) return;
    let i = 0;
    setStep(0);
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
          summary: "Uploaded in this session.",
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
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={start} disabled={!file || acl.allowedRoles.length === 0}>
                <Upload className="size-4" /> Ingest
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 p-5">
            {INGEST_STEPS.map((s, i) => (
              <div key={s} className={cx("flex items-center gap-3 text-sm", i > step && "opacity-35")}>
                {i < step ? <CircleCheck className="size-4 text-brand" /> : i === step ? <Loader2 className="size-4 animate-spin text-brand" /> : <span className="size-4 rounded-full border border-line-2" />}
                {s}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function AclDrawer({ doc, onClose, onSave }: { doc: Doc; onClose: () => void; onSave: (v: Pick<Doc, "classification" | "department" | "allowedRoles">) => void }) {
  const [acl, setAcl] = useState({ classification: doc.classification, department: doc.department, allowedRoles: doc.allowedRoles });
  const chunks = CHUNKS.filter((c) => c.docId === doc.id).length;
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
  const canUpload = !user.roles.includes("student");
  const [filter, setFilter] = useState<"all" | SourceType>("all");
  const [uploads, setUploads] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [, bump] = useState(0);

  const all = useMemo(() => [...uploads, ...DOCS], [uploads]);
  const visible = all.filter((d) => aclAllows(user, d) && (filter === "all" || d.sourceType === filter));

  function saveAcl(doc: Doc, v: Pick<Doc, "classification" | "department" | "allowedRoles">) {
    Object.assign(doc, v); // the demo engine reads ACLs at query time, so revocation is instant
    recordAudit({ userEmail: user.email, userName: user.name, action: "upload", detail: `ACL change on ${doc.title} → ${CLASSIFICATION[v.classification]} · ${v.allowedRoles.join(",")}`, chunks: 0, filtered: 0 });
    setEditing(null);
    bump((n) => n + 1);
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
          You can see {all.filter((d) => aclAllows(user, d)).length} sources. Ones you can't access are not listed, not even by title.
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
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-ink-3">No sources of this type are available to you.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {uploading && (
        <UploadModal
          onClose={() => setUploading(false)}
          onDone={(d) => {
            setUploads((u) => [d, ...u]);
            setUploading(false);
          }}
        />
      )}
      {editing && <AclDrawer doc={editing} onClose={() => setEditing(null)} onSave={(v) => saveAcl(editing, v)} />}
    </div>
  );
}
