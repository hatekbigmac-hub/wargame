// Builds the strategic world grid from geography data: land/water mask, terrain,
// water bodies, coast distance, city placement and territory regions.
// Pure computation (no DOM / Phaser) so it also runs in the headless sim test.

import {
  CELL, COLS, ROWS, WORLD_W, WORLD_H, lonToX, latToY, xToLon, yToLat, worldToCell, cellCenterX, cellCenterY,
} from '../config';
import { LANDMASSES, WATER_HOLES, STRAITS, MOUNTAINS, BIOME_ZONES, RIVERS, type GeoShape, type GeoLine } from '../data/geography';
import { CITY_DEFS } from '../data/cities';
import { RNG, fbm } from '../core/rng';
import { Terrain, type CityDef } from '../core/types';
import { MinHeap } from '../utils/heap';

export interface WorldPoly {
  name: string;
  pts: Float32Array; // world coords x,y,...
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
  port: boolean;
  portX: number;
  portY: number;
}

export const TERRAIN_NAMES = ['Ocean', 'Plains', 'Forest', 'Jungle', 'Desert', 'Mountains', 'Arctic'];
/** Movement speed multipliers by terrain. */
export const TERRAIN_SPEED = [1, 1, 0.8, 0.7, 0.85, 0.55, 0.75];
/** Damage-taken multipliers by terrain (lower = better cover). */
export const TERRAIN_COVER = [1, 1, 0.85, 0.8, 1, 0.7, 0.95];
/** Pathfinding costs for land units. */
export const TERRAIN_COST = [4, 1, 1.25, 1.4, 1.15, 1.9, 1.35];

const N = COLS * ROWS;

function projectLine(src: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < src.length; i += 2) out.push(lonToX(src[i]), latToY(src[i + 1]));
  return out;
}

/** Recursive midpoint displacement to give coastlines natural detail. */
function fractalize(pts: number[], rng: RNG, minLen: number, rough: number, closed: boolean): Float32Array {
  const out: number[] = [];
  const n = pts.length / 2;
  const segs = closed ? n : n - 1;
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
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    rec(pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], 0);
  }
  if (!closed) out.push(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]);
  return new Float32Array(out);
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function toPoly(shape: GeoShape, rough: number): WorldPoly {
  const rng = new RNG(hashStr(shape.name));
  const pts = fractalize(projectLine(shape.pts), rng, 3.5, rough, true);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  return { name: shape.name, pts, minX, minY, maxX, maxY };
}

