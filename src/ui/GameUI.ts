// In-game HTML overlay: top bar, alerts & operations strip, map layers, selection & action
// panels, unit list, event log, minimap, city / research / market / diplomacy / pause windows,
// toasts, tooltips, game-over screen and the developer debug overlay.
import type { GameScene } from '../scenes/GameScene';
import type { City, LogEntry, ResKey, Unit } from '../core/types';
import { RES_KEYS } from '../core/types';
import { el, esc, fmt, fmtRate, costHtml, bar, hpClass, gameDate, colorCss, delegate, morph } from './dom';
import { ICONS, RES_ICON } from './icons';
import { unitDef, PRODUCIBLE_UNITS } from '../data/units';
import { BUILDING_DEFS, buildingCost } from '../data/buildings';
import { TECH_DEFS, TECH_MAP } from '../data/techs';
import { FACTIONS, getFactionDef, factionName, powerTier, TIER_NAMES } from '../data/factions';
import { turretURL } from '../effects/Textures';
import { cityYield, MARKET_PRICE, MARKET_BUY, MARKET_SELL } from '../economy/EconomySystem';
import { cityDefense, cityRange } from '../cities/CitySystem';
import { CITY_MISSILE_RANGE } from '../combat/CombatSystem';
import { TERRAIN_NAMES } from '../map/WorldGeo';
import { atWar, relKey } from '../core/GameState';
import { canAfford } from '../technology/TechSystem';
import { openWindow, openSettings, openSaveLoad, openHelp, openConfirm, type Win } from './Dialogs';
import { Settings } from '../core/Settings';
import { App } from '../app';
import { WORLD_W, WORLD_H, DEBUG_ALLOWED, worldToCell } from '../config';
import { MapAssets, type MapLayer } from '../map/MapRenderer';
import { proposePeace, declareWar, militaryStrength, acceptPeaceOffer, rejectPeaceOffer } from '../diplomacy/Diplomacy';
import { gathered, PREP_HOURS, MAX_PREP_BONUS } from '../military/Offensives';
import { MOBILIZE_HOURS } from '../ai/AISystem';
import { militaryOf } from '../data/military';
import type { TechCategory } from '../core/types';
import { t, tn, onLangChange } from '../i18n';

const STATUS = (u: Unit): string => {
  if (u.order?.kind === 'board') return t('Boarding');
  if (u.order?.kind === 'unload') return t('Sailing to land');
  if (u.order?.kind === 'hold') return t('Holding');
  if (u.targetUnit >= 0 || u.targetCity >= 0) return t('Engaging');
  if (u.moving) return u.order?.kind === 'attackMove' ? t('Advancing') : t('Moving');
  return t('Idle');
};

const SIZE_NAMES = ['', 'Town', 'City', 'Major city', 'Metropolis'];
const RES_NAMES: Record<string, string> = { money: 'Money', metal: 'Metal', fuel: 'Fuel', food: 'Food' };

type DiploFilter = 'relevant' | 'war' | 'neighbors' | 'all';

export class GameUI {
  private root: HTMLElement;
  private top: HTMLElement;
  private alerts: HTMLElement;
  private layers: HTMLElement;
  private left: HTMLElement;
  private right: HTMLElement;
  private cards: HTMLElement;
  private cardTitle: HTMLElement;
  private logTitle: HTMLElement;
  private miniTitle: HTMLElement;
  private logList: HTMLElement;
  private mini: HTMLCanvasElement;
  private miniBase: HTMLCanvasElement;
  private miniBaseT = -1;
  private toasts: HTMLElement;
  private tip: HTMLElement;
  private hint: HTMLElement;
  private debugEl: HTMLElement | null = null;
  private fpsEl: HTMLElement;
  private win: Win | null = null;
  private winKind = '';
  private winArg = -1;
  private sectionCache = new Map<string, string>();
  private refreshT = 0;
  private miniT = 0;
  private lastLogLen = -1;
  private worldTipOn = false;
  private tipSrc: HTMLElement | null = null;
  private diploQuery = '';
  private diploFilter: DiploFilter = 'relevant';
  pausedByMenu = false;

  constructor(private g: GameScene) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = '';
    const r = this.root;
    this.top = el('div', 'topbar');
    this.alerts = el('div', 'alerts');
    this.layers = el('div', 'layerbar panel');
    this.left = el('div', 'panel panel-left hidden');
    this.right = el('div', 'panel panel-right hidden');
    const bottom = el('div', 'bottombar');
    const unitlist = el('div', 'panel unitlist');
    this.cardTitle = el('div', 'panel-title');
    this.cards = el('div', 'unitcards');
    unitlist.append(this.cardTitle, this.cards);
    const log = el('div', 'panel log');
    this.logTitle = el('div', 'panel-title');
    log.append(this.logTitle);
    this.logList = el('div', 'log-list');
    log.append(this.logList);
    const mm = el('div', 'panel minimap-wrap');
    this.miniTitle = el('div', 'panel-title');
    mm.append(this.miniTitle);
    const mmBox = el('div', 'minimap');
    this.mini = el('canvas');
    mmBox.append(this.mini);
    mm.append(mmBox);
    bottom.append(unitlist, log, mm);
    this.toasts = el('div', 'toasts');
    this.tip = el('div', 'tooltip');
    this.hint = el('div', 'cmd-hint panel');
    this.hint.style.display = 'none';
    this.fpsEl = el('div', 'fps');
    r.append(this.top, this.alerts, this.layers, this.left, this.right, bottom, this.toasts, this.hint, this.fpsEl, this.tip);
    this.miniBase = document.createElement('canvas');

