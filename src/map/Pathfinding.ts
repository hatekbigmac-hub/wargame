// A* pathfinding on the world grid with line-of-sight smoothing and a budgeted request queue.
import { COLS, ROWS, CELL, worldToCell, cellCenterX, cellCenterY } from '../config';
import { MinHeap } from '../utils/heap';
import { Terrain } from '../core/types';
import { TERRAIN_COST, type WorldGeo } from './WorldGeo';

export type PathDomain = 'land' | 'naval';

const N = COLS * ROWS;
const SQRT2 = Math.SQRT2;

export interface PathRequest {
  unitId: number;
  domain: PathDomain;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  group: number;
  cb: (path: number[] | null) => void;
}

export class Pathfinder {
  private g = new Float64Array(N);
  private came = new Int32Array(N);
  private stamp = new Uint32Array(N);
  private closed = new Uint32Array(N);
  private gen = 0;
  private heap = new MinHeap(4096);
  lastExpanded = 0;
  lastMs = 0;

  constructor(private geo: WorldGeo) {}

  passable(domain: PathDomain, cell: number): boolean {
    return domain === 'land' ? this.geo.isLandPassable(cell) : this.geo.isNavigable(cell);
  }

  cost(domain: PathDomain, cell: number): number {
    if (domain === 'naval') return 1;
    return TERRAIN_COST[this.geo.terrain[cell]];
  }

  /** Can a unit of this domain get from a to b at all? (cheap connectivity check) */
  reachable(domain: PathDomain, ax: number, ay: number, bx: number, by: number): boolean {
    const a = this.snap(domain, ax, ay, 3);
    const b = this.snap(domain, bx, by, 6);
    if (!a || !b) return false;
    return domain === 'land' ? this.geo.landComp[a.cell] === this.geo.landComp[b.cell] : this.geo.waterBody[a.cell] === this.geo.waterBody[b.cell];
  }

  /** Snap a point to the nearest passable cell for the domain. */
  snap(domain: PathDomain, x: number, y: number, radius = 5): { x: number; y: number; cell: number } | null {
    const c = worldToCell(x, y);
    if (this.passable(domain, c)) return { x, y, cell: c };
    const n = this.geo.nearestCell(x, y, radius, (cc) => this.passable(domain, cc));
    if (n < 0) return null;
    return { x: cellCenterX(n), y: cellCenterY(n), cell: n };
  }

  /** Straight line walkable within one medium (no land/water switching, no big cost jumps). */
  los(domain: PathDomain, ax: number, ay: number, bx: number, by: number): boolean {
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(dist / (CELL * 0.4)));
    const c0 = worldToCell(ax, ay);
    const c1 = worldToCell(bx, by);
    if (!this.passable(domain, c1)) return false;
    const maxCost = Math.max(this.cost(domain, c0), this.cost(domain, c1)) * 1.3 + 0.01;
    for (let i = 1; i < steps; i++) {
      const c = worldToCell(ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps);
      if (!this.passable(domain, c)) return false;
      if (domain === 'land' && this.cost(domain, c) > maxCost) return false;
    }
    return true;
  }

  /** Returns flattened world waypoints (excluding start) or null if unreachable. */
  find(domain: PathDomain, sx: number, sy: number, tx: number, ty: number, maxExpand = N): number[] | null {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const start = this.snap(domain, sx, sy, 3);
    const goal = this.snap(domain, tx, ty, 6);
    if (!start || !goal) return null;
    const s = start.cell;
    const t = goal.cell;
    // Different landmass / sea: unreachable without transport, fail fast.
    if (domain === 'land' && this.geo.landComp[s] !== this.geo.landComp[t]) return null;
    if (domain === 'naval' && this.geo.waterBody[s] !== this.geo.waterBody[t]) return null;
    const gx = t % COLS;
    const gy = (t / COLS) | 0;
    if (s === t) return [goal.x, goal.y];
    if (this.los(domain, sx, sy, goal.x, goal.y) && Math.hypot(goal.x - sx, goal.y - sy) < CELL * 30) return [goal.x, goal.y];

    this.gen++;
    if (this.gen > 0xfffffff0) {
      this.gen = 1;
      this.stamp.fill(0);
      this.closed.fill(0);
    }
    const gen = this.gen;
    const heap = this.heap;
    heap.clear();
    const gArr = this.g;
    const came = this.came;
    const stamp = this.stamp;
    const closed = this.closed;
    const naval = domain === 'naval';
    const geo = this.geo;
    const h = (c: number) => {
      const dx = Math.abs((c % COLS) - gx);
      const dy = Math.abs(((c / COLS) | 0) - gy);
      return (dx + dy + (SQRT2 - 2) * Math.min(dx, dy)) * 0.999;
    };
    stamp[s] = gen;
    gArr[s] = 0;
    came[s] = -1;
    heap.push(s, h(s));
    let expanded = 0;
    let found = false;
    while (heap.size > 0) {
      const c = heap.pop();
      if (closed[c] === gen) continue;
      closed[c] = gen;
      if (c === t) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const cx = c % COLS;
      const cy = (c / COLS) | 0;
      const gc = gArr[c];
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= ROWS) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= COLS) continue;
          const nc = ny * COLS + nx;
          if (closed[nc] === gen) continue;
          let step: number;
          if (naval) {
            if (!geo.isNavigable(nc)) continue;
            step = 1;
          } else {
            if (!geo.isLandPassable(nc)) continue;
            step = TERRAIN_COST[geo.terrain[nc]];
          }
          const ng = gc + step * (dx && dy ? SQRT2 : 1);
          if (stamp[nc] !== gen || ng < gArr[nc]) {
            stamp[nc] = gen;
            gArr[nc] = ng;
            came[nc] = c;
            heap.push(nc, ng + h(nc));
          }
        }
      }
    }
    this.lastExpanded = expanded;
    if (!found) {
      this.lastMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      return null;
    }
    // Reconstruct cell path.
    const cells: number[] = [];
    for (let c = t; c !== -1; c = came[c]) cells.push(c);
    cells.reverse();
    // String-pulling smoothing.
    const out: number[] = [];
    let ax = sx;
    let ay = sy;
    let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      const limit = Math.min(cells.length - 1, i + 40);
      j = limit;
      while (j > i + 1) {
        const px = j === cells.length - 1 ? goal.x : cellCenterX(cells[j]);
        const py = j === cells.length - 1 ? goal.y : cellCenterY(cells[j]);
        if (this.los(domain, ax, ay, px, py)) break;
        j--;
      }
      const px = j === cells.length - 1 ? goal.x : cellCenterX(cells[j]);
      const py = j === cells.length - 1 ? goal.y : cellCenterY(cells[j]);
      out.push(px, py);
      ax = px;
      ay = py;
      i = j;
    }
    if (out.length === 0) out.push(goal.x, goal.y);
    this.lastMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    return out;
  }
}

