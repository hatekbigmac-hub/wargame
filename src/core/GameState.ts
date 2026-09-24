// Game state construction and small state helpers.
import type { City, Difficulty, FactionId, FactionState, GameState, Resources } from './types';
import { FACTIONS, NEUTRAL_ID, NEUTRAL_COLOR } from '../data/factions';
import { forcePlan, militaryOf, startingTechs } from '../data/military';
import type { WorldGeo } from '../map/WorldGeo';

export function emptyRes(): Resources {
  return { money: 0, metal: 0, fuel: 0, food: 0 };
}

export function relKey(a: FactionId, b: FactionId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// War lookups are hot (combat targeting), so relations are indexed per faction.
// Anything that changes state.relations must call invalidateWars().
let warState: GameState | null = null;
let warIndex: Map<FactionId, Set<FactionId>> | null = null;

export function invalidateWars(): void {
  warIndex = null;
}

function wars(state: GameState): Map<FactionId, Set<FactionId>> {
  if (warIndex && warState === state) return warIndex;
  const m = new Map<FactionId, Set<FactionId>>();
  for (const [k, v] of Object.entries(state.relations)) {
    if (v !== 'war') continue;
    const [a, b] = k.split('|');
    if (!m.has(a)) m.set(a, new Set());
    if (!m.has(b)) m.set(b, new Set());
    m.get(a)!.add(b);
    m.get(b)!.add(a);
  }
  warState = state;
  warIndex = m;
  return m;
}

/** Countries start at peace; war exists only after a declaration. Insurgents fight everyone. */
export function atWar(state: GameState, a: FactionId, b: FactionId): boolean {
  if (a === b) return false;
  if (a === NEUTRAL_ID || b === NEUTRAL_ID) return true;
  return wars(state).get(a)?.has(b) ?? false;
}

/** Factions currently at war with f (insurgents excluded). */
export function enemiesOf(state: GameState, f: FactionId): FactionId[] {
  const set = wars(state).get(f);
  return set ? [...set] : [];
}

/** Is f at war with any country? */
export function hasWars(state: GameState, f: FactionId): boolean {
  return (wars(state).get(f)?.size ?? 0) > 0;
}

function makeFaction(id: FactionId, index: number, name: string, color: number, isPlayer: boolean, res: Resources): FactionState {
  return {
    id,
    index,
    name,
    color,
    isPlayer,
    alive: true,
    res: { ...res },
    income: emptyRes(),
    gross: emptyRes(),
    upkeep: emptyRes(),
    power: { supply: 0, demand: 0 },
    industry: 0,
    techs: [],
    research: null,
    effects: [],
    stats: { built: 0, lost: 0, killed: 0, captured: 0, citiesLost: 0 },
  };
}

export function cityImportance(c: Pick<City, 'size' | 'industry' | 'capital' | 'port' | 'tags' | 'trade'>): number {
  return c.size * 2 + c.industry + (c.capital ? 6 : 0) + (c.port ? 1 : 0) + c.tags.length + (c.trade ? 1 : 0);
}

export function createGameState(geo: WorldGeo, player: FactionId, difficulty: Difficulty, seed: number): GameState {
  const factions: Record<FactionId, FactionState> = {};
  FACTIONS.forEach((f, i) => {
    // Richer defence budgets start with a bigger war chest.
    const res = { ...f.startingResources, money: f.startingResources.money + Math.round(Math.sqrt(militaryOf(f.id).b) * 150) };
    factions[f.id] = makeFaction(f.id, i, f.name, f.color, f.id === player, res);
    factions[f.id].techs = startingTechs(f.id);
  });
  factions[NEUTRAL_ID] = makeFaction(NEUTRAL_ID, FACTIONS.length, 'Insurgents', NEUTRAL_COLOR, false, emptyRes());

  const cities: City[] = geo.cities.map((pc, i) => {
    const d = pc.def;
    const c: City = {
      id: i,
      name: d.name,
      ru: d.ru,
      country: d.owner,
      x: pc.x,
      y: pc.y,
      cell: pc.cell,
      owner: d.owner,
      origOwner: d.owner,
      size: d.size,
      industry: d.industry,
      port: pc.port,
      airport: d.airport,
      capital: d.capital,
      trade: d.trade,
      tags: d.tags,
      portX: pc.portX,
      portY: pc.portY,
      hp: 0,
      maxHp: 0,
      buildings: {},
      queue: [],
      capture: 0,
      capturer: null,
      lastAttacked: -999,
      cooldown: 0,
      missiles: 0,
      missileCd: 0,
      unrest: 0,
      region: i,
      importance: 0,
    };
    c.importance = cityImportance(c);
    // Starting infrastructure scales with city size.
    if (d.size >= 3) c.buildings.factory = 1;
    if (d.size >= 4) c.buildings.power_plant = 1;
    if (d.capital) {
      c.buildings.fortress = 1;
      c.buildings.barracks = 1;
      // Countries with real missile forces start with a battery in the capital; the player always
      // gets at least one so the Missile Strike button works from the first minute.
      const level = Math.max(forcePlan(d.owner).battery, d.owner === player ? 1 : 0);
      if (level > 0) {
        c.buildings.missile_battery = level;
        c.missiles = level * 2;
      }
    }
    if (pc.port && d.size >= 3) c.buildings.shipyard = 1;
    // Countries with an air force always have at least one airfield (at the capital).
    if (d.capital && !d.airport && Object.keys(forcePlan(d.owner).air).length) c.buildings.airbase = 1;
    return c;
  });

  // Everyone starts at peace; wars must be prepared and declared.
  const relations: Record<string, 'war' | 'peace'> = {};

  return {
    time: 0,
    speed: 1,
    paused: false,
    player,
    difficulty,
    seed,
    factions,
    factionOrder: FACTIONS.map((f) => f.id),
    cities,
    units: new Map(),
    nextUnitId: 1,
    relations,
    log: [],
    gameOver: null,
    eventTimer: 90,
    ai: {},
    ops: [],
    nextOpId: 1,
    peaceOffers: [],
    warStarted: {},
  };
}
