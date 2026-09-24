// Headless capture test: Germany declares war on Czechia and storms Prague.
// Usage: node scripts/run-ts.mjs scripts/captest.ts
import { WorldGeo } from '../src/map/WorldGeo';
import { Sim } from '../src/core/Simulation';
import { unitDef } from '../src/data/units';
import { declareWar } from '../src/diplomacy/Diplomacy';
const geo = WorldGeo.build();
const P = 'DEU';
const sim = Sim.newGame(geo, P, 'normal', 7);
const s = sim.state;
const c = s.cities.find((x) => x.name === 'Prague')!;
declareWar(sim, P, c.owner);
const ids: number[] = [];
for (const t of ['medium_tank', 'medium_tank', 'medium_tank', 'artillery', 'artillery', 'infantry', 'infantry', 'infantry', 'engineer']) ids.push(sim.units.spawn(t, P, c.x - 40 + Math.random() * 20, c.y - 50 + Math.random() * 20).id);
sim.units.orderAttackCity(ids.map((i) => s.units.get(i)!), c);
for (let i = 0; i < 900; i++) {
  sim.step(0.1);
  if (i % 40 === 0) {
    const mine = ids.map((id) => s.units.get(id)).filter(Boolean).map((u) => `${unitDef(u!.type).short}:${Math.round(u!.hp)}:${Math.round(Math.hypot(u!.x - c.x, u!.y - c.y))}`);
    console.log(`${(i / 10).toFixed(0)}h hp=${Math.round(c.hp)} cap=${c.capture.toFixed(2)} own=${c.owner} | ${mine.join(' ')}`);
  }
  if (c.owner === P) {
    console.log('CAPTURED at', i / 10, 'h');
    break;
  }
}
if (c.owner !== P) process.exitCode = 1;
sim.spatial.forEachInRange(c.x, c.y, 80, (u, d2) => console.log('near', u.id, u.owner, u.type, Math.round(u.hp), Math.round(Math.sqrt(d2)), u.embarked, u.targetUnit, u.targetCity));
