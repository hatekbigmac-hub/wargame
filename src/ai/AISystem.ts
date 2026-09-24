// Strategic AI for ~200 countries.
// Peace by default → a strong country picks a weaker target → visible MOBILISATION
// (troops gather at the border) → declaration of WAR → offensives (by land, or by sea on
// transport ships) → eventually a ceasefire. Plus defence, production, research, navy, missiles.
import type { AIOperation, AIState, City, FactionId, Unit, UnitDef } from '../core/types';
import { unitDef, UNIT_MAP } from '../data/units';
import { getFactionDef, factionName } from '../data/factions';
import { atWar, enemiesOf, relKey } from '../core/GameState';
import { canAfford } from '../technology/TechSystem';
import type { Sim } from '../core/Simulation';
import { CITY_MISSILE_RANGE } from '../combat/CombatSystem';
import { declareWar, makePeace, militaryStrength, wouldAcceptPeace, lastPeace } from '../diplomacy/Diplomacy';
import { t } from '../i18n';
import { forcePlan } from '../data/military';
import { hasAirfield } from '../production/ProductionSystem';

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
  patrol_boat: 1, frigate: 1.4, destroyer: 2, submarine: 1.3, cruiser: 1, missile_ship: 1, carrier: 0.35, transport: 0.8,
};
const AIR_WEIGHTS: Record<string, number> = {
  fighter: 1.2, strike_fighter: 0.9, helicopter: 0.9, bomber: 0.25, transport_heli: 0.1,
};
const DEFAULT_PERS = { aggression: 0.5, naval: 0.5, tech: 0.5, defense: 0.5 };

