// Game state construction and small state helpers.
import type { City, Difficulty, FactionId, FactionState, GameState, Resources } from './types';
import { FACTIONS, NEUTRAL_ID, NEUTRAL_COLOR } from '../data/factions';
import type { WorldGeo } from '../map/WorldGeo';

export function emptyRes(): Resources {
  return { money: 0, metal: 0, fuel: 0, food: 0 };
}

export function relKey(a: FactionId, b: FactionId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function atWar(state: GameState, a: FactionId, b: FactionId): boolean {
  if (a === b) return false;
  if (a === NEUTRAL_ID || b === NEUTRAL_ID) return true;
  return state.relations[relKey(a, b)] !== 'peace';
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
    factions[f.id] = makeFaction(f.id, i, f.name, f.color, f.id === player, f.startingResources);
  });
  factions[NEUTRAL_ID] = makeFaction(NEUTRAL_ID, FACTIONS.length, 'Insurgents', NEUTRAL_COLOR, false, emptyRes());

  const cities: City[] = geo.cities.map((pc, i) => {
    const d = pc.def;
    const c: City = {
      id: i,
      name: d.name,
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
    }
    if (pc.port && d.size >= 3) c.buildings.shipyard = 1;
    return c;
  });

  const relations: Record<string, 'war' | 'peace'> = {};
  for (const a of FACTIONS) for (const b of FACTIONS) if (a.id < b.id) relations[relKey(a.id, b.id)] = 'war';

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
  };
}
