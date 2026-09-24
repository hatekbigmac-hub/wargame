// War & peace between countries. Everyone starts at peace; wars are declared
// (by the player, or by AI factions after a visible mobilisation) and can end in ceasefires.
// The relations map is the hook for future alliances, trade, sanctions and espionage.
import type { FactionId } from '../core/types';
import type { Sim } from '../core/Simulation';
import { relKey, atWar, invalidateWars } from '../core/GameState';
import { unitDef } from '../data/units';
import { NEUTRAL_ID } from '../data/factions';

export function militaryStrength(sim: Sim, f: FactionId): number {
  let p = 0;
  for (const u of sim.state.units.values()) {
    if (u.owner !== f) continue;
    p += ((unitDef(u.type).cost.money ?? 100) / 100) * (0.3 + 0.7 * (u.hp / u.maxHp));
    if (u.cargo) p += u.cargo.length;
  }
  for (const c of sim.state.cities) if (c.owner === f) p += 1 + c.size * 0.5;
  return p;
}

export function declareWar(sim: Sim, attacker: FactionId, defender: FactionId): void {
  if (attacker === defender || attacker === NEUTRAL_ID || defender === NEUTRAL_ID) return;
  if (atWar(sim.state, attacker, defender)) return;
  const key = relKey(attacker, defender);
  sim.state.relations[key] = 'war';
  invalidateWars();
  sim.state.warStarted[key] = sim.state.time;
  sim.bus.emit('warDeclared', { attacker, defender });
}

export function makePeace(sim: Sim, a: FactionId, b: FactionId): void {
  const key = relKey(a, b);
  if (sim.state.relations[key] !== 'war') return;
  sim.state.relations[key] = 'peace';
  invalidateWars();
  delete sim.state.warStarted[key];
  sim.state.peaceOffers = sim.state.peaceOffers.filter((o) => !(o.from === a || o.from === b));
  // Stop units firing at their former enemies.
  for (const u of sim.state.units.values()) {
    if (u.owner !== a && u.owner !== b) continue;
    const t = u.targetUnit >= 0 ? sim.state.units.get(u.targetUnit) : undefined;
    if (t && (t.owner === a || t.owner === b)) u.targetUnit = -1;
    if (u.targetCity >= 0) {
      const c = sim.state.cities[u.targetCity];
      if (c && (c.owner === a || c.owner === b)) u.targetCity = -1;
    }
  }
  lastPeace.set(key, sim.state.time);
  sim.bus.emit('peaceSigned', { a, b });
}

const lastProposal = new Map<string, number>();
export const lastPeace = new Map<string, number>();

/** Would faction `to` accept a ceasefire with `from`? */
export function wouldAcceptPeace(sim: Sim, from: FactionId, to: FactionId): number {
  const key = relKey(from, to);
  const duration = sim.state.time - (sim.state.warStarted[key] ?? sim.state.time);
  const ratio = militaryStrength(sim, from) / Math.max(1, militaryStrength(sim, to));
  // Weaker side is keen; stronger side needs a long war before it tires.
  return Math.max(0.05, Math.min(0.9, 0.2 + (ratio - 0.9) * 0.6 + Math.min(0.35, duration / 600)));
}

/** Player (or AI) proposes a ceasefire to an AI faction. */
export function proposePeace(sim: Sim, from: FactionId, to: FactionId): { accepted: boolean; reason: string } {
  const s = sim.state;
  if (!atWar(s, from, to)) return { accepted: false, reason: 'Not at war.' };
  const key = relKey(from, to);
  if (s.time - (lastProposal.get(key) ?? -1e9) < 48) return { accepted: false, reason: 'They refuse to negotiate again so soon (wait 48h).' };
  lastProposal.set(key, s.time);
  if (sim.rng.next() < wouldAcceptPeace(sim, from, to)) {
    makePeace(sim, from, to);
    return { accepted: true, reason: 'Ceasefire signed.' };
  }
  return { accepted: false, reason: 'They believe they can still win this war.' };
}

/** The player accepts a pending peace offer from an AI faction. */
export function acceptPeaceOffer(sim: Sim, from: FactionId): void {
  makePeace(sim, from, sim.state.player);
  sim.state.peaceOffers = sim.state.peaceOffers.filter((o) => o.from !== from);
}

export function rejectPeaceOffer(sim: Sim, from: FactionId): void {
  sim.state.peaceOffers = sim.state.peaceOffers.filter((o) => o.from !== from);
}
