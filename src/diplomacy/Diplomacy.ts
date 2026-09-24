// Basic diplomacy: war/peace relations. Designed as the hook for future alliances,
// trade agreements, sanctions and espionage (the relations map already supports it).
import type { FactionId } from '../core/types';
import type { Sim } from '../core/Simulation';
import { relKey, atWar } from '../core/GameState';
import { unitPower } from '../ai/AISystem';

export function militaryStrength(sim: Sim, f: FactionId): number {
  let p = 0;
  for (const u of sim.state.units.values()) if (u.owner === f) p += unitPower(u);
  for (const c of sim.state.cities) if (c.owner === f) p += 1 + c.size * 0.5;
  return p;
}

const lastProposal = new Map<string, number>();

export function proposePeace(sim: Sim, from: FactionId, to: FactionId): { accepted: boolean; reason: string } {
  const s = sim.state;
  if (!atWar(s, from, to)) return { accepted: false, reason: 'Already at peace.' };
  const key = relKey(from, to);
  const last = lastProposal.get(key) ?? -1e9;
  if (s.time - last < 48) return { accepted: false, reason: 'They refuse to negotiate again so soon (wait 48h).' };
  lastProposal.set(key, s.time);
  const mine = militaryStrength(sim, from);
  const theirs = Math.max(1, militaryStrength(sim, to));
  const ratio = mine / theirs;
  const chance = Math.max(0.05, Math.min(0.85, 0.25 + (ratio - 0.8) * 0.6));
  if (sim.rng.next() < chance) {
    s.relations[key] = 'peace';
    return { accepted: true, reason: 'Ceasefire signed.' };
  }
  return { accepted: false, reason: ratio < 0.8 ? 'They believe they are winning this war.' : 'Negotiations collapsed.' };
}

export function declareWar(sim: Sim, from: FactionId, to: FactionId): void {
  sim.state.relations[relKey(from, to)] = 'war';
  lastProposal.set(relKey(from, to), sim.state.time);
}

/** AI factions may break a ceasefire with the player when they grow much stronger. */
export function aiDiplomacy(sim: Sim, f: FactionId): void {
  const s = sim.state;
  const p = s.player;
  if (f === p || atWar(s, f, p)) return;
  const since = s.time - (lastProposal.get(relKey(f, p)) ?? 0);
  if (since < 150) return;
  if (militaryStrength(sim, f) > militaryStrength(sim, p) * 1.5 && sim.rng.chance(0.08)) {
    declareWar(sim, f, p);
    sim.notify(`The ${s.factions[f].name} has broken the ceasefire and declared war!`, 'bad');
  }
}
