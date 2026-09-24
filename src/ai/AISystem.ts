// Priority-based strategic AI: defend > produce > research > attack > naval ops > missiles.
import type { AIOperation, AIState, City, FactionId, Unit, UnitDef } from '../core/types';
import { unitDef, UNIT_MAP } from '../data/units';
import { getFactionDef } from '../data/factions';
import { TECH_MAP } from '../data/techs';
import { atWar } from '../core/GameState';
import { canAfford } from '../technology/TechSystem';
import type { Sim } from '../core/Simulation';
import { CITY_MISSILE_RANGE } from '../combat/CombatSystem';
import { aiDiplomacy } from '../diplomacy/Diplomacy';

interface CityInfo {
  city: City;
  enemy: number;
  friendly: number;
}

const LAND_WEIGHTS: Record<string, number> = {
  infantry: 2, mech_infantry: 1.6, elite_infantry: 0.8, recon: 0.35, engineer: 0.3, light_tank: 1.3,
  medium_tank: 2.3, heavy_tank: 1.2, artillery: 1.1, rocket_artillery: 0.6, anti_air: 0.6,
};
const NAVAL_WEIGHTS: Record<string, number> = {
  patrol_boat: 1, frigate: 1.4, destroyer: 2, submarine: 1.3, cruiser: 1, missile_ship: 1, carrier: 0.35,
};

export function unitPower(u: Unit): number {
  const def = unitDef(u.type);
  return ((def.cost.money ?? 100) / 100) * (0.3 + 0.7 * (u.hp / u.maxHp));
}

export class AISystem {
  enabled = true;
  lastThinkMs = 0;

  constructor(private sim: Sim) {
    const s = sim.state;
    s.factionOrder.forEach((f, i) => {
      if (!s.ai[f]) s.ai[f] = { nextThink: 1 + i * 0.37, ops: [], nextOpId: 1, lastNaval: 0, mood: 0.5 };
    });
  }

  update(_dt: number): void {
    if (!this.enabled) return;
    const s = this.sim.state;
    for (const f of s.factionOrder) {
      const fs = s.factions[f];
      if (!fs.alive || fs.isPlayer) continue;
      const ai = s.ai[f];
      if (s.time < ai.nextThink) continue;
      ai.nextThink = s.time + this.interval();
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      try {
        this.think(f, ai);
      } catch (err) {
        console.warn('[AI] think failed for', f, err);
      }
      this.lastThinkMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    }
  }

  private interval(): number {
    const d = this.sim.state.difficulty;
    return d === 'easy' ? 4.5 : d === 'hard' ? 2.5 : 3.2;
  }

  private think(f: FactionId, ai: AIState): void {
    const sim = this.sim;
    const s = sim.state;
    const myCities = s.cities.filter((c) => c.owner === f);
    if (!myCities.length) return;
    const myUnits: Unit[] = [];
    for (const u of s.units.values()) if (u.owner === f && !u.dead) myUnits.push(u);
    const land = myUnits.filter((u) => unitDef(u.type).domain === 'land');
    const naval = myUnits.filter((u) => unitDef(u.type).domain === 'naval');

    const infos: CityInfo[] = myCities.map((c) => {
      let enemy = 0;
      let friendly = 0;
      sim.spatial.forEachInRange(c.x, c.y, 380, (u, d2) => {
        if (u.owner === f) {
          if (d2 < 200 * 200) friendly += unitPower(u);
        } else if (atWar(s, f, u.owner) && sim.combat.canSee(f, u) && unitDef(u.type).domain === 'land') {
          enemy += unitPower(u);
        }
      });
      return { city: c, enemy, friendly };
    });

    // Sell large commodity surpluses.
    const fsr = s.factions[f].res;
    if (fsr.food > 2500) sim.econ.trade(f, 'food', -800);
    if (fsr.fuel > 3500) sim.econ.trade(f, 'fuel', -1000);
    if (fsr.metal > 3500) sim.econ.trade(f, 'metal', -1000);
    this.cleanupOps(f, ai);
    this.defend(f, ai, infos, land);
    this.research(f);
    // Save up for research when nothing is being researched and no city is threatened.
    const saving = !s.factions[f].research && sim.tech.available(f).length > 0 && !infos.some((i) => i.enemy > i.friendly) && sim.rng.chance(0.5);
    if (!saving) this.produce(f, ai, infos, land.length, naval.length);
    this.build(f, infos);
    this.attack(f, ai, land, myCities);
    this.navy(f, ai, naval, myCities);
    this.missiles(f, myUnits, myCities, ai);
    aiDiplomacy(sim, f);
  }

