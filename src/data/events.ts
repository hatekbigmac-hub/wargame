import type { City, FactionId } from '../core/types';
import type { Sim } from '../core/Simulation';
import { NEUTRAL_ID } from './factions';
import { t, tn } from '../i18n';

export interface EventResult {
  text: string;
  city?: City | null;
}

export interface WorldEventDef {
  id: string;
  title: string;
  good: boolean;
  weight: number;
  canApply: (sim: Sim, f: FactionId) => boolean;
  apply: (sim: Sim, f: FactionId) => EventResult;
}

function ownedCities(sim: Sim, f: FactionId): City[] {
  return sim.state.cities.filter((c) => c.owner === f);
}

function randomCity(sim: Sim, f: FactionId, pred: (c: City) => boolean = () => true): City | null {
  const list = ownedCities(sim, f).filter(pred);
  return list.length ? sim.rng.pick(list) : null;
}

function addEffect(sim: Sim, f: FactionId, id: string, label: string, hours: number, mods: Record<string, unknown>): void {
  const fs = sim.state.factions[f];
  fs.effects = fs.effects.filter((e) => e.id !== id);
  fs.effects.push({ id, label, remaining: hours, mods: mods as never });
}

// Data-driven world events. Add new entries here; WorldEventSystem picks them by weight.
export const WORLD_EVENTS: WorldEventDef[] = [
  {
    id: 'industrial_boom', title: 'Industrial Boom', good: true, weight: 10,
    canApply: () => true,
    apply: (sim, f) => {
      addEffect(sim, f, 'industrial_boom', 'Industrial Boom (+25% production)', 60, { prodMult: 1.25 });
      return { text: t('Factories run triple shifts. Production +25% for 60 hours.') };
    },
  },
  {
    id: 'fuel_shortage', title: 'Fuel Shortage', good: false, weight: 8,
    canApply: () => true,
    apply: (sim, f) => {
      const fs = sim.state.factions[f];
      fs.res.fuel *= 0.8;
      addEffect(sim, f, 'fuel_shortage', 'Fuel Shortage (-40% fuel)', 60, { resMult: { fuel: 0.6 } });
      return { text: t('Refinery accidents cut fuel output by 40% for 60 hours.') };
    },
  },
  {
    id: 'harvest_failure', title: 'Harvest Failure', good: false, weight: 7,
    canApply: () => true,
    apply: (sim, f) => {
      sim.state.factions[f].res.food *= 0.7;
      addEffect(sim, f, 'harvest_failure', 'Harvest Failure (-40% food)', 45, { resMult: { food: 0.6 } });
      return { text: t('Blight ruins the harvest. Food stocks -30%, food income -40%.') };
    },
  },
  {
    id: 'windfall', title: 'Economic Windfall', good: true, weight: 9,
    canApply: () => true,
    apply: (sim, f) => {
      const amt = Math.round(sim.rng.range(400, 900));
      sim.state.factions[f].res.money += amt;
      return { text: t('Bond markets surge. Treasury receives ${amt}.', { amt }) };
    },
  },
  {
    id: 'arms_deal', title: 'Arms Deal', good: true, weight: 7,
    canApply: () => true,
    apply: (sim, f) => {
      const fs = sim.state.factions[f];
      fs.res.metal += 220;
      fs.res.fuel += 120;
      return { text: t('A lucrative arms deal delivers 220 metal and 120 fuel.') };
    },
  },
  {
    id: 'oil_discovery', title: 'Oil Discovery', good: true, weight: 5,
    canApply: (sim, f) => ownedCities(sim, f).some((c) => !c.tags.includes('o')),
    apply: (sim, f) => {
      const c = randomCity(sim, f, (cc) => !cc.tags.includes('o'));
      if (c) c.tags += 'o';
      return { text: t('Geologists strike oil near {city}. The city now produces fuel.', { city: c ? tn(c) : '' }), city: c };
    },
  },
  {
    id: 'volunteers', title: 'Volunteer Surge', good: true, weight: 7,
    canApply: (sim, f) => ownedCities(sim, f).length > 0,
    apply: (sim, f) => {
      const cities = ownedCities(sim, f).sort((a, b) => b.importance - a.importance);
      const c = cities[0];
      for (let i = 0; i < 2; i++) sim.units.spawn('infantry', f, c.x + sim.rng.range(-18, 18), c.y + sim.rng.range(-18, 18));
      return { text: t('Patriotic volunteers form two infantry battalions in {city}.', { city: tn(c) }), city: c };
    },
  },
  {
    id: 'breakthrough', title: 'Scientific Breakthrough', good: true, weight: 6,
    canApply: () => true,
    apply: (sim, f) => {
      addEffect(sim, f, 'breakthrough', 'Breakthrough (+50% research)', 50, { researchMult: 1.5 });
      return { text: t('A research breakthrough speeds up all research by 50% for 50 hours.') };
    },
  },
  {
    id: 'power_outage', title: 'Grid Failure', good: false, weight: 6,
    canApply: () => true,
    apply: (sim, f) => {
      addEffect(sim, f, 'power_outage', 'Grid Failure (-40% power)', 40, { powerMult: 0.6 });
      return { text: t('Cascading blackouts. Electricity supply -40% for 40 hours.') };
    },
  },
  {
    id: 'strikes', title: 'Labour Strikes', good: false, weight: 6,
    canApply: () => true,
    apply: (sim, f) => {
      addEffect(sim, f, 'strikes', 'Strikes (-35% production)', 40, { prodMult: 0.65 });
      return { text: t('Nationwide strikes slow production by 35% for 40 hours.') };
    },
  },
  {
    id: 'unrest', title: 'City Unrest', good: false, weight: 7,
    canApply: (sim, f) => ownedCities(sim, f).length > 2,
    apply: (sim, f) => {
      const c = randomCity(sim, f, (cc) => !cc.capital)!;
      c.unrest = 45;
      return { text: t('Riots in {city}. Production halted and tax income halved for 45 hours.', { city: tn(c) }), city: c };
    },
  },
  {
    id: 'rebellion', title: 'Rebellion', good: false, weight: 3,
    canApply: (sim, f) => ownedCities(sim, f).length > 6 && sim.state.time > 300,
    apply: (sim, f) => {
      const c = randomCity(sim, f, (cc) => {
        if (cc.capital || cc.size > 2) return false;
        let guarded = false;
        sim.spatial.forEachInRange(cc.x, cc.y, 90, (u) => { if (u.owner === f) guarded = true; });
        return !guarded;
      });
      if (!c) {
        sim.state.factions[f].res.money *= 0.9;
        return { text: t('Separatist agitation is bought off at the cost of 10% of the treasury.') };
      }
      sim.cities.captureCity(c, NEUTRAL_ID, true);
      c.hp = c.maxHp;
      for (let i = 0; i < 2; i++) sim.units.spawn('infantry', NEUTRAL_ID, c.x + sim.rng.range(-15, 15), c.y + sim.rng.range(-15, 15));
      return { text: t('Insurgents seize {city}! Retake the city by force.', { city: tn(c) }), city: c };
    },
  },
  {
    id: 'war_bonds', title: 'War Bonds', good: true, weight: 5,
    canApply: () => true,
    apply: (sim, f) => {
      addEffect(sim, f, 'war_bonds', 'War Bonds (+20% money)', 60, { resMult: { money: 1.2 } });
      return { text: t('War bond drive raises money income by 20% for 60 hours.') };
    },
  },
  {
    id: 'morale', title: 'Rally Round the Flag', good: true, weight: 4,
    canApply: () => true,
    apply: (sim, f) => {
      addEffect(sim, f, 'morale', 'High Morale (+10% attack)', 40, { attackMult: 1.1 });
      return { text: t('Troop morale soars. All units +10% attack for 40 hours.') };
    },
  },
];
