const waitScene = async (p, key, max = 40) => { for (let i = 0; i < max; i++) { await p.waitForTimeout(500); const s = await p.evaluate(() => window.__game?.scene.getScenes(true).map(s => s.scene.key).join(',')); if (s === key) return true; } return false; };
export const steps = [
  async (p) => { await waitScene(p, 'Menu'); await p.click('[data-a="new"]'); await p.click('[data-v="pac"]'); await p.click('[data-a="start"]'); return 'started ' + await waitScene(p, 'Game'); },
  async (p) => {
    await p.waitForTimeout(800);
    return await p.evaluate(() => {
      const sc = __game.scene.getScene('Game'); const s = sc.sim.state;
      const x = 5000, y = 1000; // Sea of Japan-ish / Korea
      const c = s.cities.find(c => c.name === 'Busan');
      const mine = []; for (const t of ['medium_tank','heavy_tank','light_tank','artillery','anti_air','infantry','infantry']) mine.push(sc.sim.units.spawn(t, 'pac', c.x + 60 + Math.random()*30, c.y - 110 + Math.random()*30));
      const ships = []; for (const t of ['destroyer','cruiser','submarine','frigate']) ships.push(sc.sim.units.spawn(t, 'pac', c.portX + 40 + Math.random()*40, c.portY + 40 + Math.random()*40));
      sc.sim.units.orderAttackCity(mine.map(id => id), c);
      sc.sim.units.orderAttackCity(ships, c);
      sc.select(mine.map(u => u.id), false);
      sc.controls.centerOn(c.x + 30, c.y - 40, false); sc.controls.zoomTo(1.5); sc.cameras.main.setZoom(1.5);
      return c.name;
    });
  },
  async (p) => { await p.waitForTimeout(9000); await p.screenshot({ path: 'scripts/.out/30-battle-a.png' }); return 'a'; },
  async (p) => { await p.waitForTimeout(9000); return 'b'; },
];
steps.push(async (p) => p.evaluate(async () => { const sc = __game.scene.getScene('Game'); const t0 = sc.sim.state.time; const f0 = __game.loop.frame; await new Promise(r => setTimeout(r, 3000)); return { dtime: sc.sim.state.time - t0, frames: __game.loop.frame - f0, paused: sc.sim.state.paused, zoom: sc.cameras.main.zoom, speed: sc.sim.state.speed, prof: sc.prof }; }));
