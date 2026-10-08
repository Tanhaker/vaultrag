import { Database, FileText, Image as ImageIcon, ScanText, Table2, Type } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { CLASSIFICATION, initials } from "../lib/personas";
import type { Modality, SourceType } from "../lib/types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const CLS_STYLE = [
  "text-cls-0 border-cls-0/40",
  "text-cls-1 border-cls-1/45",
  "text-cls-2 border-cls-2/55 bg-cls-2/[0.06]",
  "text-cls-3 border-cls-3/60 bg-cls-3/[0.06]",
];

/** Classification rendered as a document stamp, the way it appears on paper records. */
export function ClassBadge({ level, compact }: { level: number; compact?: boolean }) {
  return (
    <span
      title={`${CLASSIFICATION[level]} (level ${level})`}
      className={cx(
        "inline-flex shrink-0 items-center rounded-[3px] border px-1.5 py-px font-mono text-[9.5px] font-medium uppercase leading-[15px] tracking-[0.12em]",
        CLS_STYLE[level],
      )}
    >
      {compact ? `L${level}` : CLASSIFICATION[level]}
    </span>
  );
}

export function Chip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "brand" | "deny" | "warn" }) {
  const tones = {
    default: "bg-panel-2/70 text-ink-2",
    brand: "bg-brand-soft text-brand",
    deny: "bg-deny/10 text-deny",
    warn: "bg-warn/10 text-warn",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium", tones[tone])}>{children}</span>;
}

export function Avatar({ name, size = "md" }: { name: string; email?: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "size-6 text-[10px] rounded-[7px]", md: "size-8 text-[11.5px] rounded-[9px]", lg: "size-11 text-sm rounded-xl" };
  return (
    <span className={cx("inline-grid shrink-0 place-items-center bg-ink font-medium tracking-wide text-paper", sizes[size])}>
      {initials(name)}
    </span>
  );
}

export function SourceIcon({ type, className = "size-4" }: { type: SourceType; className?: string }) {
  if (type === "pdf") return <FileText className={cx(className, "text-ink-2")} />;
  if (type === "image") return <ImageIcon className={cx(className, "text-ink-2")} />;
  return <Database className={cx(className, "text-ink-2")} />;
}

export function ModalityTag({ modality }: { modality: Modality }) {
  const map: Record<Modality, [ReactNode, string]> = {
    text: [<Type key="i" className="size-3" />, "text"],
    table: [<Table2 key="i" className="size-3" />, "table"],
    ocr: [<ScanText key="i" className="size-3" />, "OCR"],
    caption: [<ImageIcon key="i" className="size-3" />, "vision caption"],
    record: [<Database key="i" className="size-3" />, "DB row"],
  };
  const [icon, label] = map[modality];
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-ink-3">
      {icon}
      {label}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl bg-panel shadow-card ring-1 ring-line/70", className)}>{children}</div>;
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" }) {
  const v = {
    primary: "bg-brand text-paper shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_1px_2px_rgba(26,63,47,0.35)] hover:bg-brand-2 disabled:bg-line-2 disabled:text-ink-3 disabled:shadow-none",
    ghost: "text-ink-2 hover:bg-panel-2 hover:text-ink",
    outline: "bg-panel text-ink-2 ring-1 ring-line-2 hover:text-ink hover:ring-ink-3",
  };
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] px-3.5 py-2 text-[13.5px] font-medium transition-[background-color,color,box-shadow,transform] duration-200 disabled:cursor-not-allowed",
        v[variant],
        className,
      )}
    />
  );
}

export function SectionTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-1.5 font-display text-[17px] italic text-ink-3">{eyebrow}</div>}
        <h1 className="font-display text-[34px] leading-[1.02] tracking-[-0.01em] text-ink sm:text-[42px]">{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "brand" | "deny" }) {
  return (
    <Card className="px-5 pt-4 pb-5">
      <div className="text-[12.5px] text-ink-3">{label}</div>
      <div className={cx("mt-1.5 font-display text-[40px] leading-none tabular-nums", tone === "brand" && "text-brand", tone === "deny" && "text-deny")}>
        {value}
      </div>
      {hint && <div className="mt-2 text-[12px] text-ink-3">{hint}</div>}
    </Card>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-line text-[12px] font-medium text-ink-3">{children}</thead>;
}
