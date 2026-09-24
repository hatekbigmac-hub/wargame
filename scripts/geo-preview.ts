import { WorldGeo } from '../src/map/WorldGeo';
import { COLS, ROWS } from '../src/config';
// @ts-ignore
import { writePNG } from './png.mjs';
const t0 = Date.now();
const g = WorldGeo.build();
console.log('build ms', Date.now() - t0, 'cities', g.cities.length, 'countries', g.countryIds.length, 'ports', g.cities.filter(c => c.port).length);
const S = 3;
const rgb = new Uint8Array(COLS * S * ROWS * S * 3);
const pal = [[217,100,79],[227,155,63],[224,194,74],[156,198,83],[79,179,107],[63,179,166],[76,159,217],[90,116,214],[139,103,209],[192,100,184],[217,115,143],[176,138,90]];
const mode = process.argv[2] || 'country';
for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
  const i = cy * COLS + cx;
  let c = [25, 50, 95];
  if (g.bridge[i]) c = [255, 255, 255];
  else if (!g.land[i] && !g.isNavigable(i)) c = [60, 80, 140];
  if (g.land[i]) {
    const k = mode === 'region' ? g.region[i] * 7 : g.cellCountry[i] * 5;
    c = pal[((k % 12) + 12) % 12];
    const nbR = cx < COLS - 1 && g.cellCountry[i + 1] !== g.cellCountry[i];
    const nbD = cy < ROWS - 1 && g.cellCountry[i + COLS] !== g.cellCountry[i];
    if ((nbR || nbD) && g.land[i]) c = c.map((v) => v * 0.55);
  }
  for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
    const p = ((cy * S + sy) * COLS * S + cx * S + sx) * 3;
    rgb[p] = c[0]; rgb[p + 1] = c[1]; rgb[p + 2] = c[2];
  }
}
for (const c of g.cities) {
  const cx = Math.floor(c.x / 16), cy = Math.floor(c.y / 16);
  const p = ((cy * S + 1) * COLS * S + cx * S + 1) * 3;
  rgb[p] = 255; rgb[p + 1] = c.port ? 40 : 255; rgb[p + 2] = c.def.capital ? 255 : 0;
}
writePNG(`scripts/.out/geo-${mode}.png`, COLS * S, ROWS * S, rgb);
