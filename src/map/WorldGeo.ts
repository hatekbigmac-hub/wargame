// Builds the strategic world grid from real-world data: country ownership per cell,
// land/water, lakes, straits (with land bridges), terrain, water bodies, coast distance,
// land connectivity, city placement and per-country city regions.
// Pure computation (no DOM / Phaser) so it also runs in the headless sim test.

import { CELL, COLS, ROWS, WORLD_W, WORLD_H, lonToX, latToY, xToLon, yToLat, worldToCell, cellCenterX, cellCenterY } from '../config';
import { STRAITS, MOUNTAINS, BIOME_ZONES } from '../data/geography';
import { WORLD } from '../data/world';
import { CITY_DEFS } from '../data/cities';
import { RNG, fbm } from '../core/rng';
import { Terrain, type CityDef } from '../core/types';
import { MinHeap } from '../utils/heap';

export interface WorldPoly {
  country: number;
  rings: Float32Array[]; // world coords x,y,...
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PlacedCity {
  def: CityDef;
  x: number;
  y: number;
  cell: number;
  country: number;
  port: boolean;
  portX: number;
  portY: number;
}

export const TERRAIN_NAMES = ['Ocean', 'Plains', 'Forest', 'Jungle', 'Desert', 'Mountains', 'Arctic'];
/** Movement speed multipliers by terrain. */
export const TERRAIN_SPEED = [1, 1, 0.8, 0.7, 0.85, 0.55, 0.75];
/** Damage-taken multipliers by terrain (lower = better cover). */
export const TERRAIN_COVER = [1, 1, 0.85, 0.8, 1, 0.7, 0.95];
/** Pathfinding costs for land units (index 0 = bridge/strait crossing). */
export const TERRAIN_COST = [2, 1, 1.25, 1.4, 1.15, 1.9, 1.35];

const N = COLS * ROWS;
/** Minimum water-body size (cells) for ports and naval movement. */
const OCEAN_MIN = 300;

function project(src: number[]): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 2) {
    out[i] = lonToX(src[i]);
    out[i + 1] = latToY(src[i + 1]);
  }
  return out;
}

