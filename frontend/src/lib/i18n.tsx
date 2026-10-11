// Interface translation (English · ગુજરાતી · हिंदी) without touching every component.
//
// The site is written in English. When another language is chosen, a walker swaps visible text nodes and
// a few attributes (placeholder, title, aria-label) for their translation, and a MutationObserver keeps
// doing so as pages render. Lookups ignore numbers ("You can see 4 documents" matches "You can see #
// documents"), so dynamic counts still translate. Anything inside translate="no" (answers, questions,
// names, document titles, data, code) is left exactly as it is. Switching back restores the originals.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type UiLang = "en" | "gu" | "hi";
export const UI_LANGS: { code: UiLang; label: string; short: string }[] = [
  { code: "en", label: "English", short: "EN" },
  { code: "gu", label: "ગુજરાતી", short: "ગુ" },
  { code: "hi", label: "हिंदी", short: "हि" },
];
const KEY = "defrag.ui-lang";
/** Off until the Gujarati and Hindi dictionaries are complete: no switcher, English only. */
export const I18N_READY = false;
type Dict = Record<string, string>;

const NUM = /\d+(?:[.,]\d+)*/g;
const keyOf = (s: string) => s.replace(/\s+/g, " ").trim().replace(NUM, "#");

function translate(text: string, dict: Dict): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed || !/[A-Za-z]/.test(trimmed)) return null;
  const hit = dict[keyOf(trimmed)];
  if (!hit) return null;
  const nums = trimmed.match(NUM) ?? [];
  let i = 0;
  const out = hit.replace(/#/g, () => nums[i++] ?? "#");
  const lead = text.match(/^\s*/)![0], tail = text.match(/\s*$/)![0];
  return lead + out + tail;
}

// original English text, and the value this module last wrote (so a React update is told apart from ours)
const originals = new WeakMap<Node, string>();
const written = new WeakMap<Node, string>();
const attrOriginals = new WeakMap<Element, Record<string, string>>();
const attrWritten = new WeakMap<Element, Record<string, string>>();
const ATTRS = ["placeholder", "title", "aria-label"];

function skip(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (e.getAttribute?.("translate") === "no") return true;
    const tag = e.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "CODE" || tag === "PRE" || tag === "TEXTAREA" || tag === "svg") return true;
  }
  return false;
}

function applyNode(node: Node, dict: Dict | null) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || skip(parent)) return;
    const current = node.nodeValue ?? "";
    const known = originals.get(node);
    // Unchanged since we last wrote it: keep the stored original. Otherwise React rendered new English text.
    const original = known !== undefined && written.get(node) === current ? known : current;
    originals.set(node, original);
    const next = dict ? translate(original, dict) ?? original : original;
    written.set(node, next);
    if (next !== current) node.nodeValue = next;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (skip(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v == null) continue;
    const store = attrOriginals.get(el) ?? {};
    const wrote = attrWritten.get(el) ?? {};
    const original = store[a] !== undefined && wrote[a] === v ? store[a] : v;
    store[a] = original;
    attrOriginals.set(el, store);
    const next = dict ? translate(original, dict) ?? original : original;
    wrote[a] = next;
    attrWritten.set(el, wrote);
    if (next !== v) el.setAttribute(a, next);
  }
  el.childNodes.forEach((c) => applyNode(c, dict));
}

const loaders: Record<Exclude<UiLang, "en">, () => Promise<{ default: Dict }>> = {
  gu: () => import("../i18n/gu.json"),
  hi: () => import("../i18n/hi.json"),
};

function normalise(raw: Dict): Dict {
  const out: Dict = {};
  for (const [k, v] of Object.entries(raw)) out[keyOf(k)] = v;
  return out;
}

const Ctx = createContext<{ lang: UiLang; setLang: (l: UiLang) => void }>({ lang: "en", setLang: () => {} });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLang>(() => {
    try {
      if (!I18N_READY) return "en";
      const v = localStorage.getItem(KEY) as UiLang | null;
      return v && UI_LANGS.some((l) => l.code === v) ? v : "en";
    } catch {
      return "en";
    }
  });
  const [dict, setDict] = useState<Dict | null>(null);

  useEffect(() => {
    let on = true;
    document.documentElement.lang = lang === "en" ? "en" : lang;
    document.documentElement.dataset.uiLang = lang;
    if (lang === "en") {
      setDict(null);
      return;
    }
    loaders[lang]().then((m) => on && setDict(normalise(m.default)));
    return () => {
      on = false;
    };
  }, [lang]);

  useEffect(() => {
    const root = document.body;
    applyNode(root, dict);
    let queued = false;
    const pending = new Set<Node>();
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") pending.add(m.target);
        else if (m.type === "attributes") pending.add(m.target);
        else m.addedNodes.forEach((n) => pending.add(n));
      }
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        mo.disconnect();
        pending.forEach((n) => n.isConnected && applyNode(n, dict));
        pending.clear();
        mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
      });
    });
    mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    return () => mo.disconnect();
  }, [dict]);

  const setLang = (l: UiLang) => {
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* not remembered */
    }
    setLangState(l);
  };
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export const useUiLang = () => useContext(Ctx);

/** EN · ગુ · हि switcher. `dark` for use over the story page's dark bars. */
export function LangSwitch({ dark, className = "" }: { dark?: boolean; className?: string }) {
  const { lang, setLang } = useUiLang();
  if (!I18N_READY) return null;
  return (
    <div translate="no" role="radiogroup" aria-label="Website language"
         className={`inline-flex shrink-0 rounded-full p-0.5 text-[12px] ring-1 ${dark ? "ring-paper/25" : "ring-line-2"} ${className}`}>
      {UI_LANGS.map((l) => (
        <button key={l.code} type="button" role="radio" aria-checked={lang === l.code} title={l.label} onClick={() => setLang(l.code)}
                className={`rounded-full px-2 py-0.5 transition-colors ${lang === l.code
                  ? dark ? "bg-paper text-ink" : "bg-ink text-paper"
                  : dark ? "text-paper/70 hover:text-paper" : "text-ink-3 hover:text-ink"}`}>
          {l.short}
        </button>
      ))}
    </div>
  );
}
