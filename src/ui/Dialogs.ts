// Windows shared between the main menu and the in-game UI.
import { el, esc, delegate, gameDate } from './dom';
import { ICONS } from './icons';
import { Settings, type SettingsData } from '../core/Settings';
import { App } from '../app';
import { listSaves, deleteSave } from '../save/SaveSystem';
import { factionName } from '../data/factions';
import { GAME_TITLE, GAME_VERSION } from '../config';
import { t } from '../i18n';

export interface Win {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

export function openWindow(host: HTMLElement, title: string, cls: string, onClose?: () => void, backdrop = true): Win {
  const wrap = el('div', 'ia');
  if (backdrop) {
    const bd = el('div', 'window-backdrop');
    wrap.appendChild(bd);
    bd.addEventListener('click', () => close());
  }
  const win = el('div', `window panel ${cls}`);
  win.innerHTML = `<div class="panel-title"><span>${title}</span><span class="grow"></span><span class="close" data-close>${ICONS.close}</span></div><div class="win-body"></div>`;
  wrap.appendChild(win);
  host.appendChild(wrap);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.remove();
    onClose?.();
  };
  win.querySelector('[data-close]')!.addEventListener('click', () => {
    App.audio.play('click');
    close();
  });
  return { root: wrap, body: win.querySelector('.win-body') as HTMLElement, close };
}

export function applyAudioSettings(): void {
  const s = Settings.data;
  App.audio.setVolumes(s.master, s.music, s.sfx);
}

export function openSettings(host: HTMLElement, onClose?: () => void): Win {
  const w = openWindow(host, t('Settings'), '', onClose);
  w.root.querySelector('.window')!.setAttribute('style', 'width:520px');
  const sliders: [keyof SettingsData, string][] = [
    ['master', 'Master volume'],
    ['music', 'Music volume'],
    ['sfx', 'Effects volume'],
  ];
  const toggles: [keyof SettingsData, string][] = [
    ['edgeScroll', 'Edge scrolling'],
    ['leftDragPan', 'Left-drag pans the map (off: box select)'],
    ['screenShake', 'Screen shake'],
    ['damageNumbers', 'Floating damage numbers'],
    ['fog', 'Fog of war overlay'],
    ['showFps', 'Show FPS counter'],
    ['autosave', 'Autosave every 3 minutes'],
  ];
  const render = () => {
    const s = Settings.data;
    const title = w.root.querySelector('.panel-title span');
    if (title) title.textContent = t('Settings');
    w.body.innerHTML =
      `<div class="settings-row"><span>${t('Language')}</span><div class="row" style="gap:6px">
        <button class="btn ${s.lang === 'en' ? 'active' : ''}" data-a="lang" data-v="en">English</button>
        <button class="btn ${s.lang === 'ru' ? 'active' : ''}" data-a="lang" data-v="ru">Русский</button></div></div>` +
      sliders
        .map(([k, label]) => `<div class="settings-row"><span>${t(label)}</span><input type="range" min="0" max="1" step="0.05" value="${s[k]}" data-k="${k}"></div>`)
        .join('') +
      toggles.map(([k, label]) => `<div class="settings-row"><span>${t(label)}</span><div class="toggle ${s[k] ? 'on' : ''}" data-a="toggle" data-v="${k}"></div></div>`).join('') +
      `<div class="settings-row"><span>${t('Default difficulty')}</span><select data-k="difficulty" class="btn">${['easy', 'normal', 'hard']
        .map((d) => `<option value="${d}" ${s.difficulty === d ? 'selected' : ''}>${t(d[0].toUpperCase() + d.slice(1))}</option>`)
        .join('')}</select></div>`;
  };
  render();
  w.body.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.k as keyof SettingsData | undefined;
    if (!k) return;
    if (el.type === 'range') Settings.set(k, Number(el.value) as never);
    applyAudioSettings();
  });
  w.body.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.k === 'difficulty') Settings.set('difficulty', el.value as SettingsData['difficulty']);
  });
  delegate(w.body, (a, v) => {
    if (a === 'toggle') {
      const k = v as keyof SettingsData;
      Settings.set(k, !Settings.data[k] as never);
      App.audio.play('click');
      render();
    } else if (a === 'lang') {
      Settings.set('lang', v as SettingsData['lang']);
      App.audio.play('click');
      render();
    }
  });
  return w;
}

