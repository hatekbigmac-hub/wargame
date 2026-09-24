const waitScene = async (p, key, max = 40) => { for (let i = 0; i < max; i++) { await p.waitForTimeout(500); const s = await p.evaluate(() => window.__game?.scene.getScenes(true).map(s => s.scene.key).join(',')); if (s === key) return true; } return false; };
export const steps = [
  async (p) => { await waitScene(p, 'Menu'); await p.click('[data-a="new"]'); await p.click('[data-v="atl"]'); await p.click('[data-a="start"]'); return 'started ' + await waitScene(p, 'Game'); },
  async (p) => {
    await p.waitForTimeout(800);
    return p.evaluate(() => {
      const sc = __game.scene.getScene('Game'); const s = sc.sim.state; const U = sc.sim.units;
      const x = 2350, y = 900; // mid Atlantic
      const cv = U.spawn('carrier', 'atl', x - 260, y); const sub = U.spawn('submarine', 'atl', x - 60, y + 60); const dd = U.spawn('destroyer', 'atl', x - 200, y - 60);
      const e = []; for (const t of ['destroyer', 'frigate', 'cruiser', 'submarine']) e.push(U.spawn(t, 'euf', x + 60 + Math.random() * 60, y + Math.random() * 80 - 40));
      U.orderAttackUnit([sub], e[1]); U.orderAttackUnit([cv], e[2]);
      sc.select([cv.id, sub.id, dd.id], false); sc.controls.centerOn(x - 60, y, false); sc.controls.zoomTo(1.6); sc.cameras.main.setZoom(1.6);
      return 'naval battle set';
    });
  },
  async (p) => { await p.waitForTimeout(4500); await p.screenshot({ path: 'scripts/.out/70-naval-a.png' }); return 'a'; },
  async (p) => { await p.waitForTimeout(5000); await p.screenshot({ path: 'scripts/.out/71-naval-b.png' }); return p.evaluate(() => { const sc = __game.scene.getScene('Game'); return sc.sim.combat.projectiles.map(q => q.kind).join(','); }); },
];
