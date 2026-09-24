// City markers: faction-tinted disc + glyph, name label, defence bar, capture ring,
// port anchor, under-attack pulse and selection highlight. Labels are LOD-culled.
import Phaser from 'phaser';
import { tn, onLangChange } from '../i18n';
import type { City } from '../core/types';
import type { Sim } from '../core/Simulation';
import { NEUTRAL_COLOR } from '../data/factions';

interface CityView {
  city: City;
  c: Phaser.GameObjects.Container;
  disc: Phaser.GameObjects.Image;
  glyph: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
  cap: Phaser.GameObjects.Graphics;
  pulse: Phaser.GameObjects.Image;
  sel: Phaser.GameObjects.Image;
  badge: Phaser.GameObjects.Text | null;
  r: number;
  lastHp: number;
  lastCap: number;
  owner: string;
}

const RADIUS = [0, 13, 16, 20, 24];

export class CityViews {
  private views: CityView[] = [];
  selected = -1;
  hovered = -1;
  lod = 1;
  zoom = 1;
  showBadges = false;

  constructor(private scene: Phaser.Scene, private sim: Sim) {
    for (const c of sim.state.cities) this.views.push(this.create(c));
    sim.bus.on('cityCaptured', ({ city }) => this.recolor(this.views[city.id]));
    const off = onLangChange(() => {
      for (const v of this.views) v.label.setText(tn(v.city).toUpperCase());
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
  }

  private color(owner: string): number {
    return this.sim.state.factions[owner]?.color ?? NEUTRAL_COLOR;
  }

  private create(city: City): CityView {
    const sc = this.scene;
    const tier = Math.min(4, city.size);
    const r = RADIUS[tier] * 0.5 + 4;
    const c = sc.add.container(city.x, city.y).setDepth(city.capital ? 12 : 10 + city.size * 0.1);
    const sel = sc.add.image(0, 0, 'fx_ring').setDisplaySize(r * 3.4, r * 3.4).setTint(0xffe28a).setVisible(false);
    const pulse = sc.add.image(0, 0, 'fx_ring').setDisplaySize(r * 2.6, r * 2.6).setTint(0xff3b30).setVisible(false);
    const disc = sc.add.image(0, 0, `city_disc_${tier}`).setScale(0.5);
    const glyph = sc.add.image(0, 0, `city_glyph_${city.capital ? 4 : Math.min(3, city.size)}`).setScale(0.5);
    const cap = sc.add.graphics();
    const label = sc.add
      .text(0, r + 3, tn(city).toUpperCase(), {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: `${city.capital ? 14 : city.size >= 3 ? 12.5 : 11.5}px`,
        fontStyle: '700',
        color: city.capital ? '#ffe7a8' : '#f2f5f8',
        stroke: '#05080d',
        strokeThickness: 3.5,
      })
      .setOrigin(0.5, 0)
      .setResolution(2);
    const hpBg = sc.add.rectangle(0, -r - 5, r * 2.2, 4, 0x000000, 0.75).setVisible(false);
    const hpFill = sc.add.rectangle(-r * 1.1, -r - 5, r * 2.2, 2.5, 0x6fd3ff).setOrigin(0, 0.5).setVisible(false);
    label.setPosition(city.x, city.y + r + 3).setDepth(24);
    const items: Phaser.GameObjects.GameObject[] = [sel, pulse, disc, glyph, cap, hpBg, hpFill];
    if (city.port) {
      const anchor = sc.add.image(r * 0.85, r * 0.7, 'ic_anchor').setScale(0.55).setTint(0xcfefff);
      items.push(anchor);
    }
    c.add(items);
    const v: CityView = { city, c, disc, glyph, label, hpBg, hpFill, cap, pulse, sel, badge: null, r, lastHp: -1, lastCap: -1, owner: '' };
    this.recolor(v);
    return v;
  }

  private recolor(v: CityView): void {
    v.owner = v.city.owner;
    v.disc.setTint(this.color(v.city.owner));
  }

  update(dt: number, time: number, view: Phaser.Geom.Rectangle): void {
    const s = this.sim.state;
    const margin = 120;
    for (const v of this.views) {
      const c = v.city;
      const on = c.x > view.x - margin && c.x < view.right + margin && c.y > view.y - margin && c.y < view.bottom + margin;
      v.c.setVisible(on);
      if (!on) {
        v.label.setVisible(false);
        continue;
      }
      if (v.owner !== c.owner) this.recolor(v);
      v.c.setScale(this.lod * (c.capital ? 1.1 : 1));
      // Label LOD
      const z = this.zoom;
      const showLabel =
        this.selected === c.id || this.hovered === c.id || z > 1.05 || (c.size >= 3 && z > 0.62) || (c.capital && z > 0.5) || (c.capital && c.size >= 4 && z > 0.26);
      v.label.setVisible(showLabel);
      if (showLabel) {
        const ls = this.lod * (c.capital ? 1.1 : 1);
        v.label.setScale(ls).setPosition(c.x, c.y + (v.r + 3) * ls);
      }
      // Defence bar
      const damaged = c.hp < c.maxHp - 1;
      v.hpBg.setVisible(damaged || this.selected === c.id);
      v.hpFill.setVisible(damaged || this.selected === c.id);
      if (Math.abs(c.hp - v.lastHp) > 0.5) {
        v.lastHp = c.hp;
        const r = c.maxHp > 0 ? c.hp / c.maxHp : 0;
        v.hpFill.width = v.r * 2.2 * r;
        v.hpFill.fillColor = r > 0.5 ? 0x6fd3ff : r > 0.2 ? 0xffc53d : 0xff4d3d;
      }
      // Capture progress ring
      if (Math.abs(c.capture - v.lastCap) > 0.004) {
        v.lastCap = c.capture;
        v.cap.clear();
        if (c.capture > 0 && c.capturer) {
          v.cap.lineStyle(4, this.color(c.capturer), 1);
          v.cap.beginPath();
          v.cap.arc(0, 0, v.r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, c.capture));
          v.cap.strokePath();
        }
      }
      // Under attack pulse
      const attacked = s.time - c.lastAttacked < 3;
      v.pulse.setVisible(attacked);
      if (attacked) {
        const p = (time * 0.0015) % 1;
        v.pulse.setScale(((v.r * 2.6) / 128) * (1 + p * 0.8));
        v.pulse.setAlpha(1 - p);
      }
      v.sel.setVisible(this.selected === c.id || this.hovered === c.id);
      if (v.sel.visible) {
        v.sel.setAlpha(this.selected === c.id ? 0.9 : 0.45);
      }
      if (this.showBadges) {
        if (!v.badge) {
          v.badge = this.scene.add
            .text(v.r + 2, -v.r - 2, '', { fontFamily: 'Oxanium, sans-serif', fontSize: '11px', fontStyle: '700', color: '#ffe28a', stroke: '#000', strokeThickness: 3 })
            .setOrigin(0, 1)
            .setResolution(2);
          v.c.add(v.badge);
        }
        let n = 0;
        this.sim.spatial.forEachInRange(c.x, c.y, 90, (u) => { if (u.owner === c.owner) n++; });
        v.badge.setText(`⚔${n}  🛡${Math.round(c.hp)}`).setVisible(true);
      } else if (v.badge) v.badge.setVisible(false);
    }
  }

  pick(x: number, y: number): City | null {
    let best: City | null = null;
    let bestD = Infinity;
    for (const v of this.views) {
      if (!v.c.visible) continue;
      const d = Math.hypot(v.city.x - x, v.city.y - y);
      const r = (v.r + 5) * this.lod;
      if (d < r && d < bestD) {
        bestD = d;
        best = v.city;
      }
    }
    return best;
  }
}
