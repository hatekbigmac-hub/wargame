const waitScene = async (p, key, max = 30) => { for (let i = 0; i < max; i++) { await p.waitForTimeout(500); const s = await p.evaluate(() => window.__game?.scene.getScenes(true).map(s => s.scene.key).join(',')); if (s === key) return true; } return false; };
export const steps = [
  async (p) => { await waitScene(p, 'Menu'); await p.waitForTimeout(800); await p.screenshot({ path: 'scripts/.out/01-menu.png' }); return 'menu'; },
  async (p) => { await p.click('[data-a="new"]'); await p.waitForTimeout(800); await p.screenshot({ path: 'scripts/.out/02-factions.png' }); return 'factions'; },
  async (p) => { await p.click('[data-v="euf"]'); await p.click('[data-a="start"]'); const ok = await waitScene(p, 'Game', 40); await p.waitForTimeout(3000); return 'game ' + ok; },
];
