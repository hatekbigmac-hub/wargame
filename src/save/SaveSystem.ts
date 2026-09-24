// Browser save/load: versioned JSON snapshots in localStorage with validation.
import type { GameState, Unit } from '../core/types';
import { SAVE_PREFIX, SAVE_VERSION } from '../config';
import { UNIT_MAP } from '../data/units';
import { CITY_DEFS } from '../data/cities';

export interface SaveMeta {
  slot: string;
  label: string;
  savedAt: string;
  faction: string;
  factionName: string;
  time: number;
  cities: number;
  difficulty: string;
}

interface SaveFile {
  version: number;
  meta: Omit<SaveMeta, 'slot'>;
  state: Omit<GameState, 'units'> & { units: Unit[] };
}

export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'];

function key(slot: string): string {
  return `${SAVE_PREFIX}.save.${slot}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function serializeGame(state: GameState, label: string): string {
  const units = [...state.units.values()].filter((u) => !u.dead).map((u) => ({ ...u, pathPending: false }));
  const file: SaveFile = {
    version: SAVE_VERSION,
    meta: {
      label,
      savedAt: new Date().toISOString(),
      faction: state.player,
      factionName: state.factions[state.player]?.name ?? state.player,
      time: state.time,
      cities: state.cities.filter((c) => c.owner === state.player).length,
      difficulty: state.difficulty,
    },
    state: { ...state, units, paused: false },
  };
  return JSON.stringify(file);
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && isFinite(v) ? v : d);

/** Parse and validate a save. Returns null for corrupt or incompatible data. */
export function deserializeGame(json: string): { state: GameState; meta: SaveFile['meta'] } | null {
  let data: SaveFile;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || data.version !== SAVE_VERSION || !data.state) return null;
  const st = data.state;
  if (!Array.isArray(st.cities) || st.cities.length !== CITY_DEFS.length) return null;
  if (!st.factions || typeof st.factions !== 'object' || !st.factions[st.player]) return null;
  if (!Array.isArray(st.units) || !Array.isArray(st.factionOrder)) return null;
  const units = new Map<number, Unit>();
  let maxId = 0;
  for (const u of st.units) {
    if (!u || typeof u.id !== 'number' || !UNIT_MAP[u.type] || !st.factions[u.owner]) continue;
    if (!isFinite(u.x) || !isFinite(u.y)) continue;
    u.hp = Math.max(1, num(u.hp, 1));
    u.maxHp = Math.max(1, num(u.maxHp, u.hp));
    u.dead = false;
    u.pathPending = false;
    if (u.path && !Array.isArray(u.path)) u.path = null;
    units.set(u.id, u);
    maxId = Math.max(maxId, u.id);
  }
  for (const c of st.cities) {
    c.hp = num(c.hp, 0);
    c.queue = Array.isArray(c.queue) ? c.queue.filter((q) => q && typeof q.id === 'string') : [];
    c.buildings = c.buildings && typeof c.buildings === 'object' ? c.buildings : {};
    if (!st.factions[c.owner]) return null;
  }
  const state: GameState = {
    ...st,
    time: num(st.time),
    speed: [1, 2, 4].includes(st.speed) ? st.speed : 1,
    paused: false,
    units,
    nextUnitId: Math.max(num(st.nextUnitId, 1), maxId + 1),
    log: Array.isArray(st.log) ? st.log.slice(-60) : [],
    gameOver: null,
    ai: st.ai && typeof st.ai === 'object' ? st.ai : {},
    relations: st.relations ?? {},
    eventTimer: num(st.eventTimer, 60),
  };
  return { state, meta: data.meta };
}

export function saveToSlot(state: GameState, slot: string, label?: string): boolean {
  const ls = storage();
  if (!ls) return false;
  try {
    ls.setItem(key(slot), serializeGame(state, label ?? (slot === 'auto' ? 'Autosave' : `Save ${slot.replace('slot', '')}`)));
    return true;
  } catch (err) {
    console.warn('[Save] failed', err);
    return false;
  }
}

export function loadFromSlot(slot: string): { state: GameState; meta: SaveFile['meta'] } | null {
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(key(slot));
    return raw ? deserializeGame(raw) : null;
  } catch {
    return null;
  }
}

export function listSaves(): (SaveMeta | null)[] {
  const ls = storage();
  return SLOTS.map((slot) => {
    if (!ls) return null;
    try {
      const raw = ls.getItem(key(slot));
      if (!raw) return null;
      const data = JSON.parse(raw) as SaveFile;
      if (data.version !== SAVE_VERSION || !data.meta) return null;
      return { slot, ...data.meta };
    } catch {
      return null;
    }
  });
}

export function deleteSave(slot: string): void {
  try {
    storage()?.removeItem(key(slot));
  } catch {
    /* ignore */
  }
}
