// In-game HTML overlay: top bar, map layers, selection & action panels, unit list,
// event log, minimap, city / research / market / diplomacy / pause windows,
// toasts, tooltips, game-over screen and the developer debug overlay.
import type { GameScene } from '../scenes/GameScene';
import type { City, LogEntry, ResKey, Unit } from '../core/types';
import { RES_KEYS } from '../core/types';
import { el, esc, fmt, fmtRate, costHtml, bar, hpClass, gameDate, colorCss, delegate, morph } from './dom';
import { ICONS, RES_ICON } from './icons';
import { unitDef, PRODUCIBLE_UNITS } from '../data/units';
import { BUILDING_DEFS, buildingCost } from '../data/buildings';
import { TECH_DEFS, TECH_MAP } from '../data/techs';
import { FACTIONS, getFactionDef } from '../data/factions';
import { turretURL } from '../effects/Textures';
import { cityYield, MARKET_PRICE, MARKET_BUY, MARKET_SELL } from '../economy/EconomySystem';
import { cityDefense, cityRange } from '../cities/CitySystem';
import { CITY_MISSILE_RANGE } from '../combat/CombatSystem';
import { TERRAIN_NAMES } from '../map/WorldGeo';
import { atWar } from '../core/GameState';
import { canAfford } from '../technology/TechSystem';
import { openWindow, openSettings, openSaveLoad, openHelp, type Win } from './Dialogs';
import { Settings } from '../core/Settings';
import { App } from '../app';
import { WORLD_W, WORLD_H, DEBUG_ALLOWED, worldToCell, TEX_SCALE } from '../config';
import { MapAssets, type MapLayer } from '../map/MapRenderer';
import { proposePeace, declareWar, militaryStrength } from '../diplomacy/Diplomacy';
import type { TechCategory } from '../core/types';

const STATUS = (u: Unit): string => {
  if (u.embarked) return 'Embarked';
  if (u.order?.kind === 'hold') return 'Holding';
  if (u.targetUnit >= 0 || u.targetCity >= 0) return 'Engaging';
  if (u.moving) return u.order?.kind === 'attackMove' ? 'Advancing' : 'Moving';
  return 'Idle';
};

export class GameUI {
  private root: HTMLElement;
  private top: HTMLElement;
  private layers: HTMLElement;
  private left: HTMLElement;
  private right: HTMLElement;
  private cards: HTMLElement;
  private cardTitle: HTMLElement;
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
  pausedByMenu = false;

  constructor(private g: GameScene) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = '';
    const r = this.root;
    this.top = el('div', 'topbar');
    this.layers = el('div', 'layerbar panel');
    this.left = el('div', 'panel panel-left hidden');
    this.right = el('div', 'panel panel-right hidden');
    const bottom = el('div', 'bottombar');
    const unitlist = el('div', 'panel unitlist');
    this.cardTitle = el('div', 'panel-title', 'Command');
    this.cards = el('div', 'unitcards');
    unitlist.append(this.cardTitle, this.cards);
    const log = el('div', 'panel log');
    log.append(el('div', 'panel-title', 'Situation Report'));
    this.logList = el('div', 'log-list');
    log.append(this.logList);
    const mm = el('div', 'panel minimap-wrap');
    mm.append(el('div', 'panel-title', `<span>Strategic Map</span><span class="grow"></span><span class="muted" style="font-size:10px">CLICK TO JUMP</span>`));
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
    r.append(this.top, this.layers, this.left, this.right, bottom, this.toasts, this.hint, this.fpsEl, this.tip);
    this.miniBase = document.createElement('canvas');

