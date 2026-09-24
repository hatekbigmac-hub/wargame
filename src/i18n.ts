// Lightweight localisation. English strings are the keys; other languages map them.
// t('Hello {name}', { name }) interpolates {placeholders}.
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

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = lang === 'ru' ? RU[key] ?? key : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Pick the localised variant of a data name ({ name, ru }). */
export function tn(o: { name: string; ru?: string }): string {
  return lang === 'ru' && o.ru ? o.ru : o.name;
}
