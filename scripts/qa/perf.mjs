const waitScene = async (p, key, max = 40) => { for (let i = 0; i < max; i++) { await p.waitForTimeout(500); const s = await p.evaluate(() => window.__game?.scene.getScenes(true).map(s => s.scene.key).join(',')); if (s === key) return true; } return false; };
export const steps = [
  async (p) => { await waitScene(p, 'Menu'); await p.click('[data-a="new"]'); await p.click('[data-v="cel"]'); await p.click('[data-a="start"]'); return 'started ' + await waitScene(p, 'Game'); },
  async (p) => { await p.evaluate(() => { const sc = window.__game.scene.getScene('Game'); sc.sim.state.speed = 4; }); await p.waitForTimeout(15000);
    return await p.evaluate(() => { const sc = window.__game.scene.getScene('Game'); return { fps: Math.round(sc.game.loop.actualFps), t: sc.sim.state.time.toFixed(1), step: sc.sim.stepMs.toFixed(2), prof: Object.fromEntries(Object.entries(sc.prof).map(([k, v]) => [k, +v.toFixed(2)])), units: sc.sim.state.units.size }; }); },
];