    this.buildTop();
    this.buildLayers();
    for (const p of [this.top, this.layers, this.left, this.right, unitlist, log]) delegate(p, (a, v, e, ev) => this.action(a, v, e, ev));
    this.logList.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-x]');
      if (t) this.g.controls.centerOn(Number(t.dataset.x), Number(t.dataset.y));
    });
    this.setupMinimap(mmBox);
    this.setupTooltips();
    this.onSelectionChanged();
    this.cards.innerHTML = this.hintHtml();
  }

  destroy(): void {
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
    return `<div class="empty-hint"><b>Left-click</b> a unit or city to select it · <b>Shift+drag</b> to box-select · <b>Right-click</b> to move or attack.<br/>
      Bombard enemy cities to zero defence, then move land units in to <b>capture</b> them. Press <b>F1</b> or open the menu for the field manual.</div>`;
  }

  toast(text: string, kind: LogEntry['kind'] = 'info', x?: number, y?: number): void {
    const t = el('div', `toast ${kind}`, esc(text));
    if (x !== undefined && y !== undefined) {
      t.title = 'Click to view';
      t.addEventListener('click', () => this.g.controls.centerOn(x, y));
    }
    this.toasts.prepend(t);
    while (this.toasts.children.length > 5) this.toasts.lastElementChild?.remove();
    setTimeout(() => t.classList.add('out'), 4200);
    setTimeout(() => t.remove(), 4700);
  }

  banner(text: string, sub: string, color = '#ffffff'): void {
    const b = el('div', 'banner', `${esc(text)}<small>${esc(sub)}</small>`);
    b.style.color = color;
    this.root.append(b);
    setTimeout(() => b.remove(), 2700);
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
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (!t) return;
      this.tipSrc = t;
      this.tip.innerHTML = t.dataset.tip!;
      this.tip.style.display = 'block';
      this.placeTip(e.clientX, e.clientY);
    });
    this.root.addEventListener('mousemove', (e) => {
      if (this.tip.style.display === 'block' && !this.worldTipOn) this.placeTip(e.clientX, e.clientY);
    });
    this.root.addEventListener('mouseout', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (t && !this.worldTipOn) {
        this.tip.style.display = 'none';
        this.tipSrc = null;
      }
    });
    this.root.addEventListener('mousedown', () => {
      if (!this.worldTipOn) this.tip.style.display = 'none';
    });
  }

  // ------------------------------------------------------------------ top bar & layers

  private buildTop(): void {
    const f = this.player;
    const def = getFactionDef(f.id)!;
    this.top.innerHTML = `
      <div class="faction"><div class="faction-emblem" style="background:${def.css}">${def.short}</div><div><div class="fname">${esc(def.name)}</div><small data-r="fsub"></small></div></div>
      <div class="resources" data-r="res"></div>
      <div class="clock"><div class="date" data-r="date"></div><div class="sub" data-r="time"></div></div>
      <div class="speed">
        <button class="btn icon" data-a="speed" data-v="0" data-tip="<b>Pause</b> (Space)">${ICONS.pause}</button>
        <button class="btn" data-a="speed" data-v="1" data-tip="Normal speed">1×</button>
        <button class="btn" data-a="speed" data-v="2" data-tip="Fast">2×</button>
        <button class="btn" data-a="speed" data-v="4" data-tip="Very fast">4×</button>
      </div>
      <div class="top-actions">
        <button class="btn icon" data-a="research" data-tip="<b>Research</b> (R)">${ICONS.research}</button>
        <button class="btn icon" data-a="market" data-tip="<b>Market</b> — trade commodities">${ICONS.market}</button>
        <button class="btn icon" data-a="factions" data-tip="<b>Diplomacy</b> — world powers">${ICONS.globe}</button>
        <button class="btn icon" data-a="saveload" data-tip="<b>Save / Load</b>">${ICONS.save}</button>
        <button class="btn icon" data-a="pause" data-tip="<b>Menu</b> (Esc)">${ICONS.menu}</button>
      </div>`;
  }

  private buildLayers(): void {
    const layers: [MapLayer, string][] = [
      ['political', 'Political'], ['terrain', 'Terrain'], ['resources', 'Resources'], ['military', 'Military'], ['strategic', 'Strategic'],
    ];
    this.layers.innerHTML = layers.map(([id, n]) => `<button class="btn ${id === 'political' ? 'active' : ''}" data-a="layer" data-v="${id}">${n}</button>`).join('');
  }

  private updateTop(): void {
    const s = this.sim.state;
    const f = this.player;
    const q = (k: string) => this.top.querySelector<HTMLElement>(`[data-r="${k}"]`)!;
    let units = 0;
    for (const u of s.units.values()) if (u.owner === f.id) units++;
    const cities = s.cities.filter((c) => c.owner === f.id).length;
    q('fsub').textContent = `${cities} cities · ${units} units`;
    const items = RES_KEYS.map((k) => {
      const inc = f.income[k];
      const shortage = f.res[k] <= 1 && inc < 0;
      const tip = `<b>${k[0].toUpperCase() + k.slice(1)}</b><br/>Production: +${f.gross[k].toFixed(1)}/h<br/>Upkeep: −${f.upkeep[k].toFixed(1)}/h<br/>Net: ${fmtRate(inc)}/h`;
      return `<div class="res ${shortage ? 'short' : ''}" data-tip="${esc(tip)}"><span class="ico">${RES_ICON[k]}</span><div><div class="val">${fmt(f.res[k])}</div><div class="rate ${inc >= 0 ? 'good' : 'bad'}">${fmtRate(inc)}/h</div></div><span class="lbl">${k}</span></div>`;
    });
    const pr = f.power.demand > 0 ? f.power.supply / f.power.demand : 1;
    items.push(`<div class="res ${pr < 1 ? 'short' : ''}" data-tip="${esc(`<b>Electricity</b><br/>Supply ${f.power.supply.toFixed(0)} / demand ${f.power.demand.toFixed(0)}<br/>Shortages slow production and research.`)}"><span class="ico">${RES_ICON.power}</span><div><div class="val">${f.power.supply.toFixed(0)}/${f.power.demand.toFixed(0)}</div><div class="rate ${pr >= 1 ? 'good' : 'bad'}">${Math.round(Math.min(1, pr) * 100)}%</div></div><span class="lbl">power</span></div>`);
    items.push(`<div class="res" data-tip="${esc(`<b>Industrial capacity</b><br/>Sum of city industry and factories.<br/>Production speed multiplier: ×${this.sim.tech.getMods(f.id).prod.toFixed(2)}`)}"><span class="ico">${RES_ICON.industry}</span><div><div class="val">${f.industry.toFixed(0)}</div><div class="rate muted">IC</div></div><span class="lbl">industry</span></div>`);
    const research = f.research ? `<div class="res research-item" data-a="research" style="cursor:pointer" data-tip="Current research — click to open"><span class="ico">${ICONS.research}</span><div><div class="val" style="font-size:12px">${esc(TECH_MAP[f.research.id]?.name ?? '')}</div>${bar(f.research.progress / f.research.time, 'prog')}</div></div>` : `<div class="res research-item" data-a="research" style="cursor:pointer" data-tip="No active research — click to choose"><span class="ico">${ICONS.research}</span><div><div class="val warn" style="font-size:13px">Research idle</div><div class="rate muted">click to choose</div></div></div>`;
    items.push(research);
    this.setSection(q('res'), 'res', items.join(''));
    const d = gameDate(s.time);
    q('date').textContent = d.date;
    q('time').textContent = `${d.time} · DAY ${d.day}${s.paused ? ' · PAUSED' : ''}`;
    this.top.querySelectorAll<HTMLElement>('[data-a="speed"]').forEach((b) => {
      const v = Number(b.dataset.v);
      b.classList.toggle('active', v === 0 ? s.paused : !s.paused && s.speed === v);
    });
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

  private unitPanel(u: Unit): string {
    const def = unitDef(u.type);
    const st = this.sim.tech.stats(u.owner, u.type);
    const f = this.sim.state.factions[u.owner];
    const own = u.owner === this.sim.state.player;
    const r = u.hp / u.maxHp;
    const terrain = TERRAIN_NAMES[this.sim.geo.terrain[worldToCell(u.x, u.y)]];
    const abil: string[] = [];
    if (def.stealth) abil.push('Stealth');
    if (def.sonar) abil.push('Sonar');
    if (def.intercept) abil.push(`Intercept ${Math.round((def.intercept + this.sim.tech.getMods(u.owner).intercept) * 100)}%`);
    if (def.missiles) abil.push(`Missiles ${u.missiles}/${def.missiles + this.sim.tech.getMods(u.owner).missileCap}`);
    if (def.splash) abil.push('Splash damage');
    if (def.stationaryFire) abil.push('Must halt to fire');
    if (def.abilities?.includes('repair')) abil.push('Repairs');
    if (def.abilities?.includes('fastCapture')) abil.push('Fast capture');
    if (def.abilities?.includes('airstrike')) abil.push('Air wing');
    const sub = def.stealth ? (u.revealed > 0 ? '<span class="warn">Surfaced / revealed</span>' : '<span class="good">Submerged</span>') : '';
    return `<div class="panel-title"><span style="color:${colorCss(f.color)}">■</span>${esc(f.name)}<span class="grow"></span><span class="tag">${def.short}</span></div>
      <div class="panel-body">
        <div class="sel-head"><div class="sel-portrait"><img src="${this.portrait(u.type, u.owner)}"/></div>
          <div><div class="sel-name">${esc(def.name)}</div><div class="sel-sub">${esc(def.role)} · <span class="rank">${'★'.repeat(u.rank)}${'☆'.repeat(3 - u.rank)}</span></div>
          <div class="sel-sub">${STATUS(u)} · ${u.embarked ? 'At sea' : terrain} ${sub}</div></div></div>
        <div class="row" style="font-size:13px"><span class="muted">Health</span><span class="spacer"></span><span class="num">${Math.ceil(u.hp)} / ${Math.round(u.maxHp)}</span></div>
        ${bar(r, hpClass(r))}
        <div class="stat-grid">
          <div class="stat"><span>Attack</span><span>${st.attack.toFixed(0)}</span></div>
          <div class="stat"><span>Defense</span><span>${st.defense.toFixed(0)}</span></div>
          <div class="stat"><span>Speed</span><span>${st.speed.toFixed(0)}</span></div>
          <div class="stat"><span>Range</span><span>${st.range.toFixed(0)}</span></div>
          <div class="stat"><span>Detection</span><span>${st.detection.toFixed(0)}</span></div>
          <div class="stat"><span>Kills</span><span>${u.kills}</span></div>
          ${own ? `<div class="stat"><span>XP</span><span>${Math.floor(u.xp)}</span></div><div class="stat"><span>Upkeep</span><span>${(def.upkeep.money ?? 0).toFixed(1)}/h</span></div>` : ''}
        </div>
        <div class="abilities">${abil.map((a) => `<span class="tag">${a}</span>`).join('')}</div>
        <div class="muted" style="font-size:13px;margin-top:8px;line-height:1.3">${esc(def.desc)}</div>
      </div>`;
  }

  private armyPanel(units: Unit[]): string {
    const counts = new Map<string, number>();
    let hp = 0;
    let max = 0;
    let atk = 0;
    for (const u of units) {
      counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
      hp += u.hp;
      max += u.maxHp;
      atk += this.sim.tech.stats(u.owner, u.type).attack;
    }
    const land = units.filter((u) => unitDef(u.type).domain === 'land').length;
    const naval = units.length - land;
    const comp = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `<div class="row" style="padding:2px 0;cursor:pointer" data-a="selType" data-v="${t}"><img src="${this.portrait(t, units[0].owner)}" style="height:22px;width:32px;object-fit:contain"/><span>${esc(unitDef(t).name)}</span><span class="spacer"></span><b class="num">×${n}</b></div>`)
      .join('');
    return `<div class="panel-title">${ICONS.garrison}<span>Task Force</span><span class="grow"></span><span class="tag">${units.length} units</span></div>
      <div class="panel-body">
        <div class="stat-grid">
          <div class="stat"><span>Land</span><span>${land}</span></div>
          <div class="stat"><span>Naval</span><span>${naval}</span></div>
          <div class="stat"><span>Firepower</span><span>${atk.toFixed(0)}</span></div>
          <div class="stat"><span>Strength</span><span>${Math.round((hp / max) * 100)}%</span></div>
        </div>
        ${bar(hp / max, hpClass(hp / max))}
        <div class="section-label">Composition</div>${comp}
      </div>`;
  }

  private cityPanel(c: City): string {
    const s = this.sim.state;
    const f = s.factions[c.owner];
    const own = c.owner === s.player;
    const y = cityYield(c);
    let garrison = 0;
    this.sim.spatial.forEachInRange(c.x, c.y, 90, (u) => { if (u.owner === c.owner && unitDef(u.type).domain === 'land') garrison++; });
    const q = c.queue[0];
    const prod = q ? `<div class="row" style="font-size:13px"><span>${esc(q.kind === 'unit' ? unitDef(q.id).name : BUILDING_DEFS.find((b) => b.id === q.id)?.name ?? q.id)}</span><span class="spacer"></span><span class="muted">${Math.floor((q.progress / q.time) * 100)}%</span></div>${bar(q.progress / q.time, 'prog')}${c.queue.length > 1 ? `<div class="muted" style="font-size:12px">+${c.queue.length - 1} queued</div>` : ''}` : `<div class="muted" style="font-size:13px">${own ? 'Idle — queue production' : '—'}</div>`;
    const tags = c.tags.split('').map((t) => ({ o: 'Oil', m: 'Metals', f: 'Farmland', e: 'Energy' })[t]).filter(Boolean);
    return `<div class="panel-title"><span style="color:${colorCss(f?.color ?? 0x999999)}">■</span>${esc(f?.name ?? 'Unknown')}<span class="grow"></span>${c.capital ? `<span class="tag gold">Capital</span>` : ''}</div>
      <div class="panel-body">
        <div class="sel-head"><div class="sel-portrait" style="font-size:34px;color:${colorCss(f?.color ?? 0x999999)}">${ICONS.city}</div>
          <div><div class="sel-name">${esc(c.name)}</div><div class="sel-sub">${['', 'Town', 'City', 'Major city', 'Metropolis'][c.size]} · Industry ${c.industry}${c.port ? ' · Port' : ''}${c.airport ? ' · Airport' : ''}</div>
          <div class="sel-sub">${tags.length ? tags.join(' · ') : 'No special resources'}${c.unrest > 0 ? ' · <span class="bad">UNREST</span>' : ''}</div></div></div>
        <div class="row" style="font-size:13px"><span class="muted">Defences</span><span class="spacer"></span><span class="num">${Math.ceil(c.hp)} / ${Math.round(c.maxHp)}</span></div>
        ${bar(c.hp / c.maxHp, c.hp / c.maxHp > 0.5 ? 'prog' : 'red')}
        ${c.capture > 0 && c.capturer ? `<div class="row" style="font-size:13px;margin-top:4px"><span class="bad">Being captured by ${esc(s.factions[c.capturer]?.name ?? '')}</span><span class="spacer"></span><span>${Math.floor(c.capture * 100)}%</span></div>${bar(c.capture, 'red')}` : ''}
        <div class="stat-grid">
          <div class="stat"><span>Garrison</span><span>${garrison}</span></div>
          <div class="stat"><span>Armour</span><span>${cityDefense(c)}</span></div>
          <div class="stat"><span>Gun range</span><span>${cityRange(c)}</span></div>
          <div class="stat"><span>Importance</span><span>${c.importance}</span></div>
          ${own ? `<div class="stat"><span>${RES_ICON.money} /h</span><span>${y.res.money.toFixed(1)}</span></div><div class="stat"><span>${RES_ICON.metal} /h</span><span>${y.res.metal.toFixed(1)}</span></div>
          <div class="stat"><span>${RES_ICON.fuel} /h</span><span>${y.res.fuel.toFixed(1)}</span></div><div class="stat"><span>${RES_ICON.food} /h</span><span>${y.res.food.toFixed(1)}</span></div>` : ''}
        </div>
        ${own ? `<div class="section-label">Production</div>${prod}
        <button class="btn primary" style="width:100%;margin-top:10px" data-a="openCity" data-v="${c.id}">${ICONS.city} Manage City</button>` : `<div class="muted" style="font-size:13px;margin-top:8px">Enemy city. Select your units and right-click it to launch an assault. Reduce its defences to zero, then occupy it with land units.</div>`}
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
    const mode = this.g.mode;
    return `<div class="panel-title">${ICONS.target}<span>Orders</span></div>
      <div class="actions">
        ${this.actionBtn('info', ICONS.move, 'Move', 'R-CLICK', '', false, 'Right-click on the map to move. Right-click an enemy to attack it.')}
        ${this.actionBtn('attackMove', ICONS.attack, 'Attack-Move', 'A', '', false, 'Advance and engage anything on the way', mode === 'attackMove' ? 'active' : '')}
        ${this.actionBtn('stop', ICONS.stop, 'Stop', 'S')}
        ${this.actionBtn('hold', ICONS.hold, 'Hold', 'H', '', false, 'Hold position and fire at enemies in range')}
        ${missiles.length ? this.actionBtn('missile', ICONS.missile, `Missile (${ready})`, 'M', '', ready === 0, 'Launch a guided missile at an enemy unit or city in range', `wide ${mode === 'missile' ? 'active' : ''}`) : ''}
        ${this.actionBtn('center', ICONS.eye, 'Center', 'C')}
        ${this.actionBtn('disband', ICONS.trash, 'Disband', 'DEL', '', false, 'Permanently disband selected units (saves upkeep)')}
      </div>`;
  }

  private cityActions(c: City): string {
    const quick = ['infantry', 'medium_tank', 'artillery', c.port ? 'destroyer' : 'anti_air', c.port ? 'submarine' : 'light_tank'];
    const f = this.player;
    const quickHtml = quick
      .map((t) => {
        const chk = this.sim.production.canProduceUnit(c, t);
        const def = unitDef(t);
        return `<button class="btn" data-a="produce" data-v="${t}" ${chk.ok ? '' : 'disabled'} data-tip="${esc(`<b>${def.name}</b><br/>${costHtml(def.cost, f.res)}<br/>${def.time}h build${chk.ok ? '' : `<br/><span class='warn'>${chk.reason}</span>`}`)}"><img src="${this.portrait(t, f.id)}" style="height:22px"/>${def.short}</button>`;
      })
      .join('');
    const repairCost = Math.round((c.maxHp - c.hp) * 0.8);
    const canRepair = c.hp < c.maxHp - 1 && this.sim.state.time - c.lastAttacked > 5 && f.res.money >= repairCost;
    return `<div class="panel-title">${ICONS.city}<span>City Orders</span></div>
      <div class="actions">
        ${this.actionBtn('openCity', ICONS.city, 'Manage', '', String(c.id), false, '', 'wide primary')}
        ${quickHtml}
        ${this.actionBtn('repair', ICONS.repair, 'Repair', '', '', !canRepair, `Restore defences for $${repairCost} (not while under fire)`)}
        ${this.actionBtn('garrison', ICONS.garrison, 'Garrison', '', '', false, 'Select all friendly units in the city')}
        ${(c.buildings.missile_battery ?? 0) > 0 ? this.actionBtn('cityMissile', ICONS.missile, `Missile (${Math.floor(c.missiles)})`, 'M', '', c.missiles < 1, `City missile battery · range ${CITY_MISSILE_RANGE}`, 'wide') : ''}
      </div>`;
  }

  private refreshCards(units: Unit[]): void {
    if (!units.length) {
      const city = this.g.selectedCity >= 0 ? this.sim.state.cities[this.g.selectedCity] : null;
      this.cardTitle.innerHTML = city ? `${ICONS.city}<span>${esc(city.name)} — Production Queue</span>` : `${ICONS.target}<span>Command</span>`;
      if (city && city.owner === this.sim.state.player) {
        const html = city.queue.length
          ? city.queue.map((q, i) => `<div class="ucard" data-a="cancelQ" data-v="${i}" data-tip="${esc(`<b>${q.kind === 'unit' ? unitDef(q.id).name : q.id}</b><br/>Click to cancel`)}">${q.kind === 'unit' ? `<img src="${this.portrait(q.id, city.owner)}"/>` : `<span style="font-size:22px">${BUILDING_DEFS.find((b) => b.id === q.id)?.icon ?? '🏗'}</span>`}${bar(q.progress / q.time, 'prog')}</div>`).join('')
          : `<div class="empty-hint">Queue is empty. Use the city orders on the right or <b>Manage City</b> to build units and infrastructure.</div>`;
        this.setSection(this.cards, 'cards', html);
      } else {
        this.setSection(this.cards, 'cards', this.hintHtml());
      }
      return;
    }
    this.cardTitle.innerHTML = `${ICONS.garrison}<span>Selected — ${units.length} unit${units.length > 1 ? 's' : ''}</span>`;
    const shown = units.slice(0, 48);
    const html = shown
      .map((u) => {
        const r = u.hp / u.maxHp;
        return `<div class="ucard" data-a="card" data-v="${u.id}" data-tip="${esc(`<b>${unitDef(u.type).name}</b><br/>${Math.ceil(u.hp)}/${Math.round(u.maxHp)} HP · ${STATUS(u)}`)}"><img src="${this.portrait(u.type, u.owner)}"/>${u.rank ? `<span class="rk">${'★'.repeat(u.rank)}</span>` : ''}${bar(r, hpClass(r))}</div>`;
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
    window.addEventListener('mouseup', () => (down = false));
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
      if (!own && !this.g.unitViews.isVisibleToPlayer(u)) continue;
      ctx.fillStyle = own ? '#ffffff' : colorCss(s.factions[u.owner]?.color ?? 0xffffff);
      const r = own ? 2.2 * dpr : 1.8 * dpr;
      ctx.fillRect(u.x * sx - r / 2, u.y * sy - r / 2, r, r);
    }
    for (const city of s.cities) {
      if (city.owner !== s.player) continue;
      ctx.fillStyle = pc;
      ctx.strokeStyle = '#000';
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
      this.refreshPanels();
      this.refreshLog();
      this.refreshWindow();
      if (this.debugEl) this.updateDebug();
      this.fpsEl.style.display = Settings.data.showFps ? 'block' : 'none';
      if (Settings.data.showFps) this.fpsEl.textContent = `${Math.round(this.g.game.loop.actualFps)} FPS`;
      const m = this.g.mode;
      this.hint.style.display = m === 'normal' ? 'none' : 'block';
      this.hint.textContent =
        m === 'attackMove' ? 'ATTACK-MOVE · left-click destination · right-click / Esc to cancel'
          : m === 'missile' || m === 'cityMissile' ? 'MISSILE STRIKE · left-click an enemy unit or city in range · right-click / Esc to cancel' : '';
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
      case 'center': g.centerOnSelection(); break;
      case 'disband': g.disbandSelected(); break;
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
      case 'info': this.toast('Right-click on the map to move selected units', 'info'); break;
    }
    this.sectionCache.delete('right');
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
    const w = this.open('city', `${ICONS.city} City Management`, 'city-win', id);
    w.body.innerHTML = `<div data-s="head"></div><div class="city-grid"><div><div data-s="stats"></div><div class="section-label">Infrastructure</div><div data-s="blds"></div></div>
      <div><div class="section-label">Production queue</div><div data-s="queue"></div><div class="section-label">Land forces</div><div class="prod-grid" data-s="land"></div><div data-s="navalwrap"><div class="section-label">Naval forces</div><div class="prod-grid" data-s="naval"></div></div></div></div>`;
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
    this.setSection(q('head'), 'win-head', `<div class="city-banner" style="border-color:${colorCss(f.color)}"><div class="nm">${esc(c.name)}</div>${c.capital ? '<span class="tag gold">Capital</span>' : ''}${c.port ? `<span class="tag">${ICONS.anchor} Port</span>` : ''}${c.airport ? `<span class="tag">${ICONS.plane} Airport</span>` : ''}${c.unrest > 0 ? `<span class="tag bad">Unrest ${Math.ceil(c.unrest)}h</span>` : ''}<span class="spacer"></span><span class="muted">${['', 'Town', 'City', 'Major city', 'Metropolis'][c.size]} · pop. ${(c.size * c.size * 0.9 + c.industry * 0.3).toFixed(1)}M</span></div>`);
    this.setSection(q('stats'), 'win-stats', `
      <div class="row" style="font-size:13px"><span class="muted">Defences</span><span class="spacer"></span><span class="num">${Math.ceil(c.hp)} / ${Math.round(c.maxHp)}</span></div>${bar(c.hp / c.maxHp, 'prog')}
      <div class="stat-grid">
        <div class="stat"><span>Industry</span><span>${c.industry}</span></div><div class="stat"><span>Land prod.</span><span>×${rateL.toFixed(2)}</span></div>
        <div class="stat"><span>Naval prod.</span><span>${naval ? `×${rateN.toFixed(2)}` : '—'}</span></div><div class="stat"><span>Missiles</span><span>${(c.buildings.missile_battery ?? 0) ? Math.floor(c.missiles) : '—'}</span></div>
        <div class="stat"><span>${RES_ICON.money} Money</span><span>${fmtRate(y.res.money)}</span></div><div class="stat"><span>${RES_ICON.metal} Metal</span><span>${fmtRate(y.res.metal)}</span></div>
        <div class="stat"><span>${RES_ICON.fuel} Fuel</span><span>${fmtRate(y.res.fuel)}</span></div><div class="stat"><span>${RES_ICON.food} Food</span><span>${fmtRate(y.res.food)}</span></div>
        <div class="stat"><span>${RES_ICON.power} Power</span><span>${y.powerSupply.toFixed(0)}/${y.powerDemand.toFixed(0)}</span></div><div class="stat"><span>${RES_ICON.industry} IC</span><span>${y.industry.toFixed(1)}</span></div>
      </div>`);
    this.setSection(q('blds'), 'win-blds', BUILDING_DEFS.filter((b) => !b.needsPort || c.port)
      .map((b) => {
        const lvl = c.buildings[b.id] ?? 0;
        const chk = this.sim.production.canBuild(c, b.id);
        const queued = this.sim.production.queuedLevel(c, b.id) - lvl;
        const cost = buildingCost(b.id, this.sim.production.queuedLevel(c, b.id));
        return `<div class="bld"><span class="ic">${b.icon}</span><div><div class="nm">${b.name} <span class="lv">${'■'.repeat(lvl)}${'□'.repeat(b.maxLevel - lvl)}</span>${queued > 0 ? ' <span class="muted">(queued)</span>' : ''}</div><div class="ds">${b.desc}</div></div>
          ${lvl + queued >= b.maxLevel ? '<span class="tag">MAX</span>' : `<button class="btn small" data-a="build" data-v="${b.id}" ${chk.ok ? '' : 'disabled'} data-tip="${esc(`${costHtml(cost, f.res)}${chk.ok ? '' : `<br/><span class='warn'>${chk.reason}</span>`}`)}">Build</button>`}</div>`;
      })
      .join(''));
    this.setSection(q('queue'), 'win-queue', c.queue.length
      ? c.queue.map((it, i) => `<div class="queue-item"><span>${it.kind === 'unit' ? esc(unitDef(it.id).name) : `${BUILDING_DEFS.find((b) => b.id === it.id)?.icon ?? ''} ${esc(BUILDING_DEFS.find((b) => b.id === it.id)?.name ?? it.id)}`} ${i === 0 ? `<span class="muted">· ${Math.max(0, Math.ceil((it.time - it.progress) / Math.max(0.01, it.kind === 'unit' && unitDef(it.id).domain === 'naval' ? rateN : rateL)))}h</span>` : '<span class="muted">· waiting</span>'}</span><button class="btn small danger" data-a="cancel" data-v="${i}" data-tip="Cancel (full refund if not started)">${ICONS.close}</button>${bar(it.progress / it.time, 'prog')}</div>`).join('')
      : '<div class="muted">Nothing in production.</div>');
    const prodCard = (id: string) => {
      const def = unitDef(id);
      const chk = this.sim.production.canProduceUnit(c, id);
      return `<div class="prod ${chk.ok ? '' : 'disabled'}" data-a="produce" data-v="${id}" data-tip="${esc(`<b>${def.name}</b> — ${def.role}<br/>${def.desc}<br/>ATK ${def.attack} · DEF ${def.defense} · HP ${def.hp} · RNG ${def.range}<br/>Upkeep ${costHtml(def.upkeep)} /h`)}">
        <img src="${this.portrait(id, f.id)}"/><div class="nm">${def.name}</div><div class="cost">${costHtml(def.cost, f.res)}</div><div class="cost">${def.time}h</div>${chk.ok ? '' : `<div class="why">${chk.reason}</div>`}</div>`;
    };
    this.setSection(q('land'), 'win-land', PRODUCIBLE_UNITS.filter((u) => u.domain === 'land').map((u) => prodCard(u.id)).join(''));
    q('navalwrap').style.display = naval ? '' : 'none';
    if (naval) this.setSection(q('naval'), 'win-naval', PRODUCIBLE_UNITS.filter((u) => u.domain === 'naval').map((u) => prodCard(u.id)).join(''));
  }

  openResearch(): void {
    this.open('research', `${ICONS.research} Research & Development`, 'research-win');
    this.win!.body.innerHTML = `<div data-s="cur"></div><div class="tech-cols" data-s="cols"></div>`;
    this.renderResearch();
  }

  private renderResearch(): void {
    const w = this.win!;
    const f = this.player;
    const cur = f.research;
    const speed = this.sim.tech.researchSpeed(f.id);
    this.setSection(w.body.querySelector('[data-s="cur"]')!, 'win-cur', cur
      ? `<div class="row" style="margin-bottom:10px"><span class="muted">Researching</span><b>${esc(TECH_MAP[cur.id].name)}</b><span class="spacer"></span><span class="muted">${Math.ceil((cur.time - cur.progress) / Math.max(0.01, speed))}h remaining · speed ×${speed.toFixed(2)}</span><button class="btn small danger" data-a="cancelResearch">Cancel (50% refund)</button></div>${bar(cur.progress / cur.time, 'prog')}<div style="height:10px"></div>`
      : `<div class="row" style="margin-bottom:10px"><span class="warn">No active research.</span><span class="muted">Select a technology below. Research labs and power supply speed up research (×${speed.toFixed(2)}).</span></div>`);
    const cats: [TechCategory, string][] = [['army', 'Army'], ['navy', 'Navy'], ['air', 'Air & Missiles'], ['industry', 'Industry']];
    const cols = cats
      .map(([cat, name]) => {
        const techs = TECH_DEFS.filter((t) => t.category === cat).sort((a, b) => a.tier - b.tier);
        return `<div class="tech-col"><h4>${name}</h4>${techs
          .map((t) => {
            const done = f.techs.includes(t.id);
            const active = cur?.id === t.id;
            const prereq = t.requires.every((r) => f.techs.includes(r));
            const cls = done ? 'done' : active ? 'active' : t.future ? 'future' : prereq ? '' : 'locked';
            const req = t.requires.length ? `Requires: ${t.requires.map((r) => TECH_MAP[r]?.name).join(', ')}` : '';
            return `<div class="tech ${cls}" data-a="tech" data-v="${t.id}"><span class="tier">T${t.tier}</span><div class="nm">${esc(t.name)}</div><div class="ds">${esc(t.desc)}</div>
              ${done ? '' : `<div class="ct">${t.future ? 'Future expansion' : `${costHtml(t.cost, f.res)} · ${t.time}h`}</div>`}${!done && !prereq && req ? `<div class="ct warn">${esc(req)}</div>` : ''}${active ? bar(cur!.progress / cur!.time, 'prog') : ''}</div>`;
          })
          .join('')}</div>`;
      })
      .join('');
    this.setSection(w.body.querySelector('[data-s="cols"]')!, 'win-cols', cols);
  }

  openMarket(): void {
    this.open('market', `${ICONS.market} Commodity Market`, '');
    this.win!.root.querySelector('.window')!.setAttribute('style', 'width:640px');
    this.renderMarket();
  }

  private renderMarket(): void {
    const f = this.player;
    const rows = (['metal', 'fuel', 'food'] as const)
      .map((k) => {
        const buy = MARKET_PRICE[k] * MARKET_BUY;
        const sell = MARKET_PRICE[k] * MARKET_SELL;
        return `<div class="market-row"><span>${RES_ICON[k]} <b>${k[0].toUpperCase() + k.slice(1)}</b></span><span class="muted">Stock <b class="num" style="color:#fff">${fmt(f.res[k])}</b> · buy $${buy.toFixed(1)} · sell $${sell.toFixed(1)}</span>
          <button class="btn small" data-a="trade" data-v="${k}:100" ${f.res.money < buy * 100 ? 'disabled' : ''}>Buy 100</button>
          <button class="btn small" data-a="trade" data-v="${k}:500" ${f.res.money < buy * 500 ? 'disabled' : ''}>Buy 500</button>
          <button class="btn small" data-a="trade" data-v="${k}:-100" ${f.res[k] < 100 ? 'disabled' : ''}>Sell 100</button>
          <button class="btn small" data-a="trade" data-v="${k}:-500" ${f.res[k] < 500 ? 'disabled' : ''}>Sell 500</button></div>`;
      })
      .join('');
    this.setSection(this.win!.body, 'win-market', `<div class="muted" style="margin-bottom:8px">Treasury: <b class="num gold">$${fmt(f.res.money)}</b>. Convert surplus commodities into money, or buy what your war machine lacks. Prices include a 30% broker spread.</div>${rows}`);
  }

  openFactions(): void {
    this.open('factions', `${ICONS.globe} World Powers & Diplomacy`, '');
    this.win!.root.querySelector('.window')!.setAttribute('style', 'width:820px');
    this.renderFactions();
  }

  private renderFactions(): void {
    const s = this.sim.state;
    const me = s.player;
    const myStr = militaryStrength(this.sim, me);
    const rows = FACTIONS.map((fd) => {
      const f = s.factions[fd.id];
      const cities = s.cities.filter((c) => c.owner === fd.id).length;
      const str = militaryStrength(this.sim, fd.id);
      const war = atWar(s, me, fd.id);
      const isMe = fd.id === me;
      const rel = isMe ? '<span class="gold">YOU</span>' : !f.alive ? '<span class="muted">Eliminated</span>' : war ? '<span class="bad">At war</span>' : '<span class="good">Ceasefire</span>';
      const act = isMe || !f.alive ? '' : war ? `<button class="btn small" data-a="peace" data-v="${fd.id}">Propose ceasefire</button>` : `<button class="btn small danger" data-a="war" data-v="${fd.id}">Declare war</button>`;
      return `<tr><td><span class="swatch" style="background:${fd.css};color:${fd.css}"></span> <b>${esc(fd.name)}</b></td><td class="num">${cities}</td><td>${f.alive ? bar(Math.min(1, str / Math.max(myStr, str, 1)), 'gold') : '—'}</td><td class="num">${f.techs.length}</td><td>${rel}</td><td>${act}</td></tr>`;
    }).join('');
    this.setSection(this.win!.body, 'win-factions', `<table class="table"><tr><th>Faction</th><th>Cities</th><th>Military strength</th><th>Techs</th><th>Relation</th><th></th></tr>${rows}</table>
      <div class="muted" style="margin-top:8px;font-size:13px">Every power starts at war with every other. A ceasefire stops all fighting between two factions — but a much stronger neighbour may break it.</div>`);
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
    const w = this.open('pause', `${ICONS.menu} Command Menu`, '');
    w.root.querySelector('.window')!.setAttribute('style', 'width:340px');
    w.body.innerHTML = `<div class="menu-buttons" style="width:100%">
      <button class="menu-btn" data-a="resume">Resume</button>
      <button class="menu-btn" data-a="saveload">Save / Load</button>
      <button class="menu-btn" data-a="settings">Settings</button>
      <button class="menu-btn" data-a="help">Field Manual</button>
      <button class="menu-btn" data-a="quit">Exit to Main Menu</button></div>`;
  }

  showGameOver(won: boolean): void {
    this.win?.close();
    const s = this.sim.state;
    const f = this.player;
    const w = this.open('gameover', won ? `${ICONS.star} Victory` : 'Defeat', 'gameover');
    const d = gameDate(s.time);
    w.body.innerHTML = `<h1 class="${won ? 'gold' : 'bad'}">${won ? 'VICTORY' : 'DEFEAT'}</h1>
      <div class="muted" style="margin-bottom:14px">${won ? `The ${esc(f.name)} stands supreme across the globe.` : `The ${esc(f.name)} has fallen.`}</div>
      <table class="table" style="text-align:left"><tr><td>War duration</td><td class="num">${d.day} days</td></tr><tr><td>Cities captured</td><td class="num">${f.stats.captured}</td></tr>
      <tr><td>Cities lost</td><td class="num">${f.stats.citiesLost}</td></tr><tr><td>Units built</td><td class="num">${f.stats.built}</td></tr><tr><td>Enemy units destroyed</td><td class="num">${f.stats.killed}</td></tr>
      <tr><td>Units lost</td><td class="num">${f.stats.lost}</td></tr><tr><td>Technologies</td><td class="num">${f.techs.length}</td></tr></table>
      <div class="row" style="justify-content:center;margin-top:16px;gap:10px">${won ? '<button class="btn" data-a="continue">Continue playing</button>' : ''}<button class="btn primary" data-a="quit">Main Menu</button></div>`;
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
        const t = TECH_MAP[v];
        const chk = this.sim.tech.canResearch(s.player, v);
        if (s.factions[s.player].techs.includes(v)) break;
        if (!chk.ok) {
          App.audio.play('error');
          this.toast(`${t.name}: ${chk.reason}`, 'warn');
        } else if (this.sim.tech.startResearch(s.player, v)) {
          App.audio.play('research');
          this.toast(`Research started: ${t.name}`, 'good');
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
        this.toast(`${s.factions[v].name}: ${r.reason}`, r.accepted ? 'good' : 'warn');
        break;
      }
      case 'war':
        declareWar(this.sim, s.player, v);
        this.toast(`War declared on the ${s.factions[v].name}!`, 'bad');
        break;
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
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-d]');
      if (t) this.g.debugCommand(t.dataset.d!);
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
    const bit = g.sim.combat.bit(s.player);
    for (let i = 0; i < g.sim.combat.visMask.length; i += 1) if (g.sim.combat.visMask[i] & bit) visCells++;
    const ai = s.ai[s.factionOrder.find((f) => f !== s.player)!];
    const txt = `FPS        ${g.game.loop.actualFps.toFixed(0)}
Sim time   ${s.time.toFixed(1)}h  speed ${s.speed}x ${s.paused ? '(paused)' : ''}
Step       ${g.sim.stepMs.toFixed(2)} ms
Units      ${s.units.size}  projectiles ${g.sim.combat.projectiles.length}
Cities     ${s.cities.length}  player ${s.cities.filter((c) => c.owner === s.player).length}
Paths      queue ${g.sim.paths.pending}  last ${g.sim.paths.finder.lastMs.toFixed(2)}ms / ${g.sim.paths.finder.lastExpanded} nodes
AI think   ${g.sim.ai.lastThinkMs.toFixed(2)} ms  ops(${s.factionOrder[1]}) ${ai?.ops.length ?? 0}  ${g.sim.ai.enabled ? 'ON' : 'OFF'}
Territory  ${g.map.renderMs.toFixed(1)} ms render
Visible    ${visCells} cells  reveal ${g.unitViews.reveal}
Camera     ${ptr.x.toFixed(0)},${ptr.y.toFixed(0)} zoom ${cam.zoom.toFixed(2)} lod ${g.unitViews.lod.toFixed(2)}
Cursor     cell ${cell} ${TERRAIN_NAMES[g.sim.geo.terrain[cell]]} region ${g.sim.geo.region[cell]}
Selected   ${[...g.selection].slice(0, 6).join(',') || (g.selectedCity >= 0 ? 'city ' + g.selectedCity : '-')}
Money      ${fmt(this.player.res.money)} (${fmtRate(this.player.income.money)}/h)
Frame ms   ${Object.entries(g.prof).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' ')}
`;
    const html = `${esc(txt)}<div class="dbg-actions"><span class="btn small" data-d="res">+Resources</span><span class="btn small" data-d="reveal">Reveal</span><span class="btn small" data-d="ai">Toggle AI</span><span class="btn small" data-d="kill">Kill sel.</span><span class="btn small" data-d="tank">Spawn army</span><span class="btn small" data-d="event">Event</span><span class="btn small" data-d="win">Win</span></div>`;
    this.setSection(d, 'debug', html);
  }
}

export { canAfford };
