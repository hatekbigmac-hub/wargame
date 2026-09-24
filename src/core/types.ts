// Shared type definitions for data definitions and simulation state.

export type FactionId = string;
export type ResKey = 'money' | 'metal' | 'fuel' | 'food';
export const RES_KEYS: ResKey[] = ['money', 'metal', 'fuel', 'food'];
export type Cost = Partial<Record<ResKey, number>>;
export type Resources = Record<ResKey, number>;
export type Difficulty = 'easy' | 'normal' | 'hard';

export type Domain = 'land' | 'naval' | 'air';
export type TargetClass = 'infantry' | 'armor' | 'ship' | 'sub' | 'city' | 'air';
export type ProjectileKind = 'bullet' | 'cannon' | 'shell' | 'rocket' | 'torpedo' | 'missile' | 'air' | 'flak';

export enum Terrain {
  Water = 0,
  Plains = 1,
  Forest = 2,
  Jungle = 3,
  Desert = 4,
  Mountain = 5,
  Arctic = 6,
}

// ---------------------------------------------------------------- data defs

export interface UnitDef {
  id: string;
  name: string;
  short: string;
  domain: Domain;
  cls: TargetClass;
  role: string;
  desc: string;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  range: number;
  reload: number;
  detection: number;
  /** Damage multiplier per target class; missing/0 = cannot engage. */
  vs: Partial<Record<TargetClass, number>>;
  cost: Cost;
  time: number;
  upkeep: Cost;
  projectile: ProjectileKind;
  sprite: string;
  turret?: string;
  size: number;
  requires?: string;
  needsPort?: boolean;
  abilities?: string[];
  stealth?: boolean;
  sonar?: number;
  intercept?: number;
  interceptRange?: number;
  missiles?: number;
  missileRange?: number;
  missileDamage?: number;
  splash?: number;
  stationaryFire?: boolean;
  minRange?: number;
  captureRate?: number;
  future?: boolean;
}

export interface BuildingDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  maxLevel: number;
  cost: Cost;
  time: number;
  needsPort?: boolean;
  requires?: string;
}

export type TechCategory = 'army' | 'navy' | 'air' | 'industry';

export interface TechEffect {
  type: 'stat' | 'unlock' | 'econ' | 'prod' | 'research' | 'upkeep' | 'intercept' | 'missile' | 'sonar' | 'stealth';
  /** For stat effects: which units ("all", a domain, a target class or a unit id). */
  target?: string;
  stat?: 'attack' | 'defense' | 'hp' | 'speed' | 'range' | 'detection';
  mult?: number;
  add?: number;
  unit?: string;
  resource?: ResKey | 'power';
}

export interface TechDef {
  id: string;
  name: string;
  category: TechCategory;
  desc: string;
  cost: Cost;
  time: number;
  requires: string[];
  effects: TechEffect[];
  tier: number;
  future?: boolean;
}

export interface FactionDef {
  id: FactionId;
  name: string;
  short: string;
  color: number;
  css: string;
  capital: string;
  desc: string;
  motto: string;
  difficulty: string;
  personality: { aggression: number; naval: number; tech: number; defense: number };
  startingResources: Resources;
}

export interface CityDef {
  name: string;
  lon: number;
  lat: number;
  owner: FactionId;
  size: number;
  industry: number;
  port: boolean;
  airport: boolean;
  capital: boolean;
  trade: boolean;
  tags: string; // resource tags: o=oil m=metal f=food e=energy
}

// ---------------------------------------------------------------- state

export type OrderKind = 'move' | 'attack' | 'attackMove' | 'hold';

export interface Order {
  kind: OrderKind;
  x: number;
  y: number;
  targetUnit?: number;
  targetCity?: number;
}

export interface Unit {
  id: number;
  type: string;
  owner: FactionId;
  x: number;
  y: number;
  angle: number;
  turret: number;
  hp: number;
  maxHp: number;
  order: Order | null;
  path: number[] | null;
  pathIdx: number;
  pathPending: boolean;
  repathAt: number;
  targetUnit: number;
  targetCity: number;
  cooldown: number;
  scanCd: number;
  missiles: number;
  missileCd: number;
  missileRegen: number;
  xp: number;
  rank: number;
  kills: number;
  embarked: boolean;
  moving: boolean;
  revealed: number;
  detMask: number;
  anchorX: number;
  anchorY: number;
  lastHit: number;
  aiTask: number;
  dead: boolean;
}

