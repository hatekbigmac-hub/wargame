// Title screen, campaign setup (faction & difficulty), load, settings, credits.
import { el, esc, delegate } from './dom';
import { openSaveLoad, openSettings, openCredits, openHelp, applyAudioSettings, type Win } from './Dialogs';
import { FACTIONS } from '../data/factions';
import { CITY_DEFS } from '../data/cities';
import { GAME_TITLE, GAME_SUBTITLE, GAME_VERSION } from '../config';
import { Settings } from '../core/Settings';
import { App } from '../app';
import { listSaves, loadFromSlot } from '../save/SaveSystem';
import type { Difficulty } from '../core/types';

export interface MenuHost {
  startNew(faction: string, difficulty: Difficulty): void;
  startLoaded(slot: string): void;
  focus(faction: string | null): void;
}

const TIPS = [
  'Submarines are invisible unless an enemy ship with <b>sonar</b> gets close — destroyers, frigates and patrol boats hunt them.',
  'Artillery must stop to fire, but it shreds city defences from long range.',
  'A city can only be captured when its defences are at zero and no enemy land units stand inside.',
  'Anti-air vehicles and frigates can <b>intercept</b> incoming missiles. Protect your fleets.',
  'Land units automatically embark on transports to cross water — but they are vulnerable at sea.',
  'Surplus metal, fuel or food can be sold at the <b>market</b> to fund your war.',
  'Power shortages slow down production and research. Build power plants.',
  'Veteran units gain up to three stars, improving attack and defence.',
];

export class MainMenu {
  private root: HTMLElement;
  private screen: HTMLElement;
  private win: Win | null = null;
  private tipIdx = 0;
  private tipTimer = 0;

  constructor(private host: MenuHost) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = '';
    this.screen = el('div', 'menu-screen');
    this.root.append(this.screen);
    this.renderMain();
    this.screen.addEventListener('pointerdown', () => this.unlockAudio(), { once: false });
    this.tipTimer = window.setInterval(() => this.rotateTip(), 7000);
  }

  destroy(): void {
    window.clearInterval(this.tipTimer);
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
          <div class="game-subtitle">${GAME_SUBTITLE}</div>
          <div class="title-rule"></div>
        </div>
        <div class="menu-buttons">
          <button class="menu-btn" data-a="new">New Campaign<small>Choose a world power and conquer the globe</small></button>
          ${latest ? `<button class="menu-btn" data-a="continue" data-v="${latest.slot}">Continue<small>${esc(latest.factionName)} · ${esc(latest.label)}</small></button>` : ''}
          <button class="menu-btn" data-a="load" ${this.hasSaves() ? '' : 'disabled'}>Load Game<small>${this.hasSaves() ? 'Resume a saved war' : 'No saved games yet'}</small></button>
          <button class="menu-btn" data-a="settings">Settings</button>
          <button class="menu-btn" data-a="help">Field Manual</button>
          <button class="menu-btn" data-a="credits">Credits</button>
        </div>
        <div class="menu-foot">v${GAME_VERSION} · 9 world powers · ${CITY_DEFS.length} cities · runs entirely in your browser</div>
      </div>
      <div class="menu-right"><div class="intel-card panel"><div class="section-label" style="margin-top:0">Intelligence brief</div><div data-tip-text>${TIPS[0]}</div></div></div>`;
    delegate(this.screen, (a, v) => this.onAction(a, v));
  }

  private rotateTip(): void {
    const t = this.screen.querySelector<HTMLElement>('[data-tip-text]');
    if (!t) return;
    this.tipIdx = (this.tipIdx + 1) % TIPS.length;
    t.style.opacity = '0';
    setTimeout(() => {
      t.innerHTML = TIPS[this.tipIdx];
      t.style.transition = 'opacity .4s';
      t.style.opacity = '1';
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
    let selected = FACTIONS[0].id;
    let difficulty: Difficulty = Settings.data.difficulty;
    const overlay = el('div', 'overlay-center');
    const win = el('div', 'window panel faction-win');
    win.style.position = 'relative';
    win.style.left = 'auto';
    win.style.top = 'auto';
    win.style.transform = 'none';
    win.style.animation = 'fadein .25s ease';
    overlay.append(win);
    this.root.append(overlay);
    const render = () => {
      const cards = FACTIONS.map((f) => {
        const cities = CITY_DEFS.filter((c) => c.owner === f.id);
        const ports = cities.filter((c) => c.port).length;
        return `<div class="fcard ${selected === f.id ? 'selected' : ''}" style="--fc:${f.css}" data-a="pick" data-v="${f.id}">
          <div class="row"><span class="faction-emblem" style="background:${f.css};width:24px;height:24px;font-size:9px">${f.short}</span><div class="fn">${esc(f.name)}</div></div>
          <div class="fm">“${esc(f.motto)}”</div>
          <div class="fd">${esc(f.desc)}</div>
          <div class="fs"><span>Cities <b>${cities.length}</b></span><span>Ports <b>${ports}</b></span><span>Capital <b>${esc(f.capital)}</b></span></div>
          <div class="fs"><span>Challenge <b class="${f.difficulty === 'Hard' ? 'bad' : f.difficulty === 'Easy' ? 'good' : 'warn'}">${f.difficulty}</b></span></div>
        </div>`;
      }).join('');
      win.innerHTML = `<div class="panel-title" style="font-size:15px;padding:11px 14px"><span>Choose your world power</span><span class="grow"></span><span class="close" data-a="back">✕</span></div>
        <div class="win-body">
          <div class="faction-grid">${cards}</div>
          <div class="diff-row"><span class="section-label" style="margin:0 8px 0 0">AI difficulty</span>
            ${(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => `<button class="btn ${difficulty === d ? 'active' : ''}" data-a="diff" data-v="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}
            <span class="spacer"></span>
            <button class="btn" data-a="back">Back</button>
            <button class="btn primary" data-a="start" style="padding:9px 26px;font-size:15px">Start Campaign ▸</button>
          </div>
        </div>`;
    };
    render();
    this.host.focus(selected);
    delegate(win, (a, v) => {
      App.audio.play('click');
      if (a === 'pick') {
        selected = v;
        this.host.focus(v);
        render();
      } else if (a === 'diff') {
        difficulty = v as Difficulty;
        Settings.set('difficulty', difficulty);
        render();
      } else if (a === 'back') {
        overlay.remove();
        this.host.focus(null);
      } else if (a === 'start') {
        this.host.startNew(selected, difficulty);
      }
    });
  }
}
