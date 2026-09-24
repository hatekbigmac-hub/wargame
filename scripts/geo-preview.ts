import { WorldGeo } from '../src/map/WorldGeo';
import { COLS, ROWS } from '../src/config';
// @ts-ignore
import { writePNG } from './png.mjs';
const t0 = Date.now();
const g = WorldGeo.build();
console.log('build ms', Date.now() - t0, 'cities', g.cities.length, 'bodies', g.bodySize.length, 'largest', Math.max(...g.bodySize));
const S = 3;
const rgb = new Uint8Array(COLS * S * ROWS * S * 3);
const tc = [[30,60,110],[120,160,80],[60,110,60],[30,90,40],[220,200,140],[140,120,100],[230,235,240]];
const hue = (r: number) => [(r * 97) % 200 + 40, (r * 57) % 200 + 40, (r * 151) % 200 + 40];
const mode = process.argv[2] || 'terrain';
for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
  const i = cy * COLS + cx;
  let c = tc[g.terrain[i]];
  if (!g.land[i] && !g.isNavigable(i)) c = [80, 100, 160];
  if (mode === 'region' && g.land[i]) c = hue(g.region[i]);
  for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
    const p = ((cy * S + sy) * COLS * S + cx * S + sx) * 3;
    rgb[p] = c[0]; rgb[p + 1] = c[1]; rgb[p + 2] = c[2];
  }
}
for (const c of g.cities) {
  const cx = Math.floor(c.x / 16), cy = Math.floor(c.y / 16);
  for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
    const p = ((cy * S + sy) * COLS * S + cx * S + sx) * 3;
    rgb[p] = 255; rgb[p + 1] = c.port ? 0 : 255; rgb[p + 2] = 0;
  }
}
writePNG(`scripts/.out/geo-${mode}.png`, COLS * S, ROWS * S, rgb);
const lost = g.cities.filter(c => c.def.port && !c.port).map(c => c.def.name);
console.log('ports lost:', lost.join(', ') || 'none');
