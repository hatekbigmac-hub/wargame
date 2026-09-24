import type { TechDef } from '../core/types';

// Technology tree. Effects are interpreted by TechSystem — add new techs here.
export const TECH_DEFS: TechDef[] = [
  // ---------------------------------------------------------------- ARMY
  { id: 'improved_rifles', name: 'Infantry Weapons', category: 'army', tier: 1, desc: '+15% infantry attack.', cost: { money: 500, metal: 60 }, time: 40, requires: [],
    effects: [{ type: 'stat', target: 'infantry', stat: 'attack', mult: 1.15 }] },
  { id: 'motorized', name: 'Mechanization', category: 'army', tier: 1, desc: 'Unlocks Mechanized Infantry.', cost: { money: 600, metal: 100 }, time: 45, requires: [],
    effects: [{ type: 'unlock', unit: 'mech_infantry' }] },
  { id: 'special_forces', name: 'Special Forces', category: 'army', tier: 2, desc: 'Unlocks Elite Infantry. +10% infantry defence.', cost: { money: 900, metal: 100 }, time: 60, requires: ['improved_rifles'],
    effects: [{ type: 'unlock', unit: 'elite_infantry' }, { type: 'stat', target: 'infantry', stat: 'defense', mult: 1.1 }] },
  { id: 'composite_armor', name: 'Composite Armour', category: 'army', tier: 1, desc: '+15% armour hit points and defence.', cost: { money: 700, metal: 150 }, time: 50, requires: [],
    effects: [{ type: 'stat', target: 'armor', stat: 'hp', mult: 1.15 }, { type: 'stat', target: 'armor', stat: 'defense', mult: 1.15 }] },
  { id: 'tank_guns', name: 'Smoothbore Guns', category: 'army', tier: 2, desc: '+15% armour attack.', cost: { money: 800, metal: 150 }, time: 55, requires: ['composite_armor'],
    effects: [{ type: 'stat', target: 'armor', stat: 'attack', mult: 1.15 }] },
  { id: 'heavy_armor', name: 'Heavy Armour', category: 'army', tier: 3, desc: 'Unlocks Heavy Tanks.', cost: { money: 1200, metal: 300 }, time: 80, requires: ['tank_guns'],
    effects: [{ type: 'unlock', unit: 'heavy_tank' }] },
  { id: 'artillery_doctrine', name: 'Artillery Doctrine', category: 'army', tier: 1, desc: '+20% artillery attack, +10% range.', cost: { money: 600, metal: 100 }, time: 45, requires: [],
    effects: [{ type: 'stat', target: 'artillery', stat: 'attack', mult: 1.2 }, { type: 'stat', target: 'artillery', stat: 'range', mult: 1.1 }, { type: 'stat', target: 'rocket_artillery', stat: 'range', mult: 1.1 }] },
  { id: 'rocketry', name: 'Rocketry', category: 'army', tier: 2, desc: 'Unlocks Missile Launchers and city Missile Batteries.', cost: { money: 1000, metal: 200, fuel: 60 }, time: 70, requires: ['artillery_doctrine'],
    effects: [{ type: 'unlock', unit: 'rocket_artillery' }] },
  { id: 'recon_drones', name: 'Recon Drones', category: 'army', tier: 2, desc: '+25% detection range for all land units.', cost: { money: 700, metal: 80 }, time: 50, requires: [],
    effects: [{ type: 'stat', target: 'land', stat: 'detection', mult: 1.25 }] },
  { id: 'logistics', name: 'Logistics', category: 'army', tier: 2, desc: '+15% land unit speed, -10% upkeep.', cost: { money: 900, fuel: 100 }, time: 60, requires: ['motorized'],
    effects: [{ type: 'stat', target: 'land', stat: 'speed', mult: 1.15 }, { type: 'upkeep', mult: 0.9 }] },

  // ---------------------------------------------------------------- NAVY
  { id: 'naval_engineering', name: 'Naval Engineering', category: 'navy', tier: 1, desc: '+15% ship hit points.', cost: { money: 700, metal: 150 }, time: 50, requires: [],
    effects: [{ type: 'stat', target: 'naval', stat: 'hp', mult: 1.15 }] },
  { id: 'blue_water_navy', name: 'Blue-Water Navy', category: 'navy', tier: 2, desc: 'Unlocks Cruisers. +10% ship speed.', cost: { money: 1100, metal: 250 }, time: 75, requires: ['naval_engineering'],
    effects: [{ type: 'unlock', unit: 'cruiser' }, { type: 'stat', target: 'naval', stat: 'speed', mult: 1.1 }] },
  { id: 'naval_missiles', name: 'Naval Missiles', category: 'navy', tier: 2, desc: 'Unlocks Missile Ships.', cost: { money: 1100, metal: 200, fuel: 80 }, time: 75, requires: ['naval_engineering'],
    effects: [{ type: 'unlock', unit: 'missile_ship' }] },
  { id: 'carrier_aviation', name: 'Carrier Aviation', category: 'navy', tier: 3, desc: 'Unlocks Aircraft Carriers.', cost: { money: 1800, metal: 400, fuel: 150 }, time: 110, requires: ['blue_water_navy'],
    effects: [{ type: 'unlock', unit: 'carrier' }] },
  { id: 'sub_stealth', name: 'Anechoic Coating', category: 'navy', tier: 2, desc: 'Submarines are 30% harder to detect and +15% torpedo damage.', cost: { money: 900, metal: 150 }, time: 60, requires: [],
    effects: [{ type: 'stealth', mult: 0.7 }, { type: 'stat', target: 'sub', stat: 'attack', mult: 1.15 }] },
  { id: 'sonar', name: 'Advanced Sonar', category: 'navy', tier: 1, desc: '+35% sonar range for all ships.', cost: { money: 600, metal: 80 }, time: 45, requires: [],
    effects: [{ type: 'sonar', mult: 1.35 }] },
  { id: 'point_defense', name: 'Point Defence', category: 'navy', tier: 2, desc: '+15% missile interception chance.', cost: { money: 900, metal: 150 }, time: 60, requires: ['sonar'],
    effects: [{ type: 'intercept', add: 0.15 }] },

  // ---------------------------------------------------------------- AIR / FUTURE
  { id: 'air_defense', name: 'Air Defence Network', category: 'air', tier: 1, desc: '+10% interception, +20% anti-air range.', cost: { money: 800, metal: 150 }, time: 55, requires: [],
    effects: [{ type: 'intercept', add: 0.1 }, { type: 'stat', target: 'anti_air', stat: 'range', mult: 1.2 }] },
  { id: 'missile_guidance', name: 'Missile Guidance', category: 'air', tier: 2, desc: '+25% missile damage and +1 missile capacity.', cost: { money: 1200, metal: 200, fuel: 80 }, time: 80, requires: ['air_defense'],
    effects: [{ type: 'missile', mult: 1.25, add: 1 }] },
  { id: 'jet_aircraft', name: 'Jet Aircraft', category: 'air', tier: 3, desc: 'Coming soon: fighter squadrons and airbases.', cost: { money: 2000 }, time: 120, requires: ['missile_guidance'], effects: [], future: true },
  { id: 'helicopters', name: 'Rotary Wing', category: 'air', tier: 3, desc: 'Coming soon: attack helicopters and paratroopers.', cost: { money: 2000 }, time: 120, requires: ['air_defense'], effects: [], future: true },

  // ---------------------------------------------------------------- INDUSTRY
  { id: 'mass_production', name: 'Mass Production', category: 'industry', tier: 1, desc: '+15% production speed.', cost: { money: 700, metal: 100 }, time: 50, requires: [],
    effects: [{ type: 'prod', mult: 1.15 }] },
  { id: 'automation', name: 'Automation', category: 'industry', tier: 2, desc: '+20% production speed.', cost: { money: 1300, metal: 250 }, time: 85, requires: ['mass_production'],
    effects: [{ type: 'prod', mult: 1.2 }] },
  { id: 'resource_extraction', name: 'Deep Extraction', category: 'industry', tier: 1, desc: '+25% metal and fuel income.', cost: { money: 700 }, time: 50, requires: [],
    effects: [{ type: 'econ', resource: 'metal', mult: 1.25 }, { type: 'econ', resource: 'fuel', mult: 1.25 }] },
  { id: 'power_grid', name: 'Smart Power Grid', category: 'industry', tier: 1, desc: '+25% electricity supply.', cost: { money: 600, metal: 80 }, time: 45, requires: [],
    effects: [{ type: 'econ', resource: 'power', mult: 1.25 }] },
  { id: 'agriculture', name: 'Agri-Tech', category: 'industry', tier: 1, desc: '+30% food income.', cost: { money: 500 }, time: 40, requires: [],
    effects: [{ type: 'econ', resource: 'food', mult: 1.3 }] },
  { id: 'infrastructure', name: 'Infrastructure', category: 'industry', tier: 2, desc: '+15% money income.', cost: { money: 1000, metal: 150 }, time: 70, requires: ['power_grid'],
    effects: [{ type: 'econ', resource: 'money', mult: 1.15 }] },
  { id: 'research_institutes', name: 'Research Institutes', category: 'industry', tier: 2, desc: '+25% research speed.', cost: { money: 900, metal: 100 }, time: 60, requires: ['mass_production'],
    effects: [{ type: 'research', mult: 1.25 }] },
];

export const TECH_MAP: Record<string, TechDef> = Object.fromEntries(TECH_DEFS.map((t) => [t.id, t]));
