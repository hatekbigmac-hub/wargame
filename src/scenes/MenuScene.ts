import Phaser from 'phaser';
import { App } from '../app';
import { MapRenderer } from '../map/MapRenderer';
import { WORLD_W, WORLD_H } from '../config';
import { CITY_DEFS } from '../data/cities';
import { cityImportance } from '../core/GameState';
import type { City, Difficulty } from '../core/types';
import { FACTIONS } from '../data/factions';
import { MainMenu, type MenuHost } from '../ui/MainMenu';
import { loadFromSlot } from '../save/SaveSystem';

export class MenuScene extends Phaser.Scene implements MenuHost {
  private map!: MapRenderer;
  private menu!: MainMenu;
  private t0 = 0;
  private focusPt: { x: number; y: number } | null = null;

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
      const f = FACTIONS.find((ff) => ff.id === pc.def.owner);
      const r = 2 + pc.def.size;
      g.fillStyle(0x000000, 0.5).fillCircle(pc.x, pc.y, r + 2);
      g.fillStyle(f?.color ?? 0xffffff, 1).fillCircle(pc.x, pc.y, r);
      g.fillStyle(0xffffff, 0.9).fillCircle(pc.x, pc.y, r * 0.4);
    });
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
    cam.setZoom(Math.max(this.scale.height / WORLD_H, this.scale.width / WORLD_W) * 1.55);
  }

  focus(faction: string | null): void {
    if (!faction) {
      this.focusPt = null;
      return;
    }
    const f = FACTIONS.find((x) => x.id === faction);
    const pc = App.geo!.cities.find((c) => c.def.name === f?.capital);
    if (pc) this.focusPt = { x: pc.x, y: pc.y };
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
    const vw = cam.width / cam.zoom;
    const vh = cam.height / cam.zoom;
    let cx: number;
    let cy: number;
    if (this.focusPt) {
      cx = this.focusPt.x - vw * 0.18;
      cy = this.focusPt.y;
    } else {
      const t = (time - this.t0) * 0.00004;
      cx = WORLD_W * 0.5 + Math.sin(t) * (WORLD_W - vw) * 0.45;
      cy = WORLD_H * 0.42 + Math.cos(t * 0.7) * Math.max(0, (WORLD_H - vh) * 0.3);
    }
    cx = Phaser.Math.Clamp(cx, vw / 2, WORLD_W - vw / 2);
    cy = Phaser.Math.Clamp(cy, vh / 2, WORLD_H - vh / 2);
    const cur = cam.midPoint;
    const k = this.focusPt ? 0.06 : 1;
    cam.centerOn(cur.x + (cx - cur.x) * k, cur.y + (cy - cur.y) * k);
  }
}