function fractalize(pts: number[], rng: RNG, minLen: number, rough: number): Float32Array {
  const out: number[] = [];
  const rec = (ax: number, ay: number, bx: number, by: number, depth: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < minLen || depth > 12) {
      out.push(ax, ay);
      return;
    }
    const off = (rng.next() - 0.5) * len * rough;
    const mx = (ax + bx) / 2 - (dy / len) * off;
    const my = (ay + by) / 2 + (dx / len) * off;
    rec(ax, ay, mx, my, depth + 1);
    rec(mx, my, bx, by, depth + 1);
  };
  for (let i = 0; i + 3 < pts.length; i += 2) rec(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], 0);
  out.push(pts[pts.length - 2], pts[pts.length - 1]);
  return new Float32Array(out);
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Even-odd scanline fill of a multi-ring polygon at cell centres. */
function rasterRings(rings: Float32Array[], minY: number, maxY: number, fn: (cell: number) => void): void {
  const y0 = Math.max(0, Math.floor(minY / CELL));
  const y1 = Math.min(ROWS - 1, Math.ceil(maxY / CELL));
  const xs: number[] = [];
  for (let cy = y0; cy <= y1; cy++) {
    const y = cy * CELL + CELL / 2;
    xs.length = 0;
    for (const pts of rings) {
      const n = pts.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ay = pts[i * 2 + 1];
        const by = pts[j * 2 + 1];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          const ax = pts[i * 2];
          const bx = pts[j * 2];
          xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const cx0 = Math.max(0, Math.ceil(xs[k] / CELL - 0.5));
      const cx1 = Math.min(COLS - 1, Math.floor(xs[k + 1] / CELL - 0.5));
      for (let cx = cx0; cx <= cx1; cx++) fn(cy * COLS + cx);
    }
  }
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export class WorldGeo {
  readonly land = new Uint8Array(N);
  /** Strait cells that land units may cross (bridges, tunnels, canal crossings). */
  readonly bridge = new Uint8Array(N);
  readonly terrain = new Uint8Array(N);
  readonly waterBody = new Int32Array(N).fill(-1);
  readonly bodySize: number[] = [];
  readonly coastDist = new Uint8Array(N);
  readonly region = new Int16Array(N).fill(-1);
  readonly cellCountry = new Int16Array(N).fill(-1);
  readonly landComp = new Int32Array(N).fill(-1);
  readonly mountainStrength = new Float32Array(N);
  countryIds: string[] = [];
  countryIndex = new Map<string, number>();
  countryCells: number[] = [];
  countryPolys: WorldPoly[] = [];
  lakePolys: Float32Array[] = [];
  straitLines: { pts: Float32Array; bridge: boolean }[] = [];
  mountainLines: { pts: Float32Array; width: number; high: boolean }[] = [];
  riverLines: Float32Array[] = [];
  cities: PlacedCity[] = [];
  regionNeighbors: number[][] = [];
  regionBox: Int16Array = new Int16Array(0);
  regionCells: number[] = [];
  regionCountry: Int16Array = new Int16Array(0);

  static build(): WorldGeo {
    const g = new WorldGeo();
    g.buildShapes();
    g.buildLand();
    g.placeCities();
    g.buildWaterBodies();
    g.assignPorts();
    g.buildTerrain();
    g.buildLandComponents();
    g.buildRegions();
    return g;
  }

  // ------------------------------------------------------------ construction

  private buildShapes(): void {
    WORLD.countries.forEach((c, ci) => {
      this.countryIds.push(c.id);
      this.countryIndex.set(c.id, ci);
      for (const poly of c.polys) {
        const rings = poly.map((r) => project(r));
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const r of rings) for (let i = 0; i < r.length; i += 2) {
          minX = Math.min(minX, r[i]);
          maxX = Math.max(maxX, r[i]);
          minY = Math.min(minY, r[i + 1]);
          maxY = Math.max(maxY, r[i + 1]);
        }
        this.countryPolys.push({ country: ci, rings, minX, minY, maxX, maxY });
      }
    });
    this.lakePolys = WORLD.lakes.map((r) => project(r));
    this.riverLines = WORLD.rivers.map((r) => project(r));
    this.straitLines = STRAITS.map((l) => ({ pts: project(l.pts), bridge: !!l.bridge }));
    this.mountainLines = MOUNTAINS.map((m) => ({
      pts: fractalize(Array.from(project(m.pts)), new RNG(hashStr(m.name)), 10, 0.35),
      width: ((m.width ?? 1) / 0.9) * CELL,
      high: !!m.high,
    }));
  }

  private buildLand(): void {
    for (const p of this.countryPolys) {
      rasterRings(p.rings, p.minY, p.maxY, (c) => {
        this.land[c] = 1;
        this.cellCountry[c] = p.country;
      });
    }
    for (const lake of this.lakePolys) {
      let minY = Infinity, maxY = -Infinity;
      for (let i = 1; i < lake.length; i += 2) {
        minY = Math.min(minY, lake[i]);
        maxY = Math.max(maxY, lake[i]);
      }
      rasterRings([lake], minY, maxY, (c) => {
        this.land[c] = 0;
        this.cellCountry[c] = -1;
      });
    }
    // Straits: carve a 4-connected channel of water cells; bridge straits stay crossable by land.
    for (const s of this.straitLines) {
      const line = s.pts;
      let prev = -1;
      const carve = (c: number) => {
        this.land[c] = 0;
        this.cellCountry[c] = -1;
        if (s.bridge) this.bridge[c] = 1;
      };
      for (let i = 0; i + 3 < line.length; i += 2) {
        const ax = line[i], ay = line[i + 1], bx = line[i + 2], by = line[i + 3];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
        for (let st = 0; st <= steps; st++) {
          const c = worldToCell(ax + ((bx - ax) * st) / steps, ay + ((by - ay) * st) / steps);
          if (c !== prev) {
            if (prev >= 0) {
              const pcx = prev % COLS, pcy = Math.floor(prev / COLS);
              const ccx = c % COLS, ccy = Math.floor(c / COLS);
              if (pcx !== ccx && pcy !== ccy) carve(pcy * COLS + ccx);
            }
            carve(c);
            prev = c;
          }
        }
      }
    }
  }

  private placeCities(): void {
    for (const def of CITY_DEFS) {
      const country = this.countryIndex.get(def.owner) ?? -1;
      let x = lonToX(def.lon);
      let y = latToY(def.lat);
      let cell = worldToCell(x, y);
      if (this.cellCountry[cell] !== country) {
        const near = this.nearestCell(x, y, 2, (c) => this.cellCountry[c] === country);
        if (near >= 0) {
          cell = near;
          if (Math.hypot(cellCenterX(near) - x, cellCenterY(near) - y) > CELL * 0.75) {
            x = cellCenterX(near);
            y = cellCenterY(near);
          }
        } else {
          // Micro-states and islands smaller than a grid cell get the cell they sit in.
          this.land[cell] = 1;
          this.bridge[cell] = 0;
          this.cellCountry[cell] = country;
        }
      }
      this.cities.push({ def, x, y, cell, country, port: false, portX: x, portY: y });
    }
    this.countryCells = this.countryIds.map(() => 0);
    for (let i = 0; i < N; i++) if (this.cellCountry[i] >= 0) this.countryCells[this.cellCountry[i]]++;
  }

  private buildWaterBodies(): void {
    const stack: number[] = [];
    let id = 0;
    for (let i = 0; i < N; i++) {
      if (this.land[i] || this.waterBody[i] >= 0) continue;
      let size = 0;
      stack.push(i);
      this.waterBody[i] = id;
      while (stack.length) {
        const c = stack.pop()!;
        size++;
        const cx = c % COLS, cy = (c / COLS) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
            const nc = ny * COLS + nx;
            if (this.land[nc] || this.waterBody[nc] >= 0) continue;
            this.waterBody[nc] = id;
            stack.push(nc);
          }
        }
      }
      this.bodySize.push(size);
      id++;
    }
    this.coastDist.fill(255);
    const q: number[] = [];
    for (let i = 0; i < N; i++) if (this.land[i]) {
      this.coastDist[i] = 0;
      q.push(i);
    }
    let head = 0;
    while (head < q.length) {
      const c = q[head++];
      const d = this.coastDist[c];
      if (d >= 254) continue;
      const cx = c % COLS, cy = (c / COLS) | 0;
      const nb = [cx > 0 ? c - 1 : -1, cx < COLS - 1 ? c + 1 : -1, cy > 0 ? c - COLS : -1, cy < ROWS - 1 ? c + COLS : -1];
      for (const nc of nb) {
        if (nc < 0 || this.coastDist[nc] <= d + 1) continue;
        this.coastDist[nc] = d + 1;
        q.push(nc);
      }
    }
  }

  isNavigable(cell: number): boolean {
    const b = this.waterBody[cell];
    return b >= 0 && this.bodySize[b] >= OCEAN_MIN;
  }

  /** Land units may stand on land or cross bridge straits. */
  isLandPassable(cell: number): boolean {
    return this.land[cell] === 1 || this.bridge[cell] === 1;
  }

  private assignPorts(): void {
    for (const pc of this.cities) {
      const w = this.nearestCell(pc.x, pc.y, 2, (c) => this.isNavigable(c));
      if (w >= 0) {
        pc.port = true;
        pc.portX = cellCenterX(w);
        pc.portY = cellCenterY(w);
      }
    }
  }

  private buildTerrain(): void {
    for (const m of this.mountainLines) {
      const pts = m.pts;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
        const r = m.width * 0.5 + CELL;
        const cx0 = Math.max(0, Math.floor((Math.min(ax, bx) - r) / CELL));
        const cx1 = Math.min(COLS - 1, Math.floor((Math.max(ax, bx) + r) / CELL));
        const cy0 = Math.max(0, Math.floor((Math.min(ay, by) - r) / CELL));
        const cy1 = Math.min(ROWS - 1, Math.floor((Math.max(ay, by) + r) / CELL));
        for (let cy = cy0; cy <= cy1; cy++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            const d = distToSegment(cx * CELL + CELL / 2, cy * CELL + CELL / 2, ax, ay, bx, by);
            const s = 1 - d / (m.width * 0.7 + 0.1);
            const idx = cy * COLS + cx;
            if (s > this.mountainStrength[idx]) this.mountainStrength[idx] = s * (m.high ? 1.15 : 1);
          }
        }
      }
    }
    for (let i = 0; i < N; i++) {
      this.terrain[i] = this.land[i] ? this.biomeAt(cellCenterX(i), cellCenterY(i), this.mountainStrength[i]) : Terrain.Water;
    }
    for (const c of this.cities) if (this.terrain[c.cell] === Terrain.Mountain) this.terrain[c.cell] = Terrain.Plains;
  }

  /** Biome classification used for both terrain gameplay and map colouring. */
  biomeAt(x: number, y: number, mountain: number): Terrain {
    const lon = xToLon(x);
    const lat = yToLat(y);
    const n = fbm(lon * 0.18, lat * 0.18, 3, 7);
    if (mountain + (n - 0.5) * 0.5 > 0.25) return Terrain.Mountain;
    const wl = lon + (fbm(lon * 0.09, lat * 0.09, 3, 31) - 0.5) * 11;
    const wt = lat + (fbm(lon * 0.09, lat * 0.09, 3, 57) - 0.5) * 8;
    const z = this.zoneStrength(wl, wt);
    if (z.ice > 0.2 || lat > 71 || (lat > 66 && n < 0.55)) return Terrain.Arctic;
    if (lat < -55) return Terrain.Arctic;
    if (z.desert + (n - 0.5) * 0.6 > 0.3) return Terrain.Desert;
    if (z.jungle + (n - 0.5) * 0.6 > 0.3) return Terrain.Jungle;
    const alat = Math.abs(lat);
    if (z.forest + (n - 0.5) * 0.6 > 0.35) return Terrain.Forest;
    if (lat > 50 && lat <= 66) return n > 0.4 ? Terrain.Forest : Terrain.Plains;
    if (alat > 35 && alat <= 50) return n > 0.6 ? Terrain.Forest : Terrain.Plains;
    return n > 0.68 ? Terrain.Forest : Terrain.Plains;
  }

  zoneStrength(lon: number, lat: number): { desert: number; jungle: number; ice: number; forest: number; steppe: number } {
    const out = { desert: 0, jungle: 0, ice: 0, forest: 0, steppe: 0 };
    for (const z of BIOME_ZONES) {
      const dx = (lon - z.lon) / z.rx;
      const dy = (lat - z.lat) / z.ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1) {
        const s = (1 - d) * z.strength;
        if (s > out[z.kind]) out[z.kind] = s;
      }
    }
    return out;
  }

  private buildLandComponents(): void {
    let id = 0;
    const stack: number[] = [];
    for (let i = 0; i < N; i++) {
      if (!this.isLandPassable(i) || this.landComp[i] >= 0) continue;
      this.landComp[i] = id;
      stack.push(i);
      while (stack.length) {
        const c = stack.pop()!;
        const cx = c % COLS, cy = (c / COLS) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const nc = ny * COLS + nx;
          if (this.landComp[nc] >= 0 || !this.isLandPassable(nc)) continue;
          this.landComp[nc] = id;
          stack.push(nc);
        }
      }
      id++;
    }
  }

  /** True if a land unit can walk from a to b (same landmass, bridges included). */
  landConnected(ax: number, ay: number, bx: number, by: number): boolean {
    const a = this.landComp[worldToCell(ax, ay)];
    return a >= 0 && a === this.landComp[worldToCell(bx, by)];
  }

  /** Nearest cell (by distance to point) within radius (cells) that satisfies pred. */
  nearestCell(x: number, y: number, radius: number, pred: (c: number) => boolean): number {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    let best = -1;
    let bestD = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const c = ny * COLS + nx;
        if (!pred(c)) continue;
        const d = Math.hypot(cellCenterX(c) - x, cellCenterY(c) - y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }

  private buildRegions(): void {
    const R = this.cities.length;
    this.regionCountry = new Int16Array(R);
    this.cities.forEach((c, i) => (this.regionCountry[i] = c.country));
    // Dijkstra from every city, never crossing into another country.
    const dist = new Float64Array(N).fill(Infinity);
    const heap = new MinHeap(8192);
    const reg = this.region;
    this.cities.forEach((c, i) => {
      if (dist[c.cell] === 0) return;
      dist[c.cell] = 0;
      reg[c.cell] = i;
      heap.push(c.cell, 0);
    });
    while (heap.size) {
      const d0 = heap.peekKey();
      const c = heap.pop();
      if (d0 > dist[c]) continue;
      const country = this.cellCountry[c];
      const cx = c % COLS, cy = (c / COLS) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const nc = ny * COLS + nx;
          if (this.cellCountry[nc] !== country) continue;
          const nd = d0 + (this.terrain[nc] === Terrain.Mountain ? 3 : 1) * (dx && dy ? 1.414 : 1);
          if (nd < dist[nc]) {
            dist[nc] = nd;
            reg[nc] = reg[c];
            heap.push(nc, nd);
          }
        }
      }
    }
    // Cells of a country not reachable over land (islands) join its nearest city.
    const byCountry: number[][] = this.countryIds.map(() => []);
    this.cities.forEach((c, i) => byCountry[c.country]?.push(i));
    for (let i = 0; i < N; i++) {
      if (this.cellCountry[i] < 0 || reg[i] >= 0) continue;
      const list = byCountry[this.cellCountry[i]];
      const x = cellCenterX(i), y = cellCenterY(i);
      let best = -1;
      let bestD = Infinity;
      for (const ci of list.length ? list : this.cities.map((_, k) => k)) {
        const d = Math.hypot(this.cities[ci].x - x, this.cities[ci].y - y);
        if (d < bestD) {
          bestD = d;
          best = ci;
        }
      }
      reg[i] = best;
    }
    this.regionBox = new Int16Array(R * 4);
    for (let r = 0; r < R; r++) {
      this.regionBox[r * 4] = COLS;
      this.regionBox[r * 4 + 1] = ROWS;
      this.regionBox[r * 4 + 2] = -1;
      this.regionBox[r * 4 + 3] = -1;
    }
    this.regionCells = new Array(R).fill(0);
    const nbSets: Set<number>[] = Array.from({ length: R }, () => new Set<number>());
    for (let i = 0; i < N; i++) {
      const r = reg[i];
      if (r < 0) continue;
      this.regionCells[r]++;
      const cx = i % COLS, cy = (i / COLS) | 0;
      const b = r * 4;
      if (cx < this.regionBox[b]) this.regionBox[b] = cx;
      if (cy < this.regionBox[b + 1]) this.regionBox[b + 1] = cy;
      if (cx > this.regionBox[b + 2]) this.regionBox[b + 2] = cx;
      if (cy > this.regionBox[b + 3]) this.regionBox[b + 3] = cy;
      for (const nc of [cx < COLS - 1 ? i + 1 : -1, cy < ROWS - 1 ? i + COLS : -1]) {
        if (nc < 0) continue;
        const r2 = reg[nc];
        if (r2 >= 0 && r2 !== r) {
          nbSets[r].add(r2);
          nbSets[r2].add(r);
        }
      }
    }
    this.regionNeighbors = nbSets.map((s) => [...s]);
  }

  // ------------------------------------------------------------ queries

  isLandAt(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return false;
    return this.land[worldToCell(x, y)] === 1;
  }

  terrainAt(x: number, y: number): Terrain {
    return this.terrain[worldToCell(x, y)] as Terrain;
  }

  regionAt(x: number, y: number): number {
    return this.region[worldToCell(x, y)];
  }
}
