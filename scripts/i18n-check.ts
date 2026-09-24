// Lists every UI string key and reports which ones are missing from the Russian dictionary.
// Usage: npm run i18n:check  (writes scripts/.out/i18n-missing.json)
import fs from 'node:fs';
import path from 'node:path';
import { RU } from '../src/i18n.ru';
import { UNIT_DEFS } from '../src/data/units';
import { BUILDING_DEFS } from '../src/data/buildings';
import { TECH_DEFS } from '../src/data/techs';
import { WORLD_EVENTS } from '../src/data/events';

const keys = new Set<string>();
const add = (s: string) => s && keys.add(s);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []));
}
const unq = (s: string) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
const uiLike = (s: string) => /^[A-Z<+—]/.test(s) || /\s/.test(s);

for (const file of walk('src')) {
  if (file.endsWith('i18n.ru.ts')) continue;
  const src = fs.readFileSync(file, 'utf8');
  // Direct t('...') calls.
  for (const m of src.matchAll(/\bt(?:r)?\(\s*'((?:[^'\\]|\\.)*)'/g)) add(unq(m[1]));
  // Indirect string tables that are passed through t() at render time.
  for (const m of src.matchAll(/const (TIPS|SIZE_NAMES|TIER_NAMES|MONTHS|TERRAIN_NAMES|RES_NAMES|CONTINENTS|SLIDERS|tagNames|hints|sliders|toggles|rows|filters|cats|layers)\b[^=]*=\s*([\[{][\s\S]*?[\]}]);/g)) {
    for (const q of m[2].matchAll(/'((?:[^'\\]|\\.)*)'/g)) if (uiLike(unq(q[1]))) add(unq(q[1]));
  }
  for (const m of src.matchAll(/sec\(\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'\)/g)) {
    add(unq(m[1]));
    add(unq(m[2]));
  }
  for (const m of src.matchAll(/reason: '((?:[^'\\]|\\.)*)'/g)) add(unq(m[1]));
}
for (const u of UNIT_DEFS) [u.name, u.role, u.desc].forEach(add);
for (const b of BUILDING_DEFS) [b.name, b.desc].forEach(add);
for (const tdef of TECH_DEFS) [tdef.name, tdef.desc].forEach(add);
for (const e of WORLD_EVENTS) add(e.title);
['Easy', 'Normal', 'Hard'].forEach(add);

const all = [...keys].sort();
const missing = all.filter((k) => !(k in RU));
const unused = Object.keys(RU).filter((k) => !keys.has(k));
fs.mkdirSync('scripts/.out', { recursive: true });
fs.writeFileSync('scripts/.out/i18n-missing.json', JSON.stringify(missing, null, 1));
console.log(`keys ${all.length}, translated ${all.length - missing.length}, missing ${missing.length}, unused ${unused.length}`);
if (process.argv.includes('--list')) console.log(missing.join('\n'));
if (process.argv.includes('--unused')) console.log(unused.join('\n'));
