// Country names drawn on the map like a political atlas. Size follows country area;
// labels fade in/out by zoom so they never clutter the view.
import Phaser from 'phaser';
import { lonToX, latToY, CELL, COLS, ROWS } from '../config';
import { FACTIONS } from '../data/factions';
import type { WorldGeo } from './WorldGeo';
import { tn, onLangChange } from '../i18n';

interface Label {
  id: string;
  text: Phaser.GameObjects.Text;
  size: number;
}

export class CountryLabels {
  private labels: Label[] = [];
  private offLang: () => void;

  constructor(scene: Phaser.Scene, geo: WorldGeo, private alive: (id: string) => boolean) {
    for (const f of FACTIONS) {
      const ci = geo.countryIndex.get(f.id);
      if (ci === undefined) continue;
      // Size by the country's land around its label point, so overseas territories
      // (Greenland for Denmark, French Guiana for France…) don't inflate the label.
      const lx = lonToX(f.labelLon);
      const ly = latToY(f.labelLat);
      const cx = Math.floor(lx / CELL);
      const cy = Math.floor(ly / CELL);
      let cells = 0;
      for (let y = Math.max(0, cy - 25); y <= Math.min(ROWS - 1, cy + 25); y++) {
        for (let x = Math.max(0, cx - 32); x <= Math.min(COLS - 1, cx + 32); x++) if (geo.cellCountry[y * COLS + x] === ci) cells++;
      }
      if (cells < 3) continue;
      const size = Math.max(11, Math.min(62, 7 + Math.sqrt(cells) * 1.15));
      const text = scene.add
        .text(lonToX(f.labelLon), latToY(f.labelLat), tn(f).toUpperCase(), {
          fontFamily: 'Oxanium, Rajdhani, sans-serif',
          fontSize: `${Math.round(size)}px`,
          fontStyle: '700',
          color: '#f4f1e8',
          stroke: '#1a1d22',
          strokeThickness: Math.max(2, size * 0.12),
          align: 'center',
        })
        .setOrigin(0.5)
        .setDepth(9)
        .setAlpha(0)
        .setLetterSpacing(Math.round(size * 0.12));
      this.labels.push({ id: f.id, text, size });
    }
    this.offLang = onLangChange(() => {
      for (const l of this.labels) {
        const f = FACTIONS.find((x) => x.id === l.id);
        if (f) l.text.setText(tn(f).toUpperCase());
      }
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.offLang());
  }

  update(zoom: number, view: Phaser.Geom.Rectangle): void {
    for (const l of this.labels) {
      const screen = l.size * zoom;
      // Visible while the on-screen size is readable but not overwhelming.
      let a = 0;
      if (screen >= 9 && screen <= 46) a = Math.min(1, (screen - 9) / 5, (46 - screen) / 8);
      if (a > 0 && !this.alive(l.id)) a = 0;
      if (a > 0) {
        const t = l.text;
        const on = t.x > view.x - 300 && t.x < view.right + 300 && t.y > view.y - 100 && t.y < view.bottom + 100;
        if (!on) a = 0;
      }
      l.text.setVisible(a > 0.01);
      if (a > 0.01) l.text.setAlpha(a * 0.78);
    }
  }
}
