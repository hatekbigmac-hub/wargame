// Simulation orchestrator. Owns all gameplay systems; has no rendering dependencies,
// so it can run headless (see scripts/simtest.ts) and could later be driven by a server.
import type { Difficulty, FactionId, GameState, LogEntry, Unit } from './types';
import { EventBus } from './EventBus';
import { RNG } from './rng';
import { SpatialHash } from './Spatial';
import { createGameState } from './GameState';
import { SIM_STEP, worldToCell } from '../config';
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
import { NEUTRAL_ID, factionName } from '../data/factions';
import { forcePlan, qualityOf, UPKEEP_BY_QUALITY } from '../data/military';
import { TECH_MAP } from '../data/techs';
import { unitDef } from '../data/units';
import { updateOps } from '../military/Offensives';
import { t, tn } from '../i18n';

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

  /** Starting armies and navies follow each country's real-world armed forces (data/military.ts). */
  private setupInitialForces(): void {
    const s = this.state;
    for (const f of s.factionOrder) {
      const cities = s.cities.filter((c) => c.owner === f);
      if (!cities.length) continue;
      const plan = forcePlan(f);
      // Spawn on our own soil: in dense regions (Europe) a random offset can cross the border.
      const spawnNear = (type: string, x: number, y: number, r = 24) => {
        for (let tries = 0; tries < 10; tries++) {
          const a = this.rng.range(0, Math.PI * 2);
          const d = this.rng.range(6, r * (1 - tries * 0.08));
          const px = x + Math.cos(a) * d;
          const py = y + Math.sin(a) * d;
          const cell = worldToCell(px, py);
          const reg = this.geo.region[cell];
          if (this.geo.isLandPassable(cell) && reg >= 0 && s.cities[reg]?.owner === f) return this.units.spawn(type, f, px, py);
        }
        return this.units.spawn(type, f, x + this.rng.range(-4, 4), y + this.rng.range(-4, 4));
      };
      // Land forces: a quarter around the capital, the rest spread over all cities by importance.
      const capital = cities.find((c) => c.capital) ?? cities[0];
      const others = cities.filter((c) => c !== capital);
      const land: string[] = [];
      for (const [type, n] of Object.entries(plan.land)) for (let i = 0; i < n; i++) land.push(type);
      this.rng.shuffleInPlace(land);
      const atCapital = others.length ? Math.ceil(land.length * 0.25) : land.length;
      land.forEach((type, i) => {
        const c = i < atCapital ? capital : this.rng.weighted(others, (o) => o.size * 2 + o.industry + 1)!;
        spawnNear(type, c.x, c.y, c === capital ? 56 : 44);
      });
      // Navy: capital ships and submarines at the main port, the rest spread over up to 4 ports.
      const ports = cities.filter((c) => c.port).sort((a, b) => b.size * 2 + b.industry - (a.size * 2 + a.industry)).slice(0, 4);
      if (ports.length) {
        let i = 0;
        for (const [type, n] of Object.entries(plan.naval)) {
          for (let k = 0; k < n; k++) {
            const p = type === 'carrier' || type === 'cruiser' ? ports[0] : ports[i++ % ports.length];
            this.units.spawn(type, f, p.portX + this.rng.range(-12, 12), p.portY + this.rng.range(-12, 12));
          }
        }
      }
    }
    this.setupBudgets();
  }

  /** Each country's defence budget pays for its standing forces (so large real armies are sustainable). */
  private setupBudgets(): void {
    const s = this.state;
    const upkeep = new Map<FactionId, { money: number; metal: number; fuel: number; food: number }>();
    for (const u of s.units.values()) {
      let b = upkeep.get(u.owner);
      if (!b) upkeep.set(u.owner, (b = { money: 0, metal: 0, fuel: 0, food: 0 }));
      const m = UPKEEP_BY_QUALITY[qualityOf(u.owner)];
      for (const [k, v] of Object.entries(unitDef(u.type).upkeep)) b[k as 'money'] += (v as number) * m;
    }
    for (const f of s.factionOrder) {
      const fs = s.factions[f];
      const b = upkeep.get(f) ?? { money: 0, metal: 0, fuel: 0, food: 0 };
      fs.budget = { money: b.money, metal: b.metal, fuel: b.fuel, food: b.food };
      fs.homeValue = s.cities.reduce((a, c) => a + (c.origOwner === f ? c.importance : 0), 0);
      const ai = s.ai[f];
      if (ai) ai.baseline = [...s.units.values()].filter((u) => u.owner === f).length;
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
    while (this.acc >= SIM_STEP && steps < 12) {
      this.acc -= SIM_STEP;
      this.step(SIM_STEP);
      steps++;
    }
    if (steps >= 12) this.acc = 0;
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
    updateOps(this, dt);
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
    const name = factionName;
    this.bus.on('cityCaptured', ({ city, from, to }) => {
      if (to === s.player) this.notify(t('{city} captured!', { city: tn(city) }), 'good', city.x, city.y);
      else if (from === s.player) this.notify(t('{city} has fallen to {name}', { city: tn(city), name: name(to) }), 'bad', city.x, city.y);
      else this.log(t('{a} captured {city} from {b}', { a: name(to), city: tn(city), b: name(from) }), 'info', city.x, city.y);
    });
    this.bus.on('cityDamaged', ({ city }) => {
      if (city.owner === s.player) this.notifyOnce(`atk${city.id}`, t('{city} is under attack!', { city: tn(city) }), 'warn', city.x, city.y, 40);
    });
    this.bus.on('researchComplete', ({ faction, tech }) => {
      const def = TECH_MAP[tech];
      if (faction === s.player) this.notify(t('Research complete: {tech}', { tech: def ? t(def.name) : tech }), 'good');
    });
    this.bus.on('productionComplete', ({ city, item, unit }) => {
      if (city.owner !== s.player) return;
      const label = item.kind === 'unit' ? t(unitDef(item.id).name) : t('{b} upgrade', { b: item.id.replace('_', ' ') });
      this.log(`${tn(city)}: ${t('{item} ready', { item: label })}`, 'info', unit?.x ?? city.x, unit?.y ?? city.y);
    });
    this.bus.on('worldEvent', ({ faction, title, text, good, city }) => {
      if (faction === s.player) this.notify(`${t(title)}: ${text}`, good ? 'good' : 'bad', city?.x, city?.y);
      else this.log(`${name(faction)} — ${t(title)}`, 'info', city?.x, city?.y);
    });
    this.bus.on('factionEliminated', ({ faction }) => {
      if (faction !== NEUTRAL_ID) this.notify(t('{name} has been eliminated!', { name: name(faction) }), faction === s.player ? 'bad' : 'warn');
    });
    this.bus.on('unitRemoved', ({ unit, killed }) => {
      if (killed && unit.owner === s.player && unitDef(unit.type).domain === 'naval') {
        this.notifyOnce('shiplost', t('{unit} lost at sea', { unit: t(unitDef(unit.type).name) }), 'bad', unit.x, unit.y, 8);
      }
    });
    this.bus.on('warDeclared', ({ attacker, defender }) => {
      if (defender === s.player) this.notify(t('{name} has declared WAR on you!', { name: name(attacker) }), 'bad');
      else if (attacker === s.player) this.notify(t('You declared war on {name}', { name: name(defender) }), 'warn');
      else this.log(t('{a} declared war on {b}', { a: name(attacker), b: name(defender) }), 'info');
    });
    this.bus.on('peaceSigned', ({ a, b }) => {
      if (a === s.player || b === s.player) this.notify(t('Ceasefire signed with {name}', { name: name(a === s.player ? b : a) }), 'good');
      else this.log(t('Ceasefire: {a} and {b}', { a: name(a), b: name(b) }), 'info');
    });
    this.bus.on('mobilization', ({ faction, target, city }) => {
      if (target === s.player) {
        this.notify(t('{name} is MOBILISING troops on your border — war expected within 2 days!', { name: name(faction) }), 'bad', city?.x, city?.y);
      } else {
        this.log(t('{a} is mobilising against {b}', { a: name(faction), b: name(target) }), 'info', city?.x, city?.y);
      }
    });
  }
}
