// Localisation. Strings are looked up by their English text, so chapter files, shared constants
// and the server keep authoring (and sending) English; the client translates at display time.
// A missing translation falls back to the English. `npx tsx scripts/i18n.ts` lists the gaps.
//
// Templates use {name} placeholders: t('{who} is down!', { who }). Server feed lines arrive
// already filled in, so `tMsg` matches them against the dictionary's templated keys.
import zhHant from './locales/zh-hant';

export type Lang = 'en' | 'zh-hant';
export const LANGS: { id: Lang; label: string; html: string }[] = [
  { id: 'en', label: 'English', html: 'en' },
  { id: 'zh-hant', label: '繁體中文', html: 'zh-Hant' },
];
export const LOCALES: Record<Exclude<Lang, 'en'>, Record<string, string>> = { 'zh-hant': zhHant };

const STORE = 'chibi.lang';
const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.id === v);

/** `?lang=`, then the saved choice, then the browser: Traditional Chinese for zh-Hant/TW/HK/MO. */
function detect(): Lang {
  if (typeof window === 'undefined') return 'en';
  const q = new URLSearchParams(location.search).get('lang')?.toLowerCase();
  if (isLang(q)) return q;
  try { const s = localStorage.getItem(STORE); if (isLang(s)) return s; } catch { /* storage blocked */ }
  for (const l of navigator.languages ?? [navigator.language]) {
    const v = l.toLowerCase();
    if (/^zh-(hant|tw|hk|mo)\b/.test(v)) return 'zh-hant';
    if (v.startsWith('en')) return 'en';
  }
  return 'en';
}

export const lang: Lang = detect();
const dict: Record<string, string> = lang === 'en' ? {} : LOCALES[lang];

const fill = (s: string, vars?: Record<string, string | number>): string =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

/** Translate English text `en`, filling {placeholders} from `vars`. */
export function t(en: string, vars?: Record<string, string | number>): string {
  return fill(dict[en] ?? en, vars);
}

let templates: { re: RegExp; keys: string[]; out: string }[] | null = null;
/** Translate a finished English line (a server feed message): exact match, else a templated key. */
export function tMsg(text: string): string {
  if (text in dict) return dict[text];
  templates ??= Object.keys(dict).filter((k) => /\{\w+\}/.test(k)).map((k) => {
    const keys: string[] = [];
    const src = k.split(/(\{\w+\})/).map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (m) { keys.push(m[1]); return '(.+?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return { re: new RegExp(`^${src}$`), keys, out: dict[k] };
  });
  for (const tp of templates) {
    const m = tp.re.exec(text);
    if (m) return fill(tp.out, Object.fromEntries(tp.keys.map((k, i) => [k, m[i + 1]])));
  }
  return text;
}

/** Save the choice and reload (the lobby is the only place it can change). */
export function setLang(l: Lang): void {
  try { localStorage.setItem(STORE, l); } catch { /* storage blocked */ }
  const u = new URL(location.href);
  u.searchParams.delete('lang');
  location.replace(u.href);
}

/** Translate the static page: every text node, plus `title` and `placeholder` attributes. */
export function translatePage(): void {
  document.documentElement.lang = LANGS.find((l) => l.id === lang)!.html;
  if (lang === 'en') return;
  document.title = t(document.title);
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const raw = n.nodeValue ?? '', key = raw.trim();
    if (key && key in dict) n.nodeValue = raw.replace(key, dict[key]);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[title], [placeholder]')) {
    for (const a of ['title', 'placeholder']) { const v = el.getAttribute(a); if (v && v in dict) el.setAttribute(a, dict[v]); }
  }
}
