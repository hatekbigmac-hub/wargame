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
import { colorCss } from '../ui/dom';
import { NEUTRAL_ID } from '../data/factions';

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
    else this.sim = Sim.newGame(geo, data.faction ?? 'atl', data.difficulty ?? Settings.data.difficulty);
    const sim = this.sim;
    this.map = new MapRenderer(this, geo, () => sim.state.cities.map((c) => c.owner), () => sim.state.cities);
    this.map.create();
    this.map.createFog();
    this.cityViews = new CityViews(this, sim);
    this.unitViews = new UnitViews(this, sim);
    this.effects = new Effects(this, sim, this.unitViews, App.audio);
    this.overlay = this.add.graphics().setDepth(15);
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
      this.ui.banner(f.name.toUpperCase(), 'THE WAR BEGINS', colorCss(f.color));
      sim.log(`${f.name} high command established. Good luck, Commander.`, 'info');
    } else this.ui.toast('Campaign loaded', 'good');
    this.time.delayedCall(4000, () => {
      const pf = this.sim.state.factions[this.sim.state.player];
      if (!pf.research) this.ui.toast('Your scientists await orders — open Research (R) to choose a technology', 'info');
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
        this.ui.banner(to === s.player ? 'CAPITAL SEIZED' : 'CAPITAL LOST', city.name.toUpperCase(), to === s.player ? '#ffd27a' : '#ff5a4f');
      }
    });
    bus.on('notify', ({ text, kind, x, y }) => {
      this.ui.toast(text, kind, x, y);
      if (kind === 'warn') App.audio.play('alert', { volume: 0.6 });
    });
    bus.on('researchComplete', ({ faction }) => faction === s.player && App.audio.play('research'));
    bus.on('productionComplete', ({ city, item }) => {
      if (city.owner === s.player) App.audio.play('build', { volume: 0.5 });
      if (item.kind === 'building' && city.owner === s.player && item.id === 'missile_battery') this.ui.toast(`${city.name}: missile battery online`, 'good');
    });
    bus.on('factionEliminated', ({ faction }) => {
      if (faction !== NEUTRAL_ID) this.ui.banner('FACTION ELIMINATED', s.factions[faction].name.toUpperCase(), colorCss(s.factions[faction].color));
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
    App.audio.listener = { x: view.centerX, y: view.centerY, w: view.width, h: view.height };
    this.ui.update(dt);
    this.mark('ui', t0);
    // Autosave
    if (Settings.data.autosave && !s.gameOver) {
      this.autosaveT -= dt;
      if (this.autosaveT <= 0) {
        this.autosaveT = 180;
        if (saveToSlot(s, 'auto')) this.sim.log('Autosaved', 'info');
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
      g.strokeCircle(c.x, c.y, 900);
    }
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
    else this.ui.toast('No friendly units in this city', 'warn');
  }

  private ownSelected(): Unit[] {
    const out: Unit[] = [];
    for (const id of this.selection) {
      const u = this.sim.state.units.get(id);
      if (u && u.owner === this.sim.state.player) out.push(u);
    }
    return out;
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
    if (u) {
      const f = s.factions[u.owner];
      const def = unitDef(u.type);
      const enemy = atWar(s, s.player, u.owner) && u.owner !== s.player;
      this.ui.setWorldTip(`<b>${def.name}</b> <span style="color:${colorCss(f.color)}">■ ${f.name}</span><br/>HP ${Math.ceil(u.hp)}/${Math.round(u.maxHp)}${u.rank ? ` · ${'★'.repeat(u.rank)}` : ''}${enemy && this.selection.size ? '<br/><span class="bad">Right-click to attack</span>' : ''}`, sx, sy);
    } else if (c) {
      const f = s.factions[c.owner];
      const enemy = atWar(s, s.player, c.owner) && c.owner !== s.player;
      this.ui.setWorldTip(`<b>${c.name}</b> <span style="color:${colorCss(f?.color ?? 0x999999)}">■ ${f?.name ?? ''}</span><br/>Defences ${Math.ceil(c.hp)}/${Math.round(c.maxHp)}${c.capture > 0 ? ` · capture ${Math.floor(c.capture * 100)}%` : ''}${enemy && this.selection.size ? '<br/><span class="bad">Right-click to assault</span>' : ''}`, sx, sy);
    } else this.ui.setWorldTip(null, 0, 0);
  }

  // ------------------------------------------------------------------ commands

  setMode(m: InputMode): void {
    this.mode = m;
    this.input.setDefaultCursor(m === 'normal' ? 'default' : 'crosshair');
  }

  private marker(x: number, y: number, color: number): void {
    const img = this.add.image(x, y, 'fx_ring').setTint(color).setDepth(16).setScale(0.35 / this.cameras.main.zoom).setAlpha(0.9);
    this.tweens.add({ targets: img, scale: 0.05 / this.cameras.main.zoom, alpha: 0, duration: 450, onComplete: () => img.destroy() });
  }

  commandAt(x: number, y: number, attackMove: boolean): void {
    const units = this.ownSelected();
    if (!units.length) return;
    const s = this.sim.state;
    const enemy = this.unitViews.pick(x, y, (u) => u.owner !== s.player && atWar(s, s.player, u.owner));
    if (enemy) {
      this.sim.units.orderAttackUnit(units, enemy);
      this.marker(enemy.x, enemy.y, 0xff4d3d);
      App.audio.play('attack');
      return;
    }
    const city = this.cityViews.pick(x, y);
    if (city && city.owner !== s.player && atWar(s, s.player, city.owner)) {
      this.sim.units.orderAttackCity(units, city);
      this.marker(city.x, city.y, 0xff4d3d);
      App.audio.play('attack');
      return;
    }
    const tx = city ? city.x : x;
    const ty = city ? city.y : y;
    this.sim.units.orderMove(units, tx, ty, attackMove);
    this.marker(tx, ty, attackMove ? 0xffa040 : 0x6bff8f);
    App.audio.play('move');
  }

  beginMissile(): void {
    if (this.selectedCity >= 0) {
      const c = this.sim.state.cities[this.selectedCity];
      if (c.owner === this.sim.state.player && (c.buildings.missile_battery ?? 0) > 0) {
        this.setMode('cityMissile');
        return;
      }
    }
    const ready = this.ownSelected().filter((u) => this.sim.combat.canLaunch(u));
    if (!ready.length) {
      const any = this.ownSelected().some((u) => unitDef(u.type).missiles);
      this.ui.toast(any ? 'No missiles ready — launchers are reloading' : 'Select a missile ship, missile launcher or a city with a missile battery', 'warn');
      App.audio.play('error');
      return;
    }
    this.setMode('missile');
  }

  missileAt(x: number, y: number): void {
    const s = this.sim.state;
    const unit = this.unitViews.pick(x, y, (u) => u.owner !== s.player && atWar(s, s.player, u.owner));
    const city = unit ? null : this.cityViews.pick(x, y);
    const target = unit ? { unit } : city && city.owner !== s.player && atWar(s, s.player, city.owner) ? { city } : null;
    if (!target) {
      this.ui.toast('Select an enemy unit or city as missile target', 'warn');
      App.audio.play('error');
      return;
    }
    const tx = unit ? unit.x : city!.x;
    const ty = unit ? unit.y : city!.y;
    let ok = false;
    if (this.mode === 'cityMissile') {
      const c = s.cities[this.selectedCity];
      ok = !!c && this.sim.combat.launchCityMissile(c, target);
      if (!ok) this.ui.toast('Target out of range or no missiles available', 'warn');
    } else {
      const shooters = this.ownSelected()
        .filter((u) => this.sim.combat.canLaunch(u) && Math.hypot(u.x - tx, u.y - ty) <= (unitDef(u.type).missileRange ?? 0))
        .sort((a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty));
      if (shooters.length) ok = this.sim.combat.launchMissile(shooters[0], target);
      if (!ok) this.ui.toast('No ready missile unit within range of that target', 'warn');
    }
    if (ok) {
      this.marker(tx, ty, 0xff9a6a);
      this.sim.log('Missile launched', 'combat', tx, ty);
    } else App.audio.play('error');
    const more = this.mode === 'cityMissile' ? (s.cities[this.selectedCity]?.missiles ?? 0) >= 1 : this.ownSelected().some((u) => this.sim.combat.canLaunch(u));
    if (!more || !this.controls.cam) this.setMode('normal');
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
      this.ui.toast(`${sent} unit${sent > 1 ? 's' : ''} returning to base for repairs`, 'info');
      App.audio.play('move');
    } else this.ui.toast('No friendly base available', 'warn');
  }

  disbandSelected(): void {
    const units = this.ownSelected();
    if (!units.length) return;
    for (const u of units) this.sim.units.remove(u, false, null);
    this.ui.toast(`${units.length} unit${units.length > 1 ? 's' : ''} disbanded`, 'info');
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
      this.ui.toast('No idle units', 'info');
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
      this.ui.toast(`${unitDef(type).name}: ${chk.reason}`, 'warn');
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
      this.ui.toast(`${BUILDING_MAP[id]?.name}: ${chk.reason}`, 'warn');
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
      this.ui.toast('Cannot repair now (under fire or insufficient funds)', 'warn');
      return;
    }
    f.res.money -= cost;
    c.hp = c.maxHp;
    App.audio.play('build');
    this.ui.toast(`${c.name} defences restored`, 'good');
  }

  // ------------------------------------------------------------------ save / load / flow

  saveGame(slot: string): void {
    if (saveToSlot(this.sim.state, slot)) this.ui.toast('Game saved', 'good');
    else this.ui.toast('Save failed — browser storage unavailable or full', 'bad');
  }

  loadGame(slot: string): void {
    const data = loadFromSlot(slot);
    if (!data) {
      this.ui.toast('Save file is missing or incompatible', 'bad');
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
      case 'win':
        s.gameOver = { winner: s.player, playerWon: true };
        this.sim.bus.emit('gameOver', { playerWon: true, winner: s.player });
        break;
    }
  }
}
