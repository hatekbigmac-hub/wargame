import Phaser from 'phaser';
import { App } from '../app';
import { MapRenderer } from '../map/MapRenderer';
import { CountryLabels } from '../map/CountryLabels';
import { WORLD_W, WORLD_H, lonToX, latToY } from '../config';
import { CITY_DEFS } from '../data/cities';
import { cityImportance } from '../core/GameState';
import type { City, Difficulty } from '../core/types';
import { FACTION_MAP } from '../data/factions';
import { MainMenu, type MenuHost } from '../ui/MainMenu';
import { loadFromSlot } from '../save/SaveSystem';

export class MenuScene extends Phaser.Scene implements MenuHost {
  private map!: MapRenderer;
  private menu!: MainMenu;
  private labels!: CountryLabels;
  private outline!: Phaser.GameObjects.Graphics;
  private t0 = 0;
  private focusPt: { x: number; y: number; zoom: number } | null = null;
  private baseZoom = 1;

  constructor() {
    super('Menu');
  }

  create(): void {
    const geo = App.geo!;
    const owners = CITY_DEFS.map((c) => c.owner);
    const cities = geo.cities.map((pc, i) => ({
      id: i, name: pc.def.name, x: pc.x, y: pc.y, importance: cityImportance({ ...pc.def, port: pc.port }), tags: pc.def.tags,
    })) as unknown as City[];
    this.map = new MapRenderer(this, geo, () => owners, () => cities);
    this.map.create();
    // City lights.
    const g = this.add.graphics().setDepth(6);
    geo.cities.forEach((pc) => {
      const f = FACTION_MAP[pc.def.owner];
      const r = 1.5 + pc.def.size * 0.8;
      g.fillStyle(0x000000, 0.5).fillCircle(pc.x, pc.y, r + 1.5);
      g.fillStyle(f?.color ?? 0xffffff, 1).fillCircle(pc.x, pc.y, r);
      g.fillStyle(0xffffff, 0.9).fillCircle(pc.x, pc.y, r * 0.45);
    });
    this.outline = this.add.graphics().setDepth(8);
    this.labels = new CountryLabels(this, geo, () => true);
    this.fitCamera();
    this.scale.on('resize', this.fitCamera, this);
    this.t0 = this.time.now;
    this.focusPt = null;
    this.menu = new MainMenu(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.fitCamera, this);
      this.menu.destroy();
    });
    App.audio.startMusic('menu');
  }

  private fitCamera(): void {
    const cam = this.cameras.main;
    cam.setSize(this.scale.width, this.scale.height);
    this.baseZoom = Math.max(this.scale.height / WORLD_H, this.scale.width / WORLD_W) * 1.55;
    if (!this.focusPt) cam.setZoom(this.baseZoom);
  }

  /** Fly the camera to a country and outline its borders. */
  focus(faction: string | null): void {
    this.outline.clear();
    if (!faction) {
      this.focusPt = null;
      return;
    }
    const f = FACTION_MAP[faction];
    const geo = App.geo!;
    const ci = geo.countryIndex.get(faction);
    if (!f || ci === undefined) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const cam = this.cameras.main;
    for (const p of geo.countryPolys) {
      if (p.country !== ci) continue;
      // Skip far-flung overseas bits when framing (they still get outlined).
      const main = Math.hypot((p.minX + p.maxX) / 2 - lonToX(f.labelLon), (p.minY + p.maxY) / 2 - latToY(f.labelLat)) < 900;
      if (main) {
        minX = Math.min(minX, p.minX);
        minY = Math.min(minY, p.minY);
        maxX = Math.max(maxX, p.maxX);
        maxY = Math.max(maxY, p.maxY);
      }
      for (const ring of p.rings) {
        const pts: Phaser.Types.Math.Vector2Like[] = [];
        for (let i = 0; i < ring.length; i += 2) pts.push({ x: ring[i], y: ring[i + 1] });
        this.outline.lineStyle(6, 0x000000, 0.35).strokePoints(pts, true);
        this.outline.lineStyle(2.5, 0xffe28a, 0.95).strokePoints(pts, true);
      }
    }
    if (!isFinite(minX)) {
      minX = maxX = lonToX(f.labelLon);
      minY = maxY = latToY(f.labelLat);
    }
    const w = Math.max(260, maxX - minX);
    const h = Math.max(200, maxY - minY);
    // Leave room for the selection window on the left/centre.
    const zoom = Phaser.Math.Clamp(Math.min((cam.width * 0.38) / w, (cam.height * 0.55) / h), this.baseZoom, 3);
    this.focusPt = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom };
  }

  startNew(faction: string, difficulty: Difficulty): void {
    this.cameras.main.fadeOut(350, 3, 8, 16);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Game', { faction, difficulty }));
  }

  startLoaded(slot: string): void {
    const data = loadFromSlot(slot);
    if (!data) return;
    this.scene.start('Game', { load: data });
  }

  update(time: number): void {
    this.map.update(time);
    const cam = this.cameras.main;
    const targetZoom = this.focusPt ? this.focusPt.zoom : this.baseZoom;
    cam.setZoom(cam.zoom + (targetZoom - cam.zoom) * 0.06);
    const vw = cam.width / cam.zoom;
    const vh = cam.height / cam.zoom;
    let cx: number;
    let cy: number;
    if (this.focusPt) {
      cx = this.focusPt.x - vw * 0.22;
      cy = this.focusPt.y;
    } else {
      const t = (time - this.t0) * 0.00004;
      cx = WORLD_W * 0.5 + Math.sin(t) * (WORLD_W - vw) * 0.45;
      cy = WORLD_H * 0.42 + Math.cos(t * 0.7) * Math.max(0, (WORLD_H - vh) * 0.3);
    }
    cx = Phaser.Math.Clamp(cx, vw / 2, WORLD_W - vw / 2);
    cy = Phaser.Math.Clamp(cy, vh / 2, WORLD_H - vh / 2);
    const cur = cam.midPoint;
    const k = this.focusPt ? 0.07 : 1;
    cam.centerOn(cur.x + (cx - cur.x) * k, cur.y + (cy - cur.y) * k);
    this.labels.update(cam.zoom, cam.worldView);
  }
}
