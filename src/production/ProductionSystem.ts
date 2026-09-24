// City production queues for units and buildings.
import type { City, Cost, ProdItem, ResKey, Unit } from '../core/types';
import { unitDef, UNIT_MAP } from '../data/units';
import { BUILDING_MAP, buildingCost, buildingTime } from '../data/buildings';
import { canAfford, pay } from '../technology/TechSystem';
import type { Sim } from '../core/Simulation';

export const MAX_QUEUE = 6;

export class ProductionSystem {
  constructor(private sim: Sim) {}

  /** Production points per game hour for this city and item domain. */
  cityRate(c: City, naval: boolean, land: boolean): number {
    const s = this.sim.state;
    if (c.unrest > 0) return 0;
    const fs = s.factions[c.owner];
    if (!fs) return 0;
    const b = c.buildings;
    let rate = 0.6 + (c.industry + (b.factory ?? 0) * 1.5) * 0.18;
    if (land) rate *= 1 + (b.barracks ?? 0) * 0.25;
    if (naval) rate *= 1 + (b.shipyard ?? 0) * 0.3;
    rate *= this.sim.tech.getMods(c.owner).prod;
    for (const e of fs.effects) rate *= e.mods.prodMult ?? 1;
    rate *= 0.5 + 0.5 * this.sim.econ.powerRatio(c.owner);
    rate *= this.sim.aiBonus(c.owner);
    if (fs.res.money <= 0 && fs.income.money < 0) rate *= 0.25;
    return rate;
  }

  canProduceUnit(c: City, type: string, checkCost = true): { ok: boolean; reason?: string } {
    const def = UNIT_MAP[type];
    if (!def || def.future) return { ok: false, reason: 'Unavailable' };
    const fs = this.sim.state.factions[c.owner];
    if (!this.sim.tech.isUnlocked(c.owner, type)) return { ok: false, reason: 'Requires research' };
    if (def.needsPort && !c.port) return { ok: false, reason: 'Requires a port' };
    if (c.queue.length >= MAX_QUEUE) return { ok: false, reason: 'Queue full' };
    if (c.unrest > 0) return { ok: false, reason: 'City in unrest' };
    if (checkCost && !canAfford(fs.res, def.cost)) return { ok: false, reason: 'Insufficient resources' };
    return { ok: true };
  }

  queuedLevel(c: City, id: string): number {
    return (c.buildings[id] ?? 0) + c.queue.filter((q) => q.kind === 'building' && q.id === id).length;
  }

  canBuild(c: City, id: string, checkCost = true): { ok: boolean; reason?: string; cost?: Cost } {
    const def = BUILDING_MAP[id];
    if (!def) return { ok: false, reason: 'Unknown' };
    const lvl = this.queuedLevel(c, id);
    if (lvl >= def.maxLevel) return { ok: false, reason: 'Max level' };
    if (def.needsPort && !c.port) return { ok: false, reason: 'Requires a port' };
    if (def.requires && !this.sim.state.factions[c.owner].techs.includes(def.requires)) return { ok: false, reason: 'Requires research' };
    if (c.queue.length >= MAX_QUEUE) return { ok: false, reason: 'Queue full' };
    const cost = buildingCost(id, lvl);
    if (checkCost && !canAfford(this.sim.state.factions[c.owner].res, cost)) return { ok: false, reason: 'Insufficient resources', cost };
    return { ok: true, cost };
  }

  enqueueUnit(c: City, type: string): boolean {
    if (!this.canProduceUnit(c, type).ok) return false;
    const def = unitDef(type);
    pay(this.sim.state.factions[c.owner].res, def.cost);
    c.queue.push({ kind: 'unit', id: type, progress: 0, time: def.time, cost: { ...def.cost } });
    return true;
  }

  enqueueBuilding(c: City, id: string): boolean {
    const chk = this.canBuild(c, id);
    if (!chk.ok || !chk.cost) return false;
    const lvl = this.queuedLevel(c, id);
    pay(this.sim.state.factions[c.owner].res, chk.cost);
    c.queue.push({ kind: 'building', id, progress: 0, time: buildingTime(id, lvl), cost: chk.cost });
    return true;
  }

  cancel(c: City, index: number): void {
    const item = c.queue[index];
    if (!item) return;
    const refund = item.progress > 0 ? 0.5 : 1;
    const res = this.sim.state.factions[c.owner]?.res;
    if (res) for (const [k, v] of Object.entries(item.cost)) res[k as ResKey] += (v as number) * refund;
    c.queue.splice(index, 1);
  }

  update(dt: number): void {
    const s = this.sim.state;
    for (const c of s.cities) {
      const item = c.queue[0];
      if (!item) continue;
      const naval = item.kind === 'unit' && unitDef(item.id).domain === 'naval';
      const land = item.kind === 'unit' && !naval;
      item.progress += dt * this.cityRate(c, naval, land);
      if (item.progress >= item.time) {
        c.queue.shift();
        this.complete(c, item);
      }
    }
  }

  private complete(c: City, item: ProdItem): void {
    const sim = this.sim;
    let unit: Unit | null = null;
    if (item.kind === 'unit') {
      const def = unitDef(item.id);
      const a = sim.rng.range(0, Math.PI * 2);
      const r = sim.rng.range(6, 22);
      if (def.domain === 'naval') unit = sim.units.spawn(item.id, c.owner, c.portX + Math.cos(a) * 6, c.portY + Math.sin(a) * 6);
      else unit = sim.units.spawn(item.id, c.owner, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
      const fs = sim.state.factions[c.owner];
      if (fs) fs.stats.built++;
    } else {
      c.buildings[item.id] = (c.buildings[item.id] ?? 0) + 1;
      if (item.id === 'fortress') sim.cities.refresh(c);
      if (item.id === 'missile_battery') c.missiles = Math.max(c.missiles, 1);
    }
    // Income figures refresh on the next hourly economy tick (a full recalc here is costly with ~2000 units).
    if (c.owner === sim.state.player) sim.econ.recalc();
    sim.bus.emit('productionComplete', { city: c, item, unit });
  }
}
