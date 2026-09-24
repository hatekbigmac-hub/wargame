// Small DOM helpers for the HTML overlay UI.
import type { Cost, ResKey, Resources } from '../core/types';
import { RES_ICON } from './icons';
import { START_DATE } from '../config';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function fmt(n: number): string {
  const a = Math.abs(n);
  if (a >= 100000) return `${(n / 1000).toFixed(0)}k`;
  if (a >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return Math.floor(n).toLocaleString('en-US');
}

export function fmtRate(n: number): string {
  const s = Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1);
  return `${n >= 0 ? '+' : ''}${s}`;
}

export function costHtml(cost: Cost, have?: Resources): string {
  return Object.entries(cost)
    .filter(([, v]) => (v as number) > 0)
    .map(([k, v]) => {
      const short = have && have[k as ResKey] < (v as number);
      return `<span class="${short ? 'bad' : ''}">${RES_ICON[k] ?? ''}${Math.round(v as number)}</span>`;
    })
    .join(' ');
}

export function hpClass(r: number): string {
  return r > 0.6 ? 'hp' : r > 0.3 ? 'hp mid' : 'hp low';
}

export function bar(ratio: number, cls = 'hp'): string {
  return `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, ratio * 100)).toFixed(1)}%"></i></div>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function gameDate(hours: number): { date: string; time: string; day: number } {
  const d = new Date(START_DATE + hours * 3600 * 1000);
  return {
    date: `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    time: `${String(d.getUTCHours()).padStart(2, '0')}:00`,
    day: Math.floor(hours / 24) + 1,
  };
}

export function colorCss(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** Attach a delegated click handler for [data-a] elements inside root. */
export function delegate(root: HTMLElement, handler: (action: string, value: string, el: HTMLElement, ev: MouseEvent) => void): void {
  root.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!t || !root.contains(t) || t.classList.contains('disabled') || (t as HTMLButtonElement).disabled) return;
    handler(t.dataset.a!, t.dataset.v ?? '', t, ev);
  });
}

/**
 * Patch `target` to match `html` in place, preserving existing elements where the
 * structure matches. Prevents buttons being replaced mid-click during live refreshes.
 */
export function morph(target: HTMLElement, html: string): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(target, tpl.content);
}

function patchChildren(cur: Node, next: Node): void {
  const want = next.childNodes;
  let i = 0;
  for (; i < want.length; i++) {
    const x = cur.childNodes[i];
    const y = want[i];
    if (!x) cur.appendChild(y.cloneNode(true));
    else patchNode(cur, x, y);
  }
  while (cur.childNodes.length > want.length) cur.removeChild(cur.lastChild!);
}

function patchNode(parent: Node, x: Node, y: Node): void {
  if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) {
    parent.replaceChild(y.cloneNode(true), x);
    return;
  }
  if (x.nodeType === Node.TEXT_NODE || x.nodeType === Node.COMMENT_NODE) {
    if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
    return;
  }
  if (x.nodeType !== Node.ELEMENT_NODE) return;
  const xe = x as Element;
  const ye = y as Element;
  for (const a of Array.from(xe.attributes)) if (!ye.hasAttribute(a.name)) xe.removeAttribute(a.name);
  for (const a of Array.from(ye.attributes)) if (xe.getAttribute(a.name) !== a.value) xe.setAttribute(a.name, a.value);
  if (xe.tagName === 'svg') {
    if (xe.innerHTML !== ye.innerHTML) xe.innerHTML = ye.innerHTML;
    return;
  }
  patchChildren(xe, ye);
}
