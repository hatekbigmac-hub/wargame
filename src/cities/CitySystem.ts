// City defence, regeneration, siege & capture logic.
import type { City, FactionId, Unit } from '../core/types';
import { unitDef } from '../data/units';
import { atWar } from '../core/GameState';
import { CAPTURE_RADIUS } from '../units/UnitSystem';
import type { Sim } from '../core/Simulation';
import { NEUTRAL_ID } from '../data/factions';

export function cityMaxHp(c: City): number {
  return (200 + c.size * 110) * (1 + (c.buildings.fortress ?? 0) * 0.35);
}

export function cityRange(c: City): number {
  return 130 + (c.buildings.fortress ?? 0) * 18;
}

export function cityDefense(c: City): number {
  return 6 + c.size * 3 + (c.buildings.fortress ?? 0) * 6;
}

export class CitySystem {
  private captureTimer = 0;
  private tmp: Unit[] = [];

  constructor(private sim: Sim) {
    for (const c of sim.state.cities) {
      c.maxHp = cityMaxHp(c);
      if (c.hp <= 0 && c.lastAttacked < -100) c.hp = c.maxHp;
    }
  }

  refresh(c: City): void {
    const ratio = c.maxHp > 0 ? c.hp / c.maxHp : 1;
    c.maxHp = cityMaxHp(c);
    c.hp = Math.min(c.maxHp, ratio * c.maxHp);
  }

  update(dt: number): void {
    const sim = this.sim;
    const s = sim.state;
    this.captureTimer -= dt;
    const doCapture = this.captureTimer <= 0;
    if (doCapture) this.captureTimer = 0.25;

    for (const c of s.cities) {
      if (c.unrest > 0) c.unrest = Math.max(0, c.unrest - dt);
      if (c.missileCd > 0) c.missileCd -= dt;
      const battery = c.buildings.missile_battery ?? 0;
      if (battery > 0 && c.missiles < battery * 2) {
        c.missiles = Math.min(battery * 2, c.missiles + dt / 50);
      }
      // Regeneration when not under fire and not besieged.
      if (c.hp < c.maxHp && s.time - c.lastAttacked > 6) {
        let rate = 0.02;
        let besieged = false;
        sim.spatial.forEachInRange(c.x, c.y, 110, (u) => {
          if (u.owner === c.owner && unitDef(u.type).abilities?.includes('repair')) rate += 0.03;
          else if (atWar(s, c.owner, u.owner) && unitDef(u.type).domain === 'land' && !u.embarked) besieged = true;
        });
        if (!besieged) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * rate * dt);
      }
      // Defensive fire.
      c.cooldown -= dt;
      if (c.cooldown <= 0 && c.hp > 0) {
        c.cooldown = 2.2;
        const target = this.findTarget(c);
        if (target) sim.combat.fireFromCity(c, target);
      }
      if (doCapture) this.updateCapture(c, 0.25);
    }
  }

  private findTarget(c: City): Unit | null {
    const s = this.sim.state;
    let best: Unit | null = null;
    let bestD = Infinity;
    this.sim.spatial.forEachInRange(c.x, c.y, cityRange(c), (u, d2) => {
      if (!atWar(s, c.owner, u.owner)) return;
      if (!this.sim.combat.canSee(c.owner, u)) return;
      if (d2 < bestD) {
        bestD = d2;
        best = u;
      }
    });
    return best;
  }

  private updateCapture(c: City, dt: number): void {
    const s = this.sim.state;
    if (c.hp > 1) {
      if (c.capture > 0) {
        c.capture = Math.max(0, c.capture - dt * 0.25);
        if (c.capture === 0) c.capturer = null;
      }
      return;
    }
    let defenders = 0;
    const power = new Map<FactionId, number>();
    this.sim.spatial.forEachInRange(c.x, c.y, CAPTURE_RADIUS, (u) => {
      const def = unitDef(u.type);
      if (def.domain !== 'land' || u.embarked) return;
      if (u.owner === c.owner || !atWar(s, u.owner, c.owner)) {
        defenders++;
        return;
      }
      power.set(u.owner, (power.get(u.owner) ?? 0) + (def.captureRate ?? 1));
    });
    if (defenders > 0 || power.size === 0) {
      if (c.capture > 0) c.capture = Math.max(0, c.capture - dt * 0.2);
      if (c.capture === 0) c.capturer = null;
      return;
    }
    let bestF: FactionId | null = null;
    let bestP = 0;
    for (const [f, p] of power) if (p > bestP) { bestP = p; bestF = f; }
    if (!bestF) return;
    if (c.capturer !== bestF) {
      c.capturer = bestF;
      c.capture = 0;
    }
    c.capture += dt * 0.16 * Math.min(2.5, Math.sqrt(bestP));
    c.lastAttacked = s.time;
    if (c.capture >= 1) this.captureCity(c, bestF);
  }

  captureCity(c: City, to: FactionId, silent = false): void {
    const sim = this.sim;
    const s = sim.state;
    const from = c.owner;
    c.owner = to;
    c.capture = 0;
    c.capturer = null;
    c.hp = c.maxHp * 0.3;
    c.queue = [];
    c.unrest = to === NEUTRAL_ID ? 0 : 20;
    c.lastAttacked = s.time;
    c.missiles = 0;
    const tf = s.factions[to];
    const ff = s.factions[from];
    if (tf && !silent && to !== NEUTRAL_ID) {
      tf.stats.captured++;
      tf.res.money += 100 + c.size * 80;
      tf.res.metal += 30 * c.size;
    }
    if (ff) ff.stats.citiesLost++;
    sim.bus.emit('cityCaptured', { city: c, from, to });
    sim.checkElimination(from, to);
  }
}