/** Game-hours of visible mobilisation before an AI declares war. */
export const MOBILIZE_HOURS = 48;

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
      if (!s.ai[f]) {
        s.ai[f] = { nextThink: 1 + (i % 60) * 0.1, ops: [], nextOpId: 1, lastNaval: 0, mood: 0.5, war: null, nextWarCheck: 30 + sim.rng.range(0, 90) };
      }
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
      ai.nextThink = s.time + this.interval(f);
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      try {
        this.think(f, ai);
      } catch (err) {
        console.warn('[AI] think failed for', f, err);
      }
      this.lastThinkMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    }
  }

  /** Big powers think more often than micro-states. */
  private interval(f: FactionId): number {
    const d = this.sim.state.difficulty;
    const power = getFactionDef(f)?.power ?? 10;
    const base = power >= 40 ? 3 : power >= 15 ? 4.5 : 7;
    return base * (d === 'easy' ? 1.3 : d === 'hard' ? 0.8 : 1);
  }

  private pers(f: FactionId) {
    return getFactionDef(f)?.personality ?? DEFAULT_PERS;
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
    const air = myUnits.filter((u) => unitDef(u.type).domain === 'air');
    const enemies = enemiesOf(s, f).filter((e) => s.factions[e]?.alive);
    const fighting = enemies.length > 0 || myCities.some((c) => s.time - c.lastAttacked < 10);

    const infos: CityInfo[] = myCities.map((c) => {
      let enemy = 0;
      let friendly = 0;
      if (fighting) {
        sim.spatial.forEachInRange(c.x, c.y, 380, (u, d2) => {
          if (u.owner === f) {
            if (d2 < 200 * 200) friendly += unitPower(u);
          } else if (unitDef(u.type).domain === 'land' && atWar(s, f, u.owner) && sim.combat.canSee(f, u)) {
            enemy += unitPower(u);
          }
        });
      }
      return { city: c, enemy, friendly };
    });

    // Sell large commodity surpluses.
    const fsr = s.factions[f].res;
    if (fsr.food > 2500) sim.econ.trade(f, 'food', -800);
    if (fsr.fuel > 3500) sim.econ.trade(f, 'fuel', -1000);
    if (fsr.metal > 3500) sim.econ.trade(f, 'metal', -1000);

    this.cleanupOps(f, ai);
    if (fighting) this.defend(infos, land);
    this.research(f);
    const saving = !s.factions[f].research && sim.tech.available(f).length > 0 && !fighting && sim.rng.chance(0.5);
    if (!saving) this.produce(f, ai, infos, land.length, naval.length, fighting || ai.war?.phase === 'mobilize', air.length);
    this.build(f, infos);
    this.warPlanning(f, ai, myCities, land, enemies);
    if (enemies.length) {
      const busy = this.attack(f, ai, land, myCities);
      this.amphibious(f, ai, land, naval, myCities, busy);
    }
    this.progressAmphibious(ai);
    this.navy(f, ai, naval, myCities);
    if (enemies.length && air.length) this.airOps(f, ai, air, infos);
    if (enemies.length) this.missiles(f, myUnits, myCities, ai);
  }

  // ---------------------------------------------------------------- diplomacy & war planning

  private warPlanning(f: FactionId, ai: AIState, myCities: City[], land: Unit[], enemies: FactionId[]): void {
    const sim = this.sim;
    const s = sim.state;
    const now = s.time;
    if (ai.war) {
      const tf = s.factions[ai.war.target];
      if (!tf?.alive) ai.war = null;
      else if (ai.war.phase === 'war' && !atWar(s, f, ai.war.target)) ai.war = null;
    }
    // Mobilisation: gather troops at the staging city, then declare war.
    if (ai.war?.phase === 'mobilize') {
      const w = ai.war;
      const stage = s.cities[w.stageCity];
      if (!stage || stage.owner !== f || atWar(s, f, w.target)) {
        ai.war = null;
      } else {
        w.prep = Math.min(1, (now - w.started) / MOBILIZE_HOURS);
        const movers = land
          .filter((u) => !u.order && u.aiTask === 0 && Math.hypot(u.x - stage.x, u.y - stage.y) > 140 && sim.geo.landConnected(u.x, u.y, stage.x, stage.y))
          .sort((a, b) => Math.hypot(a.x - stage.x, a.y - stage.y) - Math.hypot(b.x - stage.x, b.y - stage.y))
          .slice(0, 6);
        if (movers.length) sim.units.orderMove(movers, stage.x + sim.rng.range(-40, 40), stage.y + sim.rng.range(-40, 40));
        if (now - w.started >= MOBILIZE_HOURS) {
          declareWar(sim, f, w.target);
          w.phase = 'war';
          w.started = now;
          // Troops that prepared at the staging area get an offensive bonus.
          for (const u of land) {
            if (Math.hypot(u.x - stage.x, u.y - stage.y) < 220) {
              u.bonus = 1.2;
              u.bonusUntil = now + 48;
            }
          }
        }
      }
    }
    // Ceasefires after long or losing wars.
    for (const e of enemies) {
      const dur = now - (s.warStarted[relKey(f, e)] ?? now);
      if (dur < 150 || !sim.rng.chance(0.06)) continue;
      const ratio = militaryStrength(sim, f) / Math.max(1, militaryStrength(sim, e));
      if (ratio > 0.85 && dur < 400) continue;
      if (e === s.player) {
        if (!s.peaceOffers.some((o) => o.from === f)) {
          s.peaceOffers.push({ from: f, t: now });
          sim.notify(t('{name} proposes a ceasefire — open Diplomacy to answer', { name: factionName(f) }), 'info');
        }
      } else if (sim.rng.next() < wouldAcceptPeace(sim, f, e)) {
        makePeace(sim, f, e);
      }
    }
    // Decide on a new war.
    if (ai.war || enemies.length || now < (ai.nextWarCheck ?? 0)) return;
    ai.nextWarCheck = now + sim.rng.range(50, 110);
    if (now < 30) return;
    let conflicts = 0;
    for (const v of Object.values(s.relations)) if (v === 'war') conflicts++;
    for (const x of s.factionOrder) if (s.ai[x]?.war?.phase === 'mobilize') conflicts++;
    if (conflicts >= Math.min(40, 3 + Math.floor(now / 30))) return;
    const d = s.difficulty;
    const chance = this.pers(f).aggression * 0.45 * (d === 'easy' ? 0.6 : d === 'hard' ? 1.4 : 1);
    if (!sim.rng.chance(chance)) return;
    const plan = this.pickWarTarget(f, myCities);
    if (!plan) return;
    ai.war = { target: plan.target, phase: 'mobilize', started: now, stageCity: plan.stage.id, targetCity: plan.targetCity.id, prep: 0 };
    sim.bus.emit('mobilization', { faction: f, target: plan.target, city: plan.stage });
  }

  private pickWarTarget(f: FactionId, myCities: City[]): { target: FactionId; stage: City; targetCity: City } | null {
    const sim = this.sim;
    const s = sim.state;
    const def = getFactionDef(f);
    const myStr = militaryStrength(sim, f);
    const grace = s.difficulty === 'easy' ? 150 : s.difficulty === 'hard' ? 45 : 90;
    const cands = new Set<FactionId>(def?.neighbors ?? []);
    const ports = myCities.filter((c) => c.port);
    if (ports.length && myStr > 12) {
      for (const c of s.cities) {
        if (c.owner === f || cands.has(c.owner) || !c.port) continue;
        if (ports.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 650)) cands.add(c.owner);
      }
    }
    let best: { target: FactionId; stage: City; targetCity: City } | null = null;
    let bestScore = 0;
    for (const e of cands) {
      const ef = s.factions[e];
      if (!ef?.alive || e === f || atWar(s, f, e)) continue;
      if (e === s.player && s.time < grace) continue;
      if (s.time - (lastPeace.get(relKey(f, e)) ?? -1e9) < 150) continue;
      if (s.factionOrder.some((x) => s.ai[x]?.war?.target === e && s.ai[x]?.war?.phase === 'mobilize')) continue;
      const theirCities = s.cities.filter((c) => c.owner === e);
      if (!theirCities.length) continue;
      const ratio = myStr / Math.max(1, militaryStrength(sim, e));
      if (ratio < 1.25) continue;
      let pair: [City, City] | null = null;
      let pd = Infinity;
      for (const m of myCities) {
        for (const tc of theirCities) {
          const dist = Math.hypot(m.x - tc.x, m.y - tc.y);
          const eff = sim.geo.landConnected(m.x, m.y, tc.x, tc.y) ? dist : dist * 1.8 + 150;
          if (eff < pd) {
            pd = eff;
            pair = [m, tc];
          }
        }
      }
      if (!pair) continue;
      const value = theirCities.reduce((a, c) => a + c.importance, 0);
      const score = ((Math.min(4, ratio) * (8 + value)) / (1 + pd / 250)) * sim.rng.range(0.7, 1.3);
      if (score > bestScore) {
        bestScore = score;
        best = { target: e, stage: pair[0], targetCity: pair[1] };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- economy

  private pickUnit(weights: Record<string, number>, city: City): UnitDef | null {
    const sim = this.sim;
    const opts = Object.keys(weights).filter((id) => sim.production.canProduceUnit(city, id, false).ok);
    const pick = sim.rng.weighted(opts, (id) => weights[id]);
    return pick ? UNIT_MAP[pick] : null;
  }

  private produce(f: FactionId, ai: AIState, infos: CityInfo[], landCount: number, navalCount: number, war: boolean, airCount = 0): void {
    const sim = this.sim;
    const fs = sim.state.factions[f];
    const pers = this.pers(f);
    const cap = sim.state.difficulty === 'hard' ? 60 : sim.state.difficulty === 'easy' ? 34 : 46;
    let target = Math.max(2, Math.min(cap, (fs.gross.money / 1.9) * 0.9));
    if (!war) target *= 0.55;
    // Keep roughly the real-world standing forces (and grow them a little in wartime).
    if (ai.baseline) target = Math.max(target, ai.baseline * (war ? 1.1 : 0.95));
    const total = landCount + navalCount + airCount;
    if (total >= target) return;
    let queued = 0;
    // 1. Emergency levies for cities about to fall.
    const emergency = infos
      .filter((i) => i.enemy > i.friendly * 1.4 && i.enemy > 1.5 && sim.state.time - i.city.lastAttacked < 8 && i.city.queue.length < 1 && i.city.unrest <= 0)
      .sort((a, b) => b.city.importance - a.city.importance)[0];
    if (emergency) {
      const type = sim.tech.isUnlocked(f, 'mech_infantry') && canAfford(fs.res, UNIT_MAP.mech_infantry.cost) ? 'mech_infantry' : 'infantry';
      if (sim.production.enqueueUnit(emergency.city, type)) queued++;
    }
    // 2. Planned purchases: pick a unit by desired mix and save up for it.
    const ports = infos.filter((i) => i.city.port).length;
    const navalTarget = ports ? Math.round(total * 0.3 * pers.naval) + (pers.naval > 0.6 ? 2 : 0) : 0;
    for (let guard = 0; guard < 3 && queued < 3; guard++) {
      if (ai.plan) {
        const c = sim.state.cities[ai.plan.city];
        if (!c || c.owner !== f || c.queue.length >= 3 || !sim.production.canProduceUnit(c, ai.plan.unit, false).ok) ai.plan = null;
      }
      if (!ai.plan) {
        const free = infos.filter((i) => i.city.queue.length < 2 && i.city.unrest <= 0);
        if (!free.length) return;
        const startAir = Object.values(forcePlan(f).air).reduce((a, b) => a + b, 0);
        const airTarget = Math.max(startAir, Math.round(total * 0.12));
        const wantAir = !!startAir && airCount < airTarget && sim.rng.chance(0.4);
        const wantNaval = !wantAir && navalCount < navalTarget && sim.rng.chance(0.5);
        const pool = wantAir ? free.filter((i) => hasAirfield(i.city)) : wantNaval ? free.filter((i) => i.city.port) : free;
        if (!pool.length) return;
        const info = sim.rng.weighted(pool, (i) => (i.enemy + 1) * (i.city.industry + 1));
        if (!info) return;
        const def = this.pickUnit(wantAir ? AIR_WEIGHTS : wantNaval ? NAVAL_WEIGHTS : LAND_WEIGHTS, info.city);
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
    const pers = this.pers(f);
    const calm = infos.filter((i) => i.enemy < 1 && i.city.queue.length < 2);
    if (!calm.length) return;
    const tryBuild = (c: City, id: string) => sim.production.canBuild(c, id).ok && sim.production.enqueueBuilding(c, id);
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
    const pers = this.pers(f);
    const avail = sim.tech.available(f).filter((tech) => canAfford(fs.res, tech.cost));
    if (!avail.length) return;
    const pick = sim.rng.weighted(avail, (tech) => {
      const cat = tech.category === 'navy' ? 0.4 + pers.naval * 1.4 : tech.category === 'industry' ? 1.3 : tech.category === 'air' ? 0.6 : 1.1;
      return (cat * (1 + pers.tech)) / tech.tier;
    });
    if (pick) sim.tech.startResearch(f, pick.id);
  }

  // ---------------------------------------------------------------- military

  private cleanupOps(f: FactionId, ai: AIState): void {
    const sim = this.sim;
    const s = sim.state;
    ai.ops = ai.ops.filter((op) => {
      op.units = op.units.filter((id) => {
        const u = sim.units.find(id);
        return !!u && !u.dead;
      });
      const c = s.cities[op.targetCity];
      const tooLong = s.time - op.started > (op.kind === 'amphibious' ? 260 : 180);
      const transportLost = op.kind === 'amphibious' && (!op.transport || !s.units.get(op.transport));
      const done = !c || !atWar(s, f, c.owner) || op.units.length === 0 || tooLong || transportLost;
      if (done) {
        for (const id of op.units) {
          const u = sim.units.find(id);
          if (u) u.aiTask = 0;
        }
        const tr = op.transport ? s.units.get(op.transport) : undefined;
        if (tr) {
          tr.aiTask = 0;
          if (tr.cargo?.length) sim.units.unloadNow(tr);
        }
      }
      return !done;
    });
  }

  private defend(infos: CityInfo[], land: Unit[]): void {
    const sim = this.sim;
    const threatened = infos
      .filter((i) => i.enemy > 0.5 && i.enemy > i.friendly * 0.9)
      .sort((a, b) => b.city.importance * b.enemy - a.city.importance * a.enemy);
    for (const info of threatened.slice(0, 3)) {
      const c = info.city;
      let need = info.enemy * 1.3 - info.friendly;
      const candidates = land
        .filter((u) => u.aiTask === 0 && (!u.order || u.order.kind === 'move'))
        .map((u) => ({ u, d: Math.hypot(u.x - c.x, u.y - c.y) }))
        .filter((e) => e.d < 700 && e.d > 60 && sim.geo.landConnected(e.u.x, e.u.y, c.x, c.y))
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

  /** Land offensives against enemy cities reachable on foot. Returns true when ops are running. */
  private attack(f: FactionId, ai: AIState, land: Unit[], myCities: City[]): boolean {
    const sim = this.sim;
    const s = sim.state;
    const pers = this.pers(f);
    // Keep ops moving.
    for (const op of ai.ops) {
      if (op.kind !== 'attack') continue;
      const c = s.cities[op.targetCity];
      const idle = op.units.map((id) => s.units.get(id)).filter((u): u is Unit => !!u && (!u.order || u.order.kind === 'move'));
      if (idle.length) sim.units.orderAttackCity(idle, c);
    }
    const running = ai.ops.length > 0;
    const maxOps = 1 + Math.round(pers.aggression * 2);
    if (ai.ops.length >= maxOps) return running;
    const idle = land.filter((u) => u.aiTask === 0 && (!u.order || u.order.kind === 'move'));
    if (idle.length < 3) return running;
    // Keep a garrison: one unit per important city tends to stay home.
    const free = idle.filter((u) => {
      let home = false;
      for (const c of myCities) if (c.importance >= 8 && Math.hypot(c.x - u.x, c.y - u.y) < 50) home = true;
      return !home || sim.rng.chance(0.35);
    });
    if (free.length < 3) return running;
    const warTarget = ai.war?.phase === 'war' ? ai.war.target : null;
    let best: City | null = null;
    let bestScore = 0;
    let bestDef = 0;
    for (const c of s.cities) {
      if (!atWar(s, f, c.owner)) continue;
      if (ai.ops.some((o) => o.targetCity === c.id)) continue;
      let dMin = Infinity;
      let reach = 0;
      for (const u of free) {
        if (!sim.geo.landConnected(u.x, u.y, c.x, c.y)) continue;
        reach++;
        dMin = Math.min(dMin, Math.hypot(u.x - c.x, u.y - c.y));
      }
      if (reach < 3) continue;
      for (const m of myCities) dMin = Math.min(dMin, Math.hypot(m.x - c.x, m.y - c.y));
      if (dMin > 850) continue;
      let def = c.hp / 180;
      sim.spatial.forEachInRange(c.x, c.y, 220, (u) => {
        if (u.owner === c.owner && unitDef(u.type).domain === 'land') def += unitPower(u);
      });
      let score = (c.importance + 3) / (1 + dMin / 150) / (1 + def * 0.35);
      if (c.origOwner === f) score *= 1.6;
      if (c.owner === warTarget) score *= 2;
      if (c.owner === 'neutral') score *= 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = c;
        bestDef = def;
      }
    }
    if (!best) return running;
    const target = best;
    const pool = free
      .filter((u) => sim.geo.landConnected(u.x, u.y, target.x, target.y))
      .map((u) => ({ u, d: Math.hypot(u.x - target.x, u.y - target.y) }))
      .filter((e) => e.d < 1200)
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
    if (group.length < 3 || power < needed) return running;
    const op: AIOperation = { id: ai.nextOpId++, targetCity: target.id, units: group.map((u) => u.id), started: s.time, kind: 'attack' };
    for (const u of group) u.aiTask = op.id;
    ai.ops.push(op);
    sim.units.orderAttackCity(group, target);
    return true;
  }

  /** Seaborne invasion: gather troops at a port, load a transport, sail and land near the target. */
  private amphibious(f: FactionId, ai: AIState, land: Unit[], naval: Unit[], myCities: City[], landOpsRunning: boolean): void {
    const sim = this.sim;
    const s = sim.state;
    if (ai.ops.some((o) => o.kind === 'amphibious')) return;
    if (landOpsRunning && !sim.rng.chance(0.3)) return;
    const ports = myCities.filter((c) => c.port);
    if (!ports.length) return;
    // Target: an enemy coastal city not reachable on foot but reachable by sea from one of our ports.
    let best: { port: City; target: City; d: number } | null = null;
    for (const c of s.cities) {
      if (!c.port || !atWar(s, f, c.owner)) continue;
      for (const p of ports) {
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d > 1300 || (best && d >= best.d)) continue;
        if (sim.geo.landConnected(p.x, p.y, c.x, c.y)) continue;
        if (!sim.paths.finder.reachable('naval', p.portX, p.portY, c.portX, c.portY)) continue;
        best = { port: p, target: c, d };
      }
    }
    if (!best) return;
    const { port, target } = best;
    const transport = naval.find(
      (u) => u.type === 'transport' && !u.order && u.aiTask === 0 && !u.cargo?.length && sim.paths.finder.reachable('naval', u.x, u.y, port.portX, port.portY),
    );
    if (!transport) {
      if (!ai.plan && port.queue.length < 2 && sim.production.canProduceUnit(port, 'transport', false).ok) ai.plan = { unit: 'transport', city: port.id };
      return;
    }
    const troops = land
      .filter((u) => u.aiTask === 0 && !u.order && Math.hypot(u.x - port.x, u.y - port.y) < 700 && sim.geo.landConnected(u.x, u.y, port.x, port.y))
      .sort((a, b) => unitPower(b) - unitPower(a))
      .slice(0, 6);
    if (troops.length < 3) return;
    const op: AIOperation = {
      id: ai.nextOpId++, targetCity: target.id, units: troops.map((u) => u.id), started: s.time, kind: 'amphibious',
      phase: 'gather', transport: transport.id, port: port.id,
    };
    for (const u of troops) u.aiTask = op.id;
    transport.aiTask = op.id;
    ai.ops.push(op);
    sim.units.orderMove(troops, port.x, port.y);
    sim.units.orderMove([transport], port.portX, port.portY);
  }

  private progressAmphibious(ai: AIState): void {
    const sim = this.sim;
    const s = sim.state;
    for (const op of ai.ops) {
      if (op.kind !== 'amphibious') continue;
      const tr = op.transport ? s.units.get(op.transport) : undefined;
      const port = op.port !== undefined ? s.cities[op.port] : undefined;
      const target = s.cities[op.targetCity];
      if (!tr || !port || !target) continue;
      const troops = op.units.map((id) => s.units.get(id)).filter((u): u is Unit => !!u);
      if (op.phase === 'gather') {
        const near = troops.filter((u) => Math.hypot(u.x - port.x, u.y - port.y) < 110);
        const trNear = Math.hypot(tr.x - port.portX, tr.y - port.portY) < 80;
        if (!tr.order && !trNear) sim.units.orderMove([tr], port.portX, port.portY);
        for (const u of troops) if (!u.order && Math.hypot(u.x - port.x, u.y - port.y) >= 110) sim.units.orderMove([u], port.x, port.y);
        const ready = near.length >= troops.length || (near.length >= 3 && s.time - op.started > 30) || (near.length > 0 && s.time - op.started > 70);
        if (trNear && ready) {
          sim.units.orderBoard(near, tr);
          op.phase = 'board';
          op.started = s.time;
        }
      } else if (op.phase === 'board') {
        const waiting = troops.filter((u) => u.order?.kind === 'board');
        if ((tr.cargo?.length ?? 0) > 0 && (waiting.length === 0 || s.time - op.started > 25)) {
          if (waiting.length) sim.units.orderStop(waiting);
          op.units = (tr.cargo ?? []).map((u) => u.id);
          sim.units.orderUnload(tr, target.x, target.y);
          op.phase = 'sail';
          op.started = s.time;
        } else if (!tr.cargo?.length && waiting.length === 0) {
          op.started = -1e9; // nobody boarded — abandon
        }
      } else if (op.phase === 'sail') {
        if (!tr.cargo?.length) {
          const landed = op.units.map((id) => s.units.get(id)).filter((u): u is Unit => !!u);
          if (landed.length) sim.units.orderAttackCity(landed, target);
          op.kind = 'attack';
          op.units = landed.map((u) => u.id);
          op.started = s.time;
          op.transport = undefined;
          tr.aiTask = 0;
          sim.units.orderMove([tr], port.portX, port.portY);
        } else if (!tr.order) {
          // Landing failed (no beach there): try elsewhere along the target's coast.
          if (sim.units.unloadNow(tr, target.x, target.y) === 0) {
            sim.units.orderUnload(tr, target.x + sim.rng.range(-90, 90), target.y + sim.rng.range(-90, 90));
          }
        }
      }
    }
  }

  private navy(f: FactionId, ai: AIState, naval: Unit[], myCities: City[]): void {
    const sim = this.sim;
    const s = sim.state;
    if (!naval.length) return;
    const ports = myCities.filter((c) => c.port);
    const idle = naval.filter((u) => !u.order && u.aiTask === 0 && u.type !== 'transport');
    const warring = enemiesOf(s, f).length > 0;
    for (const ship of idle) {
      const def = unitDef(ship.type);
      if (warring) {
        // Hunt visible enemy ships nearby.
        let prey: Unit | null = null;
        let preyD = def.stealth ? 1300 : 900;
        sim.spatial.forEachInRange(ship.x, ship.y, preyD, (o, d2) => {
          if (!atWar(s, f, o.owner) || !sim.combat.canSee(f, o)) return;
          const od = unitDef(o.type);
          if (od.domain !== 'naval' || !(def.vs[od.cls] ?? 0)) return;
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
      }
      // Patrol near a friendly port.
      if (ports.length && sim.rng.chance(0.2)) {
        const p = sim.rng.pick(ports);
        const a = sim.rng.range(0, Math.PI * 2);
        const r = sim.rng.range(40, 260);
        sim.units.orderMove([ship], p.portX + Math.cos(a) * r, p.portY + Math.sin(a) * r, true);
      }
    }
    ai.lastNaval = s.time;
  }

  /** Air force: fighters win the skies, strike aircraft and helicopters hit troops, bombers hit cities. */
  private airOps(f: FactionId, ai: AIState, air: Unit[], infos: CityInfo[]): void {
    const sim = this.sim;
    const s = sim.state;
    const threatened = infos.filter((i) => i.enemy > 0).sort((a, b) => b.enemy * b.city.importance - a.enemy * a.city.importance);
    const opTargets = ai.ops.map((o) => s.cities[o.targetCity]).filter((c): c is City => !!c && atWar(s, f, c.owner));
    for (const u of air) {
      if (u.order || u.cargo?.length) continue;
      const def = unitDef(u.type);
      if (def.attack <= 0) continue;
      const endur = sim.units.endurance(u);
      if (u.landed && (u.fuel ?? 0) < endur * 0.8) continue;
      const radius = endur * sim.tech.stats(f, u.type).speed * 0.35;
      const inReach = (x: number, y: number) => Math.hypot(x - u.x, y - u.y) < radius;
      const enemyNear = (x: number, y: number, r: number, pred: (o: Unit) => boolean): Unit | null => {
        let best: Unit | null = null;
        let bd = Infinity;
        sim.spatial.forEachInRange(x, y, r, (o, d2) => {
          if (!atWar(s, f, o.owner) || !sim.combat.canSee(f, o) || !pred(o)) return;
          if (d2 < bd) {
            bd = d2;
            best = o;
          }
        });
        return best;
      };
      const canHit = (o: Unit) => (def.vs[unitDef(o.type).cls] ?? 0) > 0;
      if (u.type === 'fighter') {
        // Intercept enemy aircraft near our cities or our fighter; else cover an offensive or a threatened city.
        const bandit = enemyNear(u.x, u.y, Math.min(radius, 700), (o) => unitDef(o.type).domain === 'air' && !o.landed);
        if (bandit) {
          sim.units.orderAttackUnit([u], bandit);
          continue;
        }
        const cover = opTargets.find((c) => inReach(c.x, c.y)) ?? threatened.find((i) => inReach(i.city.x, i.city.y))?.city;
        if (cover && sim.rng.chance(0.5)) sim.units.orderMove([u], cover.x, cover.y, true);
        continue;
      }
      if (u.type === 'bomber') {
        const target = opTargets.find((c) => inReach(c.x, c.y)) ?? s.cities.filter((c) => atWar(s, f, c.owner) && inReach(c.x, c.y)).sort((a, b) => b.importance - a.importance)[0];
        if (target) sim.units.orderAttackCity([u], target);
        continue;
      }
      // Strike aircraft & attack helicopters: enemy troops threatening our cities, then offensive targets.
      let target: Unit | null = null;
      for (const i of threatened) {
        if (!inReach(i.city.x, i.city.y)) continue;
        target = enemyNear(i.city.x, i.city.y, 380, (o) => unitDef(o.type).domain !== 'air' && canHit(o));
        if (target) break;
      }
      if (!target) {
        for (const c of opTargets) {
          if (!inReach(c.x, c.y)) continue;
          target = enemyNear(c.x, c.y, 260, (o) => unitDef(o.type).domain !== 'air' && canHit(o));
          if (target) break;
          if ((def.vs.city ?? 0) > 0 && c.hp > 0) {
            sim.units.orderAttackCity([u], c);
            break;
          }
        }
      }
      if (target) sim.units.orderAttackUnit([u], target);
    }
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
        if (unitDef(o.type).domain === 'air' && !o.landed) return;
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
      const target = pickTarget(u.x, u.y, sim.combat.missileRangeOf(u) * 0.95);
      if (target && sim.combat.launchMissile(u, target)) launches++;
    }
    for (const c of myCities) {
      if (launches >= 2) return;
      if (c.missiles < 1 || c.missileCd > 0) continue;
      const target = pickTarget(c.x, c.y, CITY_MISSILE_RANGE * 0.95);
      if (target && sim.combat.launchCityMissile(c, target)) launches++;
    }
  }
}