  // ---------------------------------------------------------------- economy

  private pickUnit(f: FactionId, weights: Record<string, number>, city: City): UnitDef | null {
    const sim = this.sim;
    const opts = Object.keys(weights).filter((id) => sim.production.canProduceUnit(city, id, false).ok);
    const pick = sim.rng.weighted(opts, (id) => weights[id]);
    return pick ? UNIT_MAP[pick] : null;
  }

  private produce(f: FactionId, ai: AIState, infos: CityInfo[], landCount: number, navalCount: number): void {
    const sim = this.sim;
    const fs = sim.state.factions[f];
    const pers = getFactionDef(f)?.personality ?? { aggression: 0.5, naval: 0.5, tech: 0.5, defense: 0.5 };
    const cap = sim.state.difficulty === 'hard' ? 60 : sim.state.difficulty === 'easy' ? 34 : 46;
    const target = Math.max(8, Math.min(cap, (fs.gross.money / 1.9) * 0.9));
    const total = landCount + navalCount;
    if (total >= target) return;
    let queued = 0;
    // 1. Emergency levies for cities about to fall.
    const emergency = infos
      .filter((i) => i.enemy > i.friendly * 1.4 && i.enemy > 1.5 && sim.state.time - i.city.lastAttacked < 8 && i.city.queue.length < 1 && i.city.unrest <= 0)
      .sort((a, b) => b.city.importance - a.city.importance)[0];
    if (emergency) {
      const t = sim.tech.isUnlocked(f, 'mech_infantry') && canAfford(fs.res, UNIT_MAP.mech_infantry.cost) ? 'mech_infantry' : 'infantry';
      if (sim.production.enqueueUnit(emergency.city, t)) queued++;
    }
    // 2. Planned purchases: pick a unit by desired mix and save up for it.
    const ports = infos.filter((i) => i.city.port).length;
    const navalTarget = ports ? Math.round(total * 0.3 * pers.naval) + (pers.naval > 0.6 ? 3 : 1) : 0;
    for (let guard = 0; guard < 3 && queued < 3; guard++) {
      if (ai.plan) {
        const c = sim.state.cities[ai.plan.city];
        if (!c || c.owner !== f || c.queue.length >= 3 || !sim.production.canProduceUnit(c, ai.plan.unit, false).ok) ai.plan = null;
      }
      if (!ai.plan) {
        const free = infos.filter((i) => i.city.queue.length < 2 && i.city.unrest <= 0);
        if (!free.length) return;
        const wantNaval = navalCount < navalTarget && sim.rng.chance(0.55);
        const pool = wantNaval ? free.filter((i) => i.city.port) : free;
        if (!pool.length) return;
        const info = sim.rng.weighted(pool, (i) => (i.enemy + 1) * (i.city.industry + 1));
        if (!info) return;
        const def = this.pickUnit(f, wantNaval ? NAVAL_WEIGHTS : LAND_WEIGHTS, info.city);
        if (!def) return;
        ai.plan = { unit: def.id, city: info.city.id };
      }
      const def = UNIT_MAP[ai.plan.unit];
      if (!canAfford(fs.res, def.cost)) {
        // Use the market to cover missing commodities when the treasury allows.
        const extra = sim.econ.shortfallPrice(f, def.cost);
        if (fs.res.money < (def.cost.money ?? 0) + extra + 150) return;
        for (const k of ['metal', 'fuel', 'food'] as const) {
          const miss = (def.cost[k] ?? 0) - fs.res[k];
          if (miss > 0) sim.econ.trade(f, k, Math.ceil(miss));
        }
      }
      if (!canAfford(fs.res, def.cost) || fs.res.money < (def.cost.money ?? 0) + 80) return;
      if (sim.production.enqueueUnit(sim.state.cities[ai.plan.city], def.id)) queued++;
      ai.plan = null;
    }
  }

