// Main gameplay scene: wires the simulation to rendering, input, audio and UI.
import Phaser from 'phaser';
import { App } from '../app';
import { Sim } from '../core/Simulation';
import type { Difficulty, FactionId, GameState, Unit } from '../core/types';
import { MapRenderer } from '../map/MapRenderer';
import { UnitViews } from '../units/UnitViews';
import { CityViews } from '../cities/CityViews';
import { Effects } from '../effects/Effects';
import { InputController, type InputMode } from '../input/InputController';
import { GameUI } from '../ui/GameUI';
import { Settings } from '../core/Settings';
import { applyAudioSettings } from '../ui/Dialogs';
import { atWar } from '../core/GameState';
import { unitDef } from '../data/units';
import { BUILDING_MAP } from '../data/buildings';
import { saveToSlot, loadFromSlot } from '../save/SaveSystem';
import { colorCss, esc } from '../ui/dom';
import { NEUTRAL_ID, factionName } from '../data/factions';
import { CountryLabels } from '../map/CountryLabels';
import { CITY_MISSILE_RANGE } from '../combat/CombatSystem';
import { createOp, launchOp, cancelOp, needsDeclaration, STAGE_RADIUS } from '../military/Offensives';
import { worldToCell } from '../config';
import { t, tn } from '../i18n';
import type { City } from '../core/types';

/** A ready missile launcher: a unit or a city battery. */
export interface Launcher {
  unit?: Unit;
  city?: City;
  x: number;
  y: number;
  range: number;
}

export interface GameSceneData {
  faction?: FactionId;
  difficulty?: Difficulty;
  load?: { state: GameState };
}

export class GameScene extends Phaser.Scene {
  sim!: Sim;
  map!: MapRenderer;
  unitViews!: UnitViews;
  cityViews!: CityViews;
  effects!: Effects;
  controls!: InputController;
  ui!: GameUI;
  selection = new Set<number>();
  selectedCity = -1;
  mode: InputMode = 'normal';
  private overlay!: Phaser.GameObjects.Graphics;
  private labels!: CountryLabels;
  private fogT = 0;
  private hoverT = 0;
  private autosaveT = 180;
  private victoryDisabled = false;
  private lastSelKey = '';
  /** Per-section frame timings (ms, smoothed) for the debug overlay. */
  prof: Record<string, number> = {};
  private mark(name: string, t0: number): number {
    const t = performance.now();
    this.prof[name] = (this.prof[name] ?? 0) * 0.9 + (t - t0) * 0.1;
    return t;
  }

  constructor() {
    super('Game');
  }

