import Phaser from 'phaser';
import { t } from '../i18n';
import { generateTextures } from '../effects/Textures';
import { WorldGeo } from '../map/WorldGeo';
import { MapAssets } from '../map/MapRenderer';
import { App } from '../app';

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 16));

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  async create(): Promise<void> {
    const fill = document.getElementById('boot-fill');
    const text = document.getElementById('boot-text');
    const progress = (p: number, msg: string) => {
      if (fill) fill.style.width = `${Math.round(p * 100)}%`;
      if (text) text.textContent = t(msg);
    };
    try {
      progress(0.03, t('Generating assets…'));
      await nextFrame();
      generateTextures(this);
      progress(0.06, 'Surveying the world…');
      await nextFrame();
      if (!App.geo) App.geo = WorldGeo.build();
      await MapAssets.build(App.geo, progress);
      progress(1, 'Ready');
      await nextFrame();
    } catch (err) {
      console.error(err);
      if (text) text.textContent = t('Failed to initialise the game. Please reload the page.');
      return;
    }
    const loader = document.getElementById('boot-loader');
    if (loader) {
      loader.classList.add('hidden');
      setTimeout(() => loader.remove(), 700);
    }
    this.scene.start('Menu');
  }
}
