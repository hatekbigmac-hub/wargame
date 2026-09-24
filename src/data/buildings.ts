import type { BuildingDef, Cost } from '../core/types';

// City infrastructure. Cost scales by 1.6x per level already built.
export const BUILDING_DEFS: BuildingDef[] = [
  { id: 'factory', name: 'Factory', icon: '🏭', desc: '+1.5 industrial capacity per level (faster production). Uses power.', maxLevel: 3, cost: { money: 400, metal: 120 }, time: 20 },
  { id: 'power_plant', name: 'Power Plant', icon: '⚡', desc: '+8 electricity per level.', maxLevel: 3, cost: { money: 360, metal: 80 }, time: 18 },
  { id: 'mine', name: 'Mine', icon: '⛏', desc: '+2 metal/h per level (x1.5 in metal-rich cities).', maxLevel: 3, cost: { money: 300 }, time: 15 },
  { id: 'refinery', name: 'Refinery', icon: '🛢', desc: '+2 fuel/h per level (x1.5 in oil-rich cities).', maxLevel: 3, cost: { money: 320, metal: 60 }, time: 16 },
  { id: 'farm', name: 'Farms', icon: '🌾', desc: '+2.5 food/h per level (x1.5 in fertile cities).', maxLevel: 3, cost: { money: 200 }, time: 12 },
  { id: 'barracks', name: 'Barracks', icon: '⛺', desc: '+25% land unit production speed per level.', maxLevel: 3, cost: { money: 240, metal: 40 }, time: 12 },
  { id: 'shipyard', name: 'Shipyard', icon: '⚓', desc: '+30% naval production speed per level. Port only.', maxLevel: 3, cost: { money: 400, metal: 120 }, time: 20, needsPort: true },
  { id: 'fortress', name: 'Fortifications', icon: '🛡', desc: '+35% city defence and +30% city firepower per level.', maxLevel: 3, cost: { money: 360, metal: 160 }, time: 20 },
  { id: 'radar', name: 'Radar & Sonar', icon: '📡', desc: 'Extends city vision; coastal sonar detects submarines.', maxLevel: 3, cost: { money: 300, metal: 80 }, time: 15 },
  { id: 'missile_battery', name: 'Missile Battery', icon: '🚀', desc: 'City can launch 2 missiles per level at long range.', maxLevel: 3, cost: { money: 600, metal: 180, fuel: 60 }, time: 28, requires: 'rocketry' },
  { id: 'research_lab', name: 'Research Lab', icon: '🔬', desc: '+15% research speed per level. Uses power.', maxLevel: 3, cost: { money: 440, metal: 80 }, time: 20 },
];

export const BUILDING_MAP: Record<string, BuildingDef> = Object.fromEntries(BUILDING_DEFS.map((b) => [b.id, b]));

export function buildingCost(id: string, currentLevel: number): Cost {
  const def = BUILDING_MAP[id];
  const mult = Math.pow(1.6, currentLevel);
  const out: Cost = {};
  for (const [k, v] of Object.entries(def.cost)) out[k as keyof Cost] = Math.round((v as number) * mult);
  return out;
}

export function buildingTime(id: string, currentLevel: number): number {
  return BUILDING_MAP[id].time * (1 + currentLevel * 0.4);
}