export function openSaveLoad(host: HTMLElement, opts: { canSave: boolean; onSave?: (slot: string) => void; onLoad: (slot: string) => void; onClose?: () => void }): Win {
  const w = openWindow(host, opts.canSave ? t('Save / Load') : t('Load Campaign'), '', opts.onClose);
  w.root.querySelector('.window')!.setAttribute('style', 'width:600px');
  const render = () => {
    const saves = listSaves();
    const slots = ['auto', 'slot1', 'slot2', 'slot3'];
    w.body.innerHTML = slots
      .map((slot, i) => {
        const m = saves[i];
        const label = slot === 'auto' ? t('Autosave') : t('Slot {n}', { n: slot.slice(4) });
        const info = m
          ? `<div class="nm">${esc(label)} — ${esc(factionName(m.faction))}</div><div class="dt">${gameDate(m.time).date} · ${t('{n} cities', { n: m.cities })} · ${esc(t(m.difficulty[0].toUpperCase() + m.difficulty.slice(1)))} · ${t('saved')} ${new Date(m.savedAt).toLocaleString()}</div>`
          : `<div class="nm muted">${esc(label)} — ${t('empty')}</div>`;
        const saveBtn = opts.canSave && slot !== 'auto' ? `<button class="btn small" data-a="save" data-v="${slot}">${t('Save')}</button>` : '';
        const loadBtn = m ? `<button class="btn small primary" data-a="load" data-v="${slot}">${t('Load')}</button>` : '';
        const delBtn = m ? `<button class="btn small danger" data-a="del" data-v="${slot}">${ICONS.trash}</button>` : '';
        return `<div class="save-slot"><div class="info">${info}</div>${saveBtn}${loadBtn}${delBtn}</div>`;
      })
      .join('') + `<div class="muted" style="font-size:12px;margin-top:8px">${t('Saves are stored in this browser (localStorage). Quick save: F5 · Quick load: F9.')}</div>`;
  };
  render();
  delegate(w.body, (a, v) => {
    App.audio.play('click');
    if (a === 'save' && opts.onSave) {
      opts.onSave(v);
      render();
    } else if (a === 'load') {
      w.close();
      opts.onLoad(v);
    } else if (a === 'del') {
      deleteSave(v);
      render();
    }
  });
  return w;
}

