// Lightweight localisation. English strings are the keys; other languages map them.
// t("Hello {name}", { name }) interpolates {placeholders}.
import { RU } from './i18n.ru';

export type Lang = 'en' | 'ru';

let lang: Lang = 'en';
const listeners: (() => void)[] = [];

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  for (const fn of listeners) fn();
}

export function getLang(): Lang {
  return lang;
}

export function onLangChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** Keys looked up in Russian without a translation (dev builds only; read by QA scripts). */
const missing: Set<string> | null = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ? new Set() : null;
if (missing) (globalThis as Record<string, unknown>).__i18nMissing = missing;

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = key;
  if (lang === 'ru') {
    const tr = RU[key];
    if (tr !== undefined) s = tr;
    else if (missing && key) missing.add(key);
  }
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Pick the localised variant of a data name ({ name, ru }). */
export function tn(o: { name: string; ru?: string }): string {
  return lang === 'ru' && o.ru ? o.ru : o.name;
}
