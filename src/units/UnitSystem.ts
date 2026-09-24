// Unit lifecycle, orders and movement.
import type { City, FactionId, Order, Unit } from '../core/types';
import { unitDef, EMBARK_SPEED } from '../data/units';
import { TERRAIN_SPEED } from '../map/WorldGeo';
import { worldToCell, WORLD_W, WORLD_H } from '../config';
import type { Sim } from '../core/Simulation';
import { atWar } from '../core/GameState';
import type { PathDomain } from '../map/Pathfinding';

export const CAPTURE_RADIUS = 56;

export class UnitSystem {
  private groupSeq = 1;
  private sepTimer = 0;
  private tmp: Unit[] = [];

  constructor(private sim: Sim) {}

  spawn(type: string, owner: FactionId, x: number, y: number): Unit {
    const s = this.sim.state;
    const def = unitDef(type);
    const st = this.sim.tech.stats(owner, type);
    const mods = this.sim.tech.getMods(owner);
    const rng = this.sim.rng;
    const u: Unit = {
      id: s.nextUnitId++,
      type,
      owner,
      x: Math.max(4, Math.min(WORLD_W - 4, x)),
      y: Math.max(4, Math.min(WORLD_H - 4, y)),
      angle: rng.range(-Math.PI, Math.PI),
      turret: 0,
      hp: st.maxHp,
      maxHp: st.maxHp,
      order: null,
      path: null,
      pathIdx: 0,
      pathPending: false,
      repathAt: 0,
      targetUnit: -1,
      targetCity: -1,
      cooldown: rng.range(0, def.reload),
      scanCd: rng.range(0, 0.4),
      missiles: def.missiles ? def.missiles + mods.missileCap : 0,
      missileCd: 0,
      missileRegen: 0,
      xp: 0,
      rank: 0,
      kills: 0,
      embarked: false,
      moving: false,
      revealed: 0,
      detMask: 0,
      anchorX: x,
      anchorY: y,
      lastHit: -99,
      aiTask: 0,
      dead: false,
    };
    u.turret = u.angle;
    u.embarked = def.domain === 'land' && !this.sim.geo.land[worldToCell(u.x, u.y)];
    s.units.set(u.id, u);
    this.sim.bus.emit('unitCreated', { unit: u });
    return u;
  }

  remove(u: Unit, killed: boolean, by: FactionId | null): void {
    if (u.dead) return;
    u.dead = true;
    this.sim.state.units.delete(u.id);
    this.sim.paths.cancel(u.id);
    this.sim.bus.emit('unitRemoved', { unit: u, killed, by });
  }

  domainOf(u: Unit): PathDomain {
    return unitDef(u.type).domain === 'naval' ? 'naval' : 'land';
  }

  newGroup(): number {
    return this.groupSeq++;
  }

  // ------------------------------------------------------------------ orders

  private setOrder(u: Unit, order: Order | null): void {
    u.order = order;
    u.path = null;
    u.pathIdx = 0;
    u.pathPending = false;
    u.repathAt = 0;
    this.sim.paths.cancel(u.id);
    if (!order || order.kind !== 'attack') {
      u.targetUnit = -1;
      u.targetCity = -1;
    }
  }

  /** Spiral formation offsets so groups don't collapse onto one point. */
  private formation(n: number, i: number, spacing: number): [number, number] {
    if (n <= 1 || i === 0) return [0, 0];
    let ring = 1;
    while (1 + 3 * ring * (ring + 1) <= i) ring++;
    const k = i - (1 + 3 * (ring - 1) * ring);
    const a = (k / (6 * ring)) * Math.PI * 2 + ring * 0.5;
    return [Math.cos(a) * spacing * ring, Math.sin(a) * spacing * ring];
  }

  orderMove(units: Unit[], x: number, y: number, attackMove = false): void {
    const group = this.newGroup();
    const land = units.filter((u) => this.domainOf(u) === 'land');
    const naval = units.filter((u) => this.domainOf(u) === 'naval');
    const apply = (list: Unit[], spacing: number) => {
      list.forEach((u, i) => {
        const [ox, oy] = this.formation(list.length, i, spacing);
        const tx = Math.max(4, Math.min(WORLD_W - 4, x + ox));
        const ty = Math.max(4, Math.min(WORLD_H - 4, y + oy));
        this.setOrder(u, { kind: attackMove ? 'attackMove' : 'move', x: tx, y: ty });
        this.requestPath(u, tx, ty, group);
      });
    };
    apply(land, 20);
    apply(naval, 38);
  }

  orderAttackUnit(units: Unit[], target: Unit): void {
    const group = this.newGroup();
    for (const u of units) {
      if (u.owner === target.owner) continue;
      const def = unitDef(u.type);
      if (!(def.vs[unitDef(target.type).cls] ?? 0)) {
        this.setOrder(u, { kind: 'attackMove', x: target.x, y: target.y });
        this.requestPath(u, target.x, target.y, group);
        continue;
      }
      this.setOrder(u, { kind: 'attack', x: target.x, y: target.y, targetUnit: target.id });
      u.targetUnit = target.id;
      u.targetCity = -1;
    }
  }

