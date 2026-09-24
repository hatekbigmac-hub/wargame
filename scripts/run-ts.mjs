// Bundle a TS script with esbuild (shipped with Vite) and run it in Node.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
const [,, entry, ...args] = process.argv;
const out = 'scripts/.out/' + entry.replace(/[\/.]/g, '_') + '.mjs';
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning' });
const r = spawnSync(process.execPath, [out, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
