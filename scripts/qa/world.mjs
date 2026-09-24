// QA: menu → country picker (search) → start as Germany → HUD, strike button, offensive, transport, diplomacy, Russian UI.
const waitScene = async (p, key, max = 40) => { for (let i = 0; i < max; i++) { await p.waitForTimeout(500); const s = await p.evaluate(() => window.__game?.scene.getScenes(true).map(s => s.scene.key).join(',')); if (s === key) return true; } return false; };
const scene = (p, fn) => p.evaluate(fn);
export const steps = [
  async (p) => { await waitScene(p, 'Menu'); await p.waitForTimeout(1200); await p.screenshot({ path: 'scripts/.out/w01-menu.png' }); return 'menu'; },
  async (p) => {
    await p.click('[data-a="new"]'); await p.waitForTimeout(600);
    await p.fill('input[data-k="q"]', 'germ'); await p.waitForTimeout(300);
    await p.click('.fitem[data-v="DEU"]'); await p.waitForTimeout(1800);
    await p.screenshot({ path: 'scripts/.out/w02-picker.png' });
    return await p.evaluate(() => document.querySelectorAll('.fitem').length + ' items');
  },
  async (p) => { await p.click('[data-a="start"]'); const ok = await waitScene(p, 'Game', 60); await p.waitForTimeout(3500); await p.screenshot({ path: 'scripts/.out/w03-game.png' }); return 'game ' + ok; },
  async (p) => {
    // Missile strike mode
    await p.click('[data-a="strike"]'); await p.waitForTimeout(600);
    await p.screenshot({ path: 'scripts/.out/w04-strike.png' });
    const txt = await p.evaluate(() => document.querySelector('[data-r="strikeTxt"]')?.textContent + ' mode=' + window.__game.scene.getScene('Game').mode);
    await p.keyboard.press('Escape');
    return txt;
  },
  async (p) => {
    // Debug: mobilisation against the player, then offensive planning with capital army
    const r = await scene(p, () => {
      const g = window.__game.scene.getScene('Game');
      g.debugCommand('mobilize');
      const s = g.sim.state;
      const land = [...s.units.values()].filter((u) => u.owner === s.player && ['infantry','medium_tank','light_tank','artillery'].includes(u.type));
      g.select(land.slice(0, 6).map((u) => u.id), false);
      // Target: nearest foreign city on the same landmass
      const cap = s.cities.find((c) => c.owner === s.player && c.capital);
      let best = null, bd = 1e9;
      for (const c of s.cities) { if (c.owner === s.player) continue; const d = Math.hypot(c.x - cap.x, c.y - cap.y); if (d < bd && g.sim.geo.landConnected(c.x, c.y, cap.x, cap.y)) { bd = d; best = c; } }
      g.beginOffensive();
      g.offensiveAt(best.x, best.y);
      g.controls.centerOn(cap.x, cap.y, false);
      return { ops: s.ops.length, target: best.name, mode: g.mode };
    });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: 'scripts/.out/w05-offensive.png' });
    return r;
  },
  async (p) => {
    // Fast-forward prep, then launch (confirm dialog)
    await scene(p, () => { const g = window.__game.scene.getScene('Game'); g.setSpeed(4); });
    await p.waitForTimeout(9000);
    const before = await scene(p, () => { const s = window.__game.scene.getScene('Game').sim.state; return s.ops.map((o) => ({ prep: o.prep.toFixed(2), units: o.units.length })); });
    await p.click('[data-a="opLaunch"]'); await p.waitForTimeout(500);
    await p.screenshot({ path: 'scripts/.out/w06-confirm.png' });
    await p.click('.confirm-win [data-a="yes"]'); await p.waitForTimeout(1500);
    const after = await scene(p, () => { const g = window.__game.scene.getScene('Game'); const s = g.sim.state; g.setSpeed(1); return { ops: s.ops.length, wars: Object.entries(s.relations).filter(([k, v]) => v === 'war' && k.includes(s.player)).map(([k]) => k) }; });
    return { before, after };
  },
  async (p) => {
    // Transport: spawn one next to Hamburg-ish port, board 3 units
    const r = await scene(p, () => {
      const g = window.__game.scene.getScene('Game');
      const s = g.sim.state;
      const port = s.cities.filter((c) => c.owner === s.player && c.port).sort((a, b) => b.size - a.size)[0];
      const tr = g.sim.units.spawn('transport', s.player, port.portX, port.portY);
      const inf = [g.sim.units.spawn('infantry', s.player, port.x, port.y), g.sim.units.spawn('medium_tank', s.player, port.x + 6, port.y), g.sim.units.spawn('artillery', s.player, port.x, port.y + 6)];
      g.select(inf.map((u) => u.id), false);
      g.commandAt(tr.x, tr.y, false);
      g.controls.centerOn(port.x, port.y, false);
      window.__tr = tr.id;
      return { port: port.name, tr: tr.id };
    });
    await p.waitForTimeout(6000);
    const res = await scene(p, () => { const g = window.__game.scene.getScene('Game'); const tr = g.sim.state.units.get(window.__tr); g.select([tr.id], false); return { cargo: tr.cargo?.length ?? 0 }; });
    await p.waitForTimeout(500);
    await p.screenshot({ path: 'scripts/.out/w07-transport.png' });
    return { ...r, ...res };
  },
  async (p) => { await p.click('[data-a="factions"]'); await p.waitForTimeout(800); await p.screenshot({ path: 'scripts/.out/w08-diplomacy.png' }); await p.keyboard.press('Escape'); return 'diplomacy'; },
  async (p) => {
    await scene(p, () => { window.__game.scene.getScene('Game').ui.openPause(); });
    await p.waitForTimeout(300);
    await p.click('[data-a="settings"]'); await p.waitForTimeout(300);
    await p.click('[data-a="lang"][data-v="ru"]'); await p.waitForTimeout(400);
    await p.screenshot({ path: 'scripts/.out/w09-settings-ru.png' });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await scene(p, () => { const g = window.__game.scene.getScene('Game'); g.ui.closeWindow(); g.sim.state.paused = false; g.controls.targetZoom = 0.45; });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: 'scripts/.out/w10-game-ru.png' });
    return 'ru';
  },
];
steps.push(async (p) => {
  // Open every window in Russian and collect keys without translation.
  await scene(p, () => {
    const g = window.__game.scene.getScene('Game');
    const s = g.sim.state;
    const cap = s.cities.find((c) => c.owner === s.player && c.capital);
    g.ui.openResearch(); g.ui.closeWindow();
    g.ui.openMarket(); g.ui.closeWindow();
    g.ui.openCity(cap.id);
  });
  await p.waitForTimeout(600);
  await p.screenshot({ path: 'scripts/.out/w11-city-ru.png' });
  await scene(p, () => { const g = window.__game.scene.getScene('Game'); g.ui.closeWindow(); g.ui.openFactions(); });
  await p.waitForTimeout(600);
  await p.screenshot({ path: 'scripts/.out/w12-diplo-ru.png' });
  await scene(p, () => { const g = window.__game.scene.getScene('Game'); g.ui.closeWindow(); g.ui.openHelp(); });
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'scripts/.out/w13-help-ru.png' });
  await scene(p, () => { const g = window.__game.scene.getScene('Game'); g.ui.closeWindow(); const s = g.sim.state; g.select([...s.units.values()].filter((u) => u.owner === s.player).slice(0, 4).map((u) => u.id), false); });
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'scripts/.out/w14-units-ru.png' });
  return await p.evaluate(() => [...(globalThis.__i18nMissing ?? [])]);
});