  orderAttackCity(units: Unit[], city: City): void {
    for (const u of units) {
      if (!atWar(this.sim.state, u.owner, city.owner)) {
        // friendly city: garrison it
        this.orderMove([u], city.x, city.y);
        continue;
      }
      this.setOrder(u, { kind: 'attack', x: city.x, y: city.y, targetCity: city.id });
      u.targetCity = city.id;
      u.targetUnit = -1;
    }
  }

  orderStop(units: Unit[]): void {
    for (const u of units) {
      this.setOrder(u, null);
      u.anchorX = u.x;
      u.anchorY = u.y;
    }
  }

  orderHold(units: Unit[]): void {
    for (const u of units) {
      this.setOrder(u, { kind: 'hold', x: u.x, y: u.y });
      u.anchorX = u.x;
      u.anchorY = u.y;
    }
  }

  requestPath(u: Unit, tx: number, ty: number, group = 0): void {
    const order = u.order;
    u.pathPending = true;
    this.sim.paths.request({
      unitId: u.id,
      domain: this.domainOf(u),
      sx: u.x,
      sy: u.y,
      tx,
      ty,
      group,
      cb: (path) => {
        if (u.dead || u.order !== order) return;
        u.pathPending = false;
        if (!path) {
          u.path = null;
          if (order && (order.kind === 'move' || order.kind === 'attackMove')) {
            u.order = null;
            u.anchorX = u.x;
            u.anchorY = u.y;
            if (u.owner === this.sim.state.player) this.sim.notifyOnce('noroute', 'No route to destination', 'warn');
          }
          return;
        }
        u.path = path;
        u.pathIdx = 0;
      },
    });
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    const sim = this.sim;
    const s = sim.state;
    for (const u of s.units.values()) {
      if (u.dead) continue;
      const def = unitDef(u.type);
      const st = sim.tech.stats(u.owner, u.type);
      let halt = false;
      const o = u.order;
      if (o) {
        switch (o.kind) {
          case 'move':
          case 'attackMove': {
            if (!u.path && !u.pathPending) {
              u.order = null;
              u.anchorX = u.x;
              u.anchorY = u.y;
            } else if (o.kind === 'attackMove' && u.targetUnit >= 0) {
              const t = s.units.get(u.targetUnit);
              if (t && Math.hypot(t.x - u.x, t.y - u.y) <= st.range) halt = true;
            } else if (o.kind === 'attackMove' && u.targetCity >= 0) {
              const c = s.cities[u.targetCity];
              if (c && c.hp > 0 && Math.hypot(c.x - u.x, c.y - u.y) <= st.range) halt = true;
            }
            break;
          }
          case 'attack': {
            if (o.targetUnit !== undefined) {
              const t = s.units.get(o.targetUnit);
              if (!t || t.dead || !sim.combat.canSee(u.owner, t)) {
                this.setOrder(u, null);
                u.anchorX = u.x;
                u.anchorY = u.y;
                break;
              }
              u.targetUnit = t.id;
              const d = Math.hypot(t.x - u.x, t.y - u.y);
              if (d <= st.range * 0.92 && d >= (def.minRange ?? 0)) {
                halt = true;
              } else if (s.time >= u.repathAt) {
                u.repathAt = s.time + 1.5;
                this.chase(u, t.x, t.y);
              }
            } else if (o.targetCity !== undefined) {
              const c = s.cities[o.targetCity];
              if (!c || !atWar(s, u.owner, c.owner)) {
                this.setOrder(u, null);
                u.anchorX = u.x;
                u.anchorY = u.y;
                break;
              }
              u.targetCity = c.id;
              const d = Math.hypot(c.x - u.x, c.y - u.y);
              const naval = def.domain === 'naval';
              const wantClose = !naval && c.hp <= 0 && (def.captureRate ?? 0) > 0;
              const stopAt = wantClose ? CAPTURE_RADIUS * 0.5 : Math.max(24, st.range * 0.85);
              if (d <= stopAt) {
                halt = true;
              } else if (!u.pathPending && (!u.path || s.time >= u.repathAt)) {
                u.repathAt = s.time + 6;
                const tx = wantClose || !naval ? c.x : c.port ? c.portX : c.x;
                const ty = wantClose || !naval ? c.y : c.port ? c.portY : c.y;
                this.requestPath(u, tx, ty);
              }
            }
            break;
          }
          case 'hold':
            halt = true;
            break;
        }
      } else {
        // Idle: engage nearby enemies within a leash, otherwise return to anchor.
        halt = true;
        if (u.targetUnit >= 0) {
          const t = s.units.get(u.targetUnit);
          if (t && !t.dead) {
            const d = Math.hypot(t.x - u.x, t.y - u.y);
            const leash = Math.hypot(t.x - u.anchorX, t.y - u.anchorY);
            if (d > st.range * 0.92 && leash < 200 && !def.stationaryFire) {
              if (!u.path || s.time >= u.repathAt) {
                u.repathAt = s.time + 1.5;
                this.chase(u, t.x, t.y);
              }
              halt = false;
            }
          }
        } else if (u.path) {
          halt = false;
        } else if (Math.hypot(u.x - u.anchorX, u.y - u.anchorY) > 48 && s.time >= u.repathAt) {
          u.repathAt = s.time + 3;
          this.chase(u, u.anchorX, u.anchorY);
          halt = false;
        }
      }

      if (!halt && u.path) this.advance(u, dt, st.speed, def.domain === 'naval', def.cls);
      else u.moving = false;

      if (def.domain === 'land') u.embarked = !sim.geo.land[worldToCell(u.x, u.y)];
    }

    this.sepTimer -= dt;
    if (this.sepTimer <= 0) {
      this.sepTimer = 0.3;
      this.separate();
    }
  }

