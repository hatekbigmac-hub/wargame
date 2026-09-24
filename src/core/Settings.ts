// Persistent player settings (localStorage, fail-safe).
import { SAVE_PREFIX } from '../config';
import type { Difficulty } from './types';
import { setLang, type Lang } from '../i18n';

export interface SettingsData {
  master: number;
  music: number;
  sfx: number;
  edgeScroll: boolean;
  leftDragPan: boolean;
  screenShake: boolean;
  damageNumbers: boolean;
  fog: boolean;
  showFps: boolean;
  difficulty: Difficulty;
  autosave: boolean;
  lang: Lang;
}

const DEFAULTS: SettingsData = {
  master: 0.8,
  music: 0.45,
  sfx: 0.7,
  edgeScroll: true,
  leftDragPan: true,
  screenShake: true,
  damageNumbers: true,
  fog: true,
  showFps: false,
  difficulty: 'normal',
  autosave: true,
  lang: 'en',
};

const KEY = `${SAVE_PREFIX}.settings`;
type Listener = (s: SettingsData) => void;

class SettingsStore {
  data: SettingsData = { ...DEFAULTS };
  private listeners: Listener[] = [];

  load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      this.data = { ...DEFAULTS };
    }
    if (this.data.lang !== 'en' && this.data.lang !== 'ru') this.data.lang = 'en';
    setLang(this.data.lang);
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    this.data[key] = value;
    if (key === 'lang') setLang(value as Lang);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable */
    }
    for (const l of this.listeners) l(this.data);
  }

  onChange(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }
}

export const Settings = new SettingsStore();