  private build(f: FactionId, infos: CityInfo[]): void {
    const sim = this.sim;
    const fs = sim.state.factions[f];
    if (fs.res.money < 900 || sim.rng.chance(0.4)) return;
    const pers = getFactionDef(f)?.personality ?? { aggression: 0.5, naval: 0.5, tech: 0.5, defense: 0.5 };
    const calm = infos.filter((i) => i.enemy < 1 && i.city.queue.length < 2);
    if (!calm.length) return;
    const tryBuild = (c: City, id: string) => sim.production.canBuild(c, id).ok && sim.production.enqueueBuilding(c, id);
    // Power first.
    if (fs.power.supply < fs.power.demand * 1.05) {
      const c = [...calm].sort((a, b) => b.city.size - a.city.size)[0].city;
      if (tryBuild(c, 'power_plant')) return;
    }
    if (fs.income.metal < 4) {
      const c = calm.find((i) => i.city.tags.includes('m'))?.city ?? calm[0].city;
      if (tryBuild(c, 'mine')) return;
    }
    if (fs.income.fuel < 3) {
      const c = calm.find((i) => i.city.tags.includes('o'))?.city ?? calm[0].city;
      if (tryBuild(c, 'refinery')) return;
    }
    if (fs.income.food < 2) {
      const c = calm.find((i) => i.city.tags.includes('f'))?.city ?? calm[0].city;
      if (tryBuild(c, 'farm')) return;
    }
    const border = infos.filter((i) => i.enemy > 0 && i.city.importance >= 6);
    if (border.length && sim.rng.chance(pers.defense)) {
      if (tryBuild(border[0].city, 'fortress')) return;
    }
    const best = [...calm].sort((a, b) => b.city.industry - a.city.industry);
    const choice = sim.rng.pick(['factory', 'factory', 'barracks', 'research_lab', 'shipyard', 'radar', 'missile_battery']);
    for (const i of best.slice(0, 4)) if (tryBuild(i.city, choice)) return;
  }

  private research(f: FactionId): void {
    const sim = this.sim;
    const fs = sim.state.factions[f];
    if (fs.research) return;
    const pers = getFactionDef(f)?.personality ?? { aggression: 0.5, naval: 0.5, tech: 0.5, defense: 0.5 };
    const avail = sim.tech.available(f).filter((t) => canAfford(fs.res, t.cost));
    if (!avail.length) return;
    const pick = sim.rng.weighted(avail, (t) => {
      const cat = t.category === 'navy' ? 0.4 + pers.naval * 1.4 : t.category === 'industry' ? 1.3 : t.category === 'air' ? 0.6 : 1.1;
      return cat * (1 + pers.tech) / t.tier;
    });
    if (pick) sim.tech.startResearch(f, pick.id);
  }

  // ---------------------------------------------------------------- military

  private cleanupOps(f: FactionId, ai: AIState): void {
    const s = this.sim.state;
    ai.ops = ai.ops.filter((op) => {
      op.units = op.units.filter((id) => {
        const u = s.units.get(id);
        return !!u && !u.dead;
      });
      const c = s.cities[op.targetCity];
      const done = !c || !atWar(s, f, c.owner) || op.units.length === 0 || s.time - op.started > 180;
      if (done) {
        for (const id of op.units) {
          const u = s.units.get(id);
          if (u) u.aiTask = 0;
        }
      }
      return !done;
    });
  }

