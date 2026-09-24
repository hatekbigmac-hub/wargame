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

// Unit fields at their default value are left out of saves (restored on load) to keep
// saves small: four slots must fit the ~5 MB localStorage quota.
const UNIT_DEFAULTS: Record<string, unknown> = {
  order: null, path: null, pathIdx: 0, pathPending: false, repathAt: 0, targetUnit: -1, targetCity: -1, cooldown: 0, scanCd: 0,
  missiles: 0, missileCd: 0, missileRegen: 0, xp: 0, rank: 0, kills: 0, embarked: false, moving: false, revealed: 0,
  bonus: 1, bonusUntil: 0, lastHit: -99, aiTask: 0, dead: false,
};
const TRANSIENT = new Set(['cooldown', 'scanCd', 'pathPending', 'dead', 'moving']);

function packUnit(u: Unit): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(u)) {
    if (TRANSIENT.has(k)) continue;
    if (k in UNIT_DEFAULTS && UNIT_DEFAULTS[k] === v) continue;
    if (k === 'detBy' && Array.isArray(v) && v.length === 0) continue;
    if ((k === 'anchorX' && v === u.x) || (k === 'anchorY' && v === u.y)) continue;
    if (k === 'turret' && v === u.angle) continue;
    if (k === 'cargo') {
      if (Array.isArray(v) && v.length) out.cargo = (v as Unit[]).map(packUnit);
      continue;
    }
    if (k === 'lastHit' && typeof v === 'number' && v < 0) continue;
    out[k] = v;
  }
  return out;
}

function unpackUnit(raw: Record<string, unknown>): Unit {
  const u = { ...UNIT_DEFAULTS, detBy: [], ...raw } as unknown as Unit;
  u.anchorX ??= u.x;
  u.anchorY ??= u.y;
  u.turret ??= u.angle;
  if (Array.isArray(raw.cargo)) u.cargo = (raw.cargo as Record<string, unknown>[]).map(unpackUnit);
  return u;
}

export function serializeGame(state: GameState, label: string): string {
  const units = [...state.units.values()].filter((u) => !u.dead).map(packUnit) as unknown as Unit[];
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
  // Round floats to keep saves small (localStorage quota is ~5 MB for all slots).
  return JSON.stringify(file, (_k, v) => {
    if (typeof v !== 'number' || Number.isInteger(v)) return v;
    // World coordinates need 0.1 px; small ratios (progress, bonuses) keep 3 decimals.
    return Math.abs(v) >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000;
  });
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
  const valid = (u: Unit): boolean => {
    if (!u || typeof u.id !== 'number' || !UNIT_MAP[u.type] || !st.factions[u.owner]) return false;
    if (!isFinite(u.x) || !isFinite(u.y)) return false;
    u.hp = Math.max(1, num(u.hp, 1));
    u.maxHp = Math.max(1, num(u.maxHp, u.hp));
    u.dead = false;
    u.pathPending = false;
    u.detBy = Array.isArray(u.detBy) ? u.detBy : [];
    u.bonus = num(u.bonus, 1);
    u.bonusUntil = num(u.bonusUntil, 0);
    if (u.path && !Array.isArray(u.path)) u.path = null;
    maxId = Math.max(maxId, u.id);
    return true;
  };
  for (const raw of st.units) {
    const u = unpackUnit(raw as unknown as Record<string, unknown>);
    if (!valid(u)) continue;
    if (Array.isArray(u.cargo)) {
      u.cargo = u.cargo.filter(valid);
      for (const c of u.cargo) {
        c.order = null;
        c.path = null;
      }
    } else delete u.cargo;
    units.set(u.id, u);
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
    ops: Array.isArray(st.ops) ? st.ops : [],
    nextOpId: num(st.nextOpId, 1),
    peaceOffers: Array.isArray(st.peaceOffers) ? st.peaceOffers : [],
    warStarted: st.warStarted && typeof st.warStarted === 'object' ? st.warStarted : {},
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
