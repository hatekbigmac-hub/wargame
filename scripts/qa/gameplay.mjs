const waitScene = async (p, key, max = 40) => { for (let i = 0; i < max; i++) { await p.waitForTimeout(500); const s = await p.evaluate(() => window.__game?.scene.getScenes(true).map(s => s.scene.key).join(',')); if (s === key) return true; } return false; };
const helpers = () => {
  window.__qa = {
    sc: () => window.__game.scene.getScene('Game'),
    toScreen(x, y) { const sc = this.sc(); const c = sc.cameras.main; return { x: (x - c.scrollX - c.width / 2) * c.zoom + c.width / 2, y: (y - c.scrollY - c.height / 2) * c.zoom + c.height / 2 }; },
    center(x, y) { const sc = this.sc(); sc.controls.centerOn(x, y, false); },
  };
};
export const steps = [
  async (p) => { await waitScene(p, 'Menu'); await p.click('[data-a="new"]'); await p.click('[data-v="euf"]'); await p.click('[data-a="start"]'); return 'started ' + await waitScene(p, 'Game'); },
  async (p) => { await p.waitForTimeout(1500); await p.evaluate(helpers); return 'helpers'; },
  // 1. Select a player tank with a real click
  async (p) => {
    const pos = await p.evaluate(() => { const sc = __qa.sc(); const s = sc.sim.state; s.paused = true; const u = [...s.units.values()].find(u => u.owner === s.player && u.type === 'medium_tank'); __qa.center(u.x, u.y); return { id: u.id, x: u.x, y: u.y }; });
    await p.waitForTimeout(400);
    const scr = await p.evaluate(({ x, y }) => __qa.toScreen(x, y), pos);
    await p.mouse.click(scr.x, scr.y);
    await p.waitForTimeout(400);
    return await p.evaluate(() => ({ sel: [...__qa.sc().selection], left: !document.querySelector('.panel-left').classList.contains('hidden') }));
  },
  async (p) => { await p.screenshot({ path: 'scripts/.out/10-select.png' }); return 'shot'; },
  // 2. Right-click to move
  async (p) => {
    const tgt = await p.evaluate(() => { const sc = __qa.sc(); const id = [...sc.selection][0]; const u = sc.sim.state.units.get(id); return __qa.toScreen(u.x + 120, u.y + 60); });
    await p.mouse.click(tgt.x, tgt.y, { button: 'right' });
    await p.evaluate(() => { __qa.sc().sim.state.paused = false; });
    await p.waitForTimeout(2500);
    return await p.evaluate(() => { const sc = __qa.sc(); const u = sc.sim.state.units.get([...sc.selection][0]); return { order: u.order?.kind, moving: u.moving, path: !!u.path }; });
  },
  // 3. Box select with shift-drag
  async (p) => {
    const r = await p.evaluate(() => { const sc = __qa.sc(); const s = sc.sim.state; const cap = s.cities.find(c => c.owner === s.player && c.capital); __qa.center(cap.x, cap.y); return { cx: cap.x, cy: cap.y }; });
    await p.waitForTimeout(300);
    const a = await p.evaluate(({ cx, cy }) => __qa.toScreen(cx - 60, cy - 60), r);
    const b = await p.evaluate(({ cx, cy }) => __qa.toScreen(cx + 60, cy + 60), r);
    await p.keyboard.down('Shift'); await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(b.x, b.y, { steps: 5 }); await p.mouse.up(); await p.keyboard.up('Shift');
    await p.waitForTimeout(300);
    return await p.evaluate(() => ({ boxSelected: __qa.sc().selection.size }));
  },
  // 4. Click capital city, open management, queue production
  async (p) => {
    const scr = await p.evaluate(() => { const sc = __qa.sc(); const s = sc.sim.state; const cap = s.cities.find(c => c.owner === s.player && c.capital); sc.clearSelection(); return __qa.toScreen(cap.x, cap.y); });
    await p.mouse.click(scr.x, scr.y); await p.waitForTimeout(300);
    const cityId = await p.evaluate(() => __qa.sc().selectedCity);
    await p.click('[data-a="openCity"]'); await p.waitForTimeout(500);
    await p.click('.city-win [data-a="produce"][data-v="infantry"]'); await p.waitForTimeout(200);
    await p.click('.city-win [data-a="build"][data-v="barracks"]'); await p.waitForTimeout(300);
    await p.screenshot({ path: 'scripts/.out/11-city.png' });
    return await p.evaluate((id) => ({ cityId: id, queue: __qa.sc().sim.state.cities[id].queue.map(q => q.id) }), cityId);
  },
  // 5. Research
  async (p) => {
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await p.keyboard.press('r'); await p.waitForTimeout(400);
    await p.click('.research-win [data-v="naval_engineering"]'); await p.waitForTimeout(300);
    await p.screenshot({ path: 'scripts/.out/12-research.png' });
    const r = await p.evaluate(() => __qa.sc().sim.state.factions.euf.research?.id);
    await p.keyboard.press('Escape');
    return { research: r };
  },
  // 6. Missile strike: spawn a launcher near an enemy city and fire via UI mode
  async (p) => {
    const info = await p.evaluate(() => {
      const sc = __qa.sc(); const s = sc.sim.state;
      s.factions.euf.techs.push('rocketry'); sc.sim.tech.recompute('euf');
      const target = s.cities.find(c => c.name === 'Istanbul');
      const u = sc.sim.units.spawn('rocket_artillery', 'euf', target.x - 500, target.y - 120);
      sc.select([u.id], false); __qa.center(target.x - 250, target.y - 60); s.paused = true;
      return { id: u.id, tx: target.x, ty: target.y };
    });
    await p.waitForTimeout(500);
    await p.keyboard.press('m'); await p.waitForTimeout(200);
    const mode = await p.evaluate(() => __qa.sc().mode);
    const scr = await p.evaluate(({ tx, ty }) => __qa.toScreen(tx, ty), info);
    await p.mouse.click(scr.x, scr.y);
    await p.evaluate(() => { __qa.sc().sim.state.paused = false; });
    await p.waitForTimeout(700);
    const proj = await p.evaluate(() => __qa.sc().sim.combat.projectiles.filter(q => q.kind === 'missile').length);
    await p.screenshot({ path: 'scripts/.out/13-missile.png' });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: 'scripts/.out/14-impact.png' });
    return { mode, missilesInFlight: proj, cityHp: await p.evaluate(() => Math.round(__qa.sc().sim.state.cities.find(c => c.name === 'Istanbul').hp)) };
  },
  // 7. Attack + capture a city (Tunis) with a strong force
  async (p) => {
    const r = await p.evaluate(() => {
      const sc = __qa.sc(); const s = sc.sim.state; const c = s.cities.find(c => c.name === 'Tunis');
      const ids = []; for (const t of ['medium_tank','medium_tank','medium_tank','artillery','infantry','infantry','infantry']) ids.push(sc.sim.units.spawn(t, 'euf', c.x + 90 + Math.random()*20, c.y - 60 + Math.random()*20).id);
      sc.select(ids, false); __qa.center(c.x, c.y); s.speed = 4; return { x: c.x, y: c.y, owner: c.owner };
    });
    await p.waitForTimeout(300);
    const scr = await p.evaluate(({ x, y }) => __qa.toScreen(x, y), r);
    await p.mouse.click(scr.x, scr.y, { button: 'right' });
    for (let i = 0; i < 40; i++) { await p.waitForTimeout(1000); const o = await p.evaluate(() => __qa.sc().sim.state.cities.find(c => c.name === 'Tunis').owner); if (o === 'euf') break; }
    await p.screenshot({ path: 'scripts/.out/15-capture.png' });
    return await p.evaluate(() => { const c = __qa.sc().sim.state.cities.find(c => c.name === 'Tunis'); return { owner: c.owner, hp: Math.round(c.hp), capture: c.capture, t: Math.round(__qa.sc().sim.state.time) }; });
  },
  // 8. Save & load
  async (p) => {
    await p.evaluate(() => { __qa.sc().sim.state.speed = 1; });
    await p.keyboard.press('F5'); await p.waitForTimeout(300);
    const before = await p.evaluate(() => ({ t: __qa.sc().sim.state.time, units: __qa.sc().sim.state.units.size, tunis: __qa.sc().sim.state.cities.find(c => c.name === 'Tunis').owner }));
    await p.keyboard.press('F9'); await p.waitForTimeout(2500);
    const after = await p.evaluate(() => ({ t: __qa.sc().sim.state.time, units: __qa.sc().sim.state.units.size, tunis: __qa.sc().sim.state.cities.find(c => c.name === 'Tunis').owner }));
    return { before, after };
  },
];