/** Even-odd scanline fill of a polygon at cell-centre resolution. */
function rasterPoly(poly: WorldPoly, grid: Uint8Array, value: number): void {
  const pts = poly.pts;
  const n = pts.length / 2;
  const y0 = Math.max(0, Math.floor(poly.minY / CELL));
  const y1 = Math.min(ROWS - 1, Math.ceil(poly.maxY / CELL));
  const xs: number[] = [];
  for (let cy = y0; cy <= y1; cy++) {
    const y = cy * CELL + CELL / 2;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ay = pts[i * 2 + 1];
      const by = pts[j * 2 + 1];
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        const ax = pts[i * 2];
        const bx = pts[j * 2];
        xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const cx0 = Math.max(0, Math.ceil(xs[k] / CELL - 0.5));
      const cx1 = Math.min(COLS - 1, Math.floor(xs[k + 1] / CELL - 0.5));
      for (let cx = cx0; cx <= cx1; cx++) grid[cy * COLS + cx] = value;
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
  readonly terrain = new Uint8Array(N);
  readonly waterBody = new Int32Array(N).fill(-1);
  readonly bodySize: number[] = [];
  readonly coastDist = new Uint8Array(N);
  readonly region = new Int16Array(N).fill(-1);
  readonly mountainStrength = new Float32Array(N);
  landPolys: WorldPoly[] = [];
  holePolys: WorldPoly[] = [];
  straitLines: Float32Array[] = [];
  mountainLines: { pts: Float32Array; width: number; high: boolean }[] = [];
  riverLines: Float32Array[] = [];
  cities: PlacedCity[] = [];
  /** Per-region neighbour region ids (land adjacency). */
  regionNeighbors: number[][] = [];
  /** Per-region cell bounding box [minCx, minCy, maxCx, maxCy]. */
  regionBox: Int16Array = new Int16Array(0);
  regionCells: number[] = [];

  static build(): WorldGeo {
    const g = new WorldGeo();
    g.buildShapes();
    g.buildLand();
    g.buildTerrain();
    g.buildWaterBodies();
    g.placeCities();
    g.buildRegions();
    return g;
  }

  // ------------------------------------------------------------ construction

  private buildShapes(): void {
    this.landPolys = LANDMASSES.map((s) => toPoly(s, 0.3));
    this.holePolys = WATER_HOLES.map((s) => toPoly(s, 0.25));
    this.straitLines = STRAITS.map((l) => new Float32Array(projectLine(l.pts)));
    this.mountainLines = MOUNTAINS.map((m: GeoLine) => ({
      pts: fractalize(projectLine(m.pts), new RNG(hashStr(m.name)), 10, 0.35, false),
      width: ((m.width ?? 1) / 0.9) * CELL,
      high: !!m.high,
    }));
    this.riverLines = RIVERS.map((r) => fractalize(projectLine(r.pts), new RNG(hashStr(r.name)), 3, 0.45, false));
  }

  private buildLand(): void {
    for (const p of this.landPolys) rasterPoly(p, this.land, 1);
    for (const p of this.holePolys) rasterPoly(p, this.land, 0);
    // Straits: carve a 4-connected channel of water cells.
    for (const line of this.straitLines) {
      let prev = -1;
      for (let i = 0; i + 3 < line.length; i += 2) {
        const ax = line[i], ay = line[i + 1], bx = line[i + 2], by = line[i + 3];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
        for (let s = 0; s <= steps; s++) {
          const x = ax + ((bx - ax) * s) / steps;
          const y = ay + ((by - ay) * s) / steps;
          const c = worldToCell(x, y);
          if (c !== prev) {
            if (prev >= 0) {
              const pcx = prev % COLS, pcy = Math.floor(prev / COLS);
              const ccx = c % COLS, ccy = Math.floor(c / COLS);
              if (pcx !== ccx && pcy !== ccy) this.land[pcy * COLS + ccx] = 0;
            }
            this.land[c] = 0;
            prev = c;
          }
        }
      }
    }
  }

  private buildTerrain(): void {
    // Mountain influence per cell.
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
      if (!this.land[i]) {
        this.terrain[i] = Terrain.Water;
        continue;
      }
      this.terrain[i] = this.biomeAt(cellCenterX(i), cellCenterY(i), this.mountainStrength[i]);
    }
  }

  /** Biome classification used for both terrain gameplay and map colouring. */
  biomeAt(x: number, y: number, mountain: number): Terrain {
    const lon = xToLon(x);
    const lat = yToLat(y);
    const n = fbm(lon * 0.18, lat * 0.18, 3, 7);
    if (mountain + (n - 0.5) * 0.5 > 0.25) return Terrain.Mountain;
    // Domain-warp zone lookups so biome edges look organic rather than elliptical.
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
    // Coast distance (BFS from land over water).
    this.coastDist.fill(255);
    const q: number[] = [];
    for (let i = 0; i < N; i++) if (this.land[i]) { this.coastDist[i] = 0; q.push(i); }
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
    return b >= 0 && this.bodySize[b] >= 40;
  }

  private placeCities(): void {
    for (const def of CITY_DEFS) {
      let x = lonToX(def.lon);
      let y = latToY(def.lat);
      let cell = worldToCell(x, y);
      if (!this.land[cell]) {
        const near = this.nearestCell(x, y, 2, (c) => this.land[c] === 1);
        if (near >= 0) {
          cell = near;
          x = cellCenterX(near);
          y = cellCenterY(near);
        } else {
          this.land[cell] = 1;
          this.terrain[cell] = Terrain.Plains;
          this.waterBody[cell] = -1;
        }
      }
      let port = def.port;
      let portX = x, portY = y;
      if (port) {
        const w = this.nearestCell(x, y, 3, (c) => this.isNavigable(c));
        if (w >= 0) {
          portX = cellCenterX(w);
          portY = cellCenterY(w);
        } else port = false;
      }
      this.cities.push({ def, x, y, cell, port, portX, portY });
    }
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
    const dist = new Float64Array(N).fill(Infinity);
    const heap = new MinHeap(8192);
    this.cities.forEach((c, i) => {
      dist[c.cell] = 0;
      this.region[c.cell] = i;
      heap.push(c.cell, 0);
    });
    const regionAll = new Int16Array(N).fill(-1);
    this.cities.forEach((c, i) => (regionAll[c.cell] = i));
    while (heap.size) {
      const d0 = heap.peekKey();
      const c = heap.pop();
      if (d0 > dist[c]) continue;
      const cx = c % COLS, cy = (c / COLS) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const nc = ny * COLS + nx;
          const base = this.land[nc] ? (this.terrain[nc] === Terrain.Mountain ? 3 : 1) : 7;
          const nd = d0 + base * (dx && dy ? 1.414 : 1);
          if (nd < dist[nc]) {
            dist[nc] = nd;
            regionAll[nc] = regionAll[c];
            heap.push(nc, nd);
          }
        }
      }
    }
    const R = this.cities.length;
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
      if (!this.land[i]) continue;
      const r = regionAll[i];
      this.region[i] = r;
      if (r < 0) continue;
      this.regionCells[r]++;
      const cx = i % COLS, cy = (i / COLS) | 0;
      const b = r * 4;
      if (cx < this.regionBox[b]) this.regionBox[b] = cx;
      if (cy < this.regionBox[b + 1]) this.regionBox[b + 1] = cy;
      if (cx > this.regionBox[b + 2]) this.regionBox[b + 2] = cx;
      if (cy > this.regionBox[b + 3]) this.regionBox[b + 3] = cy;
      // neighbours (right & down suffice for symmetry)
      if (cx < COLS - 1 && this.land[i + 1]) {
        const r2 = regionAll[i + 1];
        if (r2 >= 0 && r2 !== r) { nbSets[r].add(r2); nbSets[r2].add(r); }
      }
      if (cy < ROWS - 1 && this.land[i + COLS]) {
        const r2 = regionAll[i + COLS];
        if (r2 >= 0 && r2 !== r) { nbSets[r].add(r2); nbSets[r2].add(r); }
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
