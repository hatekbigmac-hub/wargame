// Unified combat: per-faction visibility, sonar detection, target acquisition,
// projectiles (bullets, shells, torpedoes, missiles, air strikes) and damage.
import type { City, FactionId, Projectile, ProjectileKind, Unit, UnitDef } from '../core/types';
import { COLS, ROWS, CELL, worldToCell } from '../config';
import { unitDef } from '../data/units';
import { TERRAIN_COVER } from '../map/WorldGeo';
import { atWar } from '../core/GameState';
import type { Sim } from '../core/Simulation';

const N = COLS * ROWS;
export const RANK_XP = [0, 30, 90, 200];
export const CITY_MISSILE_RANGE = 900;
export const CITY_MISSILE_DAMAGE = 150;

export function projectilePos(p: Projectile, t = p.t): { x: number; y: number } {
  const k = Math.max(0, Math.min(1, t));
  if (p.kind === 'missile' || p.kind === 'shell' || p.kind === 'rocket' || p.kind === 'air') {
    const a = (1 - k) * (1 - k);
    const b = 2 * (1 - k) * k;
    const c = k * k;
    return { x: a * p.sx + b * p.cx + c * p.tx, y: a * p.sy + b * p.cy + c * p.ty };
  }
  return { x: p.sx + (p.tx - p.sx) * k, y: p.sy + (p.ty - p.sy) * k };
}

const SPEED: Record<ProjectileKind, number> = {
  bullet: 900, cannon: 700, flak: 1000, shell: 330, rocket: 380, torpedo: 150, missile: 420, air: 260,
};

export class CombatSystem {
  readonly visMask = new Uint16Array(N);
  projectiles: Projectile[] = [];
  private projSeq = 1;
  private visTimer = 0;
  private detTimer = 0;
  private discCache = new Map<number, Int16Array>();
  private tmp: Unit[] = [];

  constructor(private sim: Sim) {}

  bit(f: FactionId): number {
    const fs = this.sim.state.factions[f];
    return fs ? 1 << fs.index : 0;
  }

  canSee(faction: FactionId, u: Unit): boolean {
    if (u.owner === faction) return true;
    const b = this.bit(faction);
    if (!(this.visMask[worldToCell(u.x, u.y)] & b)) return false;
    if (unitDef(u.type).stealth && !(u.detMask & b)) return false;
    return true;
  }

  cellVisible(faction: FactionId, cell: number): boolean {
    return (this.visMask[cell] & this.bit(faction)) !== 0;
  }

  // ---------------------------------------------------------------- visibility

