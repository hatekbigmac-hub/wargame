const waitScene = async (p, key, max = 40) => { for (let i = 0; i < max; i++) { await p.waitForTimeout(500); const s = await p.evaluate(() => window.__game?.scene.getScenes(true).map(s => s.scene.key).join(',')); if (s === key) return true; } return false; };
export const steps = [
  async (p) => { await waitScene(p, 'Menu'); await p.click('[data-a="new"]'); await p.click('[data-v="euf"]'); await p.click('[data-a="start"]'); return 'started ' + await waitScene(p, 'Game'); },
  async (p) => {
    await p.waitForTimeout(1000);
    return await p.evaluate(() => {
      const sc = __game.scene.getScene('Game'); const s = sc.sim.state; const c = s.cities.find(c => c.name === 'Tunis');
      const ids = []; for (const t of ['medium_tank','medium_tank','medium_tank','artillery','artillery','infantry','infantry','infantry','engineer']) ids.push(sc.sim.units.spawn(t, 'euf', c.x + 100 + Math.random()*20, c.y - 70 + Math.random()*20).id);
      sc.select(ids, false); sc.controls.centerOn(c.x, c.y, false); sc.controls.zoomTo(1.3); s.paused = true;
      sc.sim.units.orderAttackCity(ids.map(i => s.units.get(i)), c);
      const log = [];
      for (let i = 0; i < 900; i++) { sc.sim.step(0.1); if (i % 60 === 0) log.push(`${i/10}h hp=${Math.round(c.hp)} cap=${c.capture.toFixed(2)} own=${c.owner} alive=${ids.filter(id => s.units.has(id)).length}`); if (c.owner === 'euf') { log.push('captured at ' + (i/10) + 'h'); break; } }
      s.paused = false;
      return log;
    });
  },
  async (p) => { await p.waitForTimeout(2500); return 'shot'; },
];
