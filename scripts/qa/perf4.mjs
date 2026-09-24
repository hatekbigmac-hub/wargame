const waitScene = async (p, key, max = 40) => { for (let i = 0; i < max; i++) { await p.waitForTimeout(500); const s = await p.evaluate(() => window.__game?.scene.getScenes(true).map(s => s.scene.key).join(',')); if (s === key) return true; } return false; };
const measure = (p) => p.evaluate(async () => { const g = window.__game; let n = 0; const f = () => n++; g.events.on('postrender', f); await new Promise(r => setTimeout(r, 3000)); g.events.off('postrender', f); return (n / 3).toFixed(1); });
export const steps = [
  async (p) => { await waitScene(p, 'Menu'); await p.waitForTimeout(1500); return 'menu ' + await measure(p); },
  async (p) => { await p.click('[data-a="new"]'); await p.click('[data-v="cel"]'); await p.click('[data-a="start"]'); await waitScene(p, 'Game'); await p.waitForTimeout(2000); return 'game ' + await measure(p); },
  async (p) => { await p.evaluate(() => { const sc = __game.scene.getScene('Game'); sc.map.updateFog = () => {}; sc.map.fogImg.setVisible(false); }); return 'no fog updates ' + await measure(p); },
  async (p) => { await p.evaluate(() => { const sc = __game.scene.getScene('Game'); sc.cameras.main.setZoom(0.55); sc.controls.targetZoom = 0.55; }); return 'zoom .55 ' + await measure(p); },
  async (p) => { await p.evaluate(() => { const sc = __game.scene.getScene('Game'); sc.cameras.main.setZoom(1.6); sc.controls.targetZoom = 1.6; }); return 'zoom 1.6 ' + await measure(p); },
];
