// Title screen, campaign setup (country & difficulty), load, settings, credits.
import { el, esc, delegate, fmt } from './dom';
import { openSaveLoad, openSettings, openCredits, openHelp, applyAudioSettings, type Win } from './Dialogs';
import { FACTIONS, FACTION_MAP, factionName, powerTier, TIER_NAMES } from '../data/factions';
import { CITY_DEFS } from '../data/cities';
import { armyValue, militaryOf, unitCounts, forcePlan, airForceOf } from '../data/military';
import { GAME_TITLE, GAME_VERSION } from '../config';
import { Settings } from '../core/Settings';
import { App } from '../app';
import { listSaves, loadFromSlot } from '../save/SaveSystem';
import type { Difficulty } from '../core/types';
import { t, tn, onLangChange } from '../i18n';

export interface MenuHost {
  startNew(faction: string, difficulty: Difficulty): void;
  startLoaded(slot: string): void;
  focus(faction: string | null): void;
}

const TIPS = [
  'The world starts at peace. Watch for <b>mobilisation</b> warnings — a neighbour gathering troops on your border will declare war about two days later.',
  'Press the <b>Missile Strike</b> button (or M) and click a target: the nearest ready launcher fires. Your capital starts with a missile battery.',
  'Land units cannot swim: build a <b>Transport Ship</b>, right-click it with troops selected to board, then right-click a coast to land.',
  '<b>Prepare an offensive</b> before attacking: troops gathered at a staging area gain up to +25% attack.',
  'Submarines are invisible unless an enemy ship with <b>sonar</b> gets close — destroyers, frigates and patrol boats hunt them.',
  'A city can only be captured when its defences are at zero and no enemy land units stand inside.',
  'Anti-air vehicles and frigates can <b>intercept</b> incoming missiles. Protect your fleets.',
  'Surplus metal, fuel or food can be sold at the <b>market</b> to fund your war.',
];

const CONTINENTS: Record<string, string> = {
  Africa: 'Africa', Asia: 'Asia', Europe: 'Europe', 'North America': 'North America', 'South America': 'South America', Oceania: 'Oceania',
  'Seven seas (open ocean)': 'Island nations',
};

export class MainMenu {
  private root: HTMLElement;
  private screen: HTMLElement;
  private win: Win | null = null;
  private tipIdx = 0;
  private tipTimer = 0;
  private offLang: () => void;
  private selectOpen = false;

