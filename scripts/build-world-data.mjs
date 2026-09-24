// Builds src/data/world.json from Natural Earth 1:50m data (public domain, naturalearthdata.com).
// Usage: node scripts/build-world-data.mjs
// Downloads the source GeoJSON into scripts/.cache (not committed) and writes a compact,
// simplified dataset: sovereign countries (real borders, English + Russian names,
// label points, map colour), cities (capitals + major cities), lakes and rivers.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const CACHE = 'scripts/.cache';
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const FILES = {
  countries: 'ne_50m_admin_0_countries.geojson',
  places: 'ne_50m_populated_places.geojson',
  lakes: 'ne_50m_lakes.geojson',
  rivers: 'ne_50m_rivers_lake_centerlines.geojson',
};
fs.mkdirSync(CACHE, { recursive: true });
const load = (k) => {
  const p = `${CACHE}/${FILES[k]}`;
  if (!fs.existsSync(p)) {
    console.log('downloading', FILES[k]);
    execFileSync('curl', ['-sSfL', '-o', p, BASE + FILES[k]]);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};

const LAT_MIN = -63.5;
const LAT_MAX = 84;
const LON_WEST = -170;
const r2 = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ geometry helpers
function dp(pts, tol) {
  // Douglas-Peucker on [[lon,lat],...]
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}

/** Normalise longitudes so rings stay continuous across the map seam at 190°E / -170°. */
function fixSeam(r) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [x] of r) {
    minLon = Math.min(minLon, x);
    maxLon = Math.max(maxLon, x);
  }
  if (minLon >= LON_WEST) return r;
  if (maxLon < LON_WEST + 5) return r.map(([x, y]) => [x + 360, y]);
  return r.map(([x, y]) => [Math.max(LON_WEST, x), y]);
}

function simplifyRing(r, tol) {
  let ring = fixSeam(r.map(([x, y]) => [x, Math.max(LAT_MIN, Math.min(LAT_MAX, y))]));
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
  if (ring.length < 4) return ring.length >= 3 ? ring : null;
  // Split the closed ring at its farthest point so Douglas-Peucker has a real baseline.
  let far = 1;
  let farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = dp(ring.slice(0, far + 1), tol);
  const b = dp([...ring.slice(far), ring[0]], tol);
  const s = [...a, ...b.slice(1, -1)];
  return s.length >= 3 ? s : null;
}

const flat = (ring) => ring.flatMap(([x, y]) => [r2(x), r2(y)]);

// ------------------------------------------------------------------ countries
const countries = load('countries');
const groups = new Map();
for (const f of countries.features) {
  const p = f.properties;
  if (p.ADM0_A3 === 'ATA' || p.SOV_A3 === 'ATA') continue;
  // Palestine is kept as its own state rather than folded into another sovereign.
  const sov = p.ADM0_A3 === 'PSX' ? 'PSX' : p.SOV_A3;
  if (!groups.has(sov)) groups.set(sov, []);
  groups.get(sov).push(f);
}

const SHORT = {
  USA: 'United States', GBR: 'United Kingdom', COD: 'DR Congo', CAF: 'Central African Rep.', DOM: 'Dominican Rep.',
  BIH: 'Bosnia and Herz.', SSD: 'South Sudan', GNQ: 'Eq. Guinea', CZE: 'Czechia', MKD: 'North Macedonia',
};

const RU_SHORT = {
  ARE: 'ОАЭ', CHN: 'Китай', COD: 'ДР Конго', CAF: 'ЦАР', DOM: 'Доминикана', CYN: 'Северный Кипр', GNQ: 'Экв. Гвинея',
  PNG: 'Папуа — Н. Гвинея', VCT: 'Сент-Винсент', SYC: 'Сейшелы', BIH: 'Босния и Герц.', USA: 'США', GBR: 'Великобритания',
};

