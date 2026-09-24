const waitScene = async (p, key, max = 40) => { for (let i = 0; i < max; i++) { await p.waitForTimeout(500); const s = await p.evaluate(() => window.__game?.scene.getScenes(true).map(s => s.scene.key).join(',')); if (s === key) return true; } return false; };
const measure = (p) => p.evaluate(async () => { const g = window.__game; let n = 0; const f = () => n++; g.events.on('postrender', f); await new Promise(r => setTimeout(r, 3000)); g.events.off('postrender', f); return (n / 3).toFixed(1); });
export const steps = [
  async (p) => { await waitScene(p, 'Menu'); await p.click('[data-a="new"]'); await p.click('[data-v="cel"]'); await p.click('[data-a="start"]'); return 'started ' + await waitScene(p, 'Game'); },
  async (p) => { await p.waitForTimeout(2000); return 'base ' + await measure(p); },
  async (p) => { await p.evaluate(() => { document.getElementById('ui').style.display = 'none'; }); return 'no DOM ui ' + await measure(p); },
  async (p) => { await p.evaluate(() => { const sc = __game.scene.getScene('Game'); sc.children.list.filter(o => o.type === 'TileSprite').forEach(o => o.setVisible(false)); }); return 'no waves ' + await measure(p); },
  async (p) => { await p.evaluate(() => { const sc = __game.scene.getScene('Game'); sc.map.fogImg.setVisible(false); }); return 'no fog ' + await measure(p); },
  async (p) => { await p.evaluate(() => { const sc = __game.scene.getScene('Game'); sc.children.list.filter(o => o.type === 'ParticleEmitter').forEach(o => o.setVisible(false)); }); return 'no particles ' + await measure(p); },
  async (p) => { await p.evaluate(() => { const sc = __game.scene.getScene('Game'); sc.children.list.filter(o => o.type === 'Container' || o.type === 'Text').forEach(o => o.setActive(false).setVisible(false)); sc.unitViews.update = () => {}; sc.cityViews.update = () => {}; }); return 'no units/cities ' + await measure(p); },
  async (p) => { await p.evaluate(() => { const sc = __game.scene.getScene('Game'); sc.sim.state.paused = true; }); return 'paused sim ' + await measure(p); },
];
