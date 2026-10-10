import { Building2, CircleCheck, CircleX, Database, EyeOff, Fingerprint, KeyRound, Layers, Loader2, Scale, ShieldCheck, UserCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { explainAnswer, type AccessDecision, type Explanation } from "../lib/api";
import { CLASSIFICATION } from "../lib/personas";
import { useSession } from "../lib/session";
import type { Answer, User } from "../lib/types";
import { ClassBadge, Chip, cx } from "./ui";

/** Same rule as acl_check() in Postgres; used only when the app runs without a backend. */
function localDecision(u: User, doc: { classification: number; department: string | null; allowedRoles: string[]; allowedUsers: string[] }): AccessDecision {
  const grant = doc.allowedUsers.includes(u.uid);
  const clearance = doc.classification <= u.clearance;
  const role = u.roles.includes("admin") || doc.allowedRoles.includes("*") || doc.allowedRoles.some((r) => u.roles.includes(r));
  const dept = !doc.department || u.depts.includes(doc.department) || u.depts.includes("*");
  return { allowed: grant || (clearance && role && dept), tenant: true, grant, clearance, role, dept };
}

function Check({ ok, icon: Icon, label, detail }: { ok: boolean; icon: typeof Scale; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md", ok ? "bg-brand-soft text-brand" : "bg-panel-2 text-ink-3")}>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
        <div className="flex items-center gap-1.5 font-medium text-ink">
          {label} {ok ? <CircleCheck className="size-3.5 text-brand" /> : <CircleX className="size-3.5 text-ink-3" />}
        </div>
        <div className="text-ink-3">{detail}</div>
      </div>
    </li>
  );
}

export function ExplainModal({ answer, onClose }: { answer: Answer; onClose: () => void }) {
  const { session } = useSession();
  const [data, setData] = useState<Explanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const u = answer.user;
  const docCites = answer.citations.filter((c) => c.chunk.modality !== "sql");
  const sqlCites = answer.citations.filter((c) => c.chunk.modality === "sql");
  const claim = answer.steps.find((s) => s.key === "claim");

  useEffect(() => {
    let on = true;
    explainAnswer(session!, docCites.map((c) => c.chunk.id))
      .then((d) => on && setData(d))
      .catch((e) => {
        if (!on) return;
        setError((e as Error).message);
        setData({
          identity: { email: u.email, roles: u.roles, depts: u.depts, clearance: u.clearance, department: u.department, source: "this browser's demo session" },
          sources: docCites.map((c) => ({
            chunkId: c.chunk.id, title: c.doc.title, sourceType: c.doc.sourceType, classification: c.doc.classification,
            department: c.doc.department, allowedRoles: c.doc.allowedRoles, grantedUsers: c.doc.allowedUsers.length,
            decision: localDecision(u, c.doc),
          })),
          engine: "computed in the browser with the same rule as acl_check()",
        });
      });
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const id = data?.identity;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div className="fade-up flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-panel shadow-float ring-1 ring-line" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-line p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Scale className="size-4.5" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium">Why this answer?</div>
            <div className="text-[12px] text-ink-3">The access decision behind every source, as the database made it.</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Close"><X className="size-4" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {!data ? (
            <div className="flex items-center gap-2 text-[13px] text-ink-3"><Loader2 className="size-4 animate-spin" /> Asking the database…</div>
          ) : (
            <>
              <section>
                <h3 className="flex items-center gap-1.5 text-[12px] font-medium tracking-[0.08em] text-ink-3 uppercase"><Fingerprint className="size-3.5" /> Who the database thinks you are</h3>
                <div className="mt-2 rounded-xl bg-panel-2/60 p-3">
                  <div className="text-[14px] font-medium">{u.name}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {id!.roles.map((r) => <Chip key={r} tone="brand">{r}</Chip>)}
                    {id!.depts.map((d) => <Chip key={d}>{d === "*" ? "all departments" : `dept ${d}`}</Chip>)}
                    <Chip>clearance {id!.clearance} · {CLASSIFICATION[id!.clearance]}</Chip>
                  </div>
                  <p className="mt-2 text-[12px] text-ink-3">From your {id!.source}. Nothing typed in the question can change it.</p>
                  {claim && (
                    <p className="mt-2 rounded-lg bg-warn/[0.08] px-2.5 py-1.5 text-[12px] text-ink-2 ring-1 ring-warn/25">
                      Your question claimed an identity ({claim.detail.split(" · ")[0]}). It was ignored, and left out of the search.
                    </p>
                  )}
                </div>
              </section>

              {answer.refused ? (
                <section>
                  <h3 className="flex items-center gap-1.5 text-[12px] font-medium tracking-[0.08em] text-ink-3 uppercase"><EyeOff className="size-3.5" /> Why you got a refusal</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                    No source you are allowed to read answers this question. Sources you can't read are never returned by the database, so the
                    system can't tell you whether one exists. The refusal is the same either way, so it leaks nothing.
                  </p>
                </section>
              ) : (
                <section>
                  <h3 className="flex items-center gap-1.5 text-[12px] font-medium tracking-[0.08em] text-ink-3 uppercase"><ShieldCheck className="size-3.5" /> Why you can read each source</h3>
                  <div className="mt-2 space-y-3">
                    {data.sources.map((s) => {
                      const d = s.decision;
                      const roles = s.allowedRoles.includes("*") ? "everyone" : s.allowedRoles.join(", ") || "nobody by role";
                      return (
                        <div key={s.chunkId} className="rounded-xl p-3 ring-1 ring-line">
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{s.title}</span>
                            <ClassBadge level={s.classification} />
                            <Chip tone={d.allowed ? "brand" : "deny"}>{d.allowed ? "allowed" : "denied"}</Chip>
                          </div>
                          <ul className="mt-3 space-y-2">
                            {d.grant ? (
                              <Check ok icon={UserCheck} label="Named on the document" detail="You were given access to this file personally." />
                            ) : (
                              <>
                                <Check ok={d.clearance} icon={Layers} label="Clearance" detail={`Document is ${CLASSIFICATION[s.classification]} (level ${s.classification}); your clearance is level ${id!.clearance}.`} />
                                <Check ok={d.role} icon={KeyRound} label="Role" detail={`Allowed roles: ${roles}. You are ${id!.roles.join(", ")}.`} />
                                <Check ok={d.dept} icon={Building2} label="Department" detail={s.department ? `Belongs to ${s.department}; your scope is ${id!.depts.join(", ")}.` : "Not tied to a department."} />
                              </>
                            )}
                          </ul>
                        </div>
                      );
                    })}
                    {sqlCites.map((c) => (
                      <div key={c.chunk.id} className="rounded-xl p-3 ring-1 ring-line">
                        <div className="flex items-center gap-2 text-[13.5px] font-medium"><Database className="size-4 text-brand" /> {c.doc.title}</div>
                        <p className="mt-1.5 text-[12.5px] text-ink-3">
                          A live query. Each table's row policy filtered the rows to the ones you may see before any were counted
                          ({c.chunk.rows?.length ?? 0} rows returned).
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-xl bg-ink p-3 text-[12.5px] leading-relaxed text-paper/80">
                <span className="font-medium text-paper">What you didn't see:</span> anything you aren't cleared for was filtered inside the vector
                search itself, so it never reached the AI and can't appear here, not even by title.
                <div className="mt-2 font-mono text-[10.5px] text-paper/50">{data.engine}{error ? " · offline fallback" : ""}</div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