function pointInRings(rings, lon, lat) {
  let inside = false;
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[i * 2], yi = r[i * 2 + 1], xj = r[j * 2], yj = r[j * 2 + 1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const out = [];
for (const [sov, feats] of groups) {
  const home = feats.find((f) => f.properties.HOMEPART === 1) ?? feats.find((f) => f.properties.ADM0_A3 === sov) ?? feats[0];
  const hp = home.properties;
  const id = sov === 'PSX' ? 'PSX' : hp.ADM0_A3;
  const polys = [];
  let area = 0;
  for (const f of feats) {
    const g = f.geometry;
    if (!g) continue;
    const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of list) {
      const outerRaw = poly[0];
      if (outerRaw.every(([, y]) => y < LAT_MIN)) continue;
      const a = ringArea(outerRaw);
      if (a < 0.015 && list.length > 1) continue; // tiny islets
      const outer = simplifyRing(outerRaw, a > 5 ? 0.035 : 0.02);
      if (!outer) continue;
      const rings = [flat(outer)];
      for (const h of poly.slice(1)) {
        if (ringArea(h) < 0.05) continue;
        const hs = simplifyRing(h, 0.03);
        if (hs) rings.push(flat(hs));
      }
      polys.push(rings);
      area += a;
    }
  }
  if (!polys.length) continue;
  out.push({
    id,
    name: SHORT[id] ?? hp.NAME,
    ru: RU_SHORT[id] ?? hp.NAME_RU ?? hp.NAME,
    cont: hp.CONTINENT,
    pop: Math.round((feats.reduce((s, f) => s + (f.properties.POP_EST || 0), 0)) / 1e5) / 10, // millions
    gdp: Math.round(feats.reduce((s, f) => s + (f.properties.GDP_MD || 0), 0) / 1000), // billions USD
    lx: r2(hp.LABEL_X),
    ly: r2(hp.LABEL_Y),
    area: Math.round(area),
    adm: feats.map((f) => f.properties.ADM0_A3),
    polys,
  });
}

// ------------------------------------------------------------------ adjacency & colouring
{
  const RES = 0.5;
  const W = 720;
  const H = Math.ceil((LAT_MAX - LAT_MIN) / RES);
  const grid = new Int16Array(W * H).fill(-1);
  out.forEach((c, ci) => {
    for (const rings of c.polys) {
      let minY = Infinity;
      let maxY = -Infinity;
      for (const r of rings) for (let i = 1; i < r.length; i += 2) {
        minY = Math.min(minY, r[i]);
        maxY = Math.max(maxY, r[i]);
      }
      const y0 = Math.max(0, Math.floor((LAT_MAX - maxY) / RES));
      const y1 = Math.min(H - 1, Math.ceil((LAT_MAX - minY) / RES));
      for (let cy = y0; cy <= y1; cy++) {
        const lat = LAT_MAX - (cy + 0.5) * RES;
        const xs = [];
        for (const r of rings) {
          const n = r.length / 2;
          for (let i = 0, j = n - 1; i < n; j = i++) {
            const ay = r[i * 2 + 1];
            const by = r[j * 2 + 1];
            if ((ay > lat) !== (by > lat)) xs.push(r[i * 2] + ((lat - ay) / (by - ay)) * (r[j * 2] - r[i * 2]));
          }
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const x0 = Math.ceil((xs[k] - LON_WEST) / RES - 0.5);
          const x1 = Math.floor((xs[k + 1] - LON_WEST) / RES - 0.5);
          for (let cx = Math.max(0, x0); cx <= Math.min(W - 1, x1); cx++) grid[cy * W + cx] = ci;
        }
      }
    }
  });
  const nb = out.map(() => new Set());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = grid[y * W + x];
    if (a < 0) continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [2, 0], [0, 2]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= W || ny >= H) continue;
      const b = grid[ny * W + nx];
      if (b >= 0 && b !== a) {
        nb[a].add(b);
        nb[b].add(a);
      }
    }
  }
  const PALETTE = 12;
  const order = out.map((_, i) => i).sort((a, b) => out[b].area - out[a].area);
  const col = new Array(out.length).fill(-1);
  for (const i of order) {
    const used = new Set([...nb[i]].map((j) => col[j]));
    let h = 0;
    for (const ch of out[i].id) h = (h * 31 + ch.charCodeAt(0)) % 997;
    for (let k = 0; k < PALETTE; k++) {
      const c = (h + k * 5) % PALETTE;
      if (!used.has(c)) {
        col[i] = c;
        break;
      }
    }
    if (col[i] < 0) col[i] = h % PALETTE;
  }
  out.forEach((c, i) => {
    c.col = col[i];
    c.nb = [...nb[i]].map((j) => out[j].id);
  });
}

