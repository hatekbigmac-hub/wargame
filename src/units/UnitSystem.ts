// Unit lifecycle, orders and movement.
import type { City, FactionId, Order, Unit } from '../core/types';
import { unitDef } from '../data/units';
import { TERRAIN_SPEED } from '../map/WorldGeo';
import { worldToCell, cellCenterX, cellCenterY, WORLD_W, WORLD_H, CELL, COLS, ROWS } from '../config';
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
      detBy: [],
      bonus: 1,
      bonusUntil: 0,
      anchorX: x,
      anchorY: y,
      lastHit: -99,
      aiTask: 0,
      dead: false,
    };
    u.turret = u.angle;
    u.embarked = false;
    s.units.set(u.id, u);
    this.sim.bus.emit('unitCreated', { unit: u });
    return u;
  }

  remove(u: Unit, killed: boolean, by: FactionId | null): void {
    if (u.dead) return;
    u.dead = true;
    this.sim.state.units.delete(u.id);
    this.sim.paths.cancel(u.id);
    if (u.cargo?.length) {
      // Troops aboard a sunk transport are lost with it.
      const fs = this.sim.state.factions[u.owner];
      for (const c of u.cargo) {
        c.dead = true;
        if (killed && fs) fs.stats.lost++;
      }
      if (killed && u.owner === this.sim.state.player) this.sim.notify(`Transport sunk with ${u.cargo.length} units aboard!`, 'bad', u.x, u.y);
      u.cargo = [];
    }
    this.sim.bus.emit('unitRemoved', { unit: u, killed, by });
  }

  /** Find a unit on the map or aboard a transport. */
  find(id: number): Unit | undefined {
    const u = this.sim.state.units.get(id);
    if (u) return u;
    for (const t of this.sim.state.units.values()) if (t.cargo) for (const c of t.cargo) if (c.id === id) return c;
    return undefined;
  }

  capacityOf(t: Unit): number {
    return unitDef(t.type).capacity ?? 0;
  }

  /** Land units walk to the coast next to the transport and embark. */
  orderBoard(units: Unit[], transport: Unit): number {
    let n = 0;
    for (const u of units) {
      if (this.domainOf(u) !== 'land' || u.owner !== transport.owner) continue;
      this.setOrder(u, { kind: 'board', x: transport.x, y: transport.y, targetUnit: transport.id });
      n++;
    }
    return n;
  }

  /** Transport sails to the coast nearest (x, y) and lands its troops there. */
  orderUnload(t: Unit, x: number, y: number): void {
    this.setOrder(t, { kind: 'unload', x, y });
    const land = this.sim.geo.nearestCell(x, y, 3, (c) => this.sim.geo.land[c] === 1);
    const tx = land >= 0 ? cellCenterX(land) : x;
    const ty = land >= 0 ? cellCenterY(land) : y;
    this.requestPath(t, tx, ty);
  }

  private board(u: Unit, t: Unit): boolean {
    t.cargo ??= [];
    if (t.cargo.length >= this.capacityOf(t)) return false;
    this.setOrder(u, null);
    this.sim.state.units.delete(u.id);
    this.sim.paths.cancel(u.id);
    t.cargo.push(u);
    this.sim.bus.emit('unitRemoved', { unit: u, killed: false, by: null });
    this.sim.bus.emit('unitBoarded', { unit: u, transport: t });
    return true;
  }

  /** Put all cargo ashore on land cells near the transport. Returns units landed. */
  unloadNow(t: Unit, destX?: number, destY?: number): number {
    const geo = this.sim.geo;
    if (!t.cargo?.length) return 0;
    const spots: number[] = [];
    for (let r = 1; r <= 3 && spots.length < t.cargo.length; r++) {
      const cx = Math.floor(t.x / CELL);
      const cy = Math.floor(t.y / CELL);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const c = ny * COLS + nx;
        if (geo.land[c] && !spots.includes(c)) spots.push(c);
      }
    }
    if (!spots.length) return 0;
    const landed = t.cargo.splice(0);
    landed.forEach((u, i) => {
      const c = spots[i % spots.length];
      u.x = cellCenterX(c) + ((i * 7) % 9) - 4;
      u.y = cellCenterY(c) + ((i * 5) % 9) - 4;
      u.order = null;
      u.path = null;
      u.pathPending = false;
      u.moving = false;
      u.anchorX = u.x;
      u.anchorY = u.y;
      u.dead = false;
      this.sim.state.units.set(u.id, u);
      this.sim.bus.emit('unitCreated', { unit: u });
      this.sim.bus.emit('unitUnloaded', { unit: u, transport: t });
    });
    if (destX !== undefined && destY !== undefined && geo.landConnected(landed[0].x, landed[0].y, destX, destY)) {
      this.orderMove(landed, destX, destY, true);
    }
    return landed.length;
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
            if (u.owner === this.sim.state.player) {
              const land = this.domainOf(u) === 'land';
              this.sim.notifyOnce('noroute', land ? 'No land route — load troops onto a Transport Ship to cross the sea' : 'No sea route to that destination', 'warn');
            }
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
              if (!t || t.dead || !sim.combat.canSee(u.owner, t) || !atWar(s, u.owner, t.owner)) {
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
              const stopAt = wantClose ? 10 : Math.max(24, st.range * 0.85);
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
          case 'board': {
            halt = true;
            const t = o.targetUnit !== undefined ? s.units.get(o.targetUnit) : undefined;
            if (!t || t.dead || t.owner !== u.owner) {
              this.setOrder(u, null);
              break;
            }
            const d = Math.hypot(t.x - u.x, t.y - u.y);
            if (d <= 46) {
              if (!this.board(u, t)) {
                this.setOrder(u, null);
                if (u.owner === s.player) sim.notifyOnce('full', 'Transport is full (6 units)', 'warn');
              }
              break;
            }
            if (!u.pathPending && (!u.path || s.time >= u.repathAt)) {
              u.repathAt = s.time + 3;
              const shore = sim.geo.nearestCell(t.x, t.y, 3, (c) => sim.geo.land[c] === 1 && sim.geo.landConnected(u.x, u.y, cellCenterX(c), cellCenterY(c)));
              if (shore < 0) {
                if (u.owner === s.player) sim.notifyOnce('shore', 'Move the transport next to a coast your troops can reach', 'warn');
              } else if (Math.hypot(cellCenterX(shore) - u.x, cellCenterY(shore) - u.y) > 6) {
                this.requestPath(u, cellCenterX(shore), cellCenterY(shore));
              }
            }
            if (u.path) halt = false;
            break;
          }
          case 'unload': {
            if (!u.cargo?.length) {
              this.setOrder(u, null);
              halt = true;
              break;
            }
            if (!u.path && !u.pathPending) {
              const n = this.unloadNow(u, o.x, o.y);
              if (!n && u.owner === s.player) sim.notifyOnce('beach', 'No beach here — move the transport next to land', 'warn');
              this.setOrder(u, null);
              u.anchorX = u.x;
              u.anchorY = u.y;
              halt = true;
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

      u.embarked = false;
    }

    this.sepTimer -= dt;
    if (this.sepTimer <= 0) {
      this.sepTimer = 0.3;
      this.separate();
    }
  }

  private wadeAshore(u: Unit, dt: number): void {
    const geo = this.sim.geo;
    const c = geo.nearestCell(u.x, u.y, 2, (cc) => geo.land[cc] === 1);
    if (c < 0) return;
    const tx = cellCenterX(c);
    const ty = cellCenterY(c);
    const d = Math.hypot(tx - u.x, ty - u.y);
    if (d < 0.5) return;
    const step = Math.min(d, 20 * dt);
    u.x += ((tx - u.x) / d) * step;
    u.y += ((ty - u.y) / d) * step;
    if (!u.order) {
      u.anchorX = u.x;
      u.anchorY = u.y;
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
    if (!naval) speed *= TERRAIN_SPEED[sim.geo.terrain[worldToCell(u.x, u.y)]];
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
      if (naval ? !geo.isNavigable(c) : !geo.isLandPassable(c)) continue;
      u.x = Math.max(4, Math.min(WORLD_W - 4, nx));
      u.y = Math.max(4, Math.min(WORLD_H - 4, ny));
      if (!u.order) {
        u.anchorX = u.x;
        u.anchorY = u.y;
      }
    }
  }
}
