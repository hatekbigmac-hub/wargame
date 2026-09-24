// Simulation orchestrator. Owns all gameplay systems; has no rendering dependencies,
// so it can run headless (see scripts/simtest.ts) and could later be driven by a server.
import type { Difficulty, FactionId, GameState, LogEntry, Unit } from './types';
import { EventBus } from './EventBus';
import { RNG } from './rng';
import { SpatialHash } from './Spatial';
import { createGameState } from './GameState';
import { SIM_STEP } from '../config';
import type { WorldGeo } from '../map/WorldGeo';
import { PathService } from '../map/Pathfinding';
import { TechSystem } from '../technology/TechSystem';
import { UnitSystem } from '../units/UnitSystem';
import { CombatSystem } from '../combat/CombatSystem';
import { CitySystem } from '../cities/CitySystem';
import { EconomySystem } from '../economy/EconomySystem';
import { ProductionSystem } from '../production/ProductionSystem';
import { WorldEventSystem } from '../events/WorldEventSystem';
import { AISystem } from '../ai/AISystem';
import { NEUTRAL_ID } from '../data/factions';
import { TECH_MAP } from '../data/techs';
import { unitDef } from '../data/units';

export class Sim {
  readonly bus: EventBus;
  readonly rng: RNG;
  readonly spatial = new SpatialHash();
  readonly paths: PathService;
  readonly tech: TechSystem;
  readonly units: UnitSystem;
  readonly combat: CombatSystem;
  readonly cities: CitySystem;
  readonly econ: EconomySystem;
  readonly production: ProductionSystem;
  readonly events: WorldEventSystem;
  readonly ai: AISystem;
  private acc = 0;
  private victoryTimer = 0;
  private notified = new Map<string, number>();
  stepMs = 0;

  constructor(readonly geo: WorldGeo, readonly state: GameState, bus?: EventBus) {
    this.bus = bus ?? new EventBus();
    this.rng = new RNG(state.seed);
    this.paths = new PathService(geo);
    this.tech = new TechSystem(this);
    this.units = new UnitSystem(this);
    this.combat = new CombatSystem(this);
    this.cities = new CitySystem(this);
    this.econ = new EconomySystem(this);
    this.production = new ProductionSystem(this);
    this.events = new WorldEventSystem(this);
    this.ai = new AISystem(this);
    this.spatial.rebuild(state.units.values());
    this.combat.updateVisibility();
    this.wireLogging();
  }

  static newGame(geo: WorldGeo, player: FactionId, difficulty: Difficulty, seed = (Date.now() % 1e9) | 0, bus?: EventBus): Sim {
    const state = createGameState(geo, player, difficulty, seed);
    const sim = new Sim(geo, state, bus);
    sim.setupInitialForces();
    sim.econ.recalc();
    sim.spatial.rebuild(state.units.values());
    sim.combat.updateVisibility();
    return sim;
  }

  private setupInitialForces(): void {
    const s = this.state;
    for (const f of s.factionOrder) {
      const cities = s.cities.filter((c) => c.owner === f);
      const spawnNear = (type: string, x: number, y: number, r = 24) => {
        const a = this.rng.range(0, Math.PI * 2);
        const d = this.rng.range(8, r);
        return this.units.spawn(type, f, x + Math.cos(a) * d, y + Math.sin(a) * d);
      };
      for (const c of cities) {
        if (c.size >= 2) spawnNear('infantry', c.x, c.y);
        if (c.size >= 4) spawnNear('infantry', c.x, c.y);
      }
      const capital = cities.find((c) => c.capital) ?? cities[0];
      if (capital) {
        for (const t of ['medium_tank', 'medium_tank', 'light_tank', 'artillery', 'anti_air', 'infantry']) spawnNear(t, capital.x, capital.y, 36);
      }
      cities
        .filter((c) => !c.capital)
        .sort((a, b) => b.industry - a.industry)
        .slice(0, 2)
        .forEach((c) => spawnNear('light_tank', c.x, c.y));
      const ports = cities.filter((c) => c.port).sort((a, b) => b.size - a.size || b.industry - a.industry);
      const fleet = [['destroyer', 'submarine'], ['frigate'], ['patrol_boat'], ['destroyer']];
      ports.slice(0, 4).forEach((p, i) => {
        for (const t of fleet[i]) this.units.spawn(t, f, p.portX + this.rng.range(-8, 8), p.portY + this.rng.range(-8, 8));
      });
    }
  }

  /** Economy/production multiplier applied to AI factions by difficulty. */
  aiBonus(f: FactionId): number {
    const fs = this.state.factions[f];
    if (!fs || fs.isPlayer || f === NEUTRAL_ID) return 1;
    const d = this.state.difficulty;
    return d === 'easy' ? 0.8 : d === 'hard' ? 1.2 : 1;
  }

  /** Advance the simulation by dt game-hours using fixed sub-steps. */
  advance(dt: number): void {
    if (this.state.gameOver) return;
    this.acc += Math.min(dt, 1);
    let steps = 0;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    while (this.acc >= SIM_STEP && steps < 8) {
      this.acc -= SIM_STEP;
      this.step(SIM_STEP);
      steps++;
    }
    if (steps >= 8) this.acc = 0;
    if (steps) this.stepMs = ((typeof performance !== 'undefined' ? performance.now() : 0) - t0) / steps;
  }