  private defend(f: FactionId, ai: AIState, infos: CityInfo[], land: Unit[]): void {
    const sim = this.sim;
    const threatened = infos
      .filter((i) => i.enemy > 0.5 && i.enemy > i.friendly * 0.9)
      .sort((a, b) => b.city.importance * b.enemy - a.city.importance * a.enemy);
    for (const info of threatened.slice(0, 3)) {
      const c = info.city;
      let need = info.enemy * 1.3 - info.friendly;
      const candidates = land
        .filter((u) => u.aiTask === 0 && !u.embarked && (!u.order || u.order.kind === 'move'))
        .map((u) => ({ u, d: Math.hypot(u.x - c.x, u.y - c.y) }))
        .filter((e) => e.d < 700 && e.d > 60)
        .sort((a, b) => a.d - b.d);
      const sent: Unit[] = [];
      for (const { u } of candidates) {
        if (need <= 0 || sent.length >= 8) break;
        sent.push(u);
        need -= unitPower(u);
      }
      if (sent.length) sim.units.orderMove(sent, c.x, c.y, true);
    }
  }

  private attack(f: FactionId, ai: AIState, land: Unit[], myCities: City[]): void {
    const sim = this.sim;
    const s = sim.state;
    const pers = getFactionDef(f)?.personality ?? { aggression: 0.5, naval: 0.5, tech: 0.5, defense: 0.5 };
    // Keep ops moving.
    for (const op of ai.ops) {
      const c = s.cities[op.targetCity];
      const idle = op.units.map((id) => s.units.get(id)!).filter((u) => u && (!u.order || u.order.kind === 'move'));
      if (idle.length) sim.units.orderAttackCity(idle, c);
    }
    const maxOps = 1 + Math.round(pers.aggression * 2);
    if (ai.ops.length >= maxOps) return;
    const idle = land.filter((u) => u.aiTask === 0 && !u.order && !u.embarked);
    if (idle.length < 4) return;
    // Keep a garrison: one unit per important city stays home.
    const free = idle.filter((u) => {
      let home = false;
      for (const c of myCities) if (c.importance >= 8 && Math.hypot(c.x - u.x, c.y - u.y) < 50) home = true;
      return !home || sim.rng.chance(0.35);
    });
    if (free.length < 3) return;

    let best: City | null = null;
    let bestScore = 0;
    let bestDef = 0;
    const cx = free.reduce((a, u) => a + u.x, 0) / free.length;
    const cy = free.reduce((a, u) => a + u.y, 0) / free.length;
    for (const c of s.cities) {
      if (!atWar(s, f, c.owner)) continue;
      if (ai.ops.some((o) => o.targetCity === c.id)) continue;
      let dMin = Infinity;
      for (const m of myCities) dMin = Math.min(dMin, Math.hypot(m.x - c.x, m.y - c.y));
      if (dMin > 750) continue;
      const dArmy = Math.hypot(c.x - cx, c.y - cy);
      let def = c.hp / 180;
      sim.spatial.forEachInRange(c.x, c.y, 220, (u) => {
        if (u.owner === c.owner && unitDef(u.type).domain === 'land') def += unitPower(u);
      });
      let score = (c.importance + 3) / (1 + dMin / 150 + dArmy / 600) / (1 + def * 0.35);
      if (c.origOwner === f) score *= 1.6;
      if (c.owner === 'neutral') score *= 1.5;
      if (c.owner === s.player) score *= 0.9 + sim.rng.next() * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = c;
        bestDef = def;
      }
    }
    if (!best) return;
    const target = best;
    const pool = free
      .map((u) => ({ u, d: Math.hypot(u.x - target.x, u.y - target.y) }))
      .filter((e) => e.d < 1100)
      .sort((a, b) => a.d - b.d);
    const group: Unit[] = [];
    let power = 0;
    for (const { u } of pool) {
      if (group.length >= 14) break;
      if (power >= bestDef * 1.6 + 3) break;
      group.push(u);
      power += unitPower(u);
    }
    const needed = bestDef * (1.1 - pers.aggression * 0.3);
    if (group.length < 3 || power < needed) return;
    const op: AIOperation = { id: ai.nextOpId++, targetCity: target.id, units: group.map((u) => u.id), started: s.time, kind: 'attack' };
    for (const u of group) u.aiTask = op.id;
    ai.ops.push(op);
    sim.units.orderAttackCity(group, target);
  }

  private navy(f: FactionId, ai: AIState, naval: Unit[], myCities: City[]): void {
    const sim = this.sim;
    const s = sim.state;
    if (!naval.length) return;
    const ports = myCities.filter((c) => c.port);
    const idle = naval.filter((u) => !u.order);
    for (const ship of idle) {
      const def = unitDef(ship.type);
      // Hunt visible enemy ships nearby.
      let prey: Unit | null = null;
      let preyD = def.stealth ? 1300 : 900;
      sim.spatial.forEachInRange(ship.x, ship.y, preyD, (o, d2) => {
        if (!atWar(s, f, o.owner) || !sim.combat.canSee(f, o)) return;
        const od = unitDef(o.type);
        if (!(def.vs[od.cls] ?? 0)) return;
        if (od.domain !== 'naval' && !o.embarked) return;
        const d = Math.sqrt(d2);
        if (d < preyD) {
          preyD = d;
          prey = o;
        }
      });
      if (prey) {
        sim.units.orderAttackUnit([ship], prey);
        continue;
      }
      // Bombard a nearby enemy coastal city occasionally.
      if ((def.vs.city ?? 0) >= 0.7 && sim.rng.chance(0.25)) {
        const coastal = s.cities.find((c) => c.port && atWar(s, f, c.owner) && Math.hypot(c.x - ship.x, c.y - ship.y) < 700);
        if (coastal) {
          sim.units.orderAttackCity([ship], coastal);
          continue;
        }
      }
      // Patrol near a friendly port.
      if (ports.length && sim.rng.chance(0.3)) {
        const p = sim.rng.pick(ports);
        const a = sim.rng.range(0, Math.PI * 2);
        const r = sim.rng.range(60, 380);
        const tx = p.portX + Math.cos(a) * r;
        const ty = p.portY + Math.sin(a) * r;
        sim.units.orderMove([ship], tx, ty, true);
      }
    }
    ai.lastNaval = s.time;
  }

  private missiles(f: FactionId, myUnits: Unit[], myCities: City[], ai: AIState): void {
    const sim = this.sim;
    const s = sim.state;
    let launches = 0;
    const opTargets = new Set(ai.ops.map((o) => o.targetCity));
    const pickTarget = (x: number, y: number, range: number): { unit?: Unit; city?: City } | null => {
      let best: Unit | null = null;
      let bestV = 2.2;
      sim.spatial.forEachInRange(x, y, range, (o) => {
        if (!atWar(s, f, o.owner) || !sim.combat.canSee(f, o)) return;
        const v = unitPower(o) * (unitDef(o.type).domain === 'naval' ? 1.3 : 1);
        if (v > bestV) {
          bestV = v;
          best = o;
        }
      });
      if (best) return { unit: best };
      for (const id of opTargets) {
        const c = s.cities[id];
        if (c && c.hp > 0 && Math.hypot(c.x - x, c.y - y) <= range) return { city: c };
      }
      return null;
    };
    for (const u of myUnits) {
      if (launches >= 2) return;
      if (!sim.combat.canLaunch(u)) continue;
      const t = pickTarget(u.x, u.y, sim.combat.missileRangeOf(u) * 0.95);
      if (t && sim.combat.launchMissile(u, t)) launches++;
    }
    for (const c of myCities) {
      if (launches >= 2) return;
      if (c.missiles < 1 || c.missileCd > 0) continue;
      const t = pickTarget(c.x, c.y, CITY_MISSILE_RANGE * 0.95);
      if (t && sim.combat.launchCityMissile(c, t)) launches++;
    }
  }
}

export { TECH_MAP };
