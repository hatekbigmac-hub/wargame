// Player offensive planning: PREPARE (move troops to a staging area near the target and let
// preparation build up) → LAUNCH (declare war if needed and attack with a combat bonus).
import type { City, PlayerOp, Unit } from '../core/types';
import type { Sim } from '../core/Simulation';
import { unitDef } from '../data/units';
import { atWar } from '../core/GameState';
import { declareWar } from '../diplomacy/Diplomacy';
import { worldToCell } from '../config';
import { t, tn } from '../i18n';

/** Hours of preparation for the full bonus. */
export const PREP_HOURS = 24;
/** Attack bonus at full preparation (+25%). */
export const MAX_PREP_BONUS = 0.25;
/** How long the bonus lasts after launch (game-hours). */
export const BONUS_HOURS = 36;
export const STAGE_RADIUS = 120;

function ownedBy(sim: Sim, x: number, y: number): string | null {
  const cell = worldToCell(x, y);
  if (!sim.geo.isLandPassable(cell)) return null;
  const r = sim.geo.region[cell];
  return r >= 0 ? sim.state.cities[r]?.owner ?? null : null;
}

/** Pick a staging point in friendly territory on the way to the target. */
export function planStaging(sim: Sim, units: Unit[], target: City): { x: number; y: number } | { error: string } {
  const s = sim.state;
  const me = s.player;
  const land = units.filter((u) => u.owner === me && unitDef(u.type).domain === 'land');
  if (!land.length) return { error: t('Select land units to prepare an offensive') };
  if (target.owner === me) return { error: t('Choose a foreign city as the target') };
  if (!land.some((u) => sim.geo.landConnected(u.x, u.y, target.x, target.y))) {
    return { error: t('No land route to {city} — load the troops onto a Transport Ship', { city: tn(target) }) };
  }
  let base: City | null = null;
  let bd = Infinity;
  for (const c of s.cities) {
    if (c.owner !== me || !sim.geo.landConnected(c.x, c.y, target.x, target.y)) continue;
    const d = Math.hypot(c.x - target.x, c.y - target.y);
    if (d < bd) {
      bd = d;
      base = c;
    }
  }
  if (base) {
    // Push the staging point from our nearest city towards the target while it stays on our soil.
    const dx = target.x - base.x;
    const dy = target.y - base.y;
    const dist = Math.hypot(dx, dy) || 1;
    for (let push = Math.min(150, dist * 0.45); push >= 0; push -= 30) {
      const x = base.x + (dx / dist) * push;
      const y = base.y + (dy / dist) * push;
      if (ownedBy(sim, x, y) === me || push === 0) return { x, y };
    }
    return { x: base.x, y: base.y };
  }
  // No city of ours on that landmass: stage just outside the target's gun range.
  const reach = land.filter((u) => sim.geo.landConnected(u.x, u.y, target.x, target.y));
  const cx = reach.reduce((a, u) => a + u.x, 0) / reach.length;
  const cy = reach.reduce((a, u) => a + u.y, 0) / reach.length;
  const dx = cx - target.x;
  const dy = cy - target.y;
  const dist = Math.hypot(dx, dy) || 1;
  const off = Math.min(dist, 230);
  return { x: target.x + (dx / dist) * off, y: target.y + (dy / dist) * off };
}

export function createOp(sim: Sim, units: Unit[], target: City): PlayerOp | { error: string } {
  const s = sim.state;
  const stage = planStaging(sim, units, target);
  if ('error' in stage) return stage;
  const land = units.filter((u) => u.owner === s.player && unitDef(u.type).domain === 'land' && sim.geo.landConnected(u.x, u.y, target.x, target.y));
  const ids = new Set(land.map((u) => u.id));
  // A unit belongs to one operation at a time.
  for (const op of s.ops) op.units = op.units.filter((id) => !ids.has(id));
  s.ops = s.ops.filter((op) => op.units.length > 0);
  const existing = s.ops.find((op) => op.targetCity === target.id);
  let op: PlayerOp;
  if (existing) {
    existing.units.push(...ids);
    op = existing;
  } else {
    op = { id: s.nextOpId++, units: [...ids], targetCity: target.id, stageX: stage.x, stageY: stage.y, prep: 0, created: s.time };
    s.ops.push(op);
  }
  sim.units.orderMove(land, op.stageX, op.stageY);
  return op;
}

export function opUnits(sim: Sim, op: PlayerOp): Unit[] {
  return op.units.map((id) => sim.state.units.get(id)).filter((u): u is Unit => !!u && !u.dead);
}

/** Fraction of the op's troops currently at the staging area. */
export function gathered(sim: Sim, op: PlayerOp): number {
  const us = opUnits(sim, op);
  if (!us.length) return 0;
  let n = 0;
  for (const u of us) if (Math.hypot(u.x - op.stageX, u.y - op.stageY) < STAGE_RADIUS) n++;
  return n / us.length;
}

export function updateOps(sim: Sim, dt: number): void {
  const s = sim.state;
  if (!s.ops.length) return;
  s.ops = s.ops.filter((op) => {
    op.units = op.units.filter((id) => {
      const u = s.units.get(id);
      return !!u && !u.dead && u.owner === s.player;
    });
    const target = s.cities[op.targetCity];
    if (!op.units.length || !target || target.owner === s.player) return false;
    op.prep = Math.min(1, op.prep + (dt * gathered(sim, op)) / PREP_HOURS);
    if (op.prep >= 1 && !op.ready) {
      op.ready = true;
      sim.notify(t('Offensive on {city} is fully prepared — launch it from the Operations panel', { city: tn(target) }), 'good', op.stageX, op.stageY);
    }
    return true;
  });
}

export function needsDeclaration(sim: Sim, op: PlayerOp): string | null {
  const c = sim.state.cities[op.targetCity];
  if (!c || atWar(sim.state, sim.state.player, c.owner)) return null;
  return c.owner;
}

export function launchOp(sim: Sim, opId: number): { ok: boolean; msg: string } {
  const s = sim.state;
  const op = s.ops.find((o) => o.id === opId);
  if (!op) return { ok: false, msg: t('Operation not found') };
  const target = s.cities[op.targetCity];
  const units = opUnits(sim, op);
  if (!target || !units.length) return { ok: false, msg: t('No troops left in this operation') };
  const enemy = needsDeclaration(sim, op);
  if (enemy) declareWar(sim, s.player, enemy);
  const bonus = 1 + MAX_PREP_BONUS * op.prep;
  let boosted = 0;
  for (const u of units) {
    if (Math.hypot(u.x - op.stageX, u.y - op.stageY) < STAGE_RADIUS + 50) {
      u.bonus = bonus;
      u.bonusUntil = s.time + BONUS_HOURS;
      boosted++;
    }
  }
  sim.units.orderAttackCity(units, target);
  s.ops = s.ops.filter((o) => o !== op);
  sim.bus.emit('offensiveLaunched', { op, city: target });
  return {
    ok: true,
    msg: t('Offensive on {city} launched: {n} units, +{b}% attack', { city: tn(target), n: units.length, b: Math.round((bonus - 1) * 100) }) + (boosted < units.length ? ` (${t('{k} not at staging', { k: units.length - boosted })})` : ''),
  };
}

export function cancelOp(sim: Sim, opId: number): void {
  sim.state.ops = sim.state.ops.filter((o) => o.id !== opId);
}
