import { Check, Loader2, Lock, Minus } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchMatrix, type AccessMatrix as Matrix, type AclExplain } from "../lib/api";
import { useSession } from "../lib/session";
import { Avatar, ClassBadge, cx } from "./ui";

const CONDITIONS: [keyof AclExplain, string][] = [
  ["tenant", "same tenant"],
  ["clearance", "clearance ≥ classification"],
  ["role", "role allowed"],
  ["dept", "department in scope"],
  ["grant", "explicit user grant"],
];

function why(e: AclExplain, locked: boolean): string {
  if (locked) return "Account locked: app_ctx() resolves to NULL, so every policy denies.";
  const lines = CONDITIONS.map(([k, label]) => `${e[k] ? "✓" : "✗"} ${label}`);
  return `${e.allowed ? "ALLOWED" : "DENIED"} by acl_check()\n${lines.join("\n")}`;
}

/** Every identity × every document, decided by the same SQL function the RLS policies call. */
export function AccessMatrix() {
  const { session } = useSession();
  const [m, setM] = useState<Matrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ u: string; d: string } | null>(null);

  useEffect(() => {
    fetchMatrix(session!).then(setM).catch((e) => setError((e as Error).message));
  }, [session]);

  if (error) return <div className="rounded-xl bg-deny/10 px-4 py-3 text-[13px] text-deny">{error}</div>;
  if (!m) return <div className="grid h-48 place-items-center text-ink-3"><Loader2 className="size-5 animate-spin" /></div>;

  const hoverUser = hover ? m.users.find((u) => u.id === hover.u) : null;
  const hoverDoc = hover ? m.documents.find((d) => d.id === hover.d) : null;
  const hoverCell = hover ? m.cells[hover.u]?.[hover.d] : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-3">
        <span>Computed live by <span className="font-mono text-ink-2">{m.source}</span>. Hover a cell to see why.</span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><span className="grid size-4 place-items-center rounded bg-brand text-paper"><Check className="size-3" /></span> can read</span>
          <span className="inline-flex items-center gap-1.5"><span className="grid size-4 place-items-center rounded bg-panel-2 text-ink-3"><Minus className="size-3" /></span> invisible</span>
        </span>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-panel shadow-card ring-1 ring-line/70">
        <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left text-[12.5px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-56 border-b border-line bg-panel px-3 py-2 align-bottom font-medium text-ink-3">Identity</th>
              {m.documents.map((d) => (
                <th key={d.id} className={cx("border-b border-line px-1 pb-2 align-bottom", hover?.d === d.id && "bg-brand-soft/40")}>
                  <div className="flex flex-col items-center gap-1">
                    <ClassBadge level={d.classification} compact />
                    <span className="block max-w-[92px] text-center text-[11px] leading-tight font-normal text-ink-2" title={d.title}>
                      {d.title.replace(/\.(pdf|jpe?g|png)$/i, "").replace(/ FY 2026-27| 2026-27| 2025-26/g, "")}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.users.map((u) => (
              <tr key={u.id} className={cx(hover?.u === u.id && "bg-brand-soft/30")}>
                <td className="sticky left-0 z-10 border-b border-line bg-panel px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <Avatar name={u.name} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 truncate text-[12.5px]">{u.name}{u.locked && <Lock className="size-3 text-deny" />}</div>
                      <div className="truncate text-[11px] text-ink-3">{u.roles.join(", ")} · {u.depts.join(",")}</div>
                    </div>
                    <span className="ml-auto"><ClassBadge level={u.clearance} compact /></span>
                  </div>
                </td>
                {m.documents.map((d) => {
                  const e = m.cells[u.id]?.[d.id];
                  const ok = !!e?.allowed && !u.locked;
                  return (
                    <td key={d.id} className="border-b border-line px-1 py-1.5 text-center">
                      <button
                        onMouseEnter={() => setHover({ u: u.id, d: d.id })}
                        onFocus={() => setHover({ u: u.id, d: d.id })}
                        title={e ? why(e, u.locked) : ""}
                        className={cx(
                          "mx-auto grid size-7 place-items-center rounded-lg transition-transform duration-150 hover:scale-110",
                          ok ? "bg-brand text-paper" : "bg-panel-2 text-ink-3",
                        )}
                        aria-label={`${u.name} · ${d.title}: ${ok ? "can read" : "invisible"}`}
                      >
                        {ok ? <Check className="size-3.5" /> : <Minus className="size-3.5" />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hoverUser && hoverDoc && hoverCell && (
        <div className="fade-up flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-panel-2/60 px-3 py-2 text-[12px] ring-1 ring-line">
          <span className="font-medium">{hoverUser.name} → {hoverDoc.title}</span>
          <span className={hoverCell.allowed && !hoverUser.locked ? "text-brand" : "text-deny"}>
            {hoverUser.locked ? "denied: account locked" : hoverCell.allowed ? "allowed" : "denied"}
          </span>
          {CONDITIONS.map(([k, label]) => (
            <span key={k} className={cx("font-mono text-[11px]", hoverCell[k] ? "text-ink-2" : "text-ink-3 line-through")}>{label}</span>
          ))}
        </div>
      )}
    </div>
  );
}