// ------------------------------------------------------------------ cities
const places = load('places').features.map((f) => f.properties);
const OIL = new Set(['USA', 'RUS', 'SAU', 'IRQ', 'IRN', 'KWT', 'ARE', 'QAT', 'OMN', 'VEN', 'NGA', 'AGO', 'LBY', 'DZA', 'KAZ', 'NOR', 'MEX', 'BRA', 'CAN', 'AZE', 'TKM', 'EGY', 'MYS', 'IDN', 'COL', 'ECU', 'GAB', 'COG', 'SDN', 'SSD', 'YEM', 'SYR', 'BRN', 'TTO', 'CHN', 'GBR']);
const METAL = new Set(['AUS', 'CHL', 'PER', 'ZAF', 'COD', 'ZMB', 'RUS', 'CAN', 'BRA', 'CHN', 'KAZ', 'MNG', 'IND', 'UKR', 'SWE', 'BOL', 'GIN', 'MRT', 'NAM', 'BWA', 'ZWE', 'PNG', 'UZB', 'KGZ', 'TJK', 'USA', 'MEX', 'IDN', 'PHL', 'DEU', 'POL', 'FIN', 'MAR']);
const FOOD = new Set(['USA', 'BRA', 'ARG', 'IND', 'CHN', 'FRA', 'UKR', 'RUS', 'AUS', 'CAN', 'THA', 'VNM', 'IDN', 'NGA', 'EGY', 'PAK', 'BGD', 'TUR', 'POL', 'DEU', 'ITA', 'ESP', 'MEX', 'KAZ', 'ETH', 'NZL', 'URY', 'PRY', 'MMR', 'HUN', 'ROU', 'KEN', 'TZA', 'NLD', 'DNK']);
const ENERGY = new Set(['NOR', 'FRA', 'CAN', 'BRA', 'PRY', 'CHN', 'SWE', 'CHE', 'ISL', 'USA', 'JPN', 'KOR', 'RUS', 'UKR', 'AUT', 'ETH', 'COD', 'LAO', 'TJK', 'NZL', 'FIN', 'ZAF']);

