// Unit lifecycle, orders and movement.
import type { City, FactionId, Order, Unit, UnitDef } from '../core/types';
import { t as tr } from '../i18n';
import { unitDef } from '../data/units';
import { TERRAIN_SPEED } from '../map/WorldGeo';
import { worldToCell, cellCenterX, cellCenterY, WORLD_W, WORLD_H, CELL, COLS, ROWS } from '../config';
import type { Sim } from '../core/Simulation';
import { atWar } from '../core/GameState';
import type { PathDomain } from '../map/Pathfinding';
import { hasAirfield } from '../production/ProductionSystem';

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
    if (def.domain === 'air') {
      u.fuel = this.endurance(u);
      u.landed = true;
    }
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
      if (killed && u.owner === this.sim.state.player) this.sim.notify(tr('Transport sunk with {n} units aboard!', { n: u.cargo.length }), 'bad', u.x, u.y);
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

  /** Can transport `t` carry unit `u`? (ships take any land unit, helicopters only infantry) */
  canCarry(t: Unit, u: Unit): boolean {
    const td = unitDef(t.type);
    const ud = unitDef(u.type);
    if (!td.capacity || ud.domain !== 'land') return false;
    return !td.carries || td.carries.includes(ud.cls);
  }

  isAir(u: Unit): boolean {
    return unitDef(u.type).domain === 'air';
  }

  /** Hours an aircraft can stay airborne. */
  endurance(u: Unit): number {
    const def = unitDef(u.type);
    const refuel = this.sim.state.factions[u.owner]?.techs.includes('aerial_refueling');
    return (def.endurance ?? 8) * (refuel ? 1.4 : 1);
  }

  private baseCache = [new Map<FactionId, { t: number; cities: City[]; carriers: Unit[] }>(), new Map<FactionId, { t: number; cities: City[]; carriers: Unit[] }>()];

  /** Nearest friendly airfield: airport / air-base cities (helicopters: any city) or an aircraft carrier. */
  nearestBase(u: Unit): { x: number; y: number; d: number } | null {
    const s = this.sim.state;
    const heli = unitDef(u.type).cls === 'heli';
    const map = this.baseCache[heli ? 1 : 0];
    let cache = map.get(u.owner);
    if (!cache || s.time - cache.t > 1) {
      const cities = s.cities.filter((c) => c.owner === u.owner && (heli || hasAirfield(c)));
      const carriers: Unit[] = [];
      for (const o of s.units.values()) if (o.owner === u.owner && o.type === 'carrier') carriers.push(o);
      cache = { t: s.time, cities, carriers };
      map.set(u.owner, cache);
    }
    let best: { x: number; y: number; d: number } | null = null;
    for (const c of cache.cities) {
      if (c.owner !== u.owner) continue;
      const d = Math.hypot(c.x - u.x, c.y - u.y);
      if (!best || d < best.d) best = { x: c.x, y: c.y, d };
    }
    for (const cv of cache.carriers) {
      if (cv.dead) continue;
      const d = Math.hypot(cv.x - u.x, cv.y - u.y);
      if (!best || d < best.d) best = { x: cv.x, y: cv.y, d };
    }
    return best;
  }

  /** Send aircraft back to the nearest airfield to refuel and repair. */
  orderRtb(units: Unit[]): number {
    let n = 0;
    for (const u of units) {
      if (!this.isAir(u)) continue;
      const b = this.nearestBase(u);
      if (!b) continue;
      this.setOrder(u, { kind: 'rtb', x: b.x, y: b.y });
      u.path = [b.x, b.y];
      n++;
    }
    return n;
  }

  /** Land units walk to the coast next to the transport and embark. */
  orderBoard(units: Unit[], transport: Unit): number {
    let n = 0;
    for (const u of units) {
      if (!this.canCarry(transport, u) || u.owner !== transport.owner) continue;
      this.setOrder(u, { kind: 'board', x: transport.x, y: transport.y, targetUnit: transport.id });
      n++;
    }
    return n;
  }

  /**
   * Water cell next to land, in the transport's sea, closest to (x, y) — where troops
   * bound for (x, y) should be put ashore. Returns -1 if no reachable beach is near.
   */
  findBeach(t: Unit, x: number, y: number, maxR = 16): number {
    const geo = this.sim.geo;
    let from = worldToCell(t.x, t.y);
    if (!geo.isNavigable(from)) from = geo.nearestCell(t.x, t.y, 3, (c) => geo.isNavigable(c));
    if (from < 0) return -1;
    const body = geo.waterBody[from];
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const beach = (c: number) => {
      if (!geo.isNavigable(c) || geo.waterBody[c] !== body) return false;
      const bx = c % COLS;
      const by = (c / COLS) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx;
          const ny = by + dy;
          if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && geo.land[ny * COLS + nx]) return true;
        }
      }
      return false;
    };
    for (let r = 0; r <= maxR; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const c = ny * COLS + nx;
          if (!beach(c)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Transport sails to the beach nearest (x, y) and lands its troops there. */
  orderUnload(t: Unit, x: number, y: number): boolean {
    if (this.isAir(t)) {
      // Helicopters fly straight to the landing zone (must be on land).
      const geo = this.sim.geo;
      let lz = worldToCell(x, y);
      if (!geo.isLandPassable(lz)) lz = geo.nearestCell(x, y, 3, (c) => geo.isLandPassable(c));
      if (lz < 0) {
        if (t.owner === this.sim.state.player) this.sim.notifyOnce('nolz', tr('Pick a landing zone on land'), 'warn');
        return false;
      }
      this.setOrder(t, { kind: 'unload', x: cellCenterX(lz), y: cellCenterY(lz) });
      t.path = [cellCenterX(lz), cellCenterY(lz)];
      return true;
    }
    const beach = this.findBeach(t, x, y);
    if (beach < 0) {
      if (t.owner === this.sim.state.player) this.sim.notifyOnce('nobeach', tr('No coast within reach of that point — pick a spot near the sea'), 'warn');
      return false;
    }
    this.setOrder(t, { kind: 'unload', x, y });
    this.requestPath(t, cellCenterX(beach), cellCenterY(beach));
    return true;
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
    if (destX !== undefined && destY !== undefined) {
      // Land on the side facing the destination (and on its landmass when possible).
      const score = (c: number) =>
        Math.hypot(cellCenterX(c) - destX, cellCenterY(c) - destY) + (geo.landConnected(cellCenterX(c), cellCenterY(c), destX, destY) ? 0 : 10000);
      spots.sort((a, b) => score(a) - score(b));
    }
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
    const air = units.filter((u) => this.isAir(u));
    const land = units.filter((u) => this.domainOf(u) === 'land' && !this.isAir(u));
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
    apply(air, 26);
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
      const def = unitDef(u.type);
      if (!((def.vs.city ?? 0) > 0) && !((def.captureRate ?? 0) > 0) && def.domain === 'air') {
        // Aircraft that cannot hurt a city (fighters) sweep the skies and troops around it instead.
        this.setOrder(u, { kind: 'attackMove', x: city.x, y: city.y });
        this.requestPath(u, city.x, city.y);
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
    if (this.isAir(u)) {
      u.path = [tx, ty];
      u.pathIdx = 0;
      u.pathPending = false;
      return;
    }
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
              this.sim.notifyOnce('noroute', land ? tr('No land route — load troops onto a Transport Ship to cross the sea') : tr('No sea route to that destination'), 'warn');
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
      if (def.domain === 'air') {
        this.updateAir(u, def, st.speed, st.range, dt);
        continue;
      }
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
            if (this.isAir(t)) {
              // Helicopter: walk to it; it must be over land our troops can reach.
              if (d <= 30) {
                if (!this.board(u, t)) {
                  this.setOrder(u, null);
                  if (u.owner === s.player) sim.notifyOnce('full', tr('Transport is full'), 'warn');
                }
                break;
              }
              if (!u.pathPending && (!u.path || s.time >= u.repathAt)) {
                u.repathAt = s.time + 2;
                const cell = worldToCell(t.x, t.y);
                if (!sim.geo.isLandPassable(cell) || !sim.geo.landConnected(u.x, u.y, t.x, t.y)) {
                  if (u.owner === s.player) sim.notifyOnce('heliland', tr('Land the helicopter where your troops can reach it'), 'warn');
                } else this.requestPath(u, t.x, t.y);
              }
              if (u.path) halt = false;
              break;
            }
            if (d <= 46) {
              if (!this.board(u, t)) {
                this.setOrder(u, null);
                if (u.owner === s.player) sim.notifyOnce('full', tr('Transport is full (6 units)'), 'warn');
              }
              break;
            }
            if (!u.pathPending && (!u.path || s.time >= u.repathAt)) {
              u.repathAt = s.time + 3;
              const shore = sim.geo.nearestCell(t.x, t.y, 3, (c) => sim.geo.land[c] === 1 && sim.geo.landConnected(u.x, u.y, cellCenterX(c), cellCenterY(c)));
              if (shore < 0) {
                if (u.owner === s.player) sim.notifyOnce('shore', tr('Move the transport next to a coast your troops can reach'), 'warn');
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
              if (!n && u.owner === s.player) sim.notifyOnce('beach', tr('No beach here — move the transport next to land'), 'warn');
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
    if (this.isAir(u)) {
      u.path = [tx, ty];
      u.pathIdx = 0;
      u.pathPending = false;
      return;
    }
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
    if (!naval && cls !== 'air' && cls !== 'heli') speed *= TERRAIN_SPEED[sim.geo.terrain[worldToCell(u.x, u.y)]];
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

  // ------------------------------------------------------------------ aircraft

  /**
   * Aircraft fly straight lines, burn fuel while airborne and must return to an airfield
   * (airport, air base, carrier; helicopters: any friendly city) to refuel and repair.
   * Jets circle over their target; helicopters hover.
   */
  private updateAir(u: Unit, def: UnitDef, speed: number, range: number, dt: number): void {
    const sim = this.sim;
    const s = sim.state;
    const endur = this.endurance(u);
    if (u.fuel === undefined) u.fuel = endur;
    // Fast path: parked, fuelled, repaired and nothing to do (full check about once an hour,
    // e.g. when the carrier it sits on sails away or its airfield is captured).
    if (u.landed && !u.order && u.targetUnit < 0 && u.fuel >= endur && u.hp >= u.maxHp && (Math.floor(s.time * 10) + u.id) % 10 !== 0) {
      u.moving = false;
      return;
    }
    const heli = def.cls === 'heli';
    const base = this.nearestBase(u);
    const o = u.order;
    const atBase = !!base && base.d < 30;
    u.embarked = false;

    // Parked at an airfield: refuel, repair, scramble against nearby enemies when fuelled.
    if (atBase && (!o || o.kind === 'rtb')) {
      if (o) this.setOrder(u, null);
      if (!u.landed) {
        u.landed = true;
        u.anchorX = u.x;
        u.anchorY = u.y;
      }
      u.fuel = Math.min(endur, u.fuel + (dt * endur) / 1.5);
      if (s.time - u.lastHit > 2) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.08 * dt);
      u.moving = false;
      u.path = null;
      const t = u.targetUnit >= 0 ? s.units.get(u.targetUnit) : undefined;
      if (!t || t.dead || u.fuel < endur * 0.5 || def.attack <= 0) return;
      // Scramble.
      if (Math.hypot(t.x - u.x, t.y - u.y) < 320) this.setOrder(u, { kind: 'attack', x: t.x, y: t.y, targetUnit: t.id });
      else return;
    }
    if (u.landed && !o && base) {
      // Our parking spot is gone (carrier moved, airfield lost): fly to the nearest base.
      this.setOrder(u, { kind: 'rtb', x: base.x, y: base.y });
    }
    u.landed = false;

    // Fuel.
    u.fuel -= dt;
    if (u.fuel <= 0) {
      if (u.owner === s.player) sim.notify(tr('{unit} ran out of fuel and was lost', { unit: tr(def.name) }), 'bad', u.x, u.y);
      this.remove(u, true, null);
      return;
    }
    if (base && u.order?.kind !== 'rtb') {
      const need = (base.d / Math.max(1, speed)) * 1.2 + 0.4;
      if (u.fuel <= need) {
        if (u.owner === s.player) sim.notifyOnce(`rtb${u.id}`, tr('{unit}: low fuel — returning to base', { unit: tr(def.name) }), 'info', u.x, u.y, 30);
        this.setOrder(u, { kind: 'rtb', x: base.x, y: base.y });
      }
    }

    const cur = u.order;
    let orbit: { x: number; y: number } | null = null;
    let goal: { x: number; y: number } | null = null;
    switch (cur?.kind) {
      case 'rtb':
        if (base) goal = { x: base.x, y: base.y };
        else this.setOrder(u, null);
        break;
      case 'move':
      case 'attackMove': {
        const tu = u.targetUnit >= 0 ? s.units.get(u.targetUnit) : undefined;
        if (cur.kind === 'attackMove' && tu && !tu.dead && Math.hypot(tu.x - u.x, tu.y - u.y) <= range) orbit = { x: tu.x, y: tu.y };
        else if (Math.hypot(cur.x - u.x, cur.y - u.y) > 4) goal = { x: cur.x, y: cur.y };
        else {
          this.setOrder(u, null);
          u.anchorX = cur.x;
          u.anchorY = cur.y;
        }
        break;
      }
      case 'attack': {
        let tx = NaN;
        let ty = NaN;
        if (cur.targetUnit !== undefined) {
          const t = s.units.get(cur.targetUnit);
          if (!t || t.dead || !sim.combat.canSee(u.owner, t) || !atWar(s, u.owner, t.owner)) {
            this.setOrder(u, null);
            u.anchorX = u.x;
            u.anchorY = u.y;
            break;
          }
          u.targetUnit = t.id;
          tx = t.x;
          ty = t.y;
        } else if (cur.targetCity !== undefined) {
          const c = s.cities[cur.targetCity];
          if (!c || !atWar(s, u.owner, c.owner)) {
            this.setOrder(u, null);
            u.anchorX = u.x;
            u.anchorY = u.y;
            break;
          }
          u.targetCity = c.id;
          tx = c.x;
          ty = c.y;
        }
        if (!isFinite(tx)) break;
        if (Math.hypot(tx - u.x, ty - u.y) <= range * 0.85) orbit = { x: tx, y: ty };
        else goal = { x: tx, y: ty };
        break;
      }
      case 'unload': {
        if (!u.cargo?.length) {
          this.setOrder(u, null);
          break;
        }
        if (Math.hypot(cur.x - u.x, cur.y - u.y) > 6) goal = { x: cur.x, y: cur.y };
        else {
          const n = this.unloadNow(u, cur.x, cur.y);
          if (!n && u.owner === s.player) sim.notifyOnce('nolz', tr('Pick a landing zone on land'), 'warn');
          this.setOrder(u, null);
          u.anchorX = u.x;
          u.anchorY = u.y;
        }
        break;
      }
      case 'hold':
        orbit = { x: cur.x, y: cur.y };
        break;
      default: {
        // Idle in the air: engage what the combat system acquired within a leash, else loiter.
        const t = u.targetUnit >= 0 ? s.units.get(u.targetUnit) : undefined;
        if (t && !t.dead && Math.hypot(t.x - u.anchorX, t.y - u.anchorY) < 320) {
          if (Math.hypot(t.x - u.x, t.y - u.y) <= range * 0.85) orbit = { x: t.x, y: t.y };
          else goal = { x: t.x, y: t.y };
        } else orbit = { x: u.anchorX, y: u.anchorY };
      }
    }

    if (goal) {
      const d = Math.hypot(goal.x - u.x, goal.y - u.y);
      const step = Math.min(d, speed * this.speedMult(u) * dt);
      if (d > 0.01) {
        u.angle = Math.atan2(goal.y - u.y, goal.x - u.x);
        u.x += ((goal.x - u.x) / d) * step;
        u.y += ((goal.y - u.y) / d) * step;
      }
      u.moving = true;
    } else if (orbit) {
      if (heli) {
        // Hover, facing the target.
        const d = Math.hypot(orbit.x - u.x, orbit.y - u.y);
        if (d > range * 0.9 && u.order) {
          const step = Math.min(d, speed * dt);
          u.x += ((orbit.x - u.x) / d) * step;
          u.y += ((orbit.y - u.y) / d) * step;
        }
        if (d > 1) u.angle = Math.atan2(orbit.y - u.y, orbit.x - u.x);
        u.moving = false;
      } else {
        this.orbit(u, orbit.x, orbit.y, speed * this.speedMult(u), dt);
      }
    } else u.moving = false;
    u.path = goal ? [goal.x, goal.y] : null;
    u.pathIdx = 0;
    u.x = Math.max(4, Math.min(WORLD_W - 4, u.x));
    u.y = Math.max(4, Math.min(WORLD_H - 4, u.y));
  }

  private speedMult(u: Unit): number {
    const fs = this.sim.state.factions[u.owner];
    let m = 1;
    if (fs) {
      if (fs.res.fuel <= 0 && fs.income.fuel < 0) m *= 0.6;
      for (const e of fs.effects) m *= e.mods.speedMult ?? 1;
    }
    return m;
  }

  /** Jets circle a point at ~38 px radius. */
  private orbit(u: Unit, cx: number, cy: number, speed: number, dt: number): void {
    const R = 38;
    const d = Math.hypot(u.x - cx, u.y - cy);
    if (d > R * 1.5) {
      const step = Math.min(d - R, speed * dt);
      u.angle = Math.atan2(cy - u.y, cx - u.x);
      u.x += Math.cos(u.angle) * step;
      u.y += Math.sin(u.angle) * step;
    } else {
      const a = Math.atan2(u.y - cy, u.x - cx) + (speed * 0.7 * dt) / R;
      const r = d + (R - d) * Math.min(1, dt * 4);
      const nx = cx + Math.cos(a) * r;
      const ny = cy + Math.sin(a) * r;
      u.angle = Math.atan2(ny - u.y, nx - u.x);
      u.x = nx;
      u.y = ny;
    }
    u.moving = true;
  }

  /** Light separation so idle stacks spread out into readable formations. */
  private separate(): void {
    const sim = this.sim;
    const geo = sim.geo;
    for (const u of sim.state.units.values()) {
      if (u.dead || u.moving) continue;
      const dom = unitDef(u.type).domain;
      if (dom === 'air') continue;
      const naval = dom === 'naval';
      const r = naval ? 30 : 17;
      const near = sim.spatial.query(u.x, u.y, r, this.tmp);
      let px = 0;
      let py = 0;
      for (const o of near) {
        if (o === u || o.owner !== u.owner) continue;
        const od = unitDef(o.type).domain;
        if (od === 'air' || (od === 'naval') !== naval) continue;
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
