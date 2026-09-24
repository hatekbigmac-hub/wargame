import { WorldGeo } from '../src/map/WorldGeo';
import { Sim } from '../src/core/Simulation';
import { unitDef } from '../src/data/units';
const geo = WorldGeo.build();
const sim = Sim.newGame(geo, 'euf', 'normal', 7);
const s = sim.state;
const c = s.cities.find((c) => c.name === 'Tunis')!;
const ids: number[] = [];
for (const t of ['medium_tank', 'medium_tank', 'medium_tank', 'artillery', 'artillery', 'infantry', 'infantry', 'infantry', 'engineer']) ids.push(sim.units.spawn(t, 'euf', c.x + 100 + Math.random() * 20, c.y - 70 + Math.random() * 20).id);
sim.units.orderAttackCity(ids.map((i) => s.units.get(i)!), c);
for (let i = 0; i < 900; i++) {
  sim.step(0.1);
  if (i % 20 === 0) {
    const near: string[] = [];
    sim.spatial.forEachInRange(c.x, c.y, 150, (u, d2) => near.push(`${u.owner}:${unitDef(u.type).short}@${Math.round(Math.sqrt(d2))}${u.embarked ? 'E' : ''}`));
    const mine = ids.map((id) => s.units.get(id)).filter(Boolean).map((u) => `${unitDef(u!.type).short}:${Math.round(u!.hp)}:${u!.order?.kind ?? '-'}:${Math.round(Math.hypot(u!.x - c.x, u!.y - c.y))}${u!.embarked ? 'E' : ''}`);
    console.log(`${(i / 10).toFixed(0)}h hp=${Math.round(c.hp)} cap=${c.capture.toFixed(2)} own=${c.owner} | mine ${mine.join(' ')} | near ${near.filter((n) => !n.startsWith('euf')).join(' ')}`);
  }
  if (c.owner === 'euf') { console.log('CAPTURED at', i / 10); break; }
}
