import type { UnitDef } from '../core/types';

// Unit definitions. Speeds are world px per game-hour (one real second at 1x).
// Balance is intentionally simple and fully data-driven.
export const UNIT_DEFS: UnitDef[] = [
  // ---------------------------------------------------------------- land
  {
    id: 'infantry', name: 'Infantry', short: 'INF', domain: 'land', cls: 'infantry', role: 'Line infantry',
    desc: 'Cheap and versatile. Holds cities and captures territory.',
    hp: 100, attack: 10, defense: 8, speed: 24, range: 70, reload: 1.4, detection: 170,
    vs: { infantry: 1, armor: 0.35, ship: 0.2, city: 0.8, heli: 0.25},
    cost: { money: 100, food: 30 }, time: 8, upkeep: { money: 0.8, food: 0.3 },
    projectile: 'bullet', sprite: 'u_infantry', size: 22, captureRate: 1,
  },
  {
    id: 'mech_infantry', name: 'Mechanized Infantry', short: 'MEC', domain: 'land', cls: 'armor', role: 'Armoured infantry',
    desc: 'Infantry in armoured fighting vehicles. Fast, sturdy and good against light armour.',
    hp: 140, attack: 14, defense: 11, speed: 38, range: 80, reload: 1.3, detection: 180,
    vs: { infantry: 1, armor: 0.6, ship: 0.2, city: 0.8, heli: 0.25},
    cost: { money: 200, metal: 40, fuel: 20 }, time: 12, upkeep: { money: 1.5, fuel: 0.3 },
    projectile: 'bullet', sprite: 'u_apc', turret: 't_small', size: 24, requires: 'motorized', captureRate: 1,
  },
  {
    id: 'elite_infantry', name: 'Elite Infantry', short: 'ELT', domain: 'land', cls: 'infantry', role: 'Special forces',
    desc: 'Veteran special forces. Hard hitting, hard to kill and capture cities twice as fast.',
    hp: 150, attack: 19, defense: 13, speed: 28, range: 85, reload: 1.2, detection: 230,
    vs: { infantry: 1.2, armor: 0.7, ship: 0.2, city: 1.1, heli: 0.4, air: 0.15},
    cost: { money: 300, food: 50 }, time: 14, upkeep: { money: 2, food: 0.4 },
    projectile: 'bullet', sprite: 'u_elite', size: 22, requires: 'special_forces', captureRate: 2, abilities: ['fastCapture'],
  },
  {
    id: 'recon', name: 'Recon Vehicle', short: 'RCN', domain: 'land', cls: 'armor', role: 'Reconnaissance',
    desc: 'Very fast scout car with long detection range. Weak in combat.',
    hp: 70, attack: 7, defense: 5, speed: 58, range: 70, reload: 1, detection: 340,
    vs: { infantry: 0.9, armor: 0.3, ship: 0.1, city: 0.3 },
    cost: { money: 120, fuel: 20 }, time: 7, upkeep: { money: 0.8, fuel: 0.2 },
    projectile: 'bullet', sprite: 'u_recon', size: 20, captureRate: 0.5,
  },
  {
    id: 'engineer', name: 'Combat Engineers', short: 'ENG', domain: 'land', cls: 'infantry', role: 'Support',
    desc: 'Repairs nearby units and cities, and captures cities quickly.',
    hp: 90, attack: 5, defense: 7, speed: 28, range: 60, reload: 1.5, detection: 170,
    vs: { infantry: 0.8, armor: 0.3, city: 0.5 },
    cost: { money: 160, metal: 20 }, time: 9, upkeep: { money: 1 },
    projectile: 'bullet', sprite: 'u_engineer', size: 22, captureRate: 1.6, abilities: ['repair', 'fastCapture'],
  },
  {
    id: 'light_tank', name: 'Light Tank', short: 'LTK', domain: 'land', cls: 'armor', role: 'Fast armour',
    desc: 'Quick, cheap armour for flanking and exploitation.',
    hp: 160, attack: 17, defense: 12, speed: 48, range: 85, reload: 1.6, detection: 200,
    vs: { infantry: 1.1, armor: 0.8, ship: 0.3, city: 0.8 },
    cost: { money: 240, metal: 70, fuel: 30 }, time: 13, upkeep: { money: 1.6, fuel: 0.4 },
    projectile: 'cannon', sprite: 'u_tank_l', turret: 't_tank_l', size: 26, captureRate: 0.7,
  },
  {
    id: 'medium_tank', name: 'Main Battle Tank', short: 'MBT', domain: 'land', cls: 'armor', role: 'Main battle tank',
    desc: 'The backbone of any armoured offensive. Balanced armour and firepower.',
    hp: 230, attack: 25, defense: 18, speed: 38, range: 95, reload: 2, detection: 190,
    vs: { infantry: 1, armor: 1, ship: 0.3, city: 1 },
    cost: { money: 380, metal: 120, fuel: 50 }, time: 18, upkeep: { money: 2.4, fuel: 0.6 },
    projectile: 'cannon', sprite: 'u_tank_m', turret: 't_tank_m', size: 30, captureRate: 0.7,
  },
  {
    id: 'heavy_tank', name: 'Heavy Tank', short: 'HTK', domain: 'land', cls: 'armor', role: 'Breakthrough armour',
    desc: 'A slow steel fortress that shrugs off fire and smashes defensive lines.',
    hp: 360, attack: 36, defense: 28, speed: 28, range: 105, reload: 2.6, detection: 180,
    vs: { infantry: 0.9, armor: 1.25, ship: 0.3, city: 1.2 },
    cost: { money: 640, metal: 220, fuel: 80 }, time: 27, upkeep: { money: 3.6, fuel: 1 },
    projectile: 'cannon', sprite: 'u_tank_h', turret: 't_tank_h', size: 34, requires: 'heavy_armor', captureRate: 0.7,
  },
  {
    id: 'artillery', name: 'Artillery', short: 'ART', domain: 'land', cls: 'armor', role: 'Indirect fire',
    desc: 'Long-range guns. Devastating against cities and massed troops. Must stop to fire.',
    hp: 90, attack: 32, defense: 5, speed: 24, range: 280, reload: 4.2, detection: 170,
    vs: { infantry: 1.2, armor: 0.7, ship: 0.6, city: 1.6 },
    cost: { money: 300, metal: 90 }, time: 16, upkeep: { money: 1.6 },
    projectile: 'shell', sprite: 'u_artillery', turret: 't_artillery', size: 28, splash: 40, stationaryFire: true, minRange: 50, captureRate: 0.3,
  },
  {
    id: 'rocket_artillery', name: 'Missile Launcher', short: 'MSL', domain: 'land', cls: 'armor', role: 'Rocket artillery',
    desc: 'Saturation rocket barrages plus long-range tactical missiles.',
    hp: 100, attack: 24, defense: 6, speed: 30, range: 320, reload: 6, detection: 180,
    vs: { infantry: 1.2, armor: 0.8, ship: 0.7, city: 1.5 },
    cost: { money: 480, metal: 140, fuel: 40 }, time: 22, upkeep: { money: 2.4, fuel: 0.4 },
    projectile: 'rocket', sprite: 'u_launcher', turret: 't_launcher', size: 30, splash: 60, stationaryFire: true, minRange: 60,
    requires: 'rocketry', missiles: 2, missileRange: 950, missileDamage: 140, abilities: ['missile'], captureRate: 0.3,
  },
  {
    id: 'anti_air', name: 'Anti-Air', short: 'AA', domain: 'land', cls: 'armor', role: 'Air & missile defence',
    desc: 'Rapid-fire flak that can intercept incoming missiles and aircraft.',
    hp: 120, attack: 11, defense: 10, speed: 36, range: 120, reload: 0.8, detection: 240,
    vs: { infantry: 0.8, armor: 0.3, air: 2, heli: 2.2, city: 0.3 },
    cost: { money: 220, metal: 70, fuel: 20 }, time: 12, upkeep: { money: 1.4, fuel: 0.3 },
    projectile: 'flak', sprite: 'u_aa', turret: 't_aa', size: 26, intercept: 0.35, interceptRange: 230, abilities: ['intercept'], captureRate: 0.5,
  },

  // ---------------------------------------------------------------- naval
  {
    id: 'patrol_boat', name: 'Patrol Boat', short: 'PTB', domain: 'naval', cls: 'ship', role: 'Coastal patrol',
    desc: 'Fast, cheap coastal craft with sonar. Good for spotting submarines.',
    hp: 100, attack: 10, defense: 7, speed: 78, range: 110, reload: 1.1, detection: 300,
    vs: { infantry: 0.6, armor: 0.4, ship: 0.8, sub: 1, city: 0.3, heli: 0.3},
    cost: { money: 160, metal: 40, fuel: 20 }, time: 10, upkeep: { money: 1.2, fuel: 0.4 },
    projectile: 'bullet', sprite: 'n_patrol', size: 30, needsPort: true, sonar: 200,
  },
  {
    id: 'transport', name: 'Transport Ship', short: 'TRN', domain: 'naval', cls: 'ship', role: 'Troop transport',
    desc: 'Carries up to 6 land units (infantry, tanks, artillery) across the sea. Board: select troops and right-click the transport. Unload: select the transport and right-click a coast.',
    hp: 170, attack: 0, defense: 8, speed: 60, range: 0, reload: 99, detection: 260,
    vs: {},
    cost: { money: 220, metal: 60, fuel: 20 }, time: 11, upkeep: { money: 1, fuel: 0.4 },
    projectile: 'bullet', sprite: 'n_transport', size: 40, needsPort: true, capacity: 6, abilities: ['transport'],
  },
  {
    id: 'frigate', name: 'Frigate', short: 'FFG', domain: 'naval', cls: 'ship', role: 'Escort / air defence',
    desc: 'Escort ship with strong missile defence and anti-submarine sonar.',
    hp: 220, attack: 16, defense: 14, speed: 66, range: 150, reload: 1.5, detection: 320,
    vs: { infantry: 0.6, armor: 0.5, ship: 0.9, sub: 1.3, city: 0.6, air: 1.5, heli: 1.3 },
    cost: { money: 380, metal: 130, fuel: 50 }, time: 20, upkeep: { money: 2.4, fuel: 0.8 },
    projectile: 'cannon', sprite: 'n_frigate', turret: 't_naval', size: 42, needsPort: true, sonar: 280, intercept: 0.4, interceptRange: 260, abilities: ['intercept'],
  },
  {
    id: 'destroyer', name: 'Destroyer', short: 'DDG', domain: 'naval', cls: 'ship', role: 'Multi-role warship',
    desc: 'Fast warship. Hunts submarines and surface ships alike.',
    hp: 280, attack: 22, defense: 16, speed: 62, range: 160, reload: 1.8, detection: 340,
    vs: { infantry: 0.7, armor: 0.6, ship: 1, sub: 1.5, city: 0.7, air: 0.9, heli: 0.9},
    cost: { money: 480, metal: 160, fuel: 60 }, time: 24, upkeep: { money: 3, fuel: 1 },
    projectile: 'cannon', sprite: 'n_destroyer', turret: 't_naval', size: 48, needsPort: true, sonar: 260, intercept: 0.2, interceptRange: 200, abilities: ['intercept'],
  },
  {
    id: 'cruiser', name: 'Cruiser', short: 'CG', domain: 'naval', cls: 'ship', role: 'Heavy warship',
    desc: 'Heavily armed capital ship. Long-range guns bombard coasts and fleets.',
    hp: 450, attack: 34, defense: 24, speed: 54, range: 220, reload: 2.6, detection: 360,
    vs: { infantry: 1, armor: 0.8, ship: 1.1, sub: 0.8, city: 1.2, air: 1, heli: 0.8},
    cost: { money: 800, metal: 280, fuel: 100 }, time: 36, upkeep: { money: 4.5, fuel: 1.5 },
    projectile: 'shell', sprite: 'n_cruiser', turret: 't_naval_h', size: 58, needsPort: true, requires: 'blue_water_navy', sonar: 160, intercept: 0.3, interceptRange: 240, splash: 30, abilities: ['intercept'],
  },
  {
    id: 'missile_ship', name: 'Missile Ship', short: 'MSS', domain: 'naval', cls: 'ship', role: 'Strike ship',
    desc: 'Carries long-range cruise missiles able to strike ships, armies and cities far inland.',
    hp: 250, attack: 14, defense: 12, speed: 58, range: 150, reload: 1.6, detection: 320,
    vs: { infantry: 0.6, armor: 0.5, ship: 0.8, sub: 0.6, city: 0.5 },
    cost: { money: 720, metal: 200, fuel: 80 }, time: 32, upkeep: { money: 4, fuel: 1.2 },
    projectile: 'cannon', sprite: 'n_missile', size: 50, needsPort: true, requires: 'naval_missiles',
    missiles: 4, missileRange: 1100, missileDamage: 170, abilities: ['missile'],
  },
  {
    id: 'submarine', name: 'Submarine', short: 'SSK', domain: 'naval', cls: 'sub', role: 'Stealth hunter',
    desc: 'Hidden beneath the waves. Only sonar can find it. Deadly torpedoes against ships.',
    hp: 190, attack: 38, defense: 10, speed: 50, range: 180, reload: 3.5, detection: 260,
    vs: { ship: 1.2, sub: 1 },
    cost: { money: 560, metal: 170, fuel: 60 }, time: 28, upkeep: { money: 3, fuel: 0.8 },
    projectile: 'torpedo', sprite: 'n_sub', size: 40, needsPort: true, stealth: true, sonar: 240, abilities: ['stealth'],
  },
  {
    id: 'carrier', name: 'Aircraft Carrier', short: 'CV', domain: 'naval', cls: 'ship', role: 'Power projection',
    desc: 'A floating airbase. Its air wing strikes targets far beyond the horizon.',
    hp: 650, attack: 30, defense: 20, speed: 46, range: 750, reload: 9, detection: 500,
    vs: { infantry: 1, armor: 1, ship: 1.1, city: 1.1, air: 0.9, heli: 0.7},
    cost: { money: 1400, metal: 480, fuel: 180 }, time: 58, upkeep: { money: 7, fuel: 2.5 },
    projectile: 'air', sprite: 'n_carrier', size: 70, needsPort: true, requires: 'carrier_aviation', abilities: ['airstrike'],
  },

  // ---------------------------------------------------------------- air
  {
    id: 'fighter', name: 'Fighter Jet', short: 'FTR', domain: 'air', cls: 'air', role: 'Air superiority',
    desc: 'Fast multirole fighter. Shoots down aircraft and helicopters, escorts strikes and scouts far ahead. Must return to an airbase or carrier to refuel.',
    hp: 110, attack: 22, defense: 10, speed: 240, range: 140, reload: 1.2, detection: 420,
    vs: { air: 1.6, heli: 1.5, infantry: 0.3, armor: 0.25, ship: 0.3 },
    cost: { money: 520, metal: 140, fuel: 90 }, time: 26, upkeep: { money: 3, fuel: 1.6 },
    projectile: 'bullet', sprite: 'a_jet', size: 30, requires: 'jet_aircraft', needsAirport: true, endurance: 10,
  },
  {
    id: 'strike_fighter', name: 'Strike Aircraft', short: 'ATK', domain: 'air', cls: 'air', role: 'Ground attack',
    desc: 'Attack jet with guided bombs. Hits armies, ships and city defences from the air. Anti-air can shoot its bombs down.',
    hp: 120, attack: 30, defense: 9, speed: 210, range: 120, reload: 2.4, detection: 360,
    vs: { infantry: 1.1, armor: 1.3, ship: 1.1, city: 1.2, heli: 0.4 },
    cost: { money: 600, metal: 160, fuel: 100 }, time: 28, upkeep: { money: 3.4, fuel: 1.8 },
    projectile: 'bomb', sprite: 'a_strike', size: 32, splash: 30, requires: 'jet_aircraft', needsAirport: true, endurance: 9,
  },
  {
    id: 'bomber', name: 'Strategic Bomber', short: 'BMB', domain: 'air', cls: 'air', role: 'Strategic bombing',
    desc: 'Long-range heavy bomber. Devastates cities and troop concentrations far behind the front. Vulnerable to fighters.',
    hp: 220, attack: 55, defense: 8, speed: 170, range: 110, reload: 5, detection: 320,
    vs: { infantry: 1.2, armor: 0.9, ship: 0.9, city: 2 },
    cost: { money: 1100, metal: 300, fuel: 180 }, time: 44, upkeep: { money: 5, fuel: 2.5 },
    projectile: 'bomb', sprite: 'a_bomber', size: 44, splash: 60, requires: 'strategic_bombing', needsAirport: true, endurance: 18,
  },
  {
    id: 'helicopter', name: 'Attack Helicopter', short: 'HEL', domain: 'air', cls: 'heli', role: 'Close air support',
    desc: 'Low-flying tank hunter with anti-tank missiles. Hovers over the battlefield; vulnerable to anti-air and infantry fire.',
    hp: 130, attack: 24, defense: 9, speed: 110, range: 130, reload: 1.8, detection: 300,
    vs: { infantry: 1.1, armor: 1.4, ship: 0.6, heli: 0.6, city: 0.5 },
    cost: { money: 450, metal: 100, fuel: 60 }, time: 22, upkeep: { money: 2.5, fuel: 1.2 },
    projectile: 'rocket', sprite: 'a_heli', turret: 'a_rotor', size: 30, requires: 'helicopters', needsAirport: true, endurance: 6,
  },
  {
    id: 'transport_heli', name: 'Transport Helicopter', short: 'THL', domain: 'air', cls: 'heli', role: 'Air assault',
    desc: 'Carries 2 infantry units anywhere — over rivers, mountains and seas. Board: select infantry and right-click the helicopter. Unload: select it and right-click the landing zone.',
    hp: 120, attack: 0, defense: 7, speed: 120, range: 0, reload: 99, detection: 260,
    vs: {},
    cost: { money: 300, metal: 80, fuel: 40 }, time: 16, upkeep: { money: 1.6, fuel: 0.8 },
    projectile: 'bullet', sprite: 'a_heli_t', turret: 'a_rotor', size: 34, requires: 'helicopters', needsAirport: true, endurance: 7,
    capacity: 2, carries: ['infantry'], abilities: ['transport'],
  },
];

export const UNIT_MAP: Record<string, UnitDef> = Object.fromEntries(UNIT_DEFS.map((u) => [u.id, u]));

export function unitDef(id: string): UnitDef {
  return UNIT_MAP[id] ?? UNIT_MAP.infantry;
}

export const PRODUCIBLE_UNITS = UNIT_DEFS.filter((u) => !u.future);

/** Legacy constant (land units no longer embark on their own). */
export const EMBARK_SPEED = 34;
