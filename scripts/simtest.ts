// Headless AI-vs-AI soak test: runs the full simulation without rendering and
// reports faction status, performance and invariants. Usage: npm run simtest [hours]
import { WorldGeo } from '../src/map/WorldGeo';
import { Sim } from '../src/core/Simulation';
import { serializeGame, deserializeGame } from '../src/save/SaveSystem';

const hours = Number(process.argv[2] ?? 600);
const t0 = Date.now();
const geo = WorldGeo.build();
console.log(`world built in ${Date.now() - t0} ms, cities=${geo.cities.length}`);
const PLAYER = process.argv[3] ?? 'FRA';
const sim = Sim.newGame(geo, PLAYER, 'normal', 12345);
// Let the "player" faction be AI-driven too for the soak test.
sim.state.factions[PLAYER].isPlayer = false;
console.log(`start units=${sim.state.units.size}`);

let captures = 0;
let kills = 0;
let missiles = 0;
let events = 0;
let wars = 0;
let peaces = 0;
let mobil = 0;
let boarded = 0;
let unloaded = 0;
sim.bus.on('warDeclared', () => wars++);
sim.bus.on('peaceSigned', () => peaces++);
sim.bus.on('mobilization', () => mobil++);
sim.bus.on('unitBoarded', () => boarded++);
sim.bus.on('unitUnloaded', () => unloaded++);
sim.bus.on('cityCaptured', () => captures++);
sim.bus.on('unitRemoved', ({ killed }) => killed && kills++);
sim.bus.on('projectileSpawn', ({ p }) => p.kind === 'missile' && missiles++);
sim.bus.on('worldEvent', () => events++);

const report = () => {
  const s = sim.state;
  const top = [...s.factionOrder].sort((a, b) => s.cities.filter((c) => c.owner === b).length - s.cities.filter((c) => c.owner === a).length).slice(0, 14);
  const rows = top.map((f) => {
    const fs = s.factions[f];
    const cities = s.cities.filter((c) => c.owner === f).length;
    let units = 0;
    for (const u of s.units.values()) if (u.owner === f) units++;
    return `${f.padEnd(7)} ${fs.alive ? 'alive' : 'DEAD '} cities=${String(cities).padStart(3)} units=${String(units).padStart(3)} $=${fs.res.money.toFixed(0).padStart(6)} inc=${fs.income.money.toFixed(1).padStart(6)} metal=${fs.res.metal.toFixed(0).padStart(5)} fuel=${fs.res.fuel.toFixed(0).padStart(5)} food=${fs.res.food.toFixed(0).padStart(5)} techs=${fs.techs.length}${fs.research ? '+' : ''}`;
  });
  const alive = s.factionOrder.filter((f) => s.factions[f].alive).length;
  const atWarNow = Object.values(s.relations).filter((v) => v === 'war').length;
  const amph = s.factionOrder.reduce((a, f) => a + (s.ai[f]?.ops.filter((o) => o.kind === 'amphibious').length ?? 0), 0);
  console.log(`--- t=${s.time.toFixed(0)}h units=${s.units.size} alive=${alive} wars=${atWarNow} (declared ${wars}, peace ${peaces}, mobilisations ${mobil}) amphOps=${amph} boarded=${boarded} unloaded=${unloaded} captures=${captures} kills=${kills} missiles=${missiles} events=${events} pathQ=${sim.paths.pending} proj=${sim.combat.projectiles.length}`);
  console.log(rows.join('\n'));
  const types: Record<string, number> = {};
  for (const u of s.units.values()) types[u.type] = (types[u.type] ?? 0) + 1;
  console.log('types:', Object.entries(types).map(([k, v]) => `${k}=${v}`).join(' '), 'batteries:', s.cities.filter((c) => c.buildings.missile_battery).length);
};

const start = Date.now();
let lastReport = 0;
let worstStep = 0;
for (let t = 0; t < hours * 10; t++) {
  const a = Date.now();
  sim.step(0.1);
  worstStep = Math.max(worstStep, Date.now() - a);
  if (sim.state.time - lastReport >= 100) {
    lastReport = sim.state.time;
    report();
  }
  // Invariants
  for (const u of sim.state.units.values()) {
    if (!isFinite(u.x) || !isFinite(u.y) || !isFinite(u.hp)) throw new Error(`bad unit state ${JSON.stringify(u)}`);
  }
}
const elapsed = Date.now() - start;
console.log(`simulated ${hours}h in ${elapsed} ms (${((elapsed / (hours * 10)) ).toFixed(2)} ms/step, worst ${worstStep} ms)`);

// Save/load round trip.
const json = serializeGame(sim.state, 'test');
const loaded = deserializeGame(json);
if (!loaded) throw new Error('deserialize failed');
const sim2 = new Sim(geo, loaded.state);
for (let i = 0; i < 50; i++) sim2.step(0.1);
console.log(`save size ${(json.length / 1024).toFixed(1)} KB, reload ok: units=${sim2.state.units.size} time=${sim2.state.time.toFixed(1)}`);
