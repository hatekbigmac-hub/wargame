// Periodically triggers data-driven world events on random factions.
import { WORLD_EVENTS } from '../data/events';
import type { Sim } from '../core/Simulation';

export class WorldEventSystem {
  constructor(private sim: Sim) {}

  update(dt: number): void {
    const s = this.sim.state;
    s.eventTimer -= dt;
    if (s.eventTimer > 0) return;
    s.eventTimer = this.sim.rng.range(55, 110);
    const alive = s.factionOrder.filter((f) => s.factions[f].alive);
    if (!alive.length) return;
    // The player is affected somewhat more often so events stay visible.
    const f = this.sim.rng.chance(0.35) && s.factions[s.player].alive ? s.player : this.sim.rng.pick(alive);
    this.trigger(f);
  }

  trigger(f: string, id?: string): void {
    const sim = this.sim;
    const candidates = WORLD_EVENTS.filter((e) => (!id || e.id === id) && e.canApply(sim, f));
    const ev = sim.rng.weighted(candidates, (e) => e.weight);
    if (!ev) return;
    try {
      const res = ev.apply(sim, f);
      sim.econ.recalc();
      sim.bus.emit('worldEvent', { id: ev.id, faction: f, title: ev.title, text: res.text, good: ev.good, city: res.city ?? null });
    } catch (err) {
      console.warn('[WorldEvents] event failed', ev.id, err);
    }
  }
}
