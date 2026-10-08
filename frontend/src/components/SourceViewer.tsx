import { Lock, ScanText, ShieldCheck, X } from "lucide-react";
import { CHUNKS, PAGE_FILLER } from "../lib/corpus";
import type { Citation } from "../lib/types";
import { ClassBadge, ModalityTag, SourceIcon } from "./ui";

function TableBlock({ content }: { content: string }) {
  const [head, ...rows] = content.split("\n").map((l) => l.split("|").map((c) => c.trim()));
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-zinc-400/60">
          {head.map((h) => (
            <th key={h} className="py-1 text-left font-semibold">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={i === rows.length - 1 ? "border-t border-zinc-400/60 font-semibold" : ""}>
            {r.map((c, j) => (
              <td key={j} className={j ? "py-0.5 text-right tabular-nums" : "py-0.5"}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PdfPage({ c }: { c: Citation }) {
  const page = c.chunk.page ?? 1;
  const blocks = CHUNKS.filter((k) => k.docId === c.doc.id && (k.page ?? 1) === page);
  const [meta, intro] = PAGE_FILLER[c.doc.id] ?? ["", ""];
  const scanned = c.chunk.modality === "ocr";
  return (
    <div className="relative mx-auto aspect-[1/1.32] w-full max-w-md overflow-hidden rounded-[4px] bg-paper p-7 text-zinc-800 shadow-float ring-1 ring-line" style={scanned ? { filter: "contrast(0.95) sepia(0.15)" } : undefined}>
      <div className="flex justify-between font-mono text-[9px] tracking-wide text-zinc-500">
        <span>{meta}</span>
        <span>p. {page}</span>
      </div>
      <div className="mt-4 space-y-3 text-[12px] leading-relaxed">
        <p className="text-zinc-600">{intro}</p>
        {blocks.map((b) => {
          const hit = b.id === c.chunk.id;
          return (
            <div key={b.id} className={hit ? "relative -mx-2 rounded-[3px] bg-mark/70 px-2 py-1 ring-[1.5px] ring-warn/70" : ""}>
              {hit && (
                <span className="absolute -top-2.5 right-1 rounded-[3px] bg-warn px-1.5 font-mono text-[9px] font-medium text-paper">
                  cited as {c.n}
                </span>
              )}
              {b.modality === "table" ? <TableBlock content={b.content} /> : <p>{b.content}</p>}
            </div>
          );
        })}
        {[92, 78, 85, 64, 88, 71].map((w, i) => (
          <div key={i} className="h-2 rounded bg-zinc-300/70" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

function ImageView({ c }: { c: Citation }) {
  const caption = CHUNKS.find((k) => k.docId === c.doc.id && k.modality === "caption");
  const ocr = c.chunk.modality === "ocr" ? c.chunk : CHUNKS.find((k) => k.docId === c.doc.id && k.modality === "ocr");
  const [x0, y0, x1, y1] = ocr?.bbox ?? [10, 20, 90, 70];
  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-[4px] bg-[radial-gradient(120%_90%_at_30%_20%,#8a6a4c_0%,#6b503a_45%,#4d3a2a_100%)] shadow-float">
        <div className="absolute inset-[9%] -rotate-1 bg-paper p-5 text-zinc-800 shadow-[0_6px_14px_rgba(40,25,10,0.35)]">
          <div className="absolute -top-2 left-1/2 size-3.5 -translate-x-1/2 rounded-full bg-deny shadow" />
          <p className="whitespace-pre-line text-center font-serif text-[11.5px] leading-snug">{ocr?.content}</p>
        </div>
        <div
          className="absolute rounded-[3px] border-2 border-brand bg-brand/10 shadow-[0_0_0_9999px_rgba(29,27,23,0.28)]"
          style={{ left: `${x0}%`, top: `${y0}%`, width: `${x1 - x0}%`, height: `${y1 - y0}%` }}
        >
          <span className="absolute -top-5 left-0 rounded-[3px] bg-brand px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-paper">
            OCR region · conf {Math.round((ocr?.ocrConfidence ?? 0.9) * 100)}%
          </span>
        </div>
      </div>
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
          <span className="font-mono text-xs text-cls-1">{c.chunk.rowRef}</span>
          <span className="text-[10.5px] text-ink-3">1 row</span>
        </div>
        <dl className="divide-y divide-line">
          {Object.entries(rec).map(([k, v]) => {
            const masked = v.startsWith("••••");
            return (
              <div key={k} className="grid grid-cols-[150px_1fr] gap-3 px-3 py-2 text-[13px]">
                <dt className="font-mono text-[11.5px] text-ink-3">{k}</dt>
                <dd className={masked ? "inline-flex items-center gap-1.5 text-ink-3" : "text-ink"}>
                  {masked && <Lock className="size-3" />}
                  {masked ? "masked by employees_secure view" : v}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
      <pre className="overflow-x-auto rounded-xl bg-panel-2/60 p-3.5 font-mono text-[11px] leading-relaxed text-ink-2">
        <span className="text-ink-3">-- executed as rag_reader, filtered by RLS{"\n"}</span>
        <span className="text-brand">SELECT</span> * <span className="text-brand">FROM</span> {table}
        {c.chunk.rowRef?.includes("group_by") ? (
          <>
            {"\n"}
            <span className="text-brand">GROUP BY</span> status;
          </>
        ) : (
          <>
            {"\n"}
            <span className="text-brand">WHERE</span> ref = <span className="text-warn">'{c.chunk.rowRef?.split("/").pop()}'</span>;
          </>
        )}
      </pre>
    </div>
  );
}

export function SourceViewer({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const c = citation;
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
            {c.chunk.bbox && <span className="font-mono text-[10.5px] text-ink-3">bbox [{c.chunk.bbox.join(", ")}]</span>}
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Close source">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {c.doc.sourceType === "pdf" && <PdfPage c={c} />}
        {c.doc.sourceType === "image" && <ImageView c={c} />}
        {c.doc.sourceType === "db_record" && <RecordView c={c} />}

        <div className="mt-4 rounded-xl bg-panel-2/55 p-3.5">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
            <ScanText className="size-3.5" /> Retrieved chunk
          </div>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{c.chunk.content}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[11px] text-ink-3">
        <ShieldCheck className="size-3.5 text-brand" />
        Opened via <span className="font-mono">/source/{c.chunk.id}</span>. Access is re-checked by RLS on every open.
      </div>
    </div>
  );
}
