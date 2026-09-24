// Windows shared between the main menu and the in-game UI.
import { el, esc, delegate, gameDate } from './dom';
import { ICONS } from './icons';
import { Settings, type SettingsData } from '../core/Settings';
import { App } from '../app';
import { listSaves, deleteSave } from '../save/SaveSystem';
import { GAME_TITLE, GAME_VERSION } from '../config';

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
  const w = openWindow(host, 'Settings', '', onClose);
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
    w.body.innerHTML =
      sliders
        .map(([k, label]) => `<div class="settings-row"><span>${label}</span><input type="range" min="0" max="1" step="0.05" value="${s[k]}" data-k="${k}"></div>`)
        .join('') +
      toggles.map(([k, label]) => `<div class="settings-row"><span>${label}</span><div class="toggle ${s[k] ? 'on' : ''}" data-a="toggle" data-v="${k}"></div></div>`).join('') +
      `<div class="settings-row"><span>Default difficulty</span><select data-k="difficulty" class="btn">${['easy', 'normal', 'hard']
        .map((d) => `<option value="${d}" ${s.difficulty === d ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`)
        .join('')}</select></div>`;
  };
  render();
  w.body.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const k = t.dataset.k as keyof SettingsData | undefined;
    if (!k) return;
    if (t.type === 'range') Settings.set(k, Number(t.value) as never);
    applyAudioSettings();
  });
  w.body.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.k === 'difficulty') Settings.set('difficulty', t.value as SettingsData['difficulty']);
  });
  delegate(w.body, (a, v) => {
    if (a === 'toggle') {
      const k = v as keyof SettingsData;
      Settings.set(k, !Settings.data[k] as never);
      App.audio.play('click');
      render();
    }
  });
  return w;
}

export function openSaveLoad(host: HTMLElement, opts: { canSave: boolean; onSave?: (slot: string) => void; onLoad: (slot: string) => void; onClose?: () => void }): Win {
  const w = openWindow(host, opts.canSave ? 'Save / Load' : 'Load Campaign', '', opts.onClose);
  w.root.querySelector('.window')!.setAttribute('style', 'width:600px');
  const render = () => {
    const saves = listSaves();
    const slots = ['auto', 'slot1', 'slot2', 'slot3'];
    w.body.innerHTML = slots
      .map((slot, i) => {
        const m = saves[i];
        const label = slot === 'auto' ? 'Autosave' : `Slot ${slot.slice(4)}`;
        const info = m
          ? `<div class="nm">${esc(label)} — ${esc(m.factionName)}</div><div class="dt">${gameDate(m.time).date} · ${m.cities} cities · ${esc(m.difficulty)} · saved ${new Date(m.savedAt).toLocaleString()}</div>`
          : `<div class="nm muted">${esc(label)} — empty</div>`;
        const saveBtn = opts.canSave && slot !== 'auto' ? `<button class="btn small" data-a="save" data-v="${slot}">Save</button>` : '';
        const loadBtn = m ? `<button class="btn small primary" data-a="load" data-v="${slot}">Load</button>` : '';
        const delBtn = m ? `<button class="btn small danger" data-a="del" data-v="${slot}">${ICONS.trash}</button>` : '';
        return `<div class="save-slot"><div class="info">${info}</div>${saveBtn}${loadBtn}${delBtn}</div>`;
      })
      .join('') + `<div class="muted" style="font-size:12px;margin-top:8px">Saves are stored in this browser (localStorage). Quick save: F5 · Quick load: F9.</div>`;
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
  const w = openWindow(host, 'Field Manual — Controls', '', onClose);
  w.root.querySelector('.window')!.setAttribute('style', 'width:640px');
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
    ['M', 'Missile strike (missile ships, launchers, city batteries)'],
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
  w.body.innerHTML = `<table class="table">${rows.map(([k, d]) => `<tr><td class="gold num" style="width:210px">${k}</td><td>${d}</td></tr>`).join('')}</table>
  <div class="section-label">How to win</div>
  <div style="line-height:1.45">Bombard an enemy city until its defences reach zero, then move land units into it with no defenders present to capture it. Control 60% of the world's cities or eliminate every rival faction to win. Lose all your cities and the war is lost.</div>`;
  return w;
}

export function openCredits(host: HTMLElement, onClose?: () => void): Win {
  const w = openWindow(host, 'Credits', '', onClose);
  w.root.querySelector('.window')!.setAttribute('style', 'width:520px');
  w.body.innerHTML = `<div style="text-align:center;line-height:1.6">
    <div class="game-title" style="font-size:34px">${GAME_TITLE}</div>
    <div class="muted" style="letter-spacing:.3em;margin-bottom:14px">VERSION ${GAME_VERSION}</div>
    <div><b>Design, code, art & audio</b><br/>Generated procedurally — every map, sprite, effect and sound is created at runtime.</div>
    <div style="margin-top:10px"><b>Technology</b><br/>Phaser 3 · TypeScript · Vite · Web Audio API</div>
    <div style="margin-top:10px"><b>Fonts</b><br/>Oxanium & Rajdhani (Google Fonts, SIL OFL)</div>
    <div style="margin-top:14px" class="muted">All factions are fictional. City names are used for geographic flavour only.</div>
  </div>`;
  return w;
}