/** Queues path requests and processes them within a per-step expansion budget. */
export class PathService {
  readonly finder: Pathfinder;
  private queue: PathRequest[] = [];
  private groupCache = new Map<number, { sx: number; sy: number; tx: number; ty: number; path: number[] }[]>();
  processedTotal = 0;

  constructor(geo: WorldGeo) {
    this.finder = new Pathfinder(geo);
  }

  get pending(): number {
    return this.queue.length;
  }

  request(req: PathRequest): void {
    // Replace an existing request for the same unit.
    const i = this.queue.findIndex((q) => q.unitId === req.unitId);
    if (i >= 0) this.queue.splice(i, 1);
    this.queue.push(req);
  }

  cancel(unitId: number): void {
    const i = this.queue.findIndex((q) => q.unitId === unitId);
    if (i >= 0) this.queue.splice(i, 1);
  }

  process(budget = 30000): void {
    let spent = 0;
    this.groupCache.clear();
    while (this.queue.length && (spent < budget || spent === 0)) {
      const r = this.queue.shift()!;
      let path: number[] | null = null;
      const cache = r.group > 0 ? this.groupCache.get(r.group) : undefined;
      if (cache) {
        for (const c of cache) {
          if (Math.hypot(c.sx - r.sx, c.sy - r.sy) < CELL * 3 && Math.hypot(c.tx - r.tx, c.ty - r.ty) < CELL * 4) {
            path = c.path.slice();
            path[path.length - 2] = r.tx;
            path[path.length - 1] = r.ty;
            if (r.domain === 'naval' && !this.finder.passable('naval', worldToCell(r.tx, r.ty))) {
              path[path.length - 2] = c.path[c.path.length - 2];
              path[path.length - 1] = c.path[c.path.length - 1];
            }
            break;
          }
        }
      }
      if (!path) {
        path = this.finder.find(r.domain, r.sx, r.sy, r.tx, r.ty);
        spent += Math.max(200, this.finder.lastExpanded);
        if (path && r.group > 0) {
          let list = this.groupCache.get(r.group);
          if (!list) this.groupCache.set(r.group, (list = []));
          list.push({ sx: r.sx, sy: r.sy, tx: r.tx, ty: r.ty, path });
        }
      }
      this.processedTotal++;
      r.cb(path);
    }
  }

  clear(): void {
    this.queue.length = 0;
  }
}

export function isWaterTerrain(t: number): boolean {
  return t === Terrain.Water;
}