const dist = (a, b) => Math.hypot(a.lon - b.lon, a.lat - b.lat);
const containing = (lon, lat) => out.find((c) => c.polys.some((rings) => pointInRings(rings, lon, lat)));
const cities = [];
for (const c of out) {
  const adm = new Set(c.adm);
  const mine = places
    .filter((p) => (adm.has(p.ADM0_A3) || (c.id === 'PSX' && p.ADM0_A3 === 'PSX')) && p.LATITUDE > LAT_MIN && p.LATITUDE < LAT_MAX)
    .filter((p) => !(c.id === 'ISR' && p.ADM0_A3 === 'PSX'))
    // Skip places that lie inside another country's borders (disputed areas stay neutral in data).
    .filter((p) => {
      const host = containing(p.LONGITUDE, p.LATITUDE);
      return !host || host === c;
    })
    .map((p) => ({ name: p.NAME, ru: p.NAME_RU || p.NAME, lon: p.LONGITUDE, lat: p.LATITUDE, pop: p.POP_MAX || 0, cls: p.FEATURECLA, adm: p.ADM0_A3, cap: p.ADM0CAP === 1 }))
    .sort((a, b) => b.pop - a.pop);
  const chosen = [];
  const homeAdm = c.adm[0] && c.adm.includes(c.id) ? c.id : c.adm[0];
  let capital = mine.find((p) => p.cap && p.adm === homeAdm && p.cls === 'Admin-0 capital') ?? mine.find((p) => p.cap && p.adm === homeAdm) ?? mine.find((p) => p.cap);
  if (!capital) capital = mine[0] ?? { name: c.name, ru: c.ru, lon: c.lx, lat: c.ly, pop: c.pop * 1e5, cls: 'synthetic' };
  chosen.push({ ...capital, capital: true });
  // Dependency capitals (e.g. Nuuk, San Juan, Nouméa) keep far-flung territories alive.
  for (const p of mine) if (p.cap && p.adm !== homeAdm && chosen.every((q) => dist(q, p) > 3)) chosen.push({ ...p, capital: false });
  const target = Math.max(1, Math.min(26, Math.round(Math.sqrt(c.area) / 2.4)));
  const spacing = c.area > 800 ? 3.2 : c.area > 150 ? 2.2 : c.area > 30 ? 1.5 : 1.0;
  for (const p of mine) {
    if (chosen.length >= target + 1) break;
    if (p.pop < 150000 && chosen.length >= 2) continue;
    if (chosen.every((q) => dist(q, p) > spacing)) chosen.push({ ...p, capital: false });
  }
  // Fill empty interiors of big countries with smaller towns far from everything else.
  if (c.area > 400) {
    for (const p of [...mine].sort((a, b) => b.pop - a.pop)) {
      if (chosen.length >= target + 2) break;
      if (chosen.every((q) => dist(q, p) > spacing * 2)) chosen.push({ ...p, capital: false });
    }
  }
  const gdppc = c.pop > 0 ? (c.gdp * 1000) / c.pop : 1000; // USD per person
  const tier = gdppc < 2000 ? 1 : gdppc < 7000 ? 2 : gdppc < 18000 ? 3 : gdppc < 38000 ? 4 : 5;
  const tagsFor = [OIL.has(c.id) ? 'o' : '', METAL.has(c.id) ? 'm' : '', FOOD.has(c.id) ? 'f' : '', ENERGY.has(c.id) ? 'e' : ''].filter(Boolean);
  chosen.forEach((p, i) => {
    const size = p.pop >= 6e6 ? 4 : p.pop >= 1.8e6 ? 3 : p.pop >= 4e5 ? 2 : 1;
    const sz = p.capital ? Math.max(2, size) : size;
    const industry = Math.max(1, Math.min(5, Math.round((tier + sz) / 2 + (p.capital ? 0.5 : 0) - 0.3)));
    let tags = '';
    if (tagsFor.length) {
      if (i === 0) tags = tagsFor[0];
      else if (i <= tagsFor.length - 1) tags = tagsFor[i];
      else if ((i * 7 + c.id.charCodeAt(0)) % 5 === 0) tags = tagsFor[i % tagsFor.length];
    }
    cities.push([p.name, p.ru, r2(p.lon), r2(p.lat), c.id, sz, industry, p.capital ? 1 : 0, tags]);
  });
}

// ------------------------------------------------------------------ lakes & rivers
const lakes = load('lakes').features
  .filter((f) => f.properties.scalerank <= 3)
  .flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates))
  .map((poly) => poly[0])
  .filter((r) => ringArea(r) > 0.6)
  .map((r) => simplifyRing(r, 0.04))
  .filter(Boolean)
  .map(flat);

const rivers = load('rivers').features
  .filter((f) => f.properties.scalerank <= 4 && f.geometry)
  .flatMap((f) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates))
  .map((l) => dp(fixSeam(l), 0.06))
  .filter((l) => l.length >= 2)
  .map(flat);

for (const c of out) delete c.area, delete c.adm;
const world = { source: 'Natural Earth 1:50m (public domain)', countries: out, cities, lakes, rivers };
fs.writeFileSync('src/data/world.json', JSON.stringify(world));
const size = fs.statSync('src/data/world.json').size;
console.log(`countries ${out.length}, cities ${cities.length}, lakes ${lakes.length}, rivers ${rivers.length}, ${(size / 1024).toFixed(0)} KB`);