export interface ProdItem {
  kind: 'unit' | 'building';
  id: string;
  progress: number;
  time: number;
  cost: Cost;
}

export interface City {
  id: number;
  name: string;
  x: number;
  y: number;
  cell: number;
  owner: FactionId;
  origOwner: FactionId;
  size: number;
  industry: number;
  port: boolean;
  airport: boolean;
  capital: boolean;
  trade: boolean;
  tags: string;
  portX: number;
  portY: number;
  hp: number;
  maxHp: number;
  buildings: Record<string, number>;
  queue: ProdItem[];
  capture: number;
  capturer: FactionId | null;
  lastAttacked: number;
  cooldown: number;
  missiles: number;
  missileCd: number;
  unrest: number;
  region: number;
  importance: number;
}

export interface EffectMods {
  prodMult?: number;
  resMult?: Partial<Record<ResKey, number>>;
  researchMult?: number;
  speedMult?: number;
  attackMult?: number;
  powerMult?: number;
}

export interface ActiveEffect {
  id: string;
  label: string;
  remaining: number;
  mods: EffectMods;
  cityId?: number;
}

export interface FactionStats {
  built: number;
  lost: number;
  killed: number;
  captured: number;
  citiesLost: number;
}

export interface FactionState {
  id: FactionId;
  index: number;
  name: string;
  color: number;
  isPlayer: boolean;
  alive: boolean;
  res: Resources;
  income: Resources;
  gross: Resources;
  upkeep: Resources;
  power: { supply: number; demand: number };
  industry: number;
  techs: string[];
  research: { id: string; progress: number; time: number } | null;
  effects: ActiveEffect[];
  stats: FactionStats;
}

export interface LogEntry {
  t: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'warn' | 'combat';
  x?: number;
  y?: number;
}

export interface AIOperation {
  id: number;
  targetCity: number;
  units: number[];
  started: number;
  kind: 'attack' | 'defend';
}

export interface AIState {
  nextThink: number;
  ops: AIOperation[];
  nextOpId: number;
  lastNaval: number;
  mood: number;
  plan?: { unit: string; city: number } | null;
}

export interface GameState {
  time: number;
  speed: number;
  paused: boolean;
  player: FactionId;
  difficulty: Difficulty;
  seed: number;
  factions: Record<FactionId, FactionState>;
  factionOrder: FactionId[];
  cities: City[];
  units: Map<number, Unit>;
  nextUnitId: number;
  relations: Record<string, 'war' | 'peace'>;
  log: LogEntry[];
  gameOver: null | { winner: FactionId | null; playerWon: boolean };
  eventTimer: number;
  ai: Record<FactionId, AIState>;
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  owner: FactionId;
  src: number; // unit id (-1 for city)
  srcCity: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  cx: number; // bezier control point (missiles / shells)
  cy: number;
  t: number;
  dur: number;
  targetUnit: number;
  targetCity: number;
  attack: number;
  vs: Partial<Record<TargetClass, number>>;
  splash: number;
  fixedDamage: number;
  interceptAt: number; // 0..1 progress at which interception happens, -1 none
  interceptBy: { x: number; y: number } | null;
  done: boolean;
}

// ---------------------------------------------------------------- events

export interface GameEvents {
  unitCreated: { unit: Unit };
  unitRemoved: { unit: Unit; killed: boolean; by: FactionId | null };
  unitFired: { unit: Unit | null; city: City | null; kind: ProjectileKind; x: number; y: number; tx: number; ty: number };
  projectileSpawn: { p: Projectile };
  projectileImpact: { p: Projectile; x: number; y: number; hit: boolean };
  missileIntercepted: { p: Projectile; x: number; y: number; bx: number; by: number };
  unitDamaged: { unit: Unit; amount: number };
  cityDamaged: { city: City; amount: number };
  cityCaptured: { city: City; from: FactionId; to: FactionId };
  productionComplete: { city: City; item: ProdItem; unit: Unit | null };
  researchComplete: { faction: FactionId; tech: string };
  factionEliminated: { faction: FactionId; by: FactionId | null };
  worldEvent: { id: string; faction: FactionId; title: string; text: string; good: boolean; city: City | null };
  notify: { text: string; kind: LogEntry['kind']; x?: number; y?: number; faction?: FactionId };
  gameOver: { playerWon: boolean; winner: FactionId | null };
  selectionChanged: { units: number[]; city: number };
}
