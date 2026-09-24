// npm run simtest -- [hours]
import { spawnSync } from 'node:child_process';
const r = spawnSync(process.execPath, ['scripts/run-ts.mjs', 'scripts/simtest.ts', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