  create(data: GameSceneData): void {
    const geo = App.geo!;
    this.selection = new Set();
    this.selectedCity = -1;
    this.mode = 'normal';
    this.victoryDisabled = false;
    if (data.load) this.sim = new Sim(geo, data.load.state);
    else this.sim = Sim.newGame(geo, data.faction ?? 'USA', data.difficulty ?? Settings.data.difficulty);
    const sim = this.sim;
    this.map = new MapRenderer(this, geo, () => sim.state.cities.map((c) => c.owner), () => sim.state.cities);
    this.map.create();
    this.map.createFog();
    this.cityViews = new CityViews(this, sim);
    this.unitViews = new UnitViews(this, sim);
    this.effects = new Effects(this, sim, this.unitViews, App.audio);
    this.overlay = this.add.graphics().setDepth(15);
    this.labels = new CountryLabels(this, geo, (id) => sim.state.factions[id]?.alive ?? false);
    this.controls = new InputController(this);
    this.ui = new GameUI(this);
    this.wireEvents();
    this.cameras.main.setBackgroundColor('#071526');
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
      this.ui.destroy();
      this.sim.bus.clear();
    });
    this.onResize();
    this.controls.targetZoom = 0.95;
    this.cameras.main.setZoom(0.95);
    this.centerOnCapital(false);
    applyAudioSettings();
    App.audio.startMusic('game');
    const f = sim.state.factions[sim.state.player];
    if (!data.load) {
      this.ui.banner(factionName(f.id).toUpperCase(), t('THE WORLD IS AT PEACE — FOR NOW'), colorCss(f.color));
      sim.log(t('{name} high command established. Good luck, Commander.', { name: factionName(f.id) }), 'info');
      this.time.delayedCall(3500, () => this.ui.toast(t('Tip: press the Missile Strike button (top bar) or M to launch missiles; open the Field Manual (F1) for transports and offensives'), 'info'));
    } else this.ui.toast(t('Campaign loaded'), 'good');
    this.time.delayedCall(9000, () => {
      const pf = this.sim.state.factions[this.sim.state.player];
      if (!pf.research) this.ui.toast(t('Your scientists await orders — open Research (R) to choose a technology'), 'info');
    });
  }

  private onResize(): void {
    this.cameras.main.setSize(this.scale.width, this.scale.height);
    this.controls.updateLimits();
  }

  private wireEvents(): void {
    const bus = this.sim.bus;
    const s = this.sim.state;
    bus.on('cityCaptured', ({ city, to, from }) => {
      this.map.markDirty();
      if (this.selectedCity === city.id && to !== s.player) this.ui.closeWindow();
      if (city.capital && (to === s.player || from === s.player)) {
        this.ui.banner(to === s.player ? t('CAPITAL SEIZED') : t('CAPITAL LOST'), tn(city).toUpperCase(), to === s.player ? '#ffd27a' : '#ff5a4f');
      }
    });
    bus.on('notify', ({ text, kind, x, y }) => {
      this.ui.toast(text, kind, x, y);
      if (kind === 'warn') App.audio.play('alert', { volume: 0.6 });
    });
    bus.on('researchComplete', ({ faction }) => faction === s.player && App.audio.play('research'));
    bus.on('productionComplete', ({ city, item }) => {
      if (city.owner === s.player) App.audio.play('build', { volume: 0.5 });
      if (item.kind === 'building' && city.owner === s.player && item.id === 'missile_battery') this.ui.toast(t('{city}: missile battery online', { city: tn(city) }), 'good');
    });
    bus.on('factionEliminated', ({ faction }) => {
      if (faction !== NEUTRAL_ID) this.ui.banner(t('COUNTRY ELIMINATED'), factionName(faction).toUpperCase(), colorCss(s.factions[faction].color));
      this.map.markDirty();
    });
    bus.on('gameOver', ({ playerWon }) => {
      if (playerWon && this.victoryDisabled) {
        s.gameOver = null;
        return;
      }
      this.ui.showGameOver(playerWon);
    });
    bus.on('unitRemoved', ({ unit }) => {
      if (this.selection.delete(unit.id)) this.ui.onSelectionChanged();
    });
    bus.on('warDeclared', ({ attacker, defender }) => {
      this.map.markDirty();
      if (defender === s.player) {
        this.ui.banner(t('WAR DECLARED'), t('{name} ATTACKS', { name: factionName(attacker).toUpperCase() }), '#ff5a4f');
        App.audio.play('alert');
      } else if (attacker === s.player) {
        this.ui.banner(t('WAR DECLARED'), factionName(defender).toUpperCase(), '#ff9a5a');
      }
    });
    bus.on('peaceSigned', ({ a, b }) => {
      if (a === s.player || b === s.player) this.ui.banner(t('CEASEFIRE'), factionName(a === s.player ? b : a).toUpperCase(), '#7de08f');
    });
    bus.on('mobilization', ({ target }) => {
      if (target === s.player) App.audio.play('alert');
    });
  }

  // ------------------------------------------------------------------ frame

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 250) / 1000;
    const s = this.sim.state;
    let t0 = performance.now();
    this.controls.update(dt);
    if (!s.paused && !s.gameOver) {
      try {
        this.sim.advance(dt * s.speed);
      } catch (err) {
        console.error('[Sim] step failed', err);
      }
    }
    t0 = this.mark('sim', t0);
    const cam = this.cameras.main;
    const lod = Phaser.Math.Clamp(Math.pow(0.85 / cam.zoom, 0.75), 1, 2.4);
    this.unitViews.lod = lod;
    this.cityViews.lod = Phaser.Math.Clamp(Math.pow(0.8 / cam.zoom, 0.8), 0.9, 2.6);
    this.cityViews.zoom = cam.zoom;
    this.effects.lod = lod;
    this.effects.zoom = cam.zoom;
    this.effects.shake = Settings.data.screenShake;
    this.effects.damageNumbers = Settings.data.damageNumbers;
    const view = cam.worldView;
    this.map.update(time);
    t0 = this.mark('map', t0);
    this.fogT -= dt;
    if (this.fogT <= 0) {
      this.fogT = 0.3;
      const combat = this.sim.combat;
      const player = s.player;
      this.map.updateFog((c) => combat.cellVisible(player, c), Settings.data.fog && !this.unitViews.reveal);
    }
    t0 = this.mark('fog', t0);
    this.unitViews.update(dt, view);
    t0 = this.mark('units', t0);
    this.cityViews.update(dt, time, view);
    t0 = this.mark('cities', t0);
    this.effects.update(dt, view, time);
    t0 = this.mark('fx', t0);
    this.drawOverlay(time);
    this.labels.update(cam.zoom, view);
    App.audio.listener = { x: view.centerX, y: view.centerY, w: view.width, h: view.height };
    this.ui.update(dt);
    this.mark('ui', t0);
    // Autosave
    if (Settings.data.autosave && !s.gameOver) {
      this.autosaveT -= dt;
      if (this.autosaveT <= 0) {
        this.autosaveT = 180;
        if (saveToSlot(s, 'auto')) this.sim.log(t('Autosaved'), 'info');
      }
    }
    const key = [...this.selection].join(',');
    if (key !== this.lastSelKey) {
      this.lastSelKey = key;
      this.ui.onSelectionChanged();
    }
  }

  /** Paths & targets of selected units, missile range rings, attack lines. */
  private drawOverlay(time: number): void {
    const g = this.overlay;
    g.clear();
    const zoom = this.cameras.main.zoom;
    const lw = 1.6 / zoom;
    const s = this.sim.state;
    let n = 0;
    for (const id of this.selection) {
      const u = s.units.get(id);
      if (!u || u.owner !== s.player) continue;
      if (++n > 40) break;
      if (u.path && u.pathIdx * 2 < u.path.length) {
        const attack = u.order?.kind === 'attack' || u.order?.kind === 'attackMove';
        g.lineStyle(lw, attack ? 0xff7a5a : 0x7dffa0, 0.55);
        g.beginPath();
        g.moveTo(u.x, u.y);
        for (let i = u.pathIdx * 2; i < u.path.length; i += 2) g.lineTo(u.path[i], u.path[i + 1]);
        g.strokePath();
        const ex = u.path[u.path.length - 2];
        const ey = u.path[u.path.length - 1];
        g.fillStyle(attack ? 0xff7a5a : 0x7dffa0, 0.8).fillCircle(ex, ey, 3 / zoom + 1);
      }
      const tu = u.targetUnit >= 0 ? s.units.get(u.targetUnit) : undefined;
      if (tu && this.unitViews.isVisibleToPlayer(tu)) {
        g.lineStyle(lw, 0xff4d3d, 0.45);
        g.lineBetween(u.x, u.y, tu.x, tu.y);
      }
      if (this.mode === 'missile' && unitDef(u.type).missiles) {
        const r = unitDef(u.type).missileRange ?? 0;
        g.lineStyle(2 / zoom, 0xff9a6a, 0.5 + Math.sin(time * 0.006) * 0.2);
        g.strokeCircle(u.x, u.y, r);
      }
    }
    if (this.mode === 'cityMissile' && this.selectedCity >= 0) {
      const c = s.cities[this.selectedCity];
      g.lineStyle(2 / zoom, 0xff9a6a, 0.6);
      g.strokeCircle(c.x, c.y, CITY_MISSILE_RANGE);
    }
    const pulse = 0.55 + Math.sin(time * 0.005) * 0.25;
    if (this.mode === 'strike') {
      for (const l of this.readyLaunchers()) {
        g.lineStyle(2 / zoom, 0xff9a6a, pulse * 0.8);
        g.strokeCircle(l.x, l.y, l.range);
        g.fillStyle(0xff9a6a, 0.9).fillCircle(l.x, l.y, 5 / zoom + 2);
      }
    }
    if (this.mode === 'board') {
      for (const u of s.units.values()) {
        if (u.owner !== s.player || !unitDef(u.type).capacity) continue;
        g.lineStyle(2.5 / zoom, 0x7dffa0, pulse);
        g.strokeCircle(u.x, u.y, 26 + 6 / zoom);
      }
    }
    // Player offensives: staging area, preparation ring and attack arrow.
    for (const op of s.ops) {
      const c = s.cities[op.targetCity];
      if (!c) continue;
      const ready = op.prep >= 1;
      const col = ready ? 0x7dffa0 : 0xffd27a;
      g.lineStyle(2 / zoom, col, 0.35).strokeCircle(op.stageX, op.stageY, STAGE_RADIUS);
      g.lineStyle(5 / zoom, 0x000000, 0.35).strokeCircle(op.stageX, op.stageY, STAGE_RADIUS + 8 / zoom);
      g.lineStyle(4 / zoom, col, 0.95);
      g.beginPath();
      g.arc(op.stageX, op.stageY, STAGE_RADIUS + 8 / zoom, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.01, op.prep));
      g.strokePath();
      this.arrow(g, op.stageX, op.stageY, c.x, c.y, col, zoom, 0.8);
    }
    // Enemy mobilisation against the player: pulsing red arrows.
    for (const f of s.factionOrder) {
      const w = s.ai[f]?.war;
      if (!w || w.target !== s.player || w.phase !== 'mobilize') continue;
      const a = s.cities[w.stageCity];
      const b = s.cities[w.targetCity];
      if (!a || !b) continue;
      g.lineStyle(3 / zoom, 0xff4d3d, pulse * 0.6).strokeCircle(a.x, a.y, 120);
      this.arrow(g, a.x, a.y, b.x, b.y, 0xff4d3d, zoom, pulse);
    }
  }

  private arrow(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, color: number, zoom: number, alpha: number): void {
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 20) return;
    const ux = (x1 - x0) / d;
    const uy = (y1 - y0) / d;
    const ex = x1 - ux * 34;
    const ey = y1 - uy * 34;
    const w = Math.max(3, 6 / zoom);
    // Curved shaft
    const mx = (x0 + ex) / 2 - uy * d * 0.12;
    const my = (y0 + ey) / 2 + ux * d * 0.12;
    const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(x0, y0), new Phaser.Math.Vector2(mx, my), new Phaser.Math.Vector2(ex, ey));
    const pts = curve.getPoints(24);
    g.lineStyle(w + 3 / zoom, 0x000000, alpha * 0.4).strokePoints(pts, false);
    g.lineStyle(w, color, alpha).strokePoints(pts, false);
    const last = pts[pts.length - 2];
    const ax = ex - last.x;
    const ay = ey - last.y;
    const al = Math.hypot(ax, ay) || 1;
    const hx = ax / al;
    const hy = ay / al;
    const hs = Math.max(14, 18 / zoom);
    g.fillStyle(color, alpha);
    g.fillTriangle(ex + hx * hs, ey + hy * hs, ex - hy * hs * 0.6, ey + hx * hs * 0.6, ex + hy * hs * 0.6, ey - hx * hs * 0.6);
  }

  // ------------------------------------------------------------------ selection

  select(ids: number[], additive: boolean): void {
    if (!additive) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    if (this.selection.size) {
      this.selectedCity = -1;
      this.cityViews.selected = -1;
    }
    this.unitViews.selected = this.selection;
    if (this.mode === 'cityMissile') this.setMode('normal');
    this.ui.onSelectionChanged();
  }

  selectCity(id: number): void {
    this.selection.clear();
    this.selectedCity = id;
    this.cityViews.selected = id;
    this.ui.onSelectionChanged();
  }

  clearSelection(): void {
    this.selection.clear();
    this.selectedCity = -1;
    this.cityViews.selected = -1;
    this.setMode('normal');
    this.ui.onSelectionChanged();
  }

  /** Returns picked unit id (or -1). */
  clickSelect(x: number, y: number, shift: boolean): number {
    let u = this.unitViews.pick(x, y);
    const c = this.cityViews.pick(x, y);
    // The inner city disc wins over units parked on top of it.
    if (u && c && Math.hypot(c.x - x, c.y - y) < Math.hypot(u.x - x, u.y - y) + 4 * this.cityViews.lod) u = null;
    if (u) {
      App.audio.play('select', { volume: 0.7 });
      if (shift && u.owner === this.sim.state.player) {
        if (this.selection.has(u.id)) {
          this.selection.delete(u.id);
          this.ui.onSelectionChanged();
        } else this.select([u.id], true);
      } else this.select([u.id], false);
      return u.id;
    }
    if (c) {
      App.audio.play('select', { volume: 0.6 });
      this.selectCity(c.id);
      return -1;
    }
    if (!shift) this.clearSelection();
    return -1;
  }

  boxSelect(x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
    const p = this.sim.state.player;
    const ids: number[] = [];
    for (const u of this.sim.state.units.values()) {
      if (u.owner === p && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1) ids.push(u.id);
    }
    if (ids.length) {
      this.select(ids, additive);
      App.audio.play('select');
    } else if (!additive) this.clearSelection();
  }

  selectSameType(id: number): void {
    const u = this.sim.state.units.get(id);
    if (!u || u.owner !== this.sim.state.player) return;
    const view = this.cameras.main.worldView;
    const ids: number[] = [];
    for (const o of this.sim.state.units.values()) {
      if (o.owner === u.owner && o.type === u.type && view.contains(o.x, o.y)) ids.push(o.id);
    }
    this.select(ids, false);
  }

  selectGarrison(cityId: number): void {
    const c = this.sim.state.cities[cityId];
    if (!c) return;
    const ids: number[] = [];
    this.sim.spatial.forEachInRange(c.x, c.y, 90, (u) => { if (u.owner === this.sim.state.player) ids.push(u.id); });
    if (ids.length) this.select(ids, false);
    else this.ui.toast(t('No friendly units in this city'), 'warn');
  }

  private ownSelected(): Unit[] {
    const out: Unit[] = [];
    for (const id of this.selection) {
      const u = this.sim.state.units.get(id);
      if (u && u.owner === this.sim.state.player) out.push(u);
    }
    return out;
  }

  clearHover(): void {
    if (this.unitViews.hovered === -1 && this.cityViews.hovered === -1) return;
    this.unitViews.hovered = -1;
    this.cityViews.hovered = -1;
    this.ui.setWorldTip(null, 0, 0);
  }

  hoverAt(x: number, y: number, sx: number, sy: number): void {
    this.hoverT -= this.game.loop.delta / 1000;
    if (this.hoverT > 0) return;
    this.hoverT = 0.08;
    const s = this.sim.state;
    const u = this.unitViews.pick(x, y);
    this.unitViews.hovered = u ? u.id : -1;
    const c = u ? null : this.cityViews.pick(x, y);
    this.cityViews.hovered = c ? c.id : -1;
    if (this.ui.modalOpen) {
      this.ui.setWorldTip(null, 0, 0);
      return;
    }
    const rel = (owner: string) =>
      owner === s.player ? '' : atWar(s, s.player, owner) ? `<span class="bad">${t('At war')}</span>` : `<span class="good">${t('At peace')}</span>`;
    if (u) {
      const f = s.factions[u.owner];
      const def = unitDef(u.type);
      const enemy = atWar(s, s.player, u.owner) && u.owner !== s.player;
      const own = u.owner === s.player;
      const cargo = u.cargo?.length ? `<br/>${t('Aboard: {n}/{max}', { n: u.cargo.length, max: def.capacity ?? 0 })}` : '';
      const boardHint = own && def.capacity && this.ownSelected().some((l) => this.sim.units.canCarry(u, l)) ? `<br/><span class="good">${t('Right-click to board this transport')}</span>` : '';
      const fuel = def.domain === 'air' && own && u.fuel !== undefined ? `<br/>${t('Fuel')} ${u.fuel.toFixed(1)}/${this.sim.units.endurance(u).toFixed(0)}${t('h')}${u.landed ? ` · ${t('Parked at airfield')}` : ''}` : '';
      this.ui.setWorldTip(`<b>${t(def.name)}</b> <span style="color:${colorCss(f.color)}">■ ${esc(factionName(u.owner))}</span> ${rel(u.owner)}<br/>${t('HP')} ${Math.ceil(u.hp)}/${Math.round(u.maxHp)}${u.rank ? ` · ${'★'.repeat(u.rank)}` : ''}${fuel}${cargo}${boardHint}${enemy && this.selection.size ? `<br/><span class="bad">${t('Right-click to attack')}</span>` : ''}`, sx, sy);
    } else if (c) {
      const f = s.factions[c.owner];
      const enemy = atWar(s, s.player, c.owner) && c.owner !== s.player;
      const origin = c.origOwner !== c.owner ? `<br/><span class="muted">${t('Originally {name}', { name: esc(factionName(c.origOwner)) })}</span>` : '';
      this.ui.setWorldTip(`<b>${esc(tn(c))}</b> <span style="color:${colorCss(f?.color ?? 0x999999)}">■ ${esc(factionName(c.owner))}</span> ${rel(c.owner)}${origin}<br/>${t('Defences')} ${Math.ceil(c.hp)}/${Math.round(c.maxHp)}${c.capture > 0 ? ` · ${t('capture')} ${Math.floor(c.capture * 100)}%` : ''}${enemy && this.selection.size ? `<br/><span class="bad">${t('Right-click to assault')}</span>` : ''}`, sx, sy);
    } else this.ui.setWorldTip(null, 0, 0);
  }

  // ------------------------------------------------------------------ commands

  setMode(m: InputMode): void {
    if (m !== 'normal' && this.ui) this.ui.closeWindow();
    this.mode = m;
    this.input.setDefaultCursor(m === 'normal' ? 'default' : 'crosshair');
  }

  private marker(x: number, y: number, color: number): void {
    const img = this.add.image(x, y, 'fx_ring').setTint(color).setDepth(16).setScale(0.35 / this.cameras.main.zoom).setAlpha(0.9);
    this.tweens.add({ targets: img, scale: 0.05 / this.cameras.main.zoom, alpha: 0, duration: 450, onComplete: () => img.destroy() });
  }

  private hasSelectedLand(): boolean {
    return this.ownSelected().some((u) => unitDef(u.type).domain === 'land');
  }

  commandAt(x: number, y: number, attackMove: boolean): void {
    const units = this.ownSelected();
    if (!units.length) return;
    const s = this.sim.state;
    const land = units.filter((u) => unitDef(u.type).domain === 'land');
    // Right-click on one of our transports with land units selected: board it.
    const ownTransport = this.unitViews.pick(x, y, (u) => u.owner === s.player && !!unitDef(u.type).capacity && !this.selection.has(u.id));
    if (ownTransport && land.some((l) => this.sim.units.canCarry(ownTransport, l))) {
      this.doBoard(land, ownTransport);
      return;
    }
    const enemy = this.unitViews.pick(x, y, (u) => u.owner !== s.player && atWar(s, s.player, u.owner));
    if (enemy) {
      this.sim.units.orderAttackUnit(units, enemy);
      this.marker(enemy.x, enemy.y, 0xff4d3d);
      App.audio.play('attack');
      return;
    }
    const city = this.cityViews.pick(x, y);
    if (city && city.owner !== s.player && atWar(s, s.player, city.owner)) {
      const loaded = units.filter((u) => u.cargo?.length);
      for (const tr of loaded) this.sim.units.orderUnload(tr, city.x, city.y);
      this.sim.units.orderAttackCity(units.filter((u) => !loaded.includes(u)), city);
      this.marker(city.x, city.y, 0xff4d3d);
      App.audio.play('attack');
      return;
    }
    if (city && city.owner !== s.player && city.owner !== NEUTRAL_ID) {
      this.ui.toast(t('{name} is at peace with you. Use Prepare Offensive (O) or declare war in Diplomacy to attack.', { name: factionName(city.owner) }), 'info');
    }
    const tx = city ? city.x : x;
    const ty = city ? city.y : y;
    // Loaded transports ordered onto land: sail to that coast and put the troops ashore.
    const loaded = units.filter((u) => u.cargo?.length);
    if (loaded.length && this.sim.geo.isLandPassable(worldToCell(tx, ty))) {
      for (const tr of loaded) this.sim.units.orderUnload(tr, tx, ty);
      const rest = units.filter((u) => !loaded.includes(u));
      if (rest.length) this.sim.units.orderMove(rest, tx, ty, attackMove);
      this.marker(tx, ty, 0x7dd8ff);
      this.ui.toast(t('Transport sailing to the coast to land its troops'), 'info');
      App.audio.play('move');
      return;
    }
    this.sim.units.orderMove(units, tx, ty, attackMove);
    this.marker(tx, ty, attackMove ? 0xffa040 : 0x6bff8f);
    App.audio.play('move');
  }

  // ------------------------------------------------------------------ transports

  beginBoard(): void {
    if (!this.hasSelectedLand()) {
      this.ui.toast(t('Select land units first (infantry, tanks, artillery), then click a Transport Ship'), 'warn');
      App.audio.play('error');
      return;
    }
    this.setMode('board');
  }

  boardAt(x: number, y: number): void {
    const s = this.sim.state;
    const tr = this.unitViews.pick(x, y, (u) => u.owner === s.player && !!unitDef(u.type).capacity);
    if (!tr) {
      this.ui.toast(t('Click one of your Transport Ships'), 'warn');
      App.audio.play('error');
      return;
    }
    this.doBoard(this.ownSelected().filter((u) => unitDef(u.type).domain === 'land'), tr);
    this.setMode('normal');
  }

  private doBoard(units: Unit[], tr: Unit): void {
    const s = this.sim.state;
    const land = units.filter((u) => this.sim.units.canCarry(tr, u));
    if (!land.length) {
      this.ui.toast(t('Helicopters can only carry infantry'), 'warn');
      App.audio.play('error');
      return;
    }
    const cap = unitDef(tr.type).capacity ?? 0;
    let pending = 0;
    for (const u of s.units.values()) if (u.order?.kind === 'board' && u.order.targetUnit === tr.id && !land.includes(u)) pending++;
    const free = cap - (tr.cargo?.length ?? 0) - pending;
    if (free <= 0) {
      this.ui.toast(t('Transport is full'), 'warn');
      App.audio.play('error');
      return;
    }
    const sorted = [...land].sort((a, b) => Math.hypot(a.x - tr.x, a.y - tr.y) - Math.hypot(b.x - tr.x, b.y - tr.y));
    const go = sorted.slice(0, free);
    this.sim.units.orderBoard(go, tr);
    this.marker(tr.x, tr.y, 0x7dffa0);
    App.audio.play('move');
    this.ui.toast(
      t('{n} units heading to the transport ({free} free places)', { n: go.length, free }) + (land.length > free ? ` — ${t('{k} do not fit', { k: land.length - free })}` : ''),
      'info',
    );
  }

  beginUnload(): void {
    const loaded = this.ownSelected().filter((u) => u.cargo?.length);
    if (!loaded.length) {
      this.ui.toast(t('Select a loaded Transport Ship'), 'warn');
      App.audio.play('error');
      return;
    }
    this.setMode('unload');
  }

  unloadAt(x: number, y: number): void {
    const loaded = this.ownSelected().filter((u) => u.cargo?.length);
    const geo = this.sim.geo;
    if (!geo.isLandPassable(worldToCell(x, y)) && geo.nearestCell(x, y, 2, (c) => geo.land[c] === 1) < 0) {
      this.ui.toast(t('Click on land near the coast to unload'), 'warn');
      App.audio.play('error');
      return;
    }
    for (const tr of loaded) this.sim.units.orderUnload(tr, x, y);
    this.marker(x, y, 0x7dd8ff);
    App.audio.play('move');
    this.setMode('normal');
  }

  /** Put the troops ashore right where the transport is (must be next to land). */
  unloadHere(): void {
    const loaded = this.ownSelected().filter((u) => u.cargo?.length);
    let n = 0;
    for (const tr of loaded) n += this.sim.units.unloadNow(tr);
    if (n) {
      this.ui.toast(t('{n} units landed', { n }), 'good');
      App.audio.play('move');
    } else {
      this.ui.toast(t('No beach here — move the transport next to land'), 'warn');
      App.audio.play('error');
    }
  }

  // ------------------------------------------------------------------ offensives

  beginOffensive(): void {
    if (!this.hasSelectedLand()) {
      this.ui.toast(t('Select land units to prepare an offensive'), 'warn');
      App.audio.play('error');
      return;
    }
    this.setMode('offensive');
  }

  offensiveAt(x: number, y: number): void {
    const s = this.sim.state;
    const city = this.cityViews.pick(x, y);
    if (!city || city.owner === s.player) {
      this.ui.toast(t('Click a foreign city to set the offensive target'), 'warn');
      App.audio.play('error');
      return;
    }
    const r = createOp(this.sim, this.ownSelected(), city);
    if ('error' in r) {
      this.ui.toast(r.error, 'warn');
      App.audio.play('error');
      return;
    }
    this.setMode('normal');
    this.marker(r.stageX, r.stageY, 0xffd27a);
    App.audio.play('move');
    this.ui.toast(t('Offensive on {city} planned — troops are moving to the staging area. Preparation builds up to +25% attack over 24h.', { city: tn(city) }), 'good');
    this.ui.onSelectionChanged();
  }

  launchOperation(id: number): void {
    const s = this.sim.state;
    const op = s.ops.find((o) => o.id === id);
    if (!op) return;
    const enemy = needsDeclaration(this.sim, op);
    const go = () => {
      const r = launchOp(this.sim, id);
      this.ui.toast(r.msg, r.ok ? 'good' : 'warn');
      if (r.ok) {
        App.audio.play('attack');
        const c = s.cities[op.targetCity];
        if (c) this.marker(c.x, c.y, 0xff4d3d);
      } else App.audio.play('error');
    };
    if (enemy) {
      this.ui.confirm(
        t('Declare war?'),
        t('Launching this offensive means declaring <b>war on {name}</b>. Their allies are not involved, but they will fight back with everything they have.', { name: esc(factionName(enemy)) }),
        t('Declare war & attack'),
        go,
      );
    } else go();
  }

  cancelOperation(id: number): void {
    cancelOp(this.sim, id);
    App.audio.play('click');
  }

  // ------------------------------------------------------------------ missiles

  /** All of the player's missile launchers that can fire right now. */
  readyLaunchers(): Launcher[] {
    const s = this.sim.state;
    const out: Launcher[] = [];
    for (const u of s.units.values()) {
      if (u.owner === s.player && this.sim.combat.canLaunch(u)) out.push({ unit: u, x: u.x, y: u.y, range: this.sim.combat.missileRangeOf(u) });
    }
    for (const c of s.cities) {
      if (c.owner === s.player && (c.buildings.missile_battery ?? 0) > 0 && c.missiles >= 1 && c.missileCd <= 0) out.push({ city: c, x: c.x, y: c.y, range: CITY_MISSILE_RANGE });
    }
    return out;
  }

  /** M / missile buttons: fire from the selection if it can, otherwise use any launcher. */
  beginMissile(): void {
    if (this.selectedCity >= 0) {
      const c = this.sim.state.cities[this.selectedCity];
      if (c.owner === this.sim.state.player && (c.buildings.missile_battery ?? 0) > 0 && c.missiles >= 1) {
        this.setMode('cityMissile');
        return;
      }
    }
    if (this.ownSelected().some((u) => this.sim.combat.canLaunch(u))) {
      this.setMode('missile');
      return;
    }
    this.beginStrike();
  }

  /** Global missile strike: the nearest ready launcher in range fires. */
  beginStrike(): void {
    if (!this.readyLaunchers().length) {
      this.ui.toast(t('No missiles ready. Missiles reload over time; build a Missile Battery in a city, or Missile Launchers (Rocketry) and Missile Ships (Naval Missiles).'), 'warn');
      App.audio.play('error');
      return;
    }
    this.setMode('strike');
  }

  missileAt(x: number, y: number, keep = false): void {
    const s = this.sim.state;
    const unit = this.unitViews.pick(x, y, (u) => u.owner !== s.player && this.sim.combat.canSee(s.player, u));
    const city = unit ? null : this.cityViews.pick(x, y);
    const owner = unit?.owner ?? (city && city.owner !== s.player ? city.owner : null);
    if (!owner) {
      this.ui.toast(t('Click an enemy unit or city as the missile target'), 'warn');
      App.audio.play('error');
      return;
    }
    if (!atWar(s, s.player, owner)) {
      this.ui.toast(t('You are not at war with {name}. Declare war in Diplomacy first.', { name: factionName(owner) }), 'warn');
      App.audio.play('error');
      return;
    }
    if (unit && unitDef(unit.type).domain === 'air' && !unit.landed) {
      this.ui.toast(t('Missiles cannot hit aircraft in flight — use fighters or anti-air'), 'warn');
      App.audio.play('error');
      return;
    }
    const target = unit ? { unit } : { city: city! };
    const tx = unit ? unit.x : city!.x;
    const ty = unit ? unit.y : city!.y;
    let ok = false;
    if (this.mode === 'cityMissile') {
      const c = s.cities[this.selectedCity];
      ok = !!c && this.sim.combat.launchCityMissile(c, target);
      if (!ok) this.ui.toast(t('Target out of range ({r}) or battery reloading', { r: CITY_MISSILE_RANGE }), 'warn');
    } else {
      const pool: Launcher[] =
        this.mode === 'missile'
          ? this.ownSelected().filter((u) => this.sim.combat.canLaunch(u)).map((u) => ({ unit: u, x: u.x, y: u.y, range: this.sim.combat.missileRangeOf(u) }))
          : this.readyLaunchers();
      const inRange = pool.filter((l) => Math.hypot(l.x - tx, l.y - ty) <= l.range).sort((a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty));
      for (const l of inRange) {
        ok = l.unit ? this.sim.combat.launchMissile(l.unit, target) : this.sim.combat.launchCityMissile(l.city!, target);
        if (ok) {
          const from = l.unit ? t(unitDef(l.unit.type).name) : tn(l.city!);
          this.sim.log(t('Missile launched from {from}', { from }), 'combat', tx, ty);
          break;
        }
      }
      if (!ok) this.ui.toast(inRange.length ? t('Target not visible to your launchers') : t('Out of range of all ready launchers — move a launcher closer'), 'warn');
    }
    if (ok) this.marker(tx, ty, 0xff9a6a);
    else App.audio.play('error');
    const more = this.mode === 'cityMissile' ? (s.cities[this.selectedCity]?.missiles ?? 0) >= 1 : this.mode === 'missile' ? this.ownSelected().some((u) => this.sim.combat.canLaunch(u)) : this.readyLaunchers().length > 0;
    if (!ok) return;
    if (!more || !keep) this.setMode('normal');
  }

  /** Send selected aircraft back to the nearest airfield or carrier. */
  returnToBase(): void {
    const air = this.ownSelected().filter((u) => this.sim.units.isAir(u));
    if (!air.length) {
      this.ui.toast(t('Select aircraft first'), 'warn');
      return;
    }
    const n = this.sim.units.orderRtb(air);
    if (n) {
      this.ui.toast(t('{n} aircraft returning to base', { n }), 'info');
      App.audio.play('move');
    } else this.ui.toast(t('No friendly airfield or carrier available'), 'warn');
  }

  orderStop(): void {
    const u = this.ownSelected();
    if (!u.length) return;
    this.sim.units.orderStop(u);
    App.audio.play('click');
  }

  orderHold(): void {
    const u = this.ownSelected();
    if (!u.length) return;
    this.sim.units.orderHold(u);
    App.audio.play('click');
  }

  /** Send selected units to the nearest friendly city (ships: nearest friendly port) to repair. */
  returnForRepairs(): void {
    const s = this.sim.state;
    const units = this.ownSelected();
    if (!units.length) return;
    let sent = 0;
    for (const u of units) {
      const naval = unitDef(u.type).domain === 'naval';
      let best = null as null | { x: number; y: number };
      let bestD = Infinity;
      for (const c of s.cities) {
        if (c.owner !== s.player || (naval && !c.port)) continue;
        const x = naval ? c.portX : c.x;
        const y = naval ? c.portY : c.y;
        const d = Math.hypot(x - u.x, y - u.y);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
      if (best) {
        this.sim.units.orderMove([u], best.x, best.y);
        sent++;
      }
    }
    if (sent) {
      this.ui.toast(t('{n} units returning to base for repairs', { n: sent }), 'info');
      App.audio.play('move');
    } else this.ui.toast(t('No friendly base available'), 'warn');
  }

  disbandSelected(): void {
    const units = this.ownSelected();
    if (!units.length) return;
    for (const u of units) this.sim.units.remove(u, false, null);
    this.ui.toast(t('{n} units disbanded', { n: units.length }), 'info');
    this.clearSelection();
  }

  centerOnSelection(): void {
    const units = this.ownSelected();
    if (units.length) {
      const x = units.reduce((a, u) => a + u.x, 0) / units.length;
      const y = units.reduce((a, u) => a + u.y, 0) / units.length;
      this.controls.centerOn(x, y);
    } else if (this.selectedCity >= 0) {
      const c = this.sim.state.cities[this.selectedCity];
      this.controls.centerOn(c.x, c.y);
    }
  }

  centerOnCapital(smooth = true): void {
    const s = this.sim.state;
    const mine = s.cities.filter((c) => c.owner === s.player).sort((a, b) => Number(b.capital) - Number(a.capital) || b.importance - a.importance);
    if (mine[0]) this.controls.centerOn(mine[0].x, mine[0].y, smooth);
  }

  cycleIdle(): void {
    const s = this.sim.state;
    const idle = [...s.units.values()].filter((u) => u.owner === s.player && !u.order && u.targetUnit < 0);
    if (!idle.length) {
      this.ui.toast(t('No idle units'), 'info');
      return;
    }
    const cur = this.selection.size === 1 ? [...this.selection][0] : -1;
    const i = idle.findIndex((u) => u.id === cur);
    const next = idle[(i + 1) % idle.length];
    this.select([next.id], false);
    this.controls.centerOn(next.x, next.y);
  }

  togglePause(): void {
    const s = this.sim.state;
    s.paused = !s.paused;
    this.ui.pausedByMenu = false;
    App.audio.play('click');
  }

  setSpeed(n: number): void {
    const s = this.sim.state;
    s.speed = n;
    s.paused = false;
  }

  // ------------------------------------------------------------------ city actions

  produce(cityId: number, type: string): void {
    const c = this.sim.state.cities[cityId];
    if (!c) return;
    const chk = this.sim.production.canProduceUnit(c, type);
    if (!chk.ok) {
      this.ui.toast(`${t(unitDef(type).name)}: ${t(chk.reason ?? '')}`, 'warn');
      App.audio.play('error');
      return;
    }
    this.sim.production.enqueueUnit(c, type);
    App.audio.play('build', { volume: 0.6 });
  }

  build(cityId: number, id: string): void {
    const c = this.sim.state.cities[cityId];
    if (!c) return;
    const chk = this.sim.production.canBuild(c, id);
    if (!chk.ok) {
      this.ui.toast(`${t(BUILDING_MAP[id]?.name ?? id)}: ${t(chk.reason ?? '')}`, 'warn');
      App.audio.play('error');
      return;
    }
    this.sim.production.enqueueBuilding(c, id);
    App.audio.play('build', { volume: 0.6 });
  }

  cancelQueue(cityId: number, idx: number): void {
    const c = this.sim.state.cities[cityId];
    if (c && c.owner === this.sim.state.player) this.sim.production.cancel(c, idx);
  }

  repairCity(cityId: number): void {
    const s = this.sim.state;
    const c = s.cities[cityId];
    if (!c || c.owner !== s.player) return;
    const cost = Math.round((c.maxHp - c.hp) * 0.8);
    const f = s.factions[s.player];
    if (s.time - c.lastAttacked <= 5 || f.res.money < cost || cost <= 0) {
      this.ui.toast(t('Cannot repair now (under fire or insufficient funds)'), 'warn');
      return;
    }
    f.res.money -= cost;
    c.hp = c.maxHp;
    App.audio.play('build');
    this.ui.toast(t('{city} defences restored', { city: tn(c) }), 'good');
  }

  // ------------------------------------------------------------------ save / load / flow

  saveGame(slot: string): void {
    if (saveToSlot(this.sim.state, slot)) this.ui.toast(t('Game saved'), 'good');
    else this.ui.toast(t('Save failed — browser storage unavailable or full'), 'bad');
  }

  loadGame(slot: string): void {
    const data = loadFromSlot(slot);
    if (!data) {
      this.ui.toast(t('Save file is missing or incompatible'), 'bad');
      return;
    }
    this.scene.restart({ load: data });
  }

  quickSave(): void {
    this.saveGame('slot1');
  }

  quickLoad(): void {
    this.loadGame('slot1');
  }

  exitToMenu(): void {
    this.scene.start('Menu');
  }

  continueAfterVictory(): void {
    this.victoryDisabled = true;
    this.sim.state.gameOver = null;
  }

  audioUnlock(): void {
    if (!App.audio.ready) {
      App.audio.unlock();
      applyAudioSettings();
    }
  }

  debugCommand(cmd: string): void {
    const s = this.sim.state;
    const f = s.factions[s.player];
    switch (cmd) {
      case 'res':
        f.res.money += 5000;
        f.res.metal += 2000;
        f.res.fuel += 2000;
        f.res.food += 2000;
        break;
      case 'reveal':
        this.unitViews.reveal = !this.unitViews.reveal;
        this.effects.reveal = this.unitViews.reveal;
        break;
      case 'ai':
        this.sim.ai.enabled = !this.sim.ai.enabled;
        break;
      case 'kill':
        for (const u of this.ownSelected()) this.sim.units.remove(u, true, null);
        for (const id of [...this.selection]) {
          const u = s.units.get(id);
          if (u) this.sim.units.remove(u, true, null);
        }
        break;
      case 'tank': {
        const v = this.cameras.main.worldView;
        for (const t of ['medium_tank', 'medium_tank', 'infantry', 'artillery']) this.sim.units.spawn(t, s.player, v.centerX + Math.random() * 40, v.centerY + Math.random() * 40);
        break;
      }
      case 'event':
        this.sim.events.trigger(s.player);
        break;
      case 'mobilize': {
        // Make the strongest neighbour start mobilising against the player (QA helper).
        const me = s.cities.filter((c) => c.owner === s.player);
        let best: { f: string; stage: number; target: number; d: number } | null = null;
        for (const c of s.cities) {
          if (c.owner === s.player || c.owner === NEUTRAL_ID || s.factions[c.owner]?.isPlayer) continue;
          for (const m of me) {
            const d = Math.hypot(c.x - m.x, c.y - m.y);
            if (!best || d < best.d) best = { f: c.owner, stage: c.id, target: m.id, d };
          }
        }
        if (best && s.ai[best.f]) {
          s.ai[best.f].war = { target: s.player, phase: 'mobilize', started: s.time, stageCity: best.stage, targetCity: best.target, prep: 0 };
          this.sim.bus.emit('mobilization', { faction: best.f, target: s.player, city: s.cities[best.stage] });
        }
        break;
      }
      case 'win':
        s.gameOver = { winner: s.player, playerWon: true };
        this.sim.bus.emit('gameOver', { playerWon: true, winner: s.player });
        break;
    }
  }
}
