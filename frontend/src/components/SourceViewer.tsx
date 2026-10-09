import { Loader2, Lock, ScanText, ShieldCheck, ShieldOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, fetchSource, pageHeader } from "../lib/api";
import { CHUNKS } from "../lib/corpus";
import { useSession } from "../lib/session";
import type { Chunk, Citation, SourceData } from "../lib/types";
import { ClassBadge, ModalityTag, SourceIcon } from "./ui";

function TableBlock({ content }: { content: string }) {
  const [head, ...rows] = content.split("\n").map((l) => l.split("|").map((c) => c.trim()));
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-zinc-400/60">
          {head.map((h, i) => (
            <th key={i} className={i ? "py-1 text-right font-semibold" : "py-1 text-left font-semibold"}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={i === rows.length - 1 && /total/i.test(r[0]) ? "border-t border-zinc-400/60 font-semibold" : ""}>
            {r.map((c, j) => (
              <td key={j} className={j ? "py-0.5 text-right tabular-nums" : "py-0.5"}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PdfPage({ c, data }: { c: Citation; data: SourceData }) {
  const page = c.chunk.page ?? 1;
  const [meta, intro] = pageHeader(c.doc);
  const blocks = [...data.blocks].sort((a, b) => (a.bbox?.[1] ?? 0) - (b.bbox?.[1] ?? 0));
  const scanned = c.chunk.modality === "ocr";
  return (
    <div className="relative mx-auto aspect-[1/1.32] w-full max-w-md overflow-hidden rounded-[4px] bg-paper p-7 text-zinc-800 shadow-float ring-1 ring-line" style={scanned ? { filter: "contrast(0.95) sepia(0.15)" } : undefined}>
      <div className="flex justify-between font-mono text-[9px] tracking-wide text-zinc-500">
        <span className="truncate pr-3">{meta}</span>
        <span>p. {page}</span>
      </div>
      <div className="mt-4 space-y-3 overflow-hidden text-[12px] leading-relaxed">
        {intro && <p className="text-zinc-600">{intro}</p>}
        {blocks.map((b) => {
          const hit = b.id === c.chunk.id;
          return (
            <div key={b.id} className={hit ? "relative -mx-2 rounded-[3px] bg-mark/70 px-2 py-1 ring-[1.5px] ring-warn/70" : ""}>
              {hit && (
                <span className="absolute -top-2.5 right-1 rounded-[3px] bg-warn px-1.5 font-mono text-[9px] font-medium text-paper">cited as {c.n}</span>
              )}
              {b.modality === "table" ? <TableBlock content={b.content} /> : <p>{b.content}</p>}
            </div>
          );
        })}
        {[92, 78, 85, 64].map((w, i) => (
          <div key={i} className="h-2 rounded bg-zinc-300/70" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

function ImageView({ c, data }: { c: Citation; data: SourceData }) {
  const ocr = c.chunk.modality === "ocr" ? c.chunk : data.blocks.find((k) => k.modality === "ocr");
  const caption = data.blocks.find((k) => k.modality === "caption") ?? CHUNKS.find((k) => k.docId === c.doc.id && k.modality === "caption");
  const [x0, y0, x1, y1] = ocr?.bbox ?? [10, 20, 90, 70];
  const label = `OCR region${ocr?.ocrConfidence ? ` · conf ${Math.round(ocr.ocrConfidence * 100)}%` : ""}`;
  const overlay = (
    <div
      className="absolute rounded-[3px] border-2 border-brand bg-brand/10 shadow-[0_0_0_9999px_rgba(29,27,23,0.28)]"
      style={{ left: `${x0}%`, top: `${y0}%`, width: `${x1 - x0}%`, height: `${y1 - y0}%` }}
    >
      <span className="absolute -top-5 left-0 whitespace-nowrap rounded-[3px] bg-brand px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-paper">{label}</span>
    </div>
  );
  return (
    <div className="space-y-3">
      {data.image ? (
        <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-[4px] shadow-float">
          <img src={data.image.src} alt={`Photo of ${c.doc.title}`} className="block w-full" />
          {overlay}
        </div>
      ) : (
        <div className="relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-[4px] bg-[radial-gradient(120%_90%_at_30%_20%,#8a6a4c_0%,#6b503a_45%,#4d3a2a_100%)] shadow-float">
          <div className="absolute inset-[9%] -rotate-1 bg-paper p-5 text-zinc-800 shadow-[0_6px_14px_rgba(40,25,10,0.35)]">
            <div className="absolute -top-2 left-1/2 size-3.5 -translate-x-1/2 rounded-full bg-deny shadow" />
            <p className="whitespace-pre-line text-center font-serif text-[11.5px] leading-snug">{ocr?.content}</p>
          </div>
          {overlay}
        </div>
      )}
      {caption && (
        <div className="rounded-xl bg-panel-2/55 p-3.5 text-[12.5px] text-ink-2">
          <ModalityTag modality="caption" />
          <p className="mt-1">{caption.content.replace(/^Vision caption:\s*/, "")}</p>
        </div>
      )}
    </div>
  );
}

function RecordView({ c }: { c: Citation }) {
  const rec = c.chunk.record ?? {};
  const table = c.chunk.rowRef?.replace("db://", "").split(/[/?#]/)[0] ?? "table";
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl bg-paper ring-1 ring-line">
        <div className="flex items-center justify-between border-b border-line bg-panel-2/60 px-3 py-2">
          <span className="truncate font-mono text-xs text-cls-1">{c.chunk.rowRef}</span>
          <span className="text-[10.5px] text-ink-3">record card</span>
        </div>
        <dl className="divide-y divide-line">
          {Object.entries(rec).map(([k, v]) => {
            const masked = String(v).startsWith("••••");
            return (
              <div key={k} className="grid grid-cols-[150px_1fr] gap-3 px-3 py-2 text-[13px]">
                <dt className="truncate font-mono text-[11.5px] text-ink-3">{k}</dt>
                <dd className={masked ? "inline-flex items-center gap-1.5 text-ink-3" : "text-ink"}>
                  {masked && <Lock className="size-3" />}
                  {masked ? "masked by employees_secure view" : String(v)}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
      <pre className="overflow-x-auto rounded-xl bg-panel-2/60 p-3.5 font-mono text-[11px] leading-relaxed text-ink-2">
        <span className="text-ink-3">-- the row behind this card, read as rag_reader under RLS{"\n"}</span>
        <span className="text-brand">SELECT</span> * <span className="text-brand">FROM</span> {table === "employees_secure" ? "employees_secure" : table}
        {"\n"}
        <span className="text-brand">WHERE</span> ref = <span className="text-warn">'{c.chunk.rowRef?.split("/").pop()?.split("#")[0]}'</span>;
      </pre>
    </div>
  );
}

function SqlView({ c }: { c: Citation }) {
  const rows = c.chunk.rows ?? [];
  const cols = c.chunk.columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  return (
    <div className="space-y-3">
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-panel-2/60 p-3.5 font-mono text-[11.5px] leading-relaxed text-ink-2">
        <span className="text-ink-3">-- generated, validated (single SELECT, whitelisted relations) and run read-only as rag_reader{"\n"}</span>
        {c.chunk.sql}
      </pre>
      <div className="overflow-x-auto rounded-xl bg-paper ring-1 ring-line">
        <table className="w-full text-left text-[12.5px]">
          <thead className="border-b border-line bg-panel-2/60 text-[11.5px] text-ink-3">
            <tr>{cols.map((k) => <th key={k} className="px-3 py-2 font-medium">{k}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((k) => (
                  <td key={k} className="px-3 py-1.5 tabular-nums">
                    {r[k] === null ? <span className="inline-flex items-center gap-1 text-ink-3"><Lock className="size-3" /> masked</span> : String(r[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-ink-3">Rows and values come back already filtered by Postgres RLS and the masking view for this identity.</p>
    </div>
  );
}

export function SourceViewer({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const { session } = useSession();
  const c = citation;
  const [data, setData] = useState<SourceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetchSource(c, session!)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof ApiError && e.status === 404 ? "404" : String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [c.chunk.id, session]);

  const shown: Chunk = data?.chunk ? { ...c.chunk, ...data.chunk } : c.chunk;
  const cite = { ...c, chunk: shown };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b border-line p-4">
        <SourceIcon type={c.doc.sourceType} className="mt-0.5 size-5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="grid size-5 place-items-center rounded-[4px] bg-brand-soft font-mono text-[10.5px] font-medium text-brand">{c.n}</span>
            <h3 className="truncate text-[14px] font-medium">{c.doc.title}</h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ClassBadge level={c.doc.classification} />
            <ModalityTag modality={c.chunk.modality} />
            {c.chunk.page && <span className="font-mono text-[10.5px] text-ink-3">page {c.chunk.page}</span>}
            {c.chunk.bbox && <span className="font-mono text-[10.5px] text-ink-3">bbox [{c.chunk.bbox.map((v) => Math.round(v)).join(", ")}]</span>}
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Close source">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {error ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <ShieldOff className="mx-auto size-6 text-deny" />
              <p className="mt-2 text-sm text-ink">{error === "404" ? "Not found" : "Could not open this source"}</p>
              <p className="mt-1 text-[12.5px] text-ink-3">{error === "404" ? "RLS re-checked access and returned nothing." : error}</p>
            </div>
          </div>
        ) : !data ? (
          <div className="grid h-40 place-items-center text-ink-3"><Loader2 className="size-5 animate-spin" /></div>
        ) : (
          <>
            {c.chunk.modality === "sql" && <SqlView c={cite} />}
            {c.chunk.modality !== "sql" && c.doc.sourceType === "pdf" && <PdfPage c={cite} data={data} />}
            {c.doc.sourceType === "image" && <ImageView c={cite} data={data} />}
            {c.chunk.modality === "record" && <RecordView c={cite} />}
            {c.chunk.modality !== "sql" && (
              <div className="mt-4 rounded-xl bg-panel-2/55 p-3.5">
                <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
                  <ScanText className="size-3.5" /> Retrieved chunk
                </div>
                <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{shown.content}</p>
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[11px] text-ink-3">
        <ShieldCheck className="size-3.5 text-brand" />
        {c.chunk.modality === "sql" ? "Computed live by Postgres for this identity." : <>Opened via <span className="font-mono">/source/{c.chunk.id.slice(0, 8)}…</span>; access is re-checked by RLS on every open.</>}
      </div>
    </div>
  );
}
