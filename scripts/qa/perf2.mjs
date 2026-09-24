const waitScene = async (p, key, max = 40) => { for (let i = 0; i < max; i++) { await p.waitForTimeout(500); const s = await p.evaluate(() => window.__game?.scene.getScenes(true).map(s => s.scene.key).join(',')); if (s === key) return true; } return false; };
export const steps = [
  async (p) => { await waitScene(p, 'Menu'); await p.click('[data-a="new"]'); await p.click('[data-v="cel"]'); await p.click('[data-a="start"]'); return 'started ' + await waitScene(p, 'Game'); },
  async (p) => {
    await p.waitForTimeout(3000);
    return await p.evaluate(async () => {
      const g = window.__game; const sc = g.scene.getScene('Game');
      let pre = 0, sum = 0, n = 0;
      g.events.on('prerender', () => { pre = performance.now(); });
      g.events.on('postrender', () => { sum += performance.now() - pre; n++; });
      await new Promise(r => setTimeout(r, 5000));
      const list = sc.children.list;
      const vis = list.filter(o => o.visible).length;
      const byType = {}; for (const o of list) if (o.visible) byType[o.type] = (byType[o.type] || 0) + 1;
      return { renderMs: (sum / Math.max(1, n)).toFixed(1), frames: n, objects: list.length, visible: vis, byType, fps: g.loop.actualFps.toFixed(1), renderer: g.renderer.type };
    });
  },
];
