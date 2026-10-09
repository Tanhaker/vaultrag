import { BadgeCheck, Download, FileSignature, Loader2, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { verifyReceipt, type ReceiptCheck } from "../lib/api";
import { useSession } from "../lib/session";
import type { Answer } from "../lib/types";
import { Button, Chip, cx } from "./ui";

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

const STATUS: Record<string, { tone: "brand" | "deny" | "warn" | "default"; label: string }> = {
  unchanged: { tone: "brand", label: "source unchanged" },
  changed: { tone: "deny", label: "source changed since" },
  "not-visible": { tone: "warn", label: "not visible to you" },
  "live-query": { tone: "default", label: "signed query result" },
};

/** Tamper test: change the first figure in the answer, the way someone editing a screenshot might. */
function tamper(text: string): string {
  return text.replace(/\d+(\.\d+)?/, (m) => String(Number(m) + (m.includes(".") ? 1.5 : 7)));
}

export function ReceiptModal({ answer, onClose }: { answer: Answer; onClose: () => void }) {
  const { session } = useSession();
  const receipt = answer.receipt!;
  const kept = answer.sentences.filter((s) => !s.removed).map((s) => s.text);
  const [check, setCheck] = useState<ReceiptCheck | null>(null);
  const [tampered, setTampered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = tampered ? kept.map((t, i) => (i === 0 ? tamper(t) : t)) : kept;

  async function run(sentences: string[]) {
    setBusy(true);
    setError(null);
    try {
      setCheck(await verifyReceipt(session!, receipt, sentences));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vaultrag-receipt-${receipt.answer_id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const verdictTone = check ? (check.verdict === "valid" ? "brand" : "deny") : null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div className="fade-up flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-panel shadow-float ring-1 ring-line" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-line p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><FileSignature className="size-4.5" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium">Answer receipt</div>
            <div className="text-[12px] text-ink-3">Signed by the server when the answer was issued. Anyone can check it later.</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Close"><X className="size-4" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-[11.5px]">
            <dt className="text-ink-3">issued</dt><dd className="text-ink-2">{receipt.issued_at.replace("T", " ").replace("+00:00", " UTC")}</dd>
            <dt className="text-ink-3">mode</dt><dd className="text-ink-2">{receipt.mode}{receipt.model ? ` · ${receipt.model}` : ""}</dd>
            <dt className="text-ink-3">data version</dt><dd className="text-ink-2">v{receipt.kb_version ?? "–"}</dd>
            <dt className="text-ink-3">question</dt><dd className="text-ink-2">sha256 {short(receipt.question_sha256)}</dd>
            <dt className="text-ink-3">answer</dt><dd className="text-ink-2">sha256 {short(receipt.answer_sha256)}</dd>
            <dt className="text-ink-3">signature</dt><dd className="break-all text-brand">hmac-sha256 {short(receipt.sig)}</dd>
          </dl>

          {receipt.citations.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[12px] font-medium text-ink-3">Sources, by content hash</div>
              {receipt.citations.map((c) => {
                const st = check?.sources.find((s) => s.n === c.n);
                return (
                  <div key={c.n} className="flex items-center gap-2.5 rounded-lg bg-paper px-3 py-2 ring-1 ring-line">
                    <span className="w-4 font-mono text-[11px] text-brand">{c.n}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px]">{c.title}</div>
                      <div className="font-mono text-[10.5px] text-ink-3">sha256 {short(c.content_sha256)}</div>
                    </div>
                    {st && <Chip tone={STATUS[st.status].tone}>{STATUS[st.status].label}</Chip>}
                  </div>
                );
              })}
            </div>
          )}

          <div className="rounded-xl bg-panel-2/55 p-3 ring-1 ring-line/60">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-3">Answer text being checked</span>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
                <input type="checkbox" checked={tampered} onChange={(e) => { setTampered(e.target.checked); setCheck(null); }} className="accent-[var(--color-deny)]" />
                Tamper test: alter a figure
              </label>
            </div>
            <p className={cx("text-[13px] leading-relaxed", tampered ? "text-deny" : "text-ink-2")}>{shown.join(" ")}</p>
          </div>

          {check && (
            <div className={cx("fade-up flex gap-3 rounded-xl p-3 ring-1", verdictTone === "brand" ? "bg-brand-soft/60 ring-brand/30" : "bg-deny/[0.07] ring-deny/30")}>
              {check.verdict === "valid" ? <ShieldCheck className="size-5 shrink-0 text-brand" /> : <ShieldAlert className="size-5 shrink-0 text-deny" />}
              <div className="space-y-1 text-[12.5px]">
                <div className="font-medium">
                  {check.verdict === "valid" ? "Receipt valid: this is exactly what VaultRAG answered, and its sources still say the same."
                    : check.verdict === "forged" ? "Signature invalid: the receipt was edited."
                    : "Mismatch: the answer or a source differs from what was signed."}
                </div>
                <div className="flex flex-wrap gap-x-4 font-mono text-[11px] text-ink-3">
                  <span>signature {check.signature ? "✓ genuine" : "✗ invalid"}</span>
                  {check.answerMatches !== null && <span>answer text {check.answerMatches ? "✓ matches" : "✗ altered"}</span>}
                </div>
              </div>
            </div>
          )}
          {error && <div className="rounded-lg bg-deny/10 px-3 py-2 text-[12.5px] text-deny">{error}</div>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-4">
          <Button variant="ghost" onClick={download}><Download className="size-4" /> Download JSON</Button>
          <Button onClick={() => run(shown)} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />} Verify against live sources
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
