// Uniform-grid spatial hash for fast unit range queries.
import { WORLD_W, WORLD_H } from '../config';
import type { Unit } from './types';

const BUCKET = 128;
const BC = Math.ceil(WORLD_W / BUCKET);
const BR = Math.ceil(WORLD_H / BUCKET);

export class SpatialHash {
  private buckets: Unit[][] = Array.from({ length: BC * BR }, () => []);

  rebuild(units: Iterable<Unit>): void {
    for (const b of this.buckets) b.length = 0;
    for (const u of units) {
      if (u.dead) continue;
      const bx = Math.max(0, Math.min(BC - 1, Math.floor(u.x / BUCKET)));
      const by = Math.max(0, Math.min(BR - 1, Math.floor(u.y / BUCKET)));
      this.buckets[by * BC + bx].push(u);
    }
  }

  /** Calls fn for every live unit within radius r of (x,y). */
  forEachInRange(x: number, y: number, r: number, fn: (u: Unit, d2: number) => void): void {
    const bx0 = Math.max(0, Math.floor((x - r) / BUCKET));
    const bx1 = Math.min(BC - 1, Math.floor((x + r) / BUCKET));
    const by0 = Math.max(0, Math.floor((y - r) / BUCKET));
    const by1 = Math.min(BR - 1, Math.floor((y + r) / BUCKET));
    const r2 = r * r;
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = this.buckets[by * BC + bx];
        for (let i = 0; i < b.length; i++) {
          const u = b[i];
          if (u.dead) continue;
          const dx = u.x - x;
          const dy = u.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) fn(u, d2);
        }
      }
    }
  }

  query(x: number, y: number, r: number, out: Unit[] = []): Unit[] {
    out.length = 0;
    this.forEachInRange(x, y, r, (u) => out.push(u));
    return out;
  }
}
