// Technology research and per-faction modifiers / cached unit stats.
import type { FactionId, TechDef, UnitDef, ResKey, Cost } from '../core/types';
import { TECH_DEFS, TECH_MAP } from '../data/techs';
import { UNIT_DEFS, unitDef } from '../data/units';
import type { Sim } from '../core/Simulation';

export interface UnitStats {
  attack: number;
  defense: number;
  maxHp: number;
  speed: number;
  range: number;
  detection: number;
}

export interface FactionMods {
  prod: number;
  research: number;
  upkeep: number;
  intercept: number;
  missileDmg: number;
  missileCap: number;
  sonar: number;
  stealth: number;
  econ: Record<ResKey | 'power', number>;
  unlocked: Set<string>;
  stats: Record<string, UnitStats>;
}

function matches(target: string | undefined, u: UnitDef): boolean {
  if (!target || target === 'all') return true;
  return target === u.domain || target === u.cls || target === u.id;
}

export function canAfford(res: Record<ResKey, number>, cost: Cost): boolean {
  for (const [k, v] of Object.entries(cost)) if ((res[k as ResKey] ?? 0) < (v as number)) return false;
  return true;
}

export function pay(res: Record<ResKey, number>, cost: Cost, mult = 1): void {
  for (const [k, v] of Object.entries(cost)) res[k as ResKey] -= (v as number) * mult;
}

export class TechSystem {
  private mods: Record<FactionId, FactionMods> = {};

  constructor(private sim: Sim) {
    for (const id of Object.keys(sim.state.factions)) this.recompute(id);
  }

  getMods(f: FactionId): FactionMods {
    return this.mods[f] ?? this.recompute(f);
  }

  stats(owner: FactionId, type: string): UnitStats {
    const m = this.getMods(owner);
    return m.stats[type] ?? m.stats.infantry;
  }

  recompute(f: FactionId): FactionMods {
    const fs = this.sim.state.factions[f];
    const techs = new Set(fs?.techs ?? []);
    const m: FactionMods = {
      prod: 1, research: 1, upkeep: 1, intercept: 0, missileDmg: 1, missileCap: 0, sonar: 1, stealth: 1,
      econ: { money: 1, metal: 1, fuel: 1, food: 1, power: 1 },
      unlocked: new Set(UNIT_DEFS.filter((u) => !u.requires && !u.future).map((u) => u.id)),
      stats: {},
    };
    const statMult: { target?: string; stat: string; mult: number }[] = [];
    for (const t of TECH_DEFS) {
      if (!techs.has(t.id)) continue;
      for (const e of t.effects) {
        switch (e.type) {
          case 'stat': statMult.push({ target: e.target, stat: e.stat!, mult: e.mult ?? 1 }); break;
          case 'unlock': if (e.unit) m.unlocked.add(e.unit); break;
          case 'econ': if (e.resource) m.econ[e.resource] *= e.mult ?? 1; break;
          case 'prod': m.prod *= e.mult ?? 1; break;
          case 'research': m.research *= e.mult ?? 1; break;
          case 'upkeep': m.upkeep *= e.mult ?? 1; break;
          case 'intercept': m.intercept += e.add ?? 0; break;
          case 'missile': m.missileDmg *= e.mult ?? 1; m.missileCap += e.add ?? 0; break;
          case 'sonar': m.sonar *= e.mult ?? 1; break;
          case 'stealth': m.stealth *= e.mult ?? 1; break;
        }
      }
    }
    for (const u of UNIT_DEFS) {
      const s: UnitStats = { attack: u.attack, defense: u.defense, maxHp: u.hp, speed: u.speed, range: u.range, detection: u.detection };
      for (const sm of statMult) {
        if (!matches(sm.target, u)) continue;
        if (sm.stat === 'hp') s.maxHp *= sm.mult;
        else (s as any)[sm.stat] *= sm.mult;
      }
      m.stats[u.id] = s;
    }
    this.mods[f] = m;
    // Keep unit hit-point ratios when max HP changes.
    for (const unit of this.sim.state.units.values()) {
      if (unit.owner !== f) continue;
      const newMax = m.stats[unit.type]?.maxHp ?? unit.maxHp;
      if (Math.abs(newMax - unit.maxHp) > 0.01) {
        unit.hp = (unit.hp / unit.maxHp) * newMax;
        unit.maxHp = newMax;
      }
    }
    return m;
  }

  isUnlocked(f: FactionId, unitId: string): boolean {
    return this.getMods(f).unlocked.has(unitId);
  }

  available(f: FactionId): TechDef[] {
    const fs = this.sim.state.factions[f];
    return TECH_DEFS.filter((t) => !t.future && !fs.techs.includes(t.id) && t.requires.every((r) => fs.techs.includes(r)));
  }

  canResearch(f: FactionId, techId: string): { ok: boolean; reason?: string } {
    const fs = this.sim.state.factions[f];
    const t = TECH_MAP[techId];
    if (!t) return { ok: false, reason: 'Unknown technology' };
    if (t.future) return { ok: false, reason: 'Coming in a future update' };
    if (fs.techs.includes(techId)) return { ok: false, reason: 'Already researched' };
    if (fs.research) return { ok: false, reason: 'Research already in progress' };
    if (!t.requires.every((r) => fs.techs.includes(r))) return { ok: false, reason: 'Missing prerequisites' };
    if (!canAfford(fs.res, t.cost)) return { ok: false, reason: 'Insufficient resources' };
    return { ok: true };
  }

  startResearch(f: FactionId, techId: string): boolean {
    if (!this.canResearch(f, techId).ok) return false;
    const fs = this.sim.state.factions[f];
    const t = TECH_MAP[techId];
    pay(fs.res, t.cost);
    fs.research = { id: techId, progress: 0, time: t.time };
    return true;
  }

  cancelResearch(f: FactionId): void {
    const fs = this.sim.state.factions[f];
    if (!fs.research) return;
    const t = TECH_MAP[fs.research.id];
    if (t) for (const [k, v] of Object.entries(t.cost)) fs.res[k as ResKey] += (v as number) * 0.5;
    fs.research = null;
  }

  researchSpeed(f: FactionId): number {
    const s = this.sim.state;
    let labs = 0;
    for (const c of s.cities) if (c.owner === f) labs += c.buildings.research_lab ?? 0;
    let mult = this.getMods(f).research * (1 + labs * 0.15);
    for (const e of s.factions[f].effects) mult *= e.mods.researchMult ?? 1;
    const fs = s.factions[f];
    const powerRatio = fs.power.demand > 0 ? Math.min(1, fs.power.supply / fs.power.demand) : 1;
    return mult * (0.6 + 0.4 * powerRatio) * this.sim.aiBonus(f);
  }

  update(dt: number): void {
    const s = this.sim.state;
    for (const id of s.factionOrder) {
      const fs = s.factions[id];
      if (!fs.alive || !fs.research) continue;
      fs.research.progress += dt * this.researchSpeed(id);
      if (fs.research.progress >= fs.research.time) {
        const tid = fs.research.id;
        fs.techs.push(tid);
        fs.research = null;
        this.recompute(id);
        this.sim.bus.emit('researchComplete', { faction: id, tech: tid });
      }
    }
  }
}

export function unitStatsFor(sim: Sim, owner: FactionId, type: string): UnitStats {
  return sim.tech.stats(owner, type);
}

export { unitDef };