  constructor(private host: MenuHost) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = '';
    this.screen = el('div', 'menu-screen');
    this.root.append(this.screen);
    this.renderMain();
    this.screen.addEventListener('pointerdown', () => this.unlockAudio(), { once: false });
    this.tipTimer = window.setInterval(() => this.rotateTip(), 7000);
    this.offLang = onLangChange(() => {
      if (!this.selectOpen) this.renderMain();
    });
  }

  destroy(): void {
    window.clearInterval(this.tipTimer);
    this.offLang();
    this.root.innerHTML = '';
  }

  private unlockAudio(): void {
    if (!App.audio.ready) {
      App.audio.unlock();
      applyAudioSettings();
      App.audio.startMusic('menu');
    }
  }

  private hasSaves(): boolean {
    return listSaves().some((s) => !!s);
  }

  private renderMain(): void {
    const saves = listSaves();
    const latest = saves.filter(Boolean).sort((a, b) => (a!.savedAt < b!.savedAt ? 1 : -1))[0];
    this.screen.innerHTML = `
      <div class="menu-left">
        <div class="title-block">
          <div class="game-title">${GAME_TITLE.split(' ')[0]}<span>${GAME_TITLE.split(' ').slice(1).join(' ')}</span></div>
          <div class="game-subtitle">${t('Global War Strategy')}</div>
          <div class="title-rule"></div>
        </div>
        <div class="menu-buttons">
          <button class="menu-btn" data-a="new">${t('New Campaign')}<small>${t('Choose any of {n} real countries', { n: FACTIONS.length })}</small></button>
          ${latest ? `<button class="menu-btn" data-a="continue" data-v="${latest.slot}">${t('Continue')}<small>${esc(factionName(latest.faction))} · ${esc(latest.slot === 'auto' ? t('Autosave') : latest.label)}</small></button>` : ''}
          <button class="menu-btn" data-a="load" ${this.hasSaves() ? '' : 'disabled'}>${t('Load Game')}<small>${this.hasSaves() ? t('Resume a saved war') : t('No saved games yet')}</small></button>
          <button class="menu-btn" data-a="settings">${t('Settings')}<small>${t('Language, audio, controls')}</small></button>
          <button class="menu-btn" data-a="help">${t('Field Manual')}</button>
          <button class="menu-btn" data-a="credits">${t('Credits')}</button>
        </div>
        <div class="menu-foot">v${GAME_VERSION} · ${t('{n} countries', { n: FACTIONS.length })} · ${t('{n} cities', { n: CITY_DEFS.length })} · ${t('runs entirely in your browser')}</div>
      </div>
      <div class="menu-right"><div class="intel-card panel"><div class="section-label" style="margin-top:0">${t('Intelligence brief')}</div><div data-tip-text>${t(TIPS[this.tipIdx])}</div></div></div>`;
    delegate(this.screen, (a, v) => this.onAction(a, v));
  }

  private rotateTip(): void {
    const el = this.screen.querySelector<HTMLElement>('[data-tip-text]');
    if (!el) return;
    this.tipIdx = (this.tipIdx + 1) % TIPS.length;
    el.style.opacity = '0';
    setTimeout(() => {
      el.innerHTML = t(TIPS[this.tipIdx]);
      el.style.transition = 'opacity .4s';
      el.style.opacity = '1';
    }, 250);
  }

  private onAction(a: string, v: string): void {
    this.unlockAudio();
    App.audio.play('click');
    switch (a) {
      case 'new':
        this.openFactionSelect();
        break;
      case 'continue':
        if (loadFromSlot(v)) this.host.startLoaded(v);
        break;
      case 'load':
        this.win?.close();
        this.win = openSaveLoad(this.root, { canSave: false, onLoad: (slot) => this.host.startLoaded(slot), onClose: () => (this.win = null) });
        break;
      case 'settings':
        this.win?.close();
        this.win = openSettings(this.root, () => (this.win = null));
        break;
      case 'help':
        this.win?.close();
        this.win = openHelp(this.root, () => (this.win = null));
        break;
      case 'credits':
        this.win?.close();
        this.win = openCredits(this.root, () => (this.win = null));
        break;
    }
  }

  private openFactionSelect(): void {
    this.win?.close();
    this.selectOpen = true;
    // Countries ranked by the size of their real-world armed forces.
    const byPower = [...FACTIONS].sort((a, b) => armyValue(b.id) - armyValue(a.id));
    const rank = new Map(byPower.map((f, i) => [f.id, i]));
    const maxArmy = armyValue(byPower[0].id);
    let selected = byPower[0].id;
    let difficulty: Difficulty = Settings.data.difficulty;
    let query = '';
    let sort: 'power' | 'name' = 'power';
    let region = 'all';
    const overlay = el('div', 'overlay-center');
    const win = el('div', 'window panel faction-win');
    win.style.position = 'relative';
    win.style.left = 'auto';
    win.style.top = 'auto';
    win.style.transform = 'none';
    win.style.animation = 'fadein .25s ease';
    overlay.append(win);
    this.root.append(overlay);
    const citiesOf = (id: string) => CITY_DEFS.filter((c) => c.owner === id);

    win.innerHTML = `<div class="panel-title" style="font-size:15px;padding:11px 14px"><span data-t="title"></span><span class="grow"></span><span class="close" data-a="back">✕</span></div>
      <div class="win-body">
        <div class="fsel">
          <div class="fsel-list-wrap">
            <div class="fsel-tools">
              <input class="search" data-k="q" type="search" autocomplete="off" spellcheck="false"/>
              <div class="row" style="gap:4px;flex-wrap:wrap" data-s="filters"></div>
            </div>
            <div class="fsel-list" data-s="list"></div>
          </div>
          <div class="fsel-detail" data-s="detail"></div>
        </div>
        <div class="diff-row" data-s="bottom"></div>
      </div>`;
    const q = (k: string) => win.querySelector<HTMLElement>(`[data-s="${k}"]`)!;
    const input = win.querySelector<HTMLInputElement>('input[data-k="q"]')!;

    const renderList = () => {
      const needle = query.trim().toLowerCase();
      let list = FACTIONS.filter((f) => region === 'all' || f.continent === region);
      if (needle) list = list.filter((f) => f.name.toLowerCase().includes(needle) || (f.ru ?? '').toLowerCase().includes(needle) || f.id.toLowerCase() === needle);
      list = [...list].sort((a, b) => (sort === 'power' ? rank.get(a.id)! - rank.get(b.id)! : tn(a).localeCompare(tn(b))));
      q('list').innerHTML = list.length
        ? list
            .map((f) => {
              // Stars: rank of the country's real-world armed forces.
              const rk = rank.get(f.id)!;
              const tier = rk < 12 ? 3 : rk < 40 ? 2 : rk < 90 ? 1 : 0;
              return `<div class="fitem ${selected === f.id ? 'selected' : ''}" style="--fc:${f.css}" data-a="pick" data-v="${f.id}">
                <span class="swatch" style="background:${f.css}"></span><span class="nm">${esc(tn(f))}</span>
                <span class="tier t${tier}">${'★'.repeat(tier + 1)}</span></div>`;
            })
            .join('')
        : `<div class="muted" style="padding:12px">${t('No country matches your search.')}</div>`;
      const cur = q('list').querySelector('.selected');
      if (cur && 'scrollIntoView' in cur) (cur as HTMLElement).scrollIntoView({ block: 'nearest' });
    };

    const renderFilters = () => {
      const regions = ['all', ...Object.keys(CONTINENTS)];
      q('filters').innerHTML =
        `<button class="btn small ${sort === 'power' ? 'active' : ''}" data-a="sort" data-v="power">${t('By military')}</button>` +
        `<button class="btn small ${sort === 'name' ? 'active' : ''}" data-a="sort" data-v="name">${t('A–Z')}</button>` +
        `<select class="btn small" data-k="region">${regions.map((r) => `<option value="${r}" ${region === r ? 'selected' : ''}>${r === 'all' ? t('All regions') : t(CONTINENTS[r])}</option>`).join('')}</select>` +
        `<button class="btn small" data-a="random" data-tip="${t('Random country')}">🎲</button>`;
    };

    const renderDetail = () => {
      const f = FACTION_MAP[selected];
      const cities = citiesOf(f.id);
      const ports = cities.filter((c) => c.port).length;
      const tier = powerTier(f.id);
      const rk = rank.get(f.id)!;
      const level = rk < 12 ? 3 : rk < 40 ? 2 : rk < 90 ? 1 : 0;
      const challenge = [t('Very hard'), t('Hard'), t('Normal'), t('Easy')][level];
      const cls = ['bad', 'bad', 'warn', 'good'][level];
      const nb = f.neighbors.map((id) => FACTION_MAP[id]).filter(Boolean).sort((a, b) => armyValue(b.id) - armyValue(a.id));
      const cap = cities.find((c) => c.capital) ?? cities[0];
      const top = [...cities].sort((a, b) => b.size * 3 + b.industry - (a.size * 3 + a.industry)).slice(0, 6);
      const m = militaryOf(f.id);
      const units = unitCounts(f.id);
      const af = airForceOf(f.id);
      const battery = Math.max(1, forcePlan(f.id).battery);
      const num = (n: number) => (n > 0 ? fmt(n) : '—');
      const pop = f.population >= 1 ? `${f.population.toFixed(1)}M` : `${Math.round(f.population * 1000)}k`;
      q('detail').innerHTML = `
        <div class="fd-head" style="--fc:${f.css}"><span class="faction-emblem" style="background:${f.css}">${f.short}</span>
          <div><div class="fd-name">${esc(tn(f))}</div><div class="muted">${t(CONTINENTS[f.continent] ?? f.continent)} · ${t(TIER_NAMES[tier])} · ${t('military #{n} in the world', { n: rk + 1 })}</div></div></div>
        <div class="stat-grid" style="margin-top:10px">
          <div class="stat"><span>${t('Capital')}</span><span>${esc(cap ? tn(cap) : '—')}</span></div>
          <div class="stat"><span>${t('Cities')}</span><span>${cities.length}</span></div>
          <div class="stat"><span>${t('Ports')}</span><span>${ports}</span></div>
          <div class="stat"><span>${t('Population')}</span><span>${pop}</span></div>
          <div class="stat"><span>${t('Industrial power')}</span><span>${f.power}</span></div>
          <div class="stat"><span>${t('Challenge')}</span><span class="${cls}">${challenge}</span></div>
        </div>
        <div class="section-label">${t('Armed forces')} <span class="muted" style="text-transform:none;letter-spacing:0">${m.real ? t('(real-world estimate)') : t('(rough estimate)')}</span></div>
        <div class="stat-grid">
          <div class="stat"><span>${t('Active personnel')}</span><span>${m.p > 0 ? Math.round(m.p * 1000).toLocaleString('en-US') : '—'}</span></div>
          <div class="stat"><span>${t('Defence budget')}</span><span>${m.b >= 1 ? `$${m.b}${t(' bn')}` : m.b > 0 ? `$${Math.round(m.b * 1000)}${t(' mn')}` : '—'}</span></div>
          <div class="stat"><span>${t('Tanks')}</span><span>${num(m.t)}</span></div>
          <div class="stat"><span>${t('Artillery')}</span><span>${num(m.a)}</span></div>
          <div class="stat"><span>${t('Submarines')}</span><span>${num(m.s)}</span></div>
          <div class="stat"><span>${t('Destroyers & frigates')}</span><span>${num(m.d + m.f)}</span></div>
          <div class="stat"><span>${t('Combat aircraft')}</span><span>${num(af.fighters + af.strike + af.bombers)}</span></div>
          <div class="stat"><span>${t('Attack helicopters')}</span><span>${num(af.helis)}</span></div>
          <div class="stat"><span>${t('Aircraft carriers')}</span><span>${num(m.cv)}</span></div>
          <div class="stat"><span>${t('Missile forces')}</span><span>${m.m ? '★'.repeat(m.m) : '—'}</span></div>
        </div>
        <div class="bar gold" style="margin-top:8px"><i style="width:${Math.max(3, Math.round((Math.sqrt(armyValue(f.id)) / Math.sqrt(maxArmy)) * 100))}%"></i></div>
        <div class="muted" style="margin-top:4px">${t('In game: {l} land units, {a} aircraft, {n} ships, missile battery level {b}', { l: units.land, a: units.air, n: units.naval, b: battery })}</div>
        <div class="section-label">${t('Major cities')}</div>
        <div class="muted" style="line-height:1.4">${top.map((c) => esc(tn(c))).join(' · ') || '—'}</div>
        <div class="section-label">${t('Land neighbours')}</div>
        <div class="fd-nb">${nb.length ? nb.slice(0, 12).map((n) => `<span class="tag" style="border-color:${n.css}" data-a="pick" data-v="${n.id}">${esc(tn(n))}</span>`).join('') : `<span class="muted">${t('None — an island nation. You will need transport ships to invade.')}</span>`}</div>`;
    };

    const renderBottom = () => {
      q('bottom').innerHTML = `<span class="section-label" style="margin:0 8px 0 0">${t('AI difficulty')}</span>
        ${(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => `<button class="btn ${difficulty === d ? 'active' : ''}" data-a="diff" data-v="${d}">${t(d[0].toUpperCase() + d.slice(1))}</button>`).join('')}
        <span class="spacer"></span>
        <button class="btn" data-a="back">${t('Back')}</button>
        <button class="btn primary" data-a="start" style="padding:9px 26px;font-size:15px">${t('Start Campaign')} ▸</button>`;
    };

    const renderAll = () => {
      win.querySelector('[data-t="title"]')!.textContent = t('Choose your country');
      input.placeholder = t('Search {n} countries…', { n: FACTIONS.length });
      renderFilters();
      renderList();
      renderDetail();
      renderBottom();
    };
    renderAll();
    this.host.focus(selected);
    input.addEventListener('input', () => {
      query = input.value;
      renderList();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const first = q('list').querySelector<HTMLElement>('[data-a="pick"]');
        if (first) pick(first.dataset.v!);
      }
    });
    win.addEventListener('change', (e) => {
      const s = e.target as HTMLSelectElement;
      if (s.dataset.k === 'region') {
        region = s.value;
        renderList();
      }
    });
    const pick = (id: string) => {
      if (!FACTION_MAP[id]) return;
      selected = id;
      this.host.focus(id);
      renderList();
      renderDetail();
    };
    const offLang = onLangChange(renderAll);
    const close = () => {
      offLang();
      overlay.remove();
      this.selectOpen = false;
      this.host.focus(null);
      this.renderMain();
    };
    delegate(win, (a, v) => {
      App.audio.play('click');
      if (a === 'pick') pick(v);
      else if (a === 'sort') {
        sort = v as 'power' | 'name';
        renderFilters();
        renderList();
      } else if (a === 'random') {
        pick(FACTIONS[Math.floor(Math.random() * FACTIONS.length)].id);
      } else if (a === 'diff') {
        difficulty = v as Difficulty;
        Settings.set('difficulty', difficulty);
        renderBottom();
      } else if (a === 'back') {
        close();
      } else if (a === 'start') {
        offLang();
        this.host.startNew(selected, difficulty);
      }
    });
    setTimeout(() => input.focus(), 50);
  }
}