  step(dt: number): void {
    const s = this.state;
    s.time += dt;
    this.paths.process(26000);
    this.spatial.rebuild(s.units.values());
    this.units.update(dt);
    this.combat.update(dt);
    this.cities.update(dt);
    this.production.update(dt);
    this.tech.update(dt);
    this.econ.update(dt);
    this.events.update(dt);
    this.ai.update(dt);
    this.victoryTimer -= dt;
    if (this.victoryTimer <= 0) {
      this.victoryTimer = 2;
      this.checkVictory();
    }
  }

  // ---------------------------------------------------------------- outcomes

  checkElimination(from: FactionId, by: FactionId | null): void {
    const s = this.state;
    if (from === NEUTRAL_ID) return;
    const fs = s.factions[from];
    if (!fs || !fs.alive) return;
    if (s.cities.some((c) => c.owner === from)) return;
    fs.alive = false;
    fs.research = null;
    const doomed: Unit[] = [];
    for (const u of s.units.values()) if (u.owner === from) doomed.push(u);
    for (const u of doomed) this.units.remove(u, false, null);
    this.bus.emit('factionEliminated', { faction: from, by });
  }

  checkVictory(): void {
    const s = this.state;
    if (s.gameOver) return;
    const player = s.factions[s.player];
    const owned = s.cities.filter((c) => c.owner === s.player).length;
    if (owned === 0 || !player.alive) {
      s.gameOver = { winner: null, playerWon: false };
      this.bus.emit('gameOver', { playerWon: false, winner: null });
      return;
    }
    const rivalsAlive = s.factionOrder.some((f) => f !== s.player && s.factions[f].alive);
    if (owned >= Math.ceil(s.cities.length * 0.6) || !rivalsAlive) {
      s.gameOver = { winner: s.player, playerWon: true };
      this.bus.emit('gameOver', { playerWon: true, winner: s.player });
    }
  }

  // ---------------------------------------------------------------- logging

  log(text: string, kind: LogEntry['kind'], x?: number, y?: number): void {
    const s = this.state;
    s.log.push({ t: s.time, text, kind, x, y });
    if (s.log.length > 80) s.log.splice(0, s.log.length - 80);
  }

  notify(text: string, kind: LogEntry['kind'], x?: number, y?: number): void {
    this.log(text, kind, x, y);
    this.bus.emit('notify', { text, kind, x, y });
  }

  /** Notify at most once per key per `cooldown` game-hours. */
  notifyOnce(key: string, text: string, kind: LogEntry['kind'], x?: number, y?: number, cooldown = 20): void {
    const last = this.notified.get(key) ?? -1e9;
    if (this.state.time - last < cooldown) return;
    this.notified.set(key, this.state.time);
    this.notify(text, kind, x, y);
  }

  private wireLogging(): void {
    const s = this.state;
    const name = (f: FactionId) => s.factions[f]?.name ?? f;
    this.bus.on('cityCaptured', ({ city, from, to }) => {
      if (to === s.player) this.notify(`${city.name} captured!`, 'good', city.x, city.y);
      else if (from === s.player) this.notify(`${city.name} has fallen to the ${name(to)}`, 'bad', city.x, city.y);
      else this.log(`${name(to)} captured ${city.name} from ${name(from)}`, 'info', city.x, city.y);
    });
    this.bus.on('cityDamaged', ({ city }) => {
      if (city.owner === s.player) this.notifyOnce(`atk${city.id}`, `${city.name} is under attack!`, 'warn', city.x, city.y, 40);
    });
    this.bus.on('researchComplete', ({ faction, tech }) => {
      if (faction === s.player) this.notify(`Research complete: ${TECH_MAP[tech]?.name ?? tech}`, 'good');
    });
    this.bus.on('productionComplete', ({ city, item, unit }) => {
      if (city.owner !== s.player) return;
      const label = item.kind === 'unit' ? unitDef(item.id).name : `${item.id.replace('_', ' ')} upgrade`;
      this.log(`${city.name}: ${label} ready`, 'info', unit?.x ?? city.x, unit?.y ?? city.y);
    });
    this.bus.on('worldEvent', ({ faction, title, text, good, city }) => {
      if (faction === s.player) this.notify(`${title}: ${text}`, good ? 'good' : 'bad', city?.x, city?.y);
      else this.log(`${name(faction)} — ${title}`, 'info', city?.x, city?.y);
    });
    this.bus.on('factionEliminated', ({ faction }) => {
      if (faction !== NEUTRAL_ID) this.notify(`The ${name(faction)} has been eliminated!`, faction === s.player ? 'bad' : 'warn');
    });
    this.bus.on('unitRemoved', ({ unit, killed }) => {
      if (killed && unit.owner === s.player && unitDef(unit.type).domain === 'naval') {
        this.notifyOnce('shiplost', `${unitDef(unit.type).name} lost at sea`, 'bad', unit.x, unit.y, 8);
      }
    });
  }
}