export function openHelp(host: HTMLElement, onClose?: () => void): Win {
  const w = openWindow(host, t('Field Manual'), 'help-win', onClose);
  w.root.querySelector('.window')!.setAttribute('style', 'width:720px');
  const rows: [string, string][] = [
    ['Left click', 'Select unit or city'],
    ['Shift + click / drag', 'Add to selection / box select'],
    ['Double click', 'Select all units of that type on screen'],
    ['Right click', 'Move · attack enemy unit · assault enemy city'],
    ['Left / right / middle drag', 'Pan the map (configurable)'],
    ['Mouse wheel · Q / E', 'Zoom in / out'],
    ['Arrow keys · screen edges', 'Scroll the map'],
    ['A', 'Attack-move (then click)'],
    ['S · H', 'Stop · Hold position'],
    ['M', 'Missile strike (then click a target)'],
    ['O', 'Prepare an offensive (then click the target city)'],
    ['B · U', 'Board a transport · Unload a transport'],
    ['C / F', 'Center camera on selection'],
    ['Tab', 'Cycle idle units'],
    ['Ctrl + 1-9 · 1-9', 'Assign / recall control group'],
    ['Space', 'Pause / resume'],
    ['+ / −', 'Game speed'],
    ['R', 'Research'],
    ['Delete', 'Disband selected units'],
    ['F5 · F9', 'Quick save · quick load'],
    ['Esc', 'Cancel / close / pause menu'],
    ['F3 or `', 'Developer debug overlay'],
  ];
  const sec = (title: string, body: string) => `<div class="section-label">${t(title)}</div><div class="manual">${t(body)}</div>`;
  w.body.innerHTML =
    sec('War & peace', 'The world starts at <b>peace</b>. Countries prepare before they attack: they <b>mobilise</b> troops on the border (you get a warning and see red arrows on the map), then <b>declare war</b> about two days later. Use the <b>Diplomacy</b> window (globe button) to declare war, propose a ceasefire or answer peace offers.') +
    sec('Preparing an offensive', 'Select land units and press <b>Prepare Offensive</b> (O), then click the enemy city. Your troops gather at a staging area on your side of the border. The longer they prepare (up to 24h), the stronger the attack: up to <b>+25% attack</b>. When ready, press <b>Launch</b> in the Operations panel — war is declared automatically if needed.') +
    sec('Missiles', 'Press the <b>Missile Strike</b> button in the top bar (or <b>M</b>) and click an enemy unit or city. The nearest ready launcher in range fires: <b>city missile batteries</b> (your capital starts with one), <b>Missile Launchers</b> and <b>Missile Ships</b>. The button shows how many launchers are ready. Anti-air and frigates can shoot missiles down.') +
    sec('Crossing the sea', 'Land units cannot swim. Build a <b>Transport Ship</b> in a port city (Manage City → Naval forces). Select infantry, tanks or artillery and <b>right-click your transport</b> (or press Board) — up to 6 units go aboard. Then select the transport and <b>right-click a coast</b> (or press Unload) to land them. If the transport sinks, everyone aboard is lost — escort it with warships.') +
    sec('Capturing cities', 'Bombard an enemy city until its defences reach zero, then move land units into it with no defenders present. Control 60% of the world\'s cities or eliminate every rival to win. Lose all your cities and the war is lost.') +
    `<div class="section-label">${t('Controls')}</div><table class="table">${rows.map(([k, d]) => `<tr><td class="gold num" style="width:210px">${t(k)}</td><td>${t(d)}</td></tr>`).join('')}</table>`;
  return w;
}

export function openCredits(host: HTMLElement, onClose?: () => void): Win {
  const w = openWindow(host, t('Credits'), '', onClose);
  w.root.querySelector('.window')!.setAttribute('style', 'width:520px');
  w.body.innerHTML = `<div style="text-align:center;line-height:1.6">
    <div class="game-title" style="font-size:34px">${GAME_TITLE}</div>
    <div class="muted" style="letter-spacing:.3em;margin-bottom:14px">${t('VERSION')} ${GAME_VERSION}</div>
    <div><b>${t('Design, code, art & audio')}</b><br/>${t('Generated procedurally — every sprite, effect and sound is created at runtime.')}</div>
    <div style="margin-top:10px"><b>${t('Map data')}</b><br/>${t('Made with Natural Earth — free vector and raster map data @ naturalearthdata.com (public domain). Borders show de facto control and are not a political statement.')}</div>
    <div style="margin-top:10px"><b>${t('Technology')}</b><br/>Phaser 3 · TypeScript · Vite · Web Audio API</div>
    <div style="margin-top:10px"><b>${t('Fonts')}</b><br/>Oxanium & Rajdhani (Google Fonts, SIL OFL)</div>
    <div style="margin-top:14px" class="muted">${t('A fictional war game. Real countries and cities are used for geographic flavour only.')}</div>
  </div>`;
  return w;
}

/** Small modal confirmation (e.g. declaring war). */
export function openConfirm(host: HTMLElement, title: string, html: string, okLabel: string, onOk: () => void, onClose?: () => void, danger = true): Win {
  const w = openWindow(host, title, 'confirm-win', onClose);
  w.root.querySelector('.window')!.setAttribute('style', 'width:440px');
  w.body.innerHTML = `<div style="line-height:1.45;margin-bottom:14px">${html}</div>
    <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn" data-a="no">${t('Cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${okLabel}</button></div>`;
  delegate(w.body, (a) => {
    App.audio.play('click');
    w.close();
    if (a === 'yes') onOk();
  });
  return w;
}
