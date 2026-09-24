import { WorldGeo } from '../src/map/WorldGeo';
const g: any = new (WorldGeo as any)();
for (const step of ['buildShapes','buildLand','buildTerrain','buildWaterBodies','placeCities','buildRegions']) {
  const t = Date.now(); g[step](); console.log(step, Date.now() - t, 'ms');
}
console.log('land pts', g.landPolys.reduce((a: number, p: any) => a + p.pts.length / 2, 0));