  /** Move toward a point directly if possible, otherwise request a path. */
  private chase(u: Unit, tx: number, ty: number): void {
    const domain = this.domainOf(u);
    const d = Math.hypot(tx - u.x, ty - u.y);
    if (d < 320 && this.sim.paths.finder.los(domain, u.x, u.y, tx, ty)) {
      u.path = [tx, ty];
      u.pathIdx = 0;
      u.pathPending = false;
    } else if (!u.pathPending) {
      this.requestPath(u, tx, ty);
    }
  }

  private advance(u: Unit, dt: number, baseSpeed: number, naval: boolean, cls: string): void {
    const sim = this.sim;
    const path = u.path!;
    if (u.pathIdx * 2 >= path.length) {
      u.path = null;
      u.moving = false;
      return;
    }
    let speed = baseSpeed;
    if (!naval) {
      if (u.embarked) speed = EMBARK_SPEED * (baseSpeed / unitDef(u.type).speed);
      else speed *= TERRAIN_SPEED[sim.geo.terrain[worldToCell(u.x, u.y)]];
    }
    const fs = sim.state.factions[u.owner];
    if (fs) {
      if ((naval || cls === 'armor') && fs.res.fuel <= 0 && fs.income.fuel < 0) speed *= 0.5;
      for (const e of fs.effects) speed *= e.mods.speedMult ?? 1;
    }
    let step = speed * dt;
    while (step > 0 && u.pathIdx * 2 < path.length) {
      const tx = path[u.pathIdx * 2];
      const ty = path[u.pathIdx * 2 + 1];
      const dx = tx - u.x;
      const dy = ty - u.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.01) u.angle = Math.atan2(dy, dx);
      if (d <= step) {
        u.x = tx;
        u.y = ty;
        step -= d;
        u.pathIdx++;
      } else {
        u.x += (dx / d) * step;
        u.y += (dy / d) * step;
        step = 0;
      }
    }
    u.moving = true;
    if (u.pathIdx * 2 >= path.length) {
      u.path = null;
      if (!u.order || u.order.kind === 'move' || u.order.kind === 'attackMove') {
        u.anchorX = u.x;
        u.anchorY = u.y;
      }
    }
  }

  /** Light separation so idle stacks spread out into readable formations. */
  private separate(): void {
    const sim = this.sim;
    const geo = sim.geo;
    for (const u of sim.state.units.values()) {
      if (u.dead || u.moving) continue;
      const naval = unitDef(u.type).domain === 'naval';
      const r = naval ? 30 : 17;
      const near = sim.spatial.query(u.x, u.y, r, this.tmp);
      let px = 0;
      let py = 0;
      for (const o of near) {
        if (o === u || o.owner !== u.owner) continue;
        if ((unitDef(o.type).domain === 'naval') !== naval) continue;
        let dx = u.x - o.x;
        let dy = u.y - o.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          dx = Math.cos(u.id);
          dy = Math.sin(u.id);
          d = 1;
        }
        const push = (r - d) * 0.35;
        px += (dx / d) * push;
        py += (dy / d) * push;
      }
      if (px === 0 && py === 0) continue;
      const nx = u.x + Math.max(-6, Math.min(6, px));
      const ny = u.y + Math.max(-6, Math.min(6, py));
      const c = worldToCell(nx, ny);
      if (naval ? !geo.isNavigable(c) : geo.land[c] !== geo.land[worldToCell(u.x, u.y)]) continue;
      u.x = Math.max(4, Math.min(WORLD_W - 4, nx));
      u.y = Math.max(4, Math.min(WORLD_H - 4, ny));
      if (!u.order) {
        u.anchorX = u.x;
        u.anchorY = u.y;
      }
    }
  }
}
