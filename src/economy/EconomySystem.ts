// Resource income, upkeep, power grid and industrial capacity.
import type { City, FactionId, ResKey, Resources } from '../core/types';
import { RES_KEYS } from '../core/types';
import { unitDef } from '../data/units';
import { emptyRes } from '../core/GameState';
import type { Sim } from '../core/Simulation';

export interface CityYield {
  res: Resources;
  powerSupply: number;
  powerDemand: number;
  industry: number;
}

export function cityYield(c: City): CityYield {
  const b = c.buildings;
  const has = (t: string) => c.tags.includes(t);
  const unrest = c.unrest > 0 ? 0.5 : 1;
  const res: Resources = {
    money: (1.4 + c.size * 1.0 + c.industry * 0.4 + (c.trade ? 2 : 0) + (c.capital ? 3 : 0)) * unrest,
    food: 0.4 + (has('f') ? 2.5 : 0) + (b.farm ?? 0) * 2.5 * (has('f') ? 1.5 : 1),
    metal: 0.2 + (has('m') ? 2.5 : 0) + (b.mine ?? 0) * 2 * (has('m') ? 1.5 : 1) + c.industry * 0.1,
    fuel: 0.1 + (has('o') ? 3 : 0) + (b.refinery ?? 0) * 2 * (has('o') ? 1.5 : 1),
  };
  return {
    res,
    powerSupply: 3 + c.size * 0.6 + (has('e') ? 6 : 0) + (b.power_plant ?? 0) * 8,
    powerDemand: c.industry * 0.8 + (b.factory ?? 0) * 2 + (b.research_lab ?? 0) * 2 + c.size * 0.4,
    industry: c.industry + (b.factory ?? 0) * 1.5,
  };
}

/** Market prices in money per unit (buy at +30%, sell at -30%). */
export const MARKET_PRICE: Record<Exclude<ResKey, 'money'>, number> = { metal: 2.4, fuel: 2.2, food: 1.2 };
export const MARKET_BUY = 1.3;
export const MARKET_SELL = 0.7;

export class EconomySystem {
  private acc = 0;

  constructor(private sim: Sim) {
    this.recalc();
  }

  update(dt: number): void {
    this.acc += dt;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.tick(1);
    }
  }

  /** Recompute income figures without changing stockpiles. */
  recalc(): void {
    const s = this.sim.state;
    for (const id of s.factionOrder) this.compute(id);
  }

  private compute(id: FactionId): void {
    const s = this.sim.state;
    const fs = s.factions[id];
    const mods = this.sim.tech.getMods(id);
    const gross = emptyRes();
    let supply = 0;
    let demand = 0;
    let industry = 0;
    for (const c of s.cities) {
      if (c.owner !== id) continue;
      const y = cityYield(c);
      for (const k of RES_KEYS) gross[k] += y.res[k];
      supply += y.powerSupply;
      demand += y.powerDemand;
      industry += y.industry;
    }
    const bonus = this.sim.aiBonus(id);
    for (const k of RES_KEYS) {
      let m = mods.econ[k] * bonus;
      for (const e of fs.effects) m *= e.mods.resMult?.[k] ?? 1;
      gross[k] *= m;
    }
    let powerMult = mods.econ.power;
    for (const e of fs.effects) powerMult *= e.mods.powerMult ?? 1;
    supply *= powerMult;
    const upkeep = emptyRes();
    for (const u of s.units.values()) {
      if (u.owner !== id) continue;
      const def = unitDef(u.type);
      for (const [k, v] of Object.entries(def.upkeep)) upkeep[k as ResKey] += (v as number) * mods.upkeep;
    }
    fs.gross = gross;
    fs.upkeep = upkeep;
    for (const k of RES_KEYS) fs.income[k] = gross[k] - upkeep[k];
    fs.power.supply = supply;
    fs.power.demand = demand;
    fs.industry = industry;
  }

  private tick(hours: number): void {
    const s = this.sim.state;
    for (const id of s.factionOrder) {
      const fs = s.factions[id];
      if (!fs.alive) continue;
      this.compute(id);
      for (const k of RES_KEYS) {
        fs.res[k] += fs.income[k] * hours;
        if (fs.res[k] < 0) fs.res[k] = 0;
      }
      // Timed effects from world events.
      for (const e of fs.effects) e.remaining -= hours;
      if (fs.effects.some((e) => e.remaining <= 0)) fs.effects = fs.effects.filter((e) => e.remaining > 0);
      // Starvation hurts infantry.
      if (fs.res.food <= 0 && fs.income.food < 0) {
        for (const u of s.units.values()) {
          if (u.owner === id && unitDef(u.type).cls === 'infantry' && u.hp > u.maxHp * 0.3) u.hp -= 1.5 * hours;
        }
      }
    }
  }

  /** Buy (amount > 0) or sell (amount < 0) a commodity for money. Returns false if not possible. */
  trade(id: FactionId, res: Exclude<ResKey, 'money'>, amount: number): boolean {
    const fs = this.sim.state.factions[id];
    if (!fs || amount === 0) return false;
    if (amount > 0) {
      const price = amount * MARKET_PRICE[res] * MARKET_BUY;
      if (fs.res.money < price) return false;
      fs.res.money -= price;
      fs.res[res] += amount;
    } else {
      const qty = -amount;
      if (fs.res[res] < qty) return false;
      fs.res[res] -= qty;
      fs.res.money += qty * MARKET_PRICE[res] * MARKET_SELL;
    }
    return true;
  }

  /** Money needed to buy whatever is missing to afford `cost`. */
  shortfallPrice(id: FactionId, cost: Partial<Record<ResKey, number>>): number {
    const fs = this.sim.state.factions[id];
    let price = 0;
    for (const k of ['metal', 'fuel', 'food'] as const) {
      const miss = (cost[k] ?? 0) - fs.res[k];
      if (miss > 0) price += Math.ceil(miss) * MARKET_PRICE[k] * MARKET_BUY;
    }
    return price;
  }

  powerRatio(id: FactionId): number {
    const fs = this.sim.state.factions[id];
    return fs.power.demand > 0 ? Math.min(1, fs.power.supply / fs.power.demand) : 1;
  }
}
