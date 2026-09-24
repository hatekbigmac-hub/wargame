const waitScene = async (p, key, max = 40) => { for (let i = 0; i < max; i++) { await p.waitForTimeout(500); const s = await p.evaluate(() => window.__game?.scene.getScenes(true).map(s => s.scene.key).join(',')); if (s === key) return true; } return false; };
export const steps = [
  async (p) => { await waitScene(p, 'Menu'); await p.click('[data-a="new"]'); await p.click('[data-v="ind"]'); await p.click('[data-a="start"]'); return 'started ' + await waitScene(p, 'Game'); },
  async (p) => {
    for (let k = 0; k < 30; k++) {
      await p.evaluate(() => { const sc = __game.scene.getScene('Game'); for (let i = 0; i < 100; i++) sc.sim.step(0.1); });
      await p.waitForTimeout(250);
    }
    return p.evaluate(() => { const sc = __game.scene.getScene('Game'); const s = sc.sim.state; return { t: Math.round(s.time), units: s.units.size, alive: s.factionOrder.filter(f => s.factions[f].alive).length, playerCities: s.cities.filter(c => c.owner === s.player).length, log: s.log.length }; });
  },
  async (p) => { await p.screenshot({ path: 'scripts/.out/60-soak.png' }); await p.keyboard.press('F5'); await p.waitForTimeout(300); await p.keyboard.press('F9'); return 'reloaded ' + await waitScene(p, 'Game'); },
  async (p) => { await p.waitForTimeout(1500); return p.evaluate(() => { const sc = __game.scene.getScene('Game'); const s = sc.sim.state; for (const c of s.cities) if (c.owner === s.player) sc.sim.cities.captureCity(c, 'cel'); sc.sim.checkVictory(); return { gameOver: s.gameOver, uiChildren: document.getElementById('ui').children.length }; }); },
  async (p) => { await p.waitForTimeout(1500); await p.screenshot({ path: 'scripts/.out/61-defeat.png' }); return 'defeat window ' + await p.evaluate(() => !!document.querySelector('.gameover')); },
];