    this.buildStatic();
    for (const p of [this.top, this.alerts, this.layers, this.left, this.right, unitlist, log]) delegate(p, (a, v, e, ev) => this.action(a, v, e, ev));
    this.logList.addEventListener('click', (ev) => {
      const target = (ev.target as HTMLElement).closest<HTMLElement>('[data-x]');
      if (target) this.g.controls.centerOn(Number(target.dataset.x), Number(target.dataset.y));
    });
    this.setupMinimap(mmBox);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.setupTooltips();
    this.onSelectionChanged();
    this.cleanups.push(
      onLangChange(() => {
        this.buildStatic();
        this.sectionCache.clear();
        this.lastLogLen = -1;
        this.refreshAll();
      }),
    );
  }

  private cleanups: (() => void)[] = [];

  destroy(): void {
    for (const c of this.cleanups) c();
    this.root.innerHTML = '';
  }

  get modalOpen(): boolean {
    return !!this.win;
  }

  // ------------------------------------------------------------------ helpers

  private get sim() {
    return this.g.sim;
  }

  private get player() {
    return this.sim.state.factions[this.sim.state.player];
  }

  private setSection(elm: HTMLElement, key: string, html: string): void {
    if (this.sectionCache.get(key) === html) return;
    this.sectionCache.set(key, html);
    morph(elm, html);
  }

  private portrait(type: string, owner: string): string {
    const def = unitDef(type);
    const color = colorCss(this.sim.state.factions[owner]?.color ?? 0xcccccc);
    return turretURL(this.g, def.sprite, def.turret, color);
  }

  private hintHtml(): string {
    return `<div class="empty-hint">${t('<b>Left-click</b> a unit or city to select it · <b>Shift+drag</b> to box-select · <b>Right-click</b> to move or attack.')}<br/>
      ${t('Launch missiles with the <b>Missile Strike</b> button in the top bar. Press <b>F1</b> for the field manual (transports, offensives, diplomacy).')}</div>`;
  }

  toast(text: string, kind: LogEntry['kind'] = 'info', x?: number, y?: number): void {
    for (const c of Array.from(this.toasts.children)) if (c.textContent === text && !c.classList.contains('out')) return;
    const tEl = el('div', `toast ${kind}`, esc(text));
    if (x !== undefined && y !== undefined) {
      tEl.title = t('Click to view');
      tEl.addEventListener('click', () => this.g.controls.centerOn(x, y));
    }
    this.toasts.prepend(tEl);
    while (this.toasts.children.length > 5) this.toasts.lastElementChild?.remove();
    const life = text.length > 90 ? 7000 : 4600;
    setTimeout(() => tEl.classList.add('out'), life);
    setTimeout(() => tEl.remove(), life + 500);
  }

  banner(text: string, sub: string, color = '#ffffff'): void {
    const b = el('div', 'banner', `${esc(text)}<small>${esc(sub)}</small>`);
    b.style.color = color;
    this.root.append(b);
    setTimeout(() => b.remove(), 2900);
  }

  confirm(title: string, html: string, okLabel: string, onOk: () => void): void {
    this.win?.close();
    const w = openConfirm(this.root, title, html, okLabel, onOk, () => {
      if (this.win === w) this.win = null;
    });
    this.win = w;
    this.winKind = 'confirm';
  }

  setWorldTip(html: string | null, sx: number, sy: number): void {
    if (!html) {
      if (this.worldTipOn) {
        this.tip.style.display = 'none';
        this.worldTipOn = false;
      }
      return;
    }
    this.worldTipOn = true;
    this.tip.innerHTML = html;
    this.tip.style.display = 'block';
    this.placeTip(sx, sy);
  }

  private placeTip(x: number, y: number): void {
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    this.tip.style.left = `${Math.min(window.innerWidth - w - 8, x + 16)}px`;
    this.tip.style.top = `${Math.min(window.innerHeight - h - 8, y + 18)}px`;
  }

  private setupTooltips(): void {
    this.root.addEventListener('mouseover', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (!target) return;
      this.tipSrc = target;
      this.tip.innerHTML = target.dataset.tip!;
      this.tip.style.display = 'block';
      this.placeTip(e.clientX, e.clientY);
    });
    this.root.addEventListener('mousemove', (e) => {
      if (this.tip.style.display === 'block' && !this.worldTipOn) this.placeTip(e.clientX, e.clientY);
    });
    this.root.addEventListener('mouseout', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (target && !this.worldTipOn) {
        this.tip.style.display = 'none';
        this.tipSrc = null;
      }
    });
    this.root.addEventListener('mousedown', () => {
      if (!this.worldTipOn) this.tip.style.display = 'none';
    });
  }

  // ------------------------------------------------------------------ top bar & layers

  private buildStatic(): void {
    const f = this.player;
    const def = getFactionDef(f.id)!;
    this.top.innerHTML = `
      <div class="faction"><div class="faction-emblem" style="background:${def.css}">${def.short}</div><div><div class="fname">${esc(factionName(f.id))}</div><small data-r="fsub"></small></div></div>
      <div class="resources" data-r="res"></div>
      <div class="clock"><div class="date" data-r="date"></div><div class="sub" data-r="time"></div></div>
      <div class="speed">
        <button class="btn icon" data-a="speed" data-v="0" data-tip="${esc(`<b>${t('Pause')}</b> (Space)`)}">${ICONS.pause}</button>
        <button class="btn" data-a="speed" data-v="1" data-tip="${esc(t('Normal speed'))}">1×</button>
        <button class="btn" data-a="speed" data-v="2" data-tip="${esc(t('Fast'))}">2×</button>
        <button class="btn" data-a="speed" data-v="4" data-tip="${esc(t('Very fast'))}">4×</button>
      </div>
      <div class="top-actions">
        <button class="btn strike-btn" data-a="strike" data-r="strike" data-tip="${esc(t('<b>Missile Strike</b> (M)<br/>Click, then click an enemy unit or city: the nearest ready launcher in range fires.<br/>Launchers: city Missile Batteries, Missile Launchers, Missile Ships.'))}"><span class="ai">${ICONS.missile}</span><span data-r="strikeTxt"></span></button>
        <button class="btn icon" data-a="research" data-tip="${esc(`<b>${t('Research')}</b> (R)`)}">${ICONS.research}</button>
        <button class="btn icon" data-a="market" data-tip="${esc(`<b>${t('Market')}</b> — ${t('trade commodities')}`)}">${ICONS.market}</button>
        <button class="btn icon badge-host" data-a="factions" data-tip="${esc(`<b>${t('Diplomacy')}</b> — ${t('war, peace, world powers')}`)}">${ICONS.globe}<span class="badge" data-r="dipBadge"></span></button>
        <button class="btn icon" data-a="saveload" data-tip="${esc(`<b>${t('Save / Load')}</b>`)}">${ICONS.save}</button>
        <button class="btn icon" data-a="pause" data-tip="${esc(`<b>${t('Menu')}</b> (Esc)`)}">${ICONS.menu}</button>
      </div>`;
    const layers: [MapLayer, string][] = [
      ['political', 'Political'], ['terrain', 'Terrain'], ['resources', 'Resources'], ['military', 'Military'], ['strategic', 'Strategic'],
    ];
    const cur = this.g.map?.layer ?? 'political';
    this.layers.innerHTML = layers.map(([id, n]) => `<button class="btn ${id === cur ? 'active' : ''}" data-a="layer" data-v="${id}">${t(n)}</button>`).join('');
    this.logTitle.innerHTML = t('Situation Report');
    this.miniTitle.innerHTML = `<span>${t('Strategic Map')}</span><span class="grow"></span><span class="muted" style="font-size:10px">${t('CLICK TO JUMP')}</span>`;
  }

  private refreshAll(): void {
    this.updateTop();
    this.updateAlerts();
    this.refreshPanels();
    this.refreshLog();
    this.refreshWindow();
  }

  private updateTop(): void {
    const s = this.sim.state;
    const f = this.player;
    const q = (k: string) => this.top.querySelector<HTMLElement>(`[data-r="${k}"]`)!;
    let units = 0;
    for (const u of s.units.values()) if (u.owner === f.id) units++;
    const cities = s.cities.filter((c) => c.owner === f.id).length;
    q('fsub').textContent = `${t('{n} cities', { n: cities })} · ${t('{n} units', { n: units })}`;
    const items = RES_KEYS.map((k) => {
      const inc = f.income[k];
      const shortage = f.res[k] <= 1 && inc < 0;
      const tip = `<b>${t(RES_NAMES[k])}</b><br/>${t('Production')}: +${f.gross[k].toFixed(1)}/h<br/>${t('Upkeep')}: −${f.upkeep[k].toFixed(1)}/h<br/>${t('Net')}: ${fmtRate(inc)}/h`;
      return `<div class="res ${shortage ? 'short' : ''}" data-tip="${esc(tip)}"><span class="ico">${RES_ICON[k]}</span><div><div class="val">${fmt(f.res[k])}</div><div class="rate ${inc >= 0 ? 'good' : 'bad'}">${fmtRate(inc)}/h</div></div><span class="lbl">${t(RES_NAMES[k])}</span></div>`;
    });
    const pr = f.power.demand > 0 ? f.power.supply / f.power.demand : 1;
    items.push(`<div class="res ${pr < 1 ? 'short' : ''}" data-tip="${esc(`<b>${t('Electricity')}</b><br/>${t('Supply {s} / demand {d}', { s: f.power.supply.toFixed(0), d: f.power.demand.toFixed(0) })}<br/>${t('Shortages slow production and research.')}`)}"><span class="ico">${RES_ICON.power}</span><div><div class="val">${f.power.supply.toFixed(0)}/${f.power.demand.toFixed(0)}</div><div class="rate ${pr >= 1 ? 'good' : 'bad'}">${Math.round(Math.min(1, pr) * 100)}%</div></div><span class="lbl">${t('Power')}</span></div>`);
    items.push(`<div class="res" data-tip="${esc(`<b>${t('Industrial capacity')}</b><br/>${t('Sum of city industry and factories.')}<br/>${t('Production speed multiplier')}: ×${this.sim.tech.getMods(f.id).prod.toFixed(2)}`)}"><span class="ico">${RES_ICON.industry}</span><div><div class="val">${f.industry.toFixed(0)}</div><div class="rate muted">IC</div></div><span class="lbl">${t('Industry')}</span></div>`);
    const research = f.research
      ? `<div class="res research-item" data-a="research" style="cursor:pointer" data-tip="${esc(t('Current research — click to open'))}"><span class="ico">${ICONS.research}</span><div><div class="val" style="font-size:12px">${esc(t(TECH_MAP[f.research.id]?.name ?? ''))}</div>${bar(f.research.progress / f.research.time, 'prog')}</div></div>`
      : `<div class="res research-item" data-a="research" style="cursor:pointer" data-tip="${esc(t('No active research — click to choose'))}"><span class="ico">${ICONS.research}</span><div><div class="val warn" style="font-size:13px">${t('Research idle')}</div><div class="rate muted">${t('click to choose')}</div></div></div>`;
    items.push(research);
    this.setSection(q('res'), 'res', items.join(''));
    const d = gameDate(s.time);
    q('date').textContent = d.date;
    q('time').textContent = `${d.time} · ${t('DAY {n}', { n: d.day })}${s.paused ? ` · ${t('PAUSED')}` : ''}`;
    this.top.querySelectorAll<HTMLElement>('[data-a="speed"]').forEach((b) => {
      const v = Number(b.dataset.v);
      b.classList.toggle('active', v === 0 ? s.paused : !s.paused && s.speed === v);
    });
    const ready = this.g.readyLaunchers().length;
    const strike = q('strike');
    strike.classList.toggle('active', this.g.mode === 'strike');
    strike.classList.toggle('dim', ready === 0);
    this.setSection(q('strikeTxt'), 'strikeTxt', `<span class="strike-label">${t('Missile Strike')} · </span>${ready}`);
    const alertsN = s.peaceOffers.length + this.threats().length;
    const badge = q('dipBadge');
    badge.textContent = alertsN ? String(alertsN) : '';
    badge.style.display = alertsN ? '' : 'none';
  }

  /** AI countries mobilising against the player. */
  private threats(): { f: string; hoursLeft: number; city: City | null }[] {
    const s = this.sim.state;
    const out: { f: string; hoursLeft: number; city: City | null }[] = [];
    for (const f of s.factionOrder) {
      const w = s.ai[f]?.war;
      if (w && w.target === s.player && w.phase === 'mobilize' && s.factions[f].alive) {
        out.push({ f, hoursLeft: Math.max(0, MOBILIZE_HOURS - (s.time - w.started)), city: s.cities[w.stageCity] ?? null });
      }
    }
    return out;
  }

  /** Strip under the top bar: operations, threats, wars and peace offers. */
  private updateAlerts(): void {
    const s = this.sim.state;
    const chips: string[] = [];
    for (const op of s.ops) {
      const c = s.cities[op.targetCity];
      if (!c) continue;
      const g = gathered(this.sim, op);
      const ready = op.prep >= 1;
      const tip = `<b>${t('Offensive on {city}', { city: esc(tn(c)) })}</b><br/>${t('{n} units · {g}% at the staging area', { n: op.units.length, g: Math.round(g * 100) })}<br/>${t('Preparation {p}% → attack bonus +{b}%', { p: Math.round(op.prep * 100), b: Math.round(op.prep * MAX_PREP_BONUS * 100) })}<br/>${t('Full preparation takes {h}h with all troops at the staging area.', { h: PREP_HOURS })}`;
      chips.push(`<div class="chip op ${ready ? 'ready' : ''}" data-tip="${esc(tip)}"><span class="ai" data-a="opView" data-v="${op.id}">${ICONS.flag}</span><span class="nm" data-a="opView" data-v="${op.id}">${esc(tn(c))}</span>
        <div class="opbar">${bar(op.prep, ready ? 'hp' : 'gold')}</div><span class="pct">${Math.round(op.prep * 100)}%</span>
        <button class="btn small ${ready ? 'primary' : ''}" data-a="opLaunch" data-v="${op.id}">${t('Launch')}</button><button class="btn small icon" data-a="opCancel" data-v="${op.id}" data-tip="${esc(t('Cancel operation'))}">${ICONS.close}</button></div>`);
    }
    for (const th of this.threats()) {
      chips.push(`<div class="chip threat" data-a="threat" data-v="${th.city?.id ?? -1}" data-tip="${esc(t('{name} is gathering troops on your border. War is expected in about {h}h. Prepare your defences, or strike first.', { name: esc(factionName(th.f)), h: Math.ceil(th.hoursLeft) }))}"><span class="ai">${ICONS.alert}</span>${t('{name} mobilising', { name: esc(factionName(th.f)) })} · ${Math.ceil(th.hoursLeft)}${t('h')}</div>`);
    }
    for (const o of s.peaceOffers) {
      chips.push(`<div class="chip peace" data-a="factions" data-tip="${esc(t('Open Diplomacy to accept or reject'))}"><span class="ai">${ICONS.peace}</span>${t('Peace offer: {name}', { name: esc(factionName(o.from)) })}</div>`);
    }
    const wars = Object.entries(s.relations)
      .filter(([k, v]) => v === 'war' && k.split('|').includes(s.player))
      .map(([k]) => k.split('|').find((x) => x !== s.player)!)
      .filter((f) => s.factions[f]?.alive);
    if (wars.length) {
      const names = wars.slice(0, 3).map((f) => esc(factionName(f))).join(', ') + (wars.length > 3 ? ` +${wars.length - 3}` : '');
      chips.push(`<div class="chip war" data-a="factions" data-tip="${esc(t('Countries at war with you — open Diplomacy'))}"><span class="ai">${ICONS.sword}</span>${t('At war')}: ${names}</div>`);
    } else if (!chips.length) {
      chips.push(`<div class="chip calm" data-a="factions"><span class="ai">${ICONS.peace}</span>${t('At peace with the world')}</div>`);
    }
    this.setSection(this.alerts, 'alerts', chips.join(''));
  }

  // ------------------------------------------------------------------ selection panels

  onSelectionChanged(): void {
    this.sectionCache.delete('left');
    this.sectionCache.delete('right');
    this.sectionCache.delete('cards');
    this.refreshPanels();
  }

  private selectedUnits(): Unit[] {
    const out: Unit[] = [];
    for (const id of this.g.selection) {
      const u = this.sim.state.units.get(id);
      if (u) out.push(u);
    }
    return out;
  }

  private refreshPanels(): void {
    const units = this.selectedUnits();
    const city = this.g.selectedCity >= 0 ? this.sim.state.cities[this.g.selectedCity] : null;
    let leftHtml = '';
    let rightHtml = '';
    if (units.length === 1) {
      leftHtml = this.unitPanel(units[0]);
      rightHtml = units[0].owner === this.sim.state.player ? this.unitActions(units) : '';
    } else if (units.length > 1) {
      leftHtml = this.armyPanel(units);
      rightHtml = this.unitActions(units);
    } else if (city) {
      leftHtml = this.cityPanel(city);
      rightHtml = city.owner === this.sim.state.player ? this.cityActions(city) : '';
    }
    this.left.classList.toggle('hidden', !leftHtml);
    this.right.classList.toggle('hidden', !rightHtml);
    this.layers.style.display = rightHtml ? 'none' : '';
    if (leftHtml) this.setSection(this.left, 'left', leftHtml);
    if (rightHtml) this.setSection(this.right, 'right', rightHtml);
    this.refreshCards(units);
  }

  private relTag(owner: string): string {
    const s = this.sim.state;
    if (owner === s.player) return '';
    return atWar(s, s.player, owner) ? `<span class="tag bad">${t('At war')}</span>` : `<span class="tag good">${t('At peace')}</span>`;
  }

  private unitPanel(u: Unit): string {
    const def = unitDef(u.type);
    const st = this.sim.tech.stats(u.owner, u.type);
    const f = this.sim.state.factions[u.owner];
    const own = u.owner === this.sim.state.player;
    const r = u.hp / u.maxHp;
    const terrain = TERRAIN_NAMES[this.sim.geo.terrain[worldToCell(u.x, u.y)]];
    const abil: string[] = [];
    if (def.stealth) abil.push(t('Stealth'));
    if (def.sonar) abil.push(t('Sonar'));
    if (def.intercept) abil.push(`${t('Intercept')} ${Math.round((def.intercept + this.sim.tech.getMods(u.owner).intercept) * 100)}%`);
    if (def.missiles) abil.push(`${t('Missiles')} ${u.missiles}/${def.missiles + this.sim.tech.getMods(u.owner).missileCap}`);
    if (def.capacity) abil.push(t('Carries {n} land units', { n: def.capacity }));
    if (def.splash) abil.push(t('Splash damage'));
    if (def.stationaryFire) abil.push(t('Must halt to fire'));
    if (def.abilities?.includes('repair')) abil.push(t('Repairs'));
    if (def.abilities?.includes('fastCapture')) abil.push(t('Fast capture'));
    if (def.abilities?.includes('airstrike')) abil.push(t('Air wing'));
    if (u.bonus > 1 && this.sim.state.time < u.bonusUntil) abil.push(`<span class="good">${t('Offensive bonus +{b}%', { b: Math.round((u.bonus - 1) * 100) })}</span>`);
    const sub = def.stealth ? (u.revealed > 0 ? `<span class="warn">${t('Surfaced / revealed')}</span>` : `<span class="good">${t('Submerged')}</span>`) : '';
    let cargo = '';
    if (def.capacity) {
      const list = u.cargo ?? [];
      const slots = Array.from({ length: def.capacity }, (_, i) => {
        const c = list[i];
        return c ? `<div class="slot full" data-tip="${esc(`<b>${t(unitDef(c.type).name)}</b><br/>${Math.ceil(c.hp)}/${Math.round(c.maxHp)} HP`)}"><img src="${this.portrait(c.type, c.owner)}"/></div>` : `<div class="slot"></div>`;
      }).join('');
      cargo = `<div class="section-label">${t('Cargo')} ${list.length}/${def.capacity}</div><div class="cargo">${slots}</div>
        ${own ? `<div class="muted" style="font-size:12px;margin-top:4px">${list.length ? t('Right-click a coast to land the troops, or press Unload.') : t('Select land units and right-click this ship to board.')}</div>` : ''}`;
    }
    return `<div class="panel-title"><span style="color:${colorCss(f.color)}">■</span>${esc(factionName(u.owner))}${this.relTag(u.owner)}<span class="grow"></span><span class="tag">${def.short}</span></div>
      <div class="panel-body">
        <div class="sel-head"><div class="sel-portrait"><img src="${this.portrait(u.type, u.owner)}"/></div>
          <div><div class="sel-name">${esc(t(def.name))}</div><div class="sel-sub">${esc(t(def.role))} · <span class="rank">${'★'.repeat(u.rank)}${'☆'.repeat(3 - u.rank)}</span></div>
          <div class="sel-sub">${STATUS(u)} · ${def.domain === 'naval' ? t('At sea') : t(terrain)} ${sub}</div></div></div>
        <div class="row" style="font-size:13px"><span class="muted">${t('Health')}</span><span class="spacer"></span><span class="num">${Math.ceil(u.hp)} / ${Math.round(u.maxHp)}</span></div>
        ${bar(r, hpClass(r))}
        <div class="stat-grid">
          <div class="stat"><span>${t('Attack')}</span><span>${st.attack.toFixed(0)}</span></div>
          <div class="stat"><span>${t('Defense')}</span><span>${st.defense.toFixed(0)}</span></div>
          <div class="stat"><span>${t('Speed')}</span><span>${st.speed.toFixed(0)}</span></div>
          <div class="stat"><span>${t('Range')}</span><span>${st.range.toFixed(0)}</span></div>
          <div class="stat"><span>${t('Detection')}</span><span>${st.detection.toFixed(0)}</span></div>
          <div class="stat"><span>${t('Kills')}</span><span>${u.kills}</span></div>
          ${own ? `<div class="stat"><span>XP</span><span>${Math.floor(u.xp)}</span></div><div class="stat"><span>${t('Upkeep')}</span><span>${(def.upkeep.money ?? 0).toFixed(1)}/h</span></div>` : ''}
        </div>
        <div class="abilities">${abil.map((a) => `<span class="tag">${a}</span>`).join('')}</div>
        ${cargo}
        <div class="muted" style="font-size:13px;margin-top:8px;line-height:1.3">${esc(t(def.desc))}</div>
      </div>`;
  }

  private armyPanel(units: Unit[]): string {
    const counts = new Map<string, number>();
    let hp = 0;
    let max = 0;
    let atk = 0;
    let aboard = 0;
    for (const u of units) {
      counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
      hp += u.hp;
      max += u.maxHp;
      atk += this.sim.tech.stats(u.owner, u.type).attack;
      aboard += u.cargo?.length ?? 0;
    }
    const land = units.filter((u) => unitDef(u.type).domain === 'land').length;
    const naval = units.length - land;
    const comp = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([ty, n]) => `<div class="row" style="padding:2px 0;cursor:pointer" data-a="selType" data-v="${ty}"><img src="${this.portrait(ty, units[0].owner)}" style="height:22px;width:32px;object-fit:contain"/><span>${esc(t(unitDef(ty).name))}</span><span class="spacer"></span><b class="num">×${n}</b></div>`)
      .join('');
    return `<div class="panel-title">${ICONS.garrison}<span>${t('Task Force')}</span><span class="grow"></span><span class="tag">${t('{n} units', { n: units.length })}</span></div>
      <div class="panel-body">
        <div class="stat-grid">
          <div class="stat"><span>${t('Land')}</span><span>${land}</span></div>
          <div class="stat"><span>${t('Naval')}</span><span>${naval}</span></div>
          <div class="stat"><span>${t('Firepower')}</span><span>${atk.toFixed(0)}</span></div>
          <div class="stat"><span>${t('Strength')}</span><span>${Math.round((hp / max) * 100)}%</span></div>
          ${aboard ? `<div class="stat"><span>${t('Aboard ships')}</span><span>${aboard}</span></div>` : ''}
        </div>
        ${bar(hp / max, hpClass(hp / max))}
        <div class="section-label">${t('Composition')}</div>${comp}
      </div>`;
  }

  private cityPanel(c: City): string {
    const s = this.sim.state;
    const f = s.factions[c.owner];
    const own = c.owner === s.player;
    const y = cityYield(c);
    let garrison = 0;
    this.sim.spatial.forEachInRange(c.x, c.y, 90, (u) => {
      if (u.owner === c.owner && unitDef(u.type).domain === 'land') garrison++;
    });
    const q = c.queue[0];
    const qName = (id: string, kind: string) => (kind === 'unit' ? t(unitDef(id).name) : t(BUILDING_DEFS.find((b) => b.id === id)?.name ?? id));
    const prod = q
      ? `<div class="row" style="font-size:13px"><span>${esc(qName(q.id, q.kind))}</span><span class="spacer"></span><span class="muted">${Math.floor((q.progress / q.time) * 100)}%</span></div>${bar(q.progress / q.time, 'prog')}${c.queue.length > 1 ? `<div class="muted" style="font-size:12px">${t('+{n} queued', { n: c.queue.length - 1 })}</div>` : ''}`
      : `<div class="muted" style="font-size:13px">${own ? t('Idle — queue production') : '—'}</div>`;
    const tagNames: Record<string, string> = { o: 'Oil', m: 'Metals', f: 'Farmland', e: 'Energy' };
    const tags = c.tags.split('').map((x) => tagNames[x]).filter(Boolean).map((x) => t(x));
    const war = !own && atWar(s, s.player, c.owner);
    const foreignHint = war
      ? t('Enemy city. Select your units and right-click it to assault. Reduce its defences to zero, then occupy it with land units.')
      : t('This country is at peace with you. Select land units and press <b>Prepare Offensive</b> (O) to plan an attack — or declare war in Diplomacy.');
    return `<div class="panel-title"><span style="color:${colorCss(f?.color ?? 0x999999)}">■</span>${esc(factionName(c.owner))}${this.relTag(c.owner)}<span class="grow"></span>${c.capital ? `<span class="tag gold">${t('Capital')}</span>` : ''}</div>
      <div class="panel-body">
        <div class="sel-head"><div class="sel-portrait" style="font-size:34px;color:${colorCss(f?.color ?? 0x999999)}">${ICONS.city}</div>
          <div><div class="sel-name">${esc(tn(c))}</div><div class="sel-sub">${t(SIZE_NAMES[c.size])} · ${t('Industry')} ${c.industry}${c.port ? ` · ${t('Port')}` : ''}${c.airport ? ` · ${t('Airport')}` : ''}</div>
          <div class="sel-sub">${tags.length ? tags.join(' · ') : t('No special resources')}${c.unrest > 0 ? ` · <span class="bad">${t('UNREST')}</span>` : ''}</div>
          ${c.origOwner !== c.owner ? `<div class="sel-sub muted">${t('Originally {name}', { name: esc(factionName(c.origOwner)) })}</div>` : ''}</div></div>
        <div class="row" style="font-size:13px"><span class="muted">${t('Defences')}</span><span class="spacer"></span><span class="num">${Math.ceil(c.hp)} / ${Math.round(c.maxHp)}</span></div>
        ${bar(c.hp / c.maxHp, c.hp / c.maxHp > 0.5 ? 'prog' : 'red')}
        ${c.capture > 0 && c.capturer ? `<div class="row" style="font-size:13px;margin-top:4px"><span class="bad">${t('Being captured by {name}', { name: esc(factionName(c.capturer)) })}</span><span class="spacer"></span><span>${Math.floor(c.capture * 100)}%</span></div>${bar(c.capture, 'red')}` : ''}
        <div class="stat-grid">
          <div class="stat"><span>${t('Garrison')}</span><span>${garrison}</span></div>
          <div class="stat"><span>${t('Armour')}</span><span>${cityDefense(c)}</span></div>
          <div class="stat"><span>${t('Gun range')}</span><span>${cityRange(c)}</span></div>
          <div class="stat"><span>${t('Importance')}</span><span>${c.importance}</span></div>
          ${own ? `<div class="stat"><span>${RES_ICON.money} /h</span><span>${y.res.money.toFixed(1)}</span></div><div class="stat"><span>${RES_ICON.metal} /h</span><span>${y.res.metal.toFixed(1)}</span></div>
          <div class="stat"><span>${RES_ICON.fuel} /h</span><span>${y.res.fuel.toFixed(1)}</span></div><div class="stat"><span>${RES_ICON.food} /h</span><span>${y.res.food.toFixed(1)}</span></div>` : ''}
        </div>
        ${own ? `<div class="section-label">${t('Production')}</div>${prod}
        <button class="btn primary" style="width:100%;margin-top:10px" data-a="openCity" data-v="${c.id}">${ICONS.city} ${t('Manage City')}</button>` : `<div class="muted" style="font-size:13px;margin-top:8px;line-height:1.35">${foreignHint}</div>`}
      </div>`;
  }

  private actionBtn(a: string, icon: string, label: string, key = '', v = '', disabled = false, tip = '', cls = ''): string {
    return `<button class="btn ${cls}" data-a="${a}" data-v="${v}" ${disabled ? 'disabled' : ''} ${tip ? `data-tip="${esc(tip)}"` : ''}><span class="ai">${icon}</span>${label}${key ? `<span class="key">${key}</span>` : ''}</button>`;
  }

  private unitActions(units: Unit[]): string {
    const own = units.filter((u) => u.owner === this.sim.state.player);
    if (!own.length) return '';
    const missiles = own.filter((u) => unitDef(u.type).missiles);
    const ready = missiles.filter((u) => this.sim.combat.canLaunch(u)).length;
    const land = own.filter((u) => unitDef(u.type).domain === 'land');
    const transports = own.filter((u) => u.type === 'transport');
    const loaded = transports.filter((u) => u.cargo?.length);
    const mode = this.g.mode;
    return `<div class="panel-title">${ICONS.target}<span>${t('Orders')}</span></div>
      <div class="actions">
        ${this.actionBtn('info', ICONS.move, t('Move'), t('R-CLICK'), '', false, t('Right-click on the map to move. Right-click an enemy to attack it.'))}
        ${this.actionBtn('attackMove', ICONS.attack, t('Attack-Move'), 'A', '', false, t('Advance and engage anything on the way'), mode === 'attackMove' ? 'active' : '')}
        ${this.actionBtn('stop', ICONS.stop, t('Stop'), 'S')}
        ${this.actionBtn('hold', ICONS.hold, t('Hold'), 'H', '', false, t('Hold position and fire at enemies in range'))}
        ${land.length ? this.actionBtn('offensive', ICONS.flag, t('Prepare Offensive'), 'O', '', false, t('Pick an enemy or foreign city: troops gather at a staging area and prepare (up to +25% attack), then you launch the attack from the Operations strip.'), `wide ${mode === 'offensive' ? 'active' : ''}`) : ''}
        ${land.length ? this.actionBtn('board', ICONS.board, t('Board Transport'), 'B', '', false, t('Click one of your Transport Ships: up to 6 land units go aboard (or right-click the ship).'), `wide ${mode === 'board' ? 'active' : ''}`) : ''}
        ${transports.length ? this.actionBtn('unload', ICONS.unload, t('Unload at…'), 'U', '', !loaded.length, t('Click a coast: the transport sails there and lands its troops (or right-click the coast).'), `wide ${mode === 'unload' ? 'active' : ''}`) : ''}
        ${transports.length ? this.actionBtn('unloadHere', ICONS.unload, t('Unload here'), '', '', !loaded.length, t('Land the troops right now (the ship must be next to land).'), 'wide') : ''}
        ${missiles.length ? this.actionBtn('missile', ICONS.missile, `${t('Missile')} (${ready})`, 'M', '', ready === 0, t('Launch a guided missile at an enemy unit or city in range'), `wide ${mode === 'missile' ? 'active' : ''}`) : ''}
        ${this.actionBtn('repairUnits', ICONS.repair, t('Repair'), '', '', !own.some((u) => u.hp < u.maxHp - 1), t('Return to the nearest friendly city or port. Units in friendly cities repair over time (faster with engineers).'))}
        ${this.actionBtn('center', ICONS.eye, t('Center'), 'C')}
        ${this.actionBtn('disband', ICONS.trash, t('Disband'), 'DEL', '', false, t('Permanently disband selected units (saves upkeep)'), 'wide')}
      </div>`;
  }

  private cityActions(c: City): string {
    const quick = ['infantry', 'medium_tank', 'artillery', c.port ? 'transport' : 'anti_air', c.port ? 'destroyer' : 'light_tank'];
    const f = this.player;
    const quickHtml = quick
      .map((ty) => {
        const chk = this.sim.production.canProduceUnit(c, ty);
        const def = unitDef(ty);
        return `<button class="btn" data-a="produce" data-v="${ty}" ${chk.ok ? '' : 'disabled'} data-tip="${esc(`<b>${t(def.name)}</b><br/>${costHtml(def.cost, f.res)}<br/>${t('{h}h build', { h: def.time })}${chk.ok ? '' : `<br/><span class='warn'>${t(chk.reason ?? '')}</span>`}`)}"><img src="${this.portrait(ty, f.id)}" style="height:22px"/>${def.short}</button>`;
      })
      .join('');
    const repairCost = Math.round((c.maxHp - c.hp) * 0.8);
    const canRepair = c.hp < c.maxHp - 1 && this.sim.state.time - c.lastAttacked > 5 && f.res.money >= repairCost;
    return `<div class="panel-title">${ICONS.city}<span>${t('City Orders')}</span></div>
      <div class="actions">
        ${this.actionBtn('openCity', ICONS.city, t('Manage'), '', String(c.id), false, '', 'wide primary')}
        ${quickHtml}
        ${this.actionBtn('repair', ICONS.repair, t('Repair'), '', '', !canRepair, t('Restore defences for ${n} (not while under fire)', { n: repairCost }))}
        ${this.actionBtn('garrison', ICONS.garrison, t('Garrison'), '', '', false, t('Select all friendly units in the city'))}
        ${(c.buildings.missile_battery ?? 0) > 0 ? this.actionBtn('cityMissile', ICONS.missile, `${t('Missile')} (${Math.floor(c.missiles)})`, 'M', '', c.missiles < 1, t('City missile battery · range {r}', { r: CITY_MISSILE_RANGE }), 'wide') : ''}
      </div>`;
  }

  private refreshCards(units: Unit[]): void {
    if (!units.length) {
      const city = this.g.selectedCity >= 0 ? this.sim.state.cities[this.g.selectedCity] : null;
      this.cardTitle.innerHTML = city ? `${ICONS.city}<span>${esc(tn(city))} — ${t('Production Queue')}</span>` : `${ICONS.target}<span>${t('Command')}</span>`;
      if (city && city.owner === this.sim.state.player) {
        const html = city.queue.length
          ? city.queue
              .map((q, i) => `<div class="ucard" data-a="cancelQ" data-v="${i}" data-tip="${esc(`<b>${q.kind === 'unit' ? t(unitDef(q.id).name) : t(BUILDING_DEFS.find((b) => b.id === q.id)?.name ?? q.id)}</b><br/>${t('Click to cancel')}`)}">${q.kind === 'unit' ? `<img src="${this.portrait(q.id, city.owner)}"/>` : `<span style="font-size:22px">${BUILDING_DEFS.find((b) => b.id === q.id)?.icon ?? '🏗'}</span>`}${bar(q.progress / q.time, 'prog')}</div>`)
              .join('')
          : `<div class="empty-hint">${t('Queue is empty. Use the city orders on the right or <b>Manage City</b> to build units and infrastructure.')}</div>`;
        this.setSection(this.cards, 'cards', html);
      } else {
        this.setSection(this.cards, 'cards', this.hintHtml());
      }
      return;
    }
    this.cardTitle.innerHTML = `${ICONS.garrison}<span>${t('Selected — {n} units', { n: units.length })}</span>`;
    const shown = units.slice(0, 48);
    const html =
      shown
        .map((u) => {
          const r = u.hp / u.maxHp;
          const cargo = u.cargo?.length ? `<span class="cg">${u.cargo.length}</span>` : '';
          return `<div class="ucard" data-a="card" data-v="${u.id}" data-tip="${esc(`<b>${t(unitDef(u.type).name)}</b><br/>${Math.ceil(u.hp)}/${Math.round(u.maxHp)} HP · ${STATUS(u)}`)}"><img src="${this.portrait(u.type, u.owner)}"/>${u.rank ? `<span class="rk">${'★'.repeat(u.rank)}</span>` : ''}${cargo}${bar(r, hpClass(r))}</div>`;
        })
        .join('') + (units.length > shown.length ? `<div class="ucard"><span class="num gold">+${units.length - shown.length}</span></div>` : '');
    this.setSection(this.cards, 'cards', html);
  }

  private refreshLog(): void {
    const log = this.sim.state.log;
    if (log.length === this.lastLogLen && this.lastLogLen >= 0) return;
    this.lastLogLen = log.length;
    this.logList.innerHTML = log
      .slice(-40)
      .reverse()
      .map((e) => `<div class="log-item ${e.kind}" ${e.x !== undefined ? `data-x="${e.x}" data-y="${e.y}"` : ''}><span class="t">${gameDate(e.t).time}</span><span>${esc(e.text)}</span></div>`)
      .join('');
  }

  // ------------------------------------------------------------------ minimap

  private setupMinimap(box: HTMLElement): void {
    const jump = (ev: MouseEvent) => {
      const r = this.mini.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * WORLD_W;
      const y = ((ev.clientY - r.top) / r.height) * WORLD_H;
      this.g.controls.centerOn(x, y, false);
    };
    let down = false;
    box.addEventListener('mousedown', (e) => {
      down = true;
      jump(e);
    });
    const up = () => (down = false);
    window.addEventListener('mouseup', up);
    this.cleanups.push(() => window.removeEventListener('mouseup', up));
    box.addEventListener('mousemove', (e) => down && jump(e));
  }

  private drawMinimap(): void {
    const c = this.mini;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      this.miniBaseT = -1;
    }
    const ctx = c.getContext('2d')!;
    const map = this.g.map;
    if (this.miniBaseT !== map.version) {
      this.miniBaseT = map.version;
      const b = this.miniBase;
      b.width = c.width;
      b.height = c.height;
      const bctx = b.getContext('2d')!;
      bctx.fillStyle = '#0b2a4a';
      bctx.fillRect(0, 0, b.width, b.height);
      bctx.drawImage(MapAssets.terrainCanvas, 0, 0, b.width, b.height);
      const terr = map.territoryCanvas();
      if (terr) {
        bctx.globalAlpha = 1;
        bctx.drawImage(terr, 0, 0, b.width, b.height);
        bctx.drawImage(terr, 0, 0, b.width, b.height);
      }
    }
    ctx.drawImage(this.miniBase, 0, 0);
    const sx = c.width / WORLD_W;
    const sy = c.height / WORLD_H;
    const s = this.sim.state;
    const pc = colorCss(this.player.color);
    for (const u of s.units.values()) {
      const own = u.owner === s.player;
      if (!own && (!atWar(s, s.player, u.owner) || !this.g.unitViews.isVisibleToPlayer(u))) continue;
      ctx.fillStyle = own ? '#ffffff' : '#ff4d3d';
      const r = own ? 2.2 * dpr : 1.8 * dpr;
      ctx.fillRect(u.x * sx - r / 2, u.y * sy - r / 2, r, r);
    }
    for (const city of s.cities) {
      if (city.owner !== s.player) continue;
      ctx.fillStyle = pc;
      const r = (city.capital ? 3.5 : 2.5) * dpr;
      ctx.fillRect(city.x * sx - r / 2, city.y * sy - r / 2, r, r);
    }
    const v = this.g.cameras.main.worldView;
    ctx.strokeStyle = '#ffe28a';
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect(v.x * sx, v.y * sy, v.width * sx, v.height * sy);
  }

  // ------------------------------------------------------------------ per-frame

  update(dt: number): void {
    this.refreshT -= dt;
    this.miniT -= dt;
    if (this.refreshT <= 0) {
      this.refreshT = 0.2;
      // Hide UI tooltips whose source element was re-rendered away.
      if (!this.worldTipOn && this.tipSrc && !this.tipSrc.isConnected) {
        this.tip.style.display = 'none';
        this.tipSrc = null;
      }
      this.updateTop();
      this.updateAlerts();
      this.refreshPanels();
      this.refreshLog();
      this.refreshWindow();
      if (this.debugEl) this.updateDebug();
      this.fpsEl.style.display = Settings.data.showFps ? 'block' : 'none';
      if (Settings.data.showFps) this.fpsEl.textContent = `${Math.round(this.g.game.loop.actualFps)} FPS`;
      const m = this.g.mode;
      const hints: Record<string, string> = {
        attackMove: 'ATTACK-MOVE · left-click destination · right-click / Esc to cancel',
        missile: 'MISSILE STRIKE · left-click an enemy unit or city in range · right-click / Esc to cancel',
        cityMissile: 'MISSILE STRIKE · left-click an enemy unit or city in range · right-click / Esc to cancel',
        strike: 'MISSILE STRIKE · click an enemy unit or city — the nearest ready launcher fires · Shift = keep firing · Esc to cancel',
        board: 'BOARD · click one of your Transport Ships · Esc to cancel',
        unload: 'UNLOAD · click a coast to land the troops · Esc to cancel',
        offensive: 'PREPARE OFFENSIVE · click the target city (enemy or foreign) · Esc to cancel',
      };
      this.hint.style.display = m === 'normal' ? 'none' : 'block';
      this.hint.textContent = hints[m] ? t(hints[m]) : '';
    }
    if (this.miniT <= 0) {
      this.miniT = 0.5;
      this.drawMinimap();
    }
  }

  // ------------------------------------------------------------------ actions

  private action(a: string, v: string, _el: HTMLElement, ev: MouseEvent): void {
    const g = this.g;
    App.audio.play('click');
    switch (a) {
      case 'speed':
        if (v === '0') g.togglePause();
        else g.setSpeed(Number(v));
        break;
      case 'strike':
        if (g.mode === 'strike') g.setMode('normal');
        else g.beginStrike();
        break;
      case 'research': this.openResearch(); break;
      case 'market': this.openMarket(); break;
      case 'factions': this.openFactions(); break;
      case 'saveload': this.openSaveLoad(); break;
      case 'pause': this.openPause(); break;
      case 'layer':
        g.map.setLayer(v as MapLayer);
        g.cityViews.showBadges = v === 'military';
        this.layers.querySelectorAll('.btn').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.v === v));
        break;
      case 'attackMove': g.setMode(g.mode === 'attackMove' ? 'normal' : 'attackMove'); break;
      case 'stop': g.orderStop(); break;
      case 'hold': g.orderHold(); break;
      case 'missile': g.beginMissile(); break;
      case 'offensive':
        if (g.mode === 'offensive') g.setMode('normal');
        else g.beginOffensive();
        break;
      case 'board':
        if (g.mode === 'board') g.setMode('normal');
        else g.beginBoard();
        break;
      case 'unload':
        if (g.mode === 'unload') g.setMode('normal');
        else g.beginUnload();
        break;
      case 'unloadHere': g.unloadHere(); break;
      case 'center': g.centerOnSelection(); break;
      case 'disband': g.disbandSelected(); break;
      case 'repairUnits': g.returnForRepairs(); break;
      case 'selType': g.select(this.selectedUnits().filter((u) => u.type === v).map((u) => u.id), false); break;
      case 'card': {
        const id = Number(v);
        if (ev.shiftKey) g.select([...g.selection].filter((x) => x !== id), false);
        else {
          g.select([id], false);
          const u = this.sim.state.units.get(id);
          if (u && ev.detail >= 2) g.controls.centerOn(u.x, u.y);
        }
        break;
      }
      case 'openCity': this.openCity(Number(v)); break;
      case 'produce': g.produce(g.selectedCity, v); break;
      case 'cancelQ': g.cancelQueue(g.selectedCity, Number(v)); break;
      case 'repair': g.repairCity(g.selectedCity); break;
      case 'garrison': g.selectGarrison(g.selectedCity); break;
      case 'cityMissile': g.setMode('cityMissile'); break;
      case 'info': this.toast(t('Right-click on the map to move selected units'), 'info'); break;
      case 'opLaunch': g.launchOperation(Number(v)); break;
      case 'opCancel': g.cancelOperation(Number(v)); break;
      case 'opView': {
        const op = this.sim.state.ops.find((o) => o.id === Number(v));
        if (op) {
          g.controls.centerOn(op.stageX, op.stageY);
          g.select(op.units.filter((id) => this.sim.state.units.has(id)), false);
        }
        break;
      }
      case 'threat': {
        const c = this.sim.state.cities[Number(v)];
        if (c) g.controls.centerOn(c.x, c.y);
        break;
      }
    }
    this.sectionCache.delete('right');
    this.sectionCache.delete('alerts');
  }

  // ------------------------------------------------------------------ windows

  closeWindow(): void {
    this.win?.close();
  }

  private open(kind: string, title: string, cls: string, arg = -1): Win {
    this.win?.close();
    this.tip.style.display = 'none';
    const w = openWindow(this.root, title, cls, () => {
      if (this.win === w) {
        this.win = null;
        this.winKind = '';
        if (this.pausedByMenu) {
          this.pausedByMenu = false;
          this.g.sim.state.paused = false;
        }
      }
    });
    this.win = w;
    this.winKind = kind;
    this.winArg = arg;
    for (const k of [...this.sectionCache.keys()]) if (k.startsWith('win')) this.sectionCache.delete(k);
    delegate(w.body, (a, v, e, ev) => this.winAction(a, v, e, ev));
    return w;
  }

  private refreshWindow(): void {
    if (!this.win) return;
    if (this.winKind === 'city') this.renderCity();
    else if (this.winKind === 'research') this.renderResearch();
    else if (this.winKind === 'market') this.renderMarket();
    else if (this.winKind === 'factions') this.renderFactions();
  }

  openCity(id: number): void {
    const c = this.sim.state.cities[id];
    if (!c || c.owner !== this.sim.state.player) return;
    this.g.selectCity(id);
    const w = this.open('city', `${ICONS.city} ${t('City Management')}`, 'city-win', id);
    w.body.innerHTML = `<div data-s="head"></div><div class="city-grid"><div><div data-s="stats"></div><div class="section-label">${t('Infrastructure')}</div><div data-s="blds"></div></div>
      <div><div class="section-label">${t('Production queue')}</div><div data-s="queue"></div><div class="section-label">${t('Land forces')}</div><div class="prod-grid" data-s="land"></div><div data-s="navalwrap"><div class="section-label">${t('Naval forces')}</div><div class="prod-grid" data-s="naval"></div></div></div></div>`;
    this.renderCity();
  }

  private renderCity(): void {
    const w = this.win!;
    const c = this.sim.state.cities[this.winArg];
    if (!c || c.owner !== this.sim.state.player) {
      this.closeWindow();
      return;
    }
    const f = this.player;
    const q = (k: string) => w.body.querySelector<HTMLElement>(`[data-s="${k}"]`)!;
    const y = cityYield(c);
    const naval = c.port;
    const rateL = this.sim.production.cityRate(c, false, true);
    const rateN = this.sim.production.cityRate(c, true, false);
    this.setSection(q('head'), 'win-head', `<div class="city-banner" style="border-color:${colorCss(f.color)}"><div class="nm">${esc(tn(c))}</div>${c.capital ? `<span class="tag gold">${t('Capital')}</span>` : ''}${c.port ? `<span class="tag">${ICONS.anchor} ${t('Port')}</span>` : ''}${c.airport ? `<span class="tag">${ICONS.plane} ${t('Airport')}</span>` : ''}${c.unrest > 0 ? `<span class="tag bad">${t('Unrest {h}h', { h: Math.ceil(c.unrest) })}</span>` : ''}<span class="spacer"></span><span class="muted">${t(SIZE_NAMES[c.size])} · ${t('pop.')} ${(c.size * c.size * 0.9 + c.industry * 0.3).toFixed(1)}M</span></div>`);
    this.setSection(q('stats'), 'win-stats', `
      <div class="row" style="font-size:13px"><span class="muted">${t('Defences')}</span><span class="spacer"></span><span class="num">${Math.ceil(c.hp)} / ${Math.round(c.maxHp)}</span></div>${bar(c.hp / c.maxHp, 'prog')}
      <div class="stat-grid">
        <div class="stat"><span>${t('Industry')}</span><span>${c.industry}</span></div><div class="stat"><span>${t('Land prod.')}</span><span>×${rateL.toFixed(2)}</span></div>
        <div class="stat"><span>${t('Naval prod.')}</span><span>${naval ? `×${rateN.toFixed(2)}` : '—'}</span></div><div class="stat"><span>${t('Missiles')}</span><span>${(c.buildings.missile_battery ?? 0) ? Math.floor(c.missiles) : '—'}</span></div>
        <div class="stat"><span>${RES_ICON.money} ${t('Money')}</span><span>${fmtRate(y.res.money)}</span></div><div class="stat"><span>${RES_ICON.metal} ${t('Metal')}</span><span>${fmtRate(y.res.metal)}</span></div>
        <div class="stat"><span>${RES_ICON.fuel} ${t('Fuel')}</span><span>${fmtRate(y.res.fuel)}</span></div><div class="stat"><span>${RES_ICON.food} ${t('Food')}</span><span>${fmtRate(y.res.food)}</span></div>
        <div class="stat"><span>${RES_ICON.power} ${t('Power')}</span><span>${y.powerSupply.toFixed(0)}/${y.powerDemand.toFixed(0)}</span></div><div class="stat"><span>${RES_ICON.industry} IC</span><span>${y.industry.toFixed(1)}</span></div>
      </div>`);
    this.setSection(
      q('blds'),
      'win-blds',
      BUILDING_DEFS.filter((b) => !b.needsPort || c.port)
        .map((b) => {
          const lvl = c.buildings[b.id] ?? 0;
          const chk = this.sim.production.canBuild(c, b.id);
          const queued = this.sim.production.queuedLevel(c, b.id) - lvl;
          const cost = buildingCost(b.id, this.sim.production.queuedLevel(c, b.id));
          return `<div class="bld"><span class="ic">${b.icon}</span><div><div class="nm">${t(b.name)} <span class="lv">${'■'.repeat(lvl)}${'□'.repeat(b.maxLevel - lvl)}</span>${queued > 0 ? ` <span class="muted">(${t('queued')})</span>` : ''}</div><div class="ds">${t(b.desc)}</div></div>
          ${lvl + queued >= b.maxLevel ? '<span class="tag">MAX</span>' : `<button class="btn small" data-a="build" data-v="${b.id}" ${chk.ok ? '' : 'disabled'} data-tip="${esc(`${costHtml(cost, f.res)}${chk.ok ? '' : `<br/><span class='warn'>${t(chk.reason ?? '')}</span>`}`)}">${t('Build')}</button>`}</div>`;
        })
        .join(''),
    );
    this.setSection(
      q('queue'),
      'win-queue',
      c.queue.length
        ? c.queue
            .map((it, i) => {
              const nm = it.kind === 'unit' ? esc(t(unitDef(it.id).name)) : `${BUILDING_DEFS.find((b) => b.id === it.id)?.icon ?? ''} ${esc(t(BUILDING_DEFS.find((b) => b.id === it.id)?.name ?? it.id))}`;
              const eta = i === 0 ? `<span class="muted">· ${Math.max(0, Math.ceil((it.time - it.progress) / Math.max(0.01, it.kind === 'unit' && unitDef(it.id).domain === 'naval' ? rateN : rateL)))}${t('h')}</span>` : `<span class="muted">· ${t('waiting')}</span>`;
              return `<div class="queue-item"><span>${nm} ${eta}</span><button class="btn small danger" data-a="cancel" data-v="${i}" data-tip="${esc(t('Cancel (full refund if not started)'))}">${ICONS.close}</button>${bar(it.progress / it.time, 'prog')}</div>`;
            })
            .join('')
        : `<div class="muted">${t('Nothing in production.')}</div>`,
    );
    const prodCard = (id: string) => {
      const def = unitDef(id);
      const chk = this.sim.production.canProduceUnit(c, id);
      const extra = def.capacity ? `<br/><span class='good'>${t('Carries {n} land units', { n: def.capacity })}</span>` : '';
      return `<div class="prod ${chk.ok ? '' : 'disabled'}" data-a="produce" data-v="${id}" data-tip="${esc(`<b>${t(def.name)}</b> — ${t(def.role)}<br/>${t(def.desc)}<br/>ATK ${def.attack} · DEF ${def.defense} · HP ${def.hp} · RNG ${def.range}${extra}<br/>${t('Upkeep')} ${costHtml(def.upkeep)} /h`)}">
        <img src="${this.portrait(id, f.id)}"/><div class="nm">${t(def.name)}</div><div class="cost">${costHtml(def.cost, f.res)}</div><div class="cost">${def.time}${t('h')}</div>${chk.ok ? '' : `<div class="why">${t(chk.reason ?? '')}</div>`}</div>`;
    };
    this.setSection(q('land'), 'win-land', PRODUCIBLE_UNITS.filter((u) => u.domain === 'land').map((u) => prodCard(u.id)).join(''));
    q('navalwrap').style.display = naval ? '' : 'none';
    if (naval) this.setSection(q('naval'), 'win-naval', PRODUCIBLE_UNITS.filter((u) => u.domain === 'naval').map((u) => prodCard(u.id)).join(''));
  }

  openResearch(): void {
    this.open('research', `${ICONS.research} ${t('Research & Development')}`, 'research-win');
    this.win!.body.innerHTML = `<div data-s="cur"></div><div class="tech-cols" data-s="cols"></div>`;
    this.renderResearch();
  }

  private renderResearch(): void {
    const w = this.win!;
    const f = this.player;
    const cur = f.research;
    const speed = this.sim.tech.researchSpeed(f.id);
    this.setSection(
      w.body.querySelector('[data-s="cur"]')!,
      'win-cur',
      cur
        ? `<div class="row" style="margin-bottom:10px"><span class="muted">${t('Researching')}</span><b>${esc(t(TECH_MAP[cur.id].name))}</b><span class="spacer"></span><span class="muted">${t('{h}h remaining · speed ×{s}', { h: Math.ceil((cur.time - cur.progress) / Math.max(0.01, speed)), s: speed.toFixed(2) })}</span><button class="btn small danger" data-a="cancelResearch">${t('Cancel (50% refund)')}</button></div>${bar(cur.progress / cur.time, 'prog')}<div style="height:10px"></div>`
        : `<div class="row" style="margin-bottom:10px"><span class="warn">${t('No active research.')}</span><span class="muted">${t('Select a technology below. Research labs and power supply speed up research (×{s}).', { s: speed.toFixed(2) })}</span></div>`,
    );
    const cats: [TechCategory, string][] = [['army', 'Army'], ['navy', 'Navy'], ['air', 'Air & Missiles'], ['industry', 'Industry']];
    const cols = cats
      .map(([cat, name]) => {
        const techs = TECH_DEFS.filter((x) => x.category === cat).sort((a, b) => a.tier - b.tier);
        return `<div class="tech-col"><h4>${t(name)}</h4>${techs
          .map((tech) => {
            const done = f.techs.includes(tech.id);
            const active = cur?.id === tech.id;
            const prereq = tech.requires.every((r) => f.techs.includes(r));
            const cls = done ? 'done' : active ? 'active' : tech.future ? 'future' : prereq ? '' : 'locked';
            const req = tech.requires.length ? `${t('Requires')}: ${tech.requires.map((r) => t(TECH_MAP[r]?.name ?? r)).join(', ')}` : '';
            return `<div class="tech ${cls}" data-a="tech" data-v="${tech.id}"><span class="tier">T${tech.tier}</span><div class="nm">${esc(t(tech.name))}</div><div class="ds">${esc(t(tech.desc))}</div>
              ${done ? '' : `<div class="ct">${tech.future ? t('Future expansion') : `${costHtml(tech.cost, f.res)} · ${tech.time}${t('h')}`}</div>`}${!done && !prereq && req ? `<div class="ct warn">${esc(req)}</div>` : ''}${active ? bar(cur!.progress / cur!.time, 'prog') : ''}</div>`;
          })
          .join('')}</div>`;
      })
      .join('');
    this.setSection(w.body.querySelector('[data-s="cols"]')!, 'win-cols', cols);
  }

  openMarket(): void {
    this.open('market', `${ICONS.market} ${t('Commodity Market')}`, '');
    this.win!.root.querySelector('.window')!.setAttribute('style', 'width:660px');
    this.renderMarket();
  }

  private renderMarket(): void {
    const f = this.player;
    const rows = (['metal', 'fuel', 'food'] as const)
      .map((k) => {
        const buy = MARKET_PRICE[k] * MARKET_BUY;
        const sell = MARKET_PRICE[k] * MARKET_SELL;
        return `<div class="market-row"><span>${RES_ICON[k]} <b>${t(RES_NAMES[k])}</b></span><span class="muted">${t('Stock')} <b class="num" style="color:#fff">${fmt(f.res[k])}</b> · ${t('buy')} $${buy.toFixed(1)} · ${t('sell')} $${sell.toFixed(1)}</span>
          <button class="btn small" data-a="trade" data-v="${k}:100" ${f.res.money < buy * 100 ? 'disabled' : ''}>${t('Buy')} 100</button>
          <button class="btn small" data-a="trade" data-v="${k}:500" ${f.res.money < buy * 500 ? 'disabled' : ''}>${t('Buy')} 500</button>
          <button class="btn small" data-a="trade" data-v="${k}:-100" ${f.res[k] < 100 ? 'disabled' : ''}>${t('Sell')} 100</button>
          <button class="btn small" data-a="trade" data-v="${k}:-500" ${f.res[k] < 500 ? 'disabled' : ''}>${t('Sell')} 500</button></div>`;
      })
      .join('');
    this.setSection(this.win!.body, 'win-market', `<div class="muted" style="margin-bottom:8px">${t('Treasury')}: <b class="num gold">$${fmt(f.res.money)}</b>. ${t('Convert surplus commodities into money, or buy what your war machine lacks. Prices include a 30% broker spread.')}</div>${rows}`);
  }

  openFactions(): void {
    this.open('factions', `${ICONS.globe} ${t('Diplomacy')}`, 'diplo-win');
    this.win!.root.querySelector('.window')!.setAttribute('style', 'width:900px');
    this.win!.body.innerHTML = `<div data-s="offers"></div>
      <div class="row diplo-tools"><input class="search" data-k="dq" type="search" autocomplete="off" spellcheck="false"/><div class="row" style="gap:4px" data-s="filters"></div></div>
      <div class="diplo-table" data-s="table"></div><div class="muted" style="margin-top:8px;font-size:13px" data-s="foot"></div>`;
    const input = this.win!.body.querySelector<HTMLInputElement>('input[data-k="dq"]')!;
    input.value = this.diploQuery;
    input.addEventListener('input', () => {
      this.diploQuery = input.value;
      this.sectionCache.delete('win-dtable');
      this.renderFactions();
    });
    input.addEventListener('keydown', (e) => e.stopPropagation());
    this.renderFactions();
  }

  private renderFactions(): void {
    const w = this.win!;
    const s = this.sim.state;
    const me = s.player;
    const q = (k: string) => w.body.querySelector<HTMLElement>(`[data-s="${k}"]`)!;
    const input = w.body.querySelector<HTMLInputElement>('input[data-k="dq"]');
    if (input) input.placeholder = t('Search {n} countries…', { n: FACTIONS.length });
    // Pending peace offers and threats first.
    const threats = this.threats();
    const offers = s.peaceOffers
      .map((o) => `<div class="offer"><span class="ai">${ICONS.peace}</span><b>${esc(factionName(o.from))}</b> ${t('offers a ceasefire.')}<span class="spacer"></span><button class="btn small primary" data-a="acceptPeace" data-v="${o.from}">${t('Accept')}</button><button class="btn small" data-a="rejectPeace" data-v="${o.from}">${t('Reject')}</button></div>`)
      .concat(threats.map((th) => `<div class="offer threat"><span class="ai">${ICONS.alert}</span>${t('<b>{name}</b> is mobilising against you — war in about {h}h.', { name: esc(factionName(th.f)), h: Math.ceil(th.hoursLeft) })}</div>`))
      .join('');
    this.setSection(q('offers'), 'win-doffers', offers);
    const filters: [DiploFilter, string][] = [['relevant', 'Neighbours & wars'], ['war', 'At war'], ['neighbors', 'Neighbours'], ['all', 'All countries']];
    this.setSection(q('filters'), 'win-dfilters', filters.map(([id, n]) => `<button class="btn small ${this.diploFilter === id ? 'active' : ''}" data-a="dfilter" data-v="${id}">${t(n)}</button>`).join(''));
    const myDef = getFactionDef(me)!;
    const neighbors = new Set(myDef.neighbors);
    // Countries across a narrow sea count as neighbours too (any city within 500px of ours).
    const mine = s.cities.filter((c) => c.owner === me);
    for (const c of s.cities) {
      if (c.owner === me || neighbors.has(c.owner)) continue;
      if (mine.some((m) => Math.hypot(m.x - c.x, m.y - c.y) < 500)) neighbors.add(c.owner);
    }
    const needle = this.diploQuery.trim().toLowerCase();
    const myStr = Math.max(1, militaryStrength(this.sim, me));
    let list = FACTIONS.filter((fd) => fd.id !== me && s.factions[fd.id]);
    const warWith = (id: string) => atWar(s, me, id);
    if (needle) list = list.filter((fd) => fd.name.toLowerCase().includes(needle) || (fd.ru ?? '').toLowerCase().includes(needle));
    else if (this.diploFilter === 'war') list = list.filter((fd) => warWith(fd.id));
    else if (this.diploFilter === 'neighbors') list = list.filter((fd) => neighbors.has(fd.id));
    else if (this.diploFilter === 'relevant') list = list.filter((fd) => neighbors.has(fd.id) || warWith(fd.id) || threats.some((th) => th.f === fd.id) || powerTier(fd.id) >= 3);
    const strength = new Map<string, number>();
    for (const fd of list) strength.set(fd.id, militaryStrength(this.sim, fd.id));
    list.sort((a, b) => Number(warWith(b.id)) - Number(warWith(a.id)) || strength.get(b.id)! - strength.get(a.id)!);
    const shown = list.slice(0, 80);
    const rows = shown
      .map((fd) => {
        const f = s.factions[fd.id];
        const cities = s.cities.filter((c) => c.owner === fd.id).length;
        const str = strength.get(fd.id)!;
        const war = warWith(fd.id);
        const since = war ? Math.floor(s.time - (s.warStarted[relKey(me, fd.id)] ?? s.time)) : 0;
        const threat = threats.find((th) => th.f === fd.id);
        const rel = !f.alive ? `<span class="muted">${t('Eliminated')}</span>` : war ? `<span class="bad">${t('At war')}</span> <span class="muted">${since}${t('h')}</span>` : threat ? `<span class="warn">${t('Mobilising!')}</span>` : `<span class="good">${t('Peace')}</span>`;
        const act = !f.alive ? '' : war ? `<button class="btn small" data-a="peace" data-v="${fd.id}">${t('Propose ceasefire')}</button>` : `<button class="btn small danger" data-a="war" data-v="${fd.id}">${t('Declare war')}</button>`;
        const ratio = str / myStr;
        const cmp = ratio > 1.5 ? `<span class="bad">${t('Stronger')}</span>` : ratio < 0.67 ? `<span class="good">${t('Weaker')}</span>` : `<span class="warn">${t('Equal')}</span>`;
        const ms = militaryOf(fd.id);
        const realTip = `<b>${esc(tn(fd))}</b> — ${t('Armed forces')}${ms.real ? '' : ` ${t('(rough estimate)')}`}<br/>${t('Active personnel')}: ${Math.round(ms.p * 1000).toLocaleString('en-US')}<br/>${t('Tanks')}: ${fmt(ms.t)} · ${t('Artillery')}: ${fmt(ms.a)}<br/>${t('Submarines')}: ${ms.s} · ${t('Destroyers & frigates')}: ${ms.d + ms.f} · ${t('Aircraft carriers')}: ${ms.cv}<br/>${t('Defence budget')}: $${ms.b}${t(' bn')}<br/><span class='muted'>${t('Click to show on the map')}</span>`;
        return `<tr><td><span class="swatch" style="background:${fd.css};color:${fd.css}"></span> <b class="dname" data-a="dfocus" data-v="${fd.id}" data-tip="${esc(realTip)}">${esc(tn(fd))}</b>${neighbors.has(fd.id) ? ` <span class="tag">${t('Neighbour')}</span>` : ''}</td><td class="muted">${t(TIER_NAMES[powerTier(fd.id)])}</td><td class="num">${cities}</td><td>${f.alive ? `${bar(Math.min(1, str / Math.max(myStr, str, 1)), 'gold')}<small>${cmp}</small>` : '—'}</td><td>${rel}</td><td>${act}</td></tr>`;
      })
      .join('');
    this.setSection(
      q('table'),
      'win-dtable',
      `<table class="table"><tr><th>${t('Country')}</th><th>${t('Status')}</th><th>${t('Cities')}</th><th>${t('Military vs. you')}</th><th>${t('Relation')}</th><th></th></tr>${rows || `<tr><td colspan="6" class="muted">${t('No countries match.')}</td></tr>`}</table>${list.length > shown.length ? `<div class="muted">${t('+{n} more — refine the search', { n: list.length - shown.length })}</div>` : ''}`,
    );
    this.setSection(q('foot'), 'win-dfoot', t('Everyone starts at peace. Countries that grow strong will mobilise against weaker neighbours and declare war after about two days. Declaring war yourself is instant — preparing an offensive first gives your troops a combat bonus.'));
  }

  openSaveLoad(): void {
    this.win?.close();
    const w = openSaveLoad(this.root, {
      canSave: true,
      onSave: (slot) => this.g.saveGame(slot),
      onLoad: (slot) => this.g.loadGame(slot),
      onClose: () => {
        if (this.win === w) this.win = null;
      },
    });
    this.win = w;
    this.winKind = 'saveload';
  }

  openPause(): void {
    const s = this.sim.state;
    if (!s.paused) {
      s.paused = true;
      this.pausedByMenu = true;
    }
    const w = this.open('pause', `${ICONS.menu} ${t('Command Menu')}`, '');
    w.root.querySelector('.window')!.setAttribute('style', 'width:340px');
    w.body.innerHTML = `<div class="menu-buttons" style="width:100%">
      <button class="menu-btn" data-a="resume">${t('Resume')}</button>
      <button class="menu-btn" data-a="saveload">${t('Save / Load')}</button>
      <button class="menu-btn" data-a="settings">${t('Settings')}</button>
      <button class="menu-btn" data-a="help">${t('Field Manual')}</button>
      <button class="menu-btn" data-a="quit">${t('Exit to Main Menu')}</button></div>`;
  }

  showGameOver(won: boolean): void {
    this.win?.close();
    const s = this.sim.state;
    const f = this.player;
    const w = this.open('gameover', won ? `${ICONS.star} ${t('Victory')}` : t('Defeat'), 'gameover');
    const d = gameDate(s.time);
    const name = esc(factionName(f.id));
    w.body.innerHTML = `<h1 class="${won ? 'gold' : 'bad'}">${won ? t('VICTORY') : t('DEFEAT')}</h1>
      <div class="muted" style="margin-bottom:14px">${won ? t('{name} stands supreme across the globe.', { name }) : t('{name} has fallen.', { name })}</div>
      <table class="table" style="text-align:left"><tr><td>${t('War duration')}</td><td class="num">${t('{n} days', { n: d.day })}</td></tr><tr><td>${t('Cities captured')}</td><td class="num">${f.stats.captured}</td></tr>
      <tr><td>${t('Cities lost')}</td><td class="num">${f.stats.citiesLost}</td></tr><tr><td>${t('Units built')}</td><td class="num">${f.stats.built}</td></tr><tr><td>${t('Enemy units destroyed')}</td><td class="num">${f.stats.killed}</td></tr>
      <tr><td>${t('Units lost')}</td><td class="num">${f.stats.lost}</td></tr><tr><td>${t('Technologies')}</td><td class="num">${f.techs.length}</td></tr></table>
      <div class="row" style="justify-content:center;margin-top:16px;gap:10px">${won ? `<button class="btn" data-a="continue">${t('Continue playing')}</button>` : ''}<button class="btn primary" data-a="quit">${t('Main Menu')}</button></div>`;
    App.audio.play(won ? 'capture' : 'lost');
  }

  private winAction(a: string, v: string, _el: HTMLElement, _ev: MouseEvent): void {
    const g = this.g;
    App.audio.play('click');
    const s = this.sim.state;
    switch (a) {
      case 'produce': g.produce(this.winArg, v); break;
      case 'build': g.build(this.winArg, v); break;
      case 'cancel': g.cancelQueue(this.winArg, Number(v)); break;
      case 'tech': {
        const tech = TECH_MAP[v];
        const chk = this.sim.tech.canResearch(s.player, v);
        if (s.factions[s.player].techs.includes(v)) break;
        if (!chk.ok) {
          App.audio.play('error');
          this.toast(`${t(tech.name)}: ${t(chk.reason ?? '')}`, 'warn');
        } else if (this.sim.tech.startResearch(s.player, v)) {
          App.audio.play('research');
          this.toast(t('Research started: {tech}', { tech: t(tech.name) }), 'good');
        }
        break;
      }
      case 'cancelResearch': this.sim.tech.cancelResearch(s.player); break;
      case 'trade': {
        const [k, n] = v.split(':');
        if (this.sim.econ.trade(s.player, k as Exclude<ResKey, 'money'>, Number(n))) App.audio.play('build');
        else App.audio.play('error');
        break;
      }
      case 'peace': {
        const r = proposePeace(this.sim, s.player, v);
        this.toast(`${factionName(v)}: ${t(r.reason)}`, r.accepted ? 'good' : 'warn');
        break;
      }
      case 'war': {
        const name = esc(factionName(v));
        this.confirm(
          t('Declare war?'),
          t('Declare <b>war on {name}</b>? Their units and cities become valid targets immediately, and they will fight back. Tip: preparing an offensive first (O) gives your troops up to +25% attack.', { name }),
          t('Declare war'),
          () => {
            declareWar(this.sim, s.player, v);
            this.openFactions();
          },
        );
        return;
      }
      case 'acceptPeace': acceptPeaceOffer(this.sim, v); break;
      case 'rejectPeace': rejectPeaceOffer(this.sim, v); break;
      case 'dfilter': {
        this.diploFilter = v as DiploFilter;
        this.diploQuery = '';
        const input = this.win?.body.querySelector<HTMLInputElement>('input[data-k="dq"]');
        if (input) input.value = '';
        break;
      }
      case 'dfocus': {
        const c = s.cities.find((x) => x.owner === v && x.capital) ?? s.cities.find((x) => x.owner === v);
        if (c) {
          this.closeWindow();
          g.controls.centerOn(c.x, c.y);
          g.selectCity(c.id);
        }
        return;
      }
      case 'resume': this.closeWindow(); break;
      case 'saveload': this.openSaveLoad(); break;
      case 'settings': {
        this.win?.close();
        const w = openSettings(this.root, () => {
          if (this.win === w) this.win = null;
        });
        this.win = w;
        this.winKind = 'settings';
        break;
      }
      case 'help': this.openHelp(); break;
      case 'quit': g.exitToMenu(); break;
      case 'continue': g.continueAfterVictory(); this.closeWindow(); break;
    }
    for (const k of [...this.sectionCache.keys()]) if (k.startsWith('win')) this.sectionCache.delete(k);
    this.refreshWindow();
  }

  openHelp(): void {
    this.win?.close();
    const w = openHelp(this.root, () => {
      if (this.win === w) this.win = null;
    });
    this.win = w;
    this.winKind = 'help';
  }

  // ------------------------------------------------------------------ debug

  toggleDebug(): void {
    if (!DEBUG_ALLOWED) return;
    if (this.debugEl) {
      this.debugEl.remove();
      this.debugEl = null;
      return;
    }
    this.debugEl = el('div', 'debug panel');
    this.root.append(this.debugEl);
    this.debugEl.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-d]');
      if (target) this.g.debugCommand(target.dataset.d!);
    });
    this.updateDebug();
  }

  private updateDebug(): void {
    const d = this.debugEl!;
    const g = this.g;
    const s = this.sim.state;
    const cam = g.cameras.main;
    const ptr = g.controls.toWorld(g.controls.cam.width / 2, g.controls.cam.height / 2);
    const mp = g.controls.toWorld(g.game.input.activePointer.x, g.game.input.activePointer.y);
    const cell = worldToCell(mp.x, mp.y);
    let visCells = 0;
    const vis = g.sim.combat.playerVis;
    for (let i = 0; i < vis.length; i += 1) visCells += vis[i];
    let wars = 0;
    for (const v of Object.values(s.relations)) if (v === 'war') wars++;
    const mob = s.factionOrder.filter((f) => s.ai[f]?.war?.phase === 'mobilize').length;
    const region = g.sim.geo.region[cell];
    const txt = `FPS        ${g.game.loop.actualFps.toFixed(0)}
Sim time   ${s.time.toFixed(1)}h  speed ${s.speed}x ${s.paused ? '(paused)' : ''}
Step       ${g.sim.stepMs.toFixed(2)} ms
Units      ${s.units.size}  projectiles ${g.sim.combat.projectiles.length}
Cities     ${s.cities.length}  player ${s.cities.filter((c) => c.owner === s.player).length}
World      ${s.factionOrder.filter((f) => s.factions[f].alive).length} countries  wars ${wars}  mobilising ${mob}
Paths      queue ${g.sim.paths.pending}  last ${g.sim.paths.finder.lastMs.toFixed(2)}ms / ${g.sim.paths.finder.lastExpanded} nodes
AI think   ${g.sim.ai.lastThinkMs.toFixed(2)} ms  ${g.sim.ai.enabled ? 'ON' : 'OFF'}
Territory  ${g.map.renderMs.toFixed(1)} ms render
Visible    ${visCells} cells  reveal ${g.unitViews.reveal}
Camera     ${ptr.x.toFixed(0)},${ptr.y.toFixed(0)} zoom ${cam.zoom.toFixed(2)} lod ${g.unitViews.lod.toFixed(2)}
Cursor     cell ${cell} ${TERRAIN_NAMES[g.sim.geo.terrain[cell]]} region ${region} ${region >= 0 ? s.cities[region]?.name ?? '' : ''}
Selected   ${[...g.selection].slice(0, 6).join(',') || (g.selectedCity >= 0 ? 'city ' + g.selectedCity : '-')}
Money      ${fmt(this.player.res.money)} (${fmtRate(this.player.income.money)}/h)
Frame ms   ${Object.entries(g.prof).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' ')}
`;
    const html = `${esc(txt)}<div class="dbg-actions"><span class="btn small" data-d="res">+Resources</span><span class="btn small" data-d="reveal">Reveal</span><span class="btn small" data-d="ai">Toggle AI</span><span class="btn small" data-d="kill">Kill sel.</span><span class="btn small" data-d="tank">Spawn army</span><span class="btn small" data-d="event">Event</span><span class="btn small" data-d="mobilize">AI mobilise vs me</span><span class="btn small" data-d="win">Win</span></div>`;
    this.setSection(d, 'debug', html);
  }
}

export { canAfford };
