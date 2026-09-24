// Browser QA driver (dev only). Usage:
//   node scripts/browser.mjs <url> <out.png> [script.js]
// The optional script is evaluated step by step: it must export `steps`, an array of
// async (page) => void functions; a screenshot is taken after the last step.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }

const [,, url = 'http://localhost:5173/', out = 'scripts/.out/shot.png', stepsFile] = process.argv;
fs.mkdirSync('scripts/.out', { recursive: true });
const browser = await pw.chromium.launch({ args: process.env.GLARGS ? process.env.GLARGS.split(' ') : [] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url, { waitUntil: 'load' });
if (stepsFile) {
  const mod = await import(new URL('file://' + fs.realpathSync(stepsFile)));
  for (const [i, step] of mod.steps.entries()) {
    const r = await step(page);
    if (r) console.log(`step ${i}:`, typeof r === 'string' ? r : JSON.stringify(r));
  }
} else {
  await page.waitForTimeout(6000);
}
await page.screenshot({ path: out, timeout: 90000 });
console.log(logs.slice(0, 40).join('\n') || 'no console errors');
await browser.close();
