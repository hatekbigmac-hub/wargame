import type { FactionDef } from '../core/types';
import { WORLD } from './world';
import { t, tn } from '../i18n';

// Every sovereign country from the Natural Earth dataset is a playable faction.
// Colours come from a 12-colour political palette assigned so neighbours differ.
export const PALETTE = [
  0xd9644f, 0xe39b3f, 0xe0c24a, 0x9cc653, 0x4fb36b, 0x3fb3a6, 0x4c9fd9, 0x5a74d6, 0x8b67d1, 0xc064b8, 0xd9738f, 0xb08a5a,
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const cityRows = WORLD.cities;

export const FACTIONS: FactionDef[] = WORLD.countries.map((c) => {
  const mine = cityRows.filter((r) => r[4] === c.id);
  const power = mine.reduce((s, r) => s + r[5] * r[6], 0);
  const capital = mine.find((r) => r[7] === 1) ?? mine[0];
  const h = hash(c.id);
  const color = PALETTE[c.col % PALETTE.length];
  const big = power >= 40;
  return {
    id: c.id,
    name: c.name,
    ru: c.ru,
    short: c.id,
    color,
    css: `#${color.toString(16).padStart(6, '0')}`,
    capital: capital ? capital[0] : c.name,
    continent: c.cont,
    population: c.pop,
    gdp: c.gdp,
    neighbors: c.nb,
    labelLon: c.lx,
    labelLat: c.ly,
    power,
    personality: {
      aggression: Math.min(0.95, 0.25 + h * 0.5 + (big ? 0.12 : 0)),
      naval: 0.3 + hash(c.id + 'n') * 0.6,
      tech: Math.min(1, 0.3 + (c.gdp / Math.max(1, c.pop)) / 60),
      defense: 0.4 + hash(c.id + 'd') * 0.4,
    },
    startingResources: {
      money: Math.round(700 + power * 45),
      metal: Math.round(180 + power * 12),
      fuel: Math.round(140 + power * 10),
      food: Math.round(200 + power * 10),
    },
  };
});

export const FACTION_MAP: Record<string, FactionDef> = Object.fromEntries(FACTIONS.map((f) => [f.id, f]));

export const NEUTRAL_ID = 'neutral';
export const NEUTRAL_COLOR = 0x8d939c;

export function getFactionDef(id: string): FactionDef | undefined {
  return FACTION_MAP[id];
}

/** Localised display name for a faction id. */
export function factionName(id: string): string {
  if (id === NEUTRAL_ID) return t('Insurgents');
  const d = FACTION_MAP[id];
  return d ? tn(d) : id;
}

/** 0 minor · 1 regional · 2 major · 3 great power (drives starting forces and AI pacing). */
export function powerTier(id: string): number {
  const p = FACTION_MAP[id]?.power ?? 0;
  return p >= 60 ? 3 : p >= 25 ? 2 : p >= 10 ? 1 : 0;
}

export const TIER_NAMES = ['Minor state', 'Regional power', 'Major power', 'Great power'];