  private disc(r: number): Int16Array {
    let d = this.discCache.get(r);
    if (!d) {
      const arr: number[] = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) arr.push(dx, dy);
      d = new Int16Array(arr);
      this.discCache.set(r, d);
    }
    return d;
  }

  private mark(x: number, y: number, radius: number, bit: number): void {
    const r = Math.max(1, Math.round(radius / CELL));
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const d = this.disc(r);
    const vm = this.visMask;
    for (let i = 0; i < d.length; i += 2) {
      const nx = cx + d[i];
      const ny = cy + d[i + 1];
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      vm[ny * COLS + nx] |= bit;
    }
  }

  updateVisibility(): void {
    const s = this.sim.state;
    this.visMask.fill(0);
    for (const u of s.units.values()) {
      if (u.dead) continue;
      this.mark(u.x, u.y, this.sim.tech.stats(u.owner, u.type).detection, this.bit(u.owner));
    }
    for (const c of s.cities) {
      this.mark(c.x, c.y, 150 + c.size * 15 + (c.buildings.radar ?? 0) * 70, this.bit(c.owner));
    }
  }

  private updateDetection(): void {
    const s = this.sim.state;
    for (const u of s.units.values()) {
      const def = unitDef(u.type);
      if (!def.stealth || u.dead) continue;
      let mask = 0;
      const cell = worldToCell(u.x, u.y);
      if (u.revealed > 0) mask |= this.visMask[cell];
      const stealth = this.sim.tech.getMods(u.owner).stealth;
      this.sim.spatial.forEachInRange(u.x, u.y, 380, (o, d2) => {
        if (o.owner === u.owner) return;
        const od = unitDef(o.type);
        if (!od.sonar) return;
        const r = od.sonar * this.sim.tech.getMods(o.owner).sonar * stealth;
        if (d2 <= r * r) mask |= this.bit(o.owner);
      });
      for (const c of s.cities) {
        if (!c.port || c.owner === u.owner) continue;
        const r = (60 + (c.buildings.radar ?? 0) * 90) * stealth;
        const dx = c.x - u.x;
        const dy = c.y - u.y;
        if (dx * dx + dy * dy <= r * r) mask |= this.bit(c.owner);
      }
      u.detMask = mask & ~this.bit(u.owner);
    }
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    const sim = this.sim;
    const s = sim.state;
    this.visTimer -= dt;
    if (this.visTimer <= 0) {
      this.visTimer = 0.5;
      this.updateVisibility();
    }
    this.detTimer -= dt;
    if (this.detTimer <= 0) {
      this.detTimer = 0.5;
      this.updateDetection();
    }

    for (const u of s.units.values()) {
      if (u.dead) continue;
      const def = unitDef(u.type);
      u.cooldown -= dt;
      if (u.revealed > 0) u.revealed -= dt;
      if (def.missiles) {
        if (u.missileCd > 0) u.missileCd -= dt;
        const max = def.missiles + sim.tech.getMods(u.owner).missileCap;
        if (u.missiles < max) {
          u.missileRegen += dt;
          if (u.missileRegen >= 45) {
            u.missileRegen = 0;
            u.missiles++;
          }
        }
      }
      u.scanCd -= dt;
      if (u.scanCd <= 0) {
        u.scanCd = 0.35 + sim.rng.next() * 0.15;
        this.acquire(u, def);
      }
      if (u.cooldown <= 0) this.tryFire(u, def);
    }
    this.updateProjectiles(dt);
  }

  private acquire(u: Unit, def: UnitDef): void {
    const s = this.sim.state;
    if (u.embarked) {
      if (!u.order || u.order.kind !== 'attack') {
        u.targetUnit = -1;
        u.targetCity = -1;
      }
      return;
    }
    const st = this.sim.tech.stats(u.owner, u.type);
    const o = u.order;
    if (o && o.kind === 'attack' && o.targetUnit !== undefined) return; // fixed target
    const extra = !o || o.kind === 'attackMove' ? 90 : 0;
    const searchR = st.range + extra;
    let best: Unit | null = null;
    let bestScore = Infinity;
    const minR = def.minRange ?? 0;
    this.sim.spatial.forEachInRange(u.x, u.y, searchR, (t, d2) => {
      if (t.owner === u.owner || !atWar(s, u.owner, t.owner)) return;
      const vs = def.vs[unitDef(t.type).cls] ?? 0;
      if (vs <= 0) return;
      if (d2 < minR * minR) return;
      if (!this.canSee(u.owner, t)) return;
      const score = (d2 + 400) / vs * (0.5 + 0.5 * (t.hp / t.maxHp)) * (t.embarked ? 0.5 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    });
    u.targetUnit = best ? (best as Unit).id : -1;
    // City targets: keep attack-order city, otherwise opportunistic bombardment.
    if (o && o.kind === 'attack' && o.targetCity !== undefined) {
      u.targetCity = o.targetCity;
      return;
    }
    u.targetCity = -1;
    if (!best && (def.vs.city ?? 0) > 0) {
      let bestD = (st.range + 10) * (st.range + 10);
      for (const c of s.cities) {
        if (c.hp <= 0 || !atWar(s, u.owner, c.owner)) continue;
        const dx = c.x - u.x;
        const dy = c.y - u.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
          bestD = d2;
          u.targetCity = c.id;
        }
      }
    }
  }

  private tryFire(u: Unit, def: UnitDef): void {
    if (u.embarked) return;
    if (def.stationaryFire && u.moving) return;
    const s = this.sim.state;
    const st = this.sim.tech.stats(u.owner, u.type);
    if (u.targetUnit >= 0) {
      const t = s.units.get(u.targetUnit);
      if (t && !t.dead && this.canSee(u.owner, t)) {
        const d = Math.hypot(t.x - u.x, t.y - u.y);
        if (d <= st.range && d >= (def.minRange ?? 0)) {
          this.fire(u, def, st.attack, t.x, t.y, t.id, -1);
          return;
        }
      } else if (!u.order || u.order.kind !== 'attack') {
        u.targetUnit = -1;
      }
    }
    if (u.targetCity >= 0 && (def.vs.city ?? 0) > 0) {
      const c = s.cities[u.targetCity];
      if (c && c.hp > 0 && atWar(s, u.owner, c.owner)) {
        const d = Math.hypot(c.x - u.x, c.y - u.y);
        if (d <= st.range + 14) this.fire(u, def, st.attack, c.x, c.y, -1, c.id);
      }
    }
  }

  private attackMult(owner: FactionId, rank: number): number {
    let m = 1 + rank * 0.1;
    const fs = this.sim.state.factions[owner];
    if (fs) for (const e of fs.effects) m *= e.mods.attackMult ?? 1;
    return m;
  }

  private fire(u: Unit, def: UnitDef, attack: number, tx: number, ty: number, targetUnit: number, targetCity: number): void {
    const rng = this.sim.rng;
    u.cooldown = def.reload * rng.range(0.9, 1.1);
    u.turret = Math.atan2(ty - u.y, tx - u.x);
    if (def.domain === 'naval' || !this.hasTurret(def)) u.angle = def.domain === 'naval' ? u.angle : u.turret;
    if (def.stealth) u.revealed = 5;
    const p = this.makeProjectile(def.projectile, u.owner, u.x, u.y, tx, ty, targetUnit, targetCity);
    p.src = u.id;
    p.attack = attack * this.attackMult(u.owner, u.rank);
    p.vs = def.vs;
    p.splash = def.splash ?? 0;
    if (def.projectile === 'air') this.rollIntercept(p, 0.5);
    this.projectiles.push(p);
    this.sim.bus.emit('unitFired', { unit: u, city: null, kind: def.projectile, x: u.x, y: u.y, tx, ty });
    this.sim.bus.emit('projectileSpawn', { p });
  }

  private hasTurret(def: UnitDef): boolean {
    return !!def.turret;
  }

  fireFromCity(c: City, t: Unit): void {
    const attack = (6 + c.size * 3) * (1 + (c.buildings.fortress ?? 0) * 0.3);
    const naval = unitDef(t.type).domain === 'naval';
    const p = this.makeProjectile(naval || c.size >= 3 ? 'shell' : 'cannon', c.owner, c.x, c.y - 4, t.x, t.y, t.id, -1);
    p.srcCity = c.id;
    p.attack = attack;
    p.vs = { infantry: 1, armor: 0.9, ship: 1, sub: 0.6 };
    this.projectiles.push(p);
    this.sim.bus.emit('unitFired', { unit: null, city: c, kind: p.kind, x: c.x, y: c.y, tx: t.x, ty: t.y });
    this.sim.bus.emit('projectileSpawn', { p });
  }

  private makeProjectile(kind: ProjectileKind, owner: FactionId, sx: number, sy: number, tx: number, ty: number, targetUnit: number, targetCity: number): Projectile {
    const dist = Math.hypot(tx - sx, ty - sy);
    let dur = dist / SPEED[kind];
    if (kind === 'shell' || kind === 'rocket') dur += 0.35;
    if (kind === 'missile') dur += 1.1;
    const rng = this.sim.rng;
    let cx = (sx + tx) / 2;
    let cy = (sy + ty) / 2;
    if (kind === 'shell' || kind === 'rocket') cy -= dist * 0.35;
    if (kind === 'missile') {
      const side = rng.chance(0.5) ? 1 : -1;
      const nx = -(ty - sy) / (dist || 1);
      const ny = (tx - sx) / (dist || 1);
      cx += nx * dist * 0.18 * side;
      cy += ny * dist * 0.18 * side - dist * 0.3;
    }
    if (kind === 'air') cy -= dist * 0.1;
    return {
      id: this.projSeq++, kind, owner, src: -1, srcCity: -1, sx, sy, tx, ty, cx, cy, t: 0, dur: Math.max(0.08, dur),
      targetUnit, targetCity, attack: 0, vs: {}, splash: 0, fixedDamage: 0, interceptAt: -1, interceptBy: null, done: false,
    };
  }

  // ---------------------------------------------------------------- missiles

  missileRangeOf(u: Unit): number {
    return unitDef(u.type).missileRange ?? 0;
  }

  canLaunch(u: Unit): boolean {
    const def = unitDef(u.type);
    return !!def.missiles && u.missiles >= 1 && u.missileCd <= 0 && !u.embarked && !u.dead;
  }

  /** Launch a missile from a unit at a target unit or city. Returns false if invalid. */
  launchMissile(u: Unit, target: { unit?: Unit; city?: City }): boolean {
    if (!this.canLaunch(u)) return false;
    const def = unitDef(u.type);
    const tx = target.unit ? target.unit.x : target.city ? target.city.x : NaN;
    const ty = target.unit ? target.unit.y : target.city ? target.city.y : NaN;
    if (!isFinite(tx)) return false;
    if (Math.hypot(tx - u.x, ty - u.y) > (def.missileRange ?? 0)) return false;
    if (target.unit && (!this.canSee(u.owner, target.unit) || !atWar(this.sim.state, u.owner, target.unit.owner))) return false;
    if (target.city && !atWar(this.sim.state, u.owner, target.city.owner)) return false;
    u.missiles--;
    u.missileCd = 3;
    u.turret = Math.atan2(ty - u.y, tx - u.x);
    const dmg = (def.missileDamage ?? 120) * this.sim.tech.getMods(u.owner).missileDmg;
    this.spawnMissile(u.owner, u.x, u.y, tx, ty, target.unit?.id ?? -1, target.city?.id ?? -1, dmg, u.id, -1);
    return true;
  }

  launchCityMissile(c: City, target: { unit?: Unit; city?: City }): boolean {
    if (c.missiles < 1 || c.missileCd > 0) return false;
    const tx = target.unit ? target.unit.x : target.city!.x;
    const ty = target.unit ? target.unit.y : target.city!.y;
    if (Math.hypot(tx - c.x, ty - c.y) > CITY_MISSILE_RANGE) return false;
    if (target.unit && !this.canSee(c.owner, target.unit)) return false;
    const owner = target.unit?.owner ?? target.city!.owner;
    if (!atWar(this.sim.state, c.owner, owner)) return false;
    c.missiles--;
    c.missileCd = 4;
    const dmg = CITY_MISSILE_DAMAGE * this.sim.tech.getMods(c.owner).missileDmg;
    this.spawnMissile(c.owner, c.x, c.y, tx, ty, target.unit?.id ?? -1, target.city?.id ?? -1, dmg, -1, c.id);
    return true;
  }

  private spawnMissile(owner: FactionId, sx: number, sy: number, tx: number, ty: number, tu: number, tc: number, dmg: number, srcUnit: number, srcCity: number): void {
    const p = this.makeProjectile('missile', owner, sx, sy, tx, ty, tu, tc);
    p.src = srcUnit;
    p.srcCity = srcCity;
    p.fixedDamage = dmg;
    p.splash = 45;
    this.rollIntercept(p, 1);
    this.projectiles.push(p);
    this.sim.bus.emit('projectileSpawn', { p });
  }

  private rollIntercept(p: Projectile, factor: number): void {
    let survive = 1;
    let best: Unit | null = null;
    let bestD = Infinity;
    const s = this.sim.state;
    this.sim.spatial.forEachInRange(p.tx, p.ty, 320, (o, d2) => {
      if (!atWar(s, o.owner, p.owner)) return;
      const od = unitDef(o.type);
      if (!od.intercept || o.embarked) return;
      const r = (od.interceptRange ?? 200) * (this.sim.tech.stats(o.owner, o.type).range / od.range);
      if (d2 > r * r) return;
      const chance = Math.min(0.85, od.intercept + this.sim.tech.getMods(o.owner).intercept) * factor;
      survive *= 1 - chance;
      if (d2 < bestD) {
        bestD = d2;
        best = o;
      }
    });
    if (best && this.sim.rng.next() > survive) {
      p.interceptAt = 0.72 + this.sim.rng.next() * 0.18;
      p.interceptBy = { x: (best as Unit).x, y: (best as Unit).y };
    }
  }

  // ---------------------------------------------------------------- projectiles

  private updateProjectiles(dt: number): void {
    const s = this.sim.state;
    for (const p of this.projectiles) {
      if (p.done) continue;
      // Direct-fire rounds home onto moving targets.
      if (p.targetUnit >= 0 && (p.kind === 'bullet' || p.kind === 'cannon' || p.kind === 'flak' || p.kind === 'torpedo' || p.kind === 'air')) {
        const t = s.units.get(p.targetUnit);
        if (t && !t.dead) {
          p.tx = t.x;
          p.ty = t.y;
        }
      }
      p.t += dt / p.dur;
      if (p.interceptAt >= 0 && p.t >= p.interceptAt) {
        p.done = true;
        const pos = projectilePos(p);
        this.sim.bus.emit('missileIntercepted', { p, x: pos.x, y: pos.y, bx: p.interceptBy?.x ?? pos.x, by: p.interceptBy?.y ?? pos.y });
        continue;
      }
      if (p.t >= 1) {
        p.done = true;
        this.impact(p);
      }
    }
    if (this.projectiles.length > 64 || this.projectiles.some((p) => p.done)) {
      this.projectiles = this.projectiles.filter((p) => !p.done);
    }
  }

  private impact(p: Projectile): void {
    const s = this.sim.state;
    let hit = false;
    if (p.targetUnit >= 0) {
      const t = s.units.get(p.targetUnit);
      if (t && !t.dead) {
        const d = Math.hypot(t.x - p.tx, t.y - p.ty);
        if (d <= 16 + p.splash * 0.5) {
          hit = true;
          const dmg = p.fixedDamage > 0 ? p.fixedDamage * this.coverOf(t) : this.calcDamage(p.attack, p.vs[unitDef(t.type).cls] ?? 0, t);
          this.damageUnit(t, dmg, p.owner, p.src);
        }
      }
    }
    if (p.targetCity >= 0) {
      const c = s.cities[p.targetCity];
      if (c && atWar(s, p.owner, c.owner)) {
        hit = true;
        const cityDef = 6 + c.size * 3 + (c.buildings.fortress ?? 0) * 6;
        const dmg = p.fixedDamage > 0 ? p.fixedDamage * 1.3 : p.attack * (p.vs.city ?? 0.5) * (25 / (25 + cityDef)) * 1.6 * this.sim.rng.range(0.85, 1.15);
        this.damageCity(c, dmg, p.owner);
      }
    }
    if (p.splash > 0) {
      this.sim.spatial.forEachInRange(p.tx, p.ty, p.splash, (o) => {
        if (o.id === p.targetUnit || !atWar(s, p.owner, o.owner)) return;
        const tdef = unitDef(o.type);
        if (tdef.domain === 'naval' && tdef.stealth) return;
        const base = p.fixedDamage > 0 ? p.fixedDamage * 0.5 * this.coverOf(o) : this.calcDamage(p.attack, (p.vs[tdef.cls] ?? 0) * 0.5, o);
        if (base > 0) this.damageUnit(o, base, p.owner, p.src);
      });
    }
    this.sim.bus.emit('projectileImpact', { p, x: p.tx, y: p.ty, hit });
  }

  private coverOf(t: Unit): number {
    const def = unitDef(t.type);
    if (def.domain === 'naval') return 1;
    if (t.embarked) return 1.8;
    let cover = TERRAIN_COVER[this.sim.geo.terrain[worldToCell(t.x, t.y)]];
    const r = this.sim.geo.region[worldToCell(t.x, t.y)];
    if (r >= 0) {
      const c = this.sim.state.cities[r];
      if (c && c.owner === t.owner && Math.hypot(c.x - t.x, c.y - t.y) < 60) cover *= 0.75;
    }
    return cover;
  }

  calcDamage(attack: number, vs: number, t: Unit): number {
    if (vs <= 0) return 0;
    const st = this.sim.tech.stats(t.owner, t.type);
    const def = st.defense * (1 + t.rank * 0.1);
    return attack * vs * (25 / (25 + def)) * 1.6 * this.sim.rng.range(0.85, 1.15) * this.coverOf(t);
  }

  damageUnit(t: Unit, amount: number, by: FactionId, attackerId: number): void {
    if (t.dead || amount <= 0) return;
    const s = this.sim.state;
    t.hp -= amount;
    t.lastHit = s.time;
    this.sim.bus.emit('unitDamaged', { unit: t, amount });
    const attacker = attackerId >= 0 ? s.units.get(attackerId) : undefined;
    if (attacker) this.addXp(attacker, amount * 0.04);
    if (t.hp <= 0) {
      if (attacker) {
        attacker.kills++;
        this.addXp(attacker, 20);
      }
      const bf = s.factions[by];
      if (bf) bf.stats.killed++;
      const tf = s.factions[t.owner];
      if (tf) tf.stats.lost++;
      this.sim.units.remove(t, true, by);
      return;
    }
    // Retaliate if idle.
    if (attacker && !t.order && t.targetUnit < 0) {
      const tdef = unitDef(t.type);
      if ((tdef.vs[unitDef(attacker.type).cls] ?? 0) > 0) t.targetUnit = attacker.id;
    }
  }

  private addXp(u: Unit, xp: number): void {
    u.xp += xp;
    while (u.rank < 3 && u.xp >= RANK_XP[u.rank + 1]) u.rank++;
  }

  damageCity(c: City, amount: number, by: FactionId): void {
    if (amount <= 0) return;
    const was = c.hp;
    c.hp = Math.max(0, c.hp - amount);
    c.lastAttacked = this.sim.state.time;
    if (was > 0) this.sim.bus.emit('cityDamaged', { city: c, amount });
  }
}
