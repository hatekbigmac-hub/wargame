// Phaser visuals for units: tinted hull + rotating turret, shadow, HP bar, selection ring,
// transport form when embarked, submerged submarines, hit flashes and culling.
import Phaser from 'phaser';
import type { Unit } from '../core/types';
import type { Sim } from '../core/Simulation';
import { unitDef } from '../data/units';
import { UNIT_TEXTURE_SCALE } from '../effects/Textures';

interface UnitView {
  unit: Unit;
  c: Phaser.GameObjects.Container;
  shadow: Phaser.GameObjects.Image;
  body: Phaser.GameObjects.Image;
  turret: Phaser.GameObjects.Image | null;
  transport: Phaser.GameObjects.Image | null;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
  ring: Phaser.GameObjects.Image;
  color: number;
  size: number;
  naval: boolean;
  air: boolean;
  heli: boolean;
  lastHp: number;
  flash: number;
  bodyAngle: number;
  turretAngle: number;
  phase: number;
  embarked: boolean;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class UnitViews {
  private views = new Map<number, UnitView>();
  selected = new Set<number>();
  hovered = -1;
  reveal = false;
  lod = 1;

  constructor(private scene: Phaser.Scene, private sim: Sim) {
    for (const u of sim.state.units.values()) this.add(u);
    sim.bus.on('unitCreated', ({ unit }) => this.add(unit));
    sim.bus.on('unitRemoved', ({ unit }) => this.remove(unit.id));
    sim.bus.on('unitDamaged', ({ unit }) => {
      const v = this.views.get(unit.id);
      if (v) v.flash = 0.12;
    });
  }

  get(id: number): UnitView | undefined {
    return this.views.get(id);
  }

  private add(u: Unit): void {
    if (this.views.has(u.id)) return;
    const sc = this.scene;
    const def = unitDef(u.type);
    const color = this.sim.state.factions[u.owner]?.color ?? 0xcccccc;
    const naval = def.domain === 'naval';
    const size = def.size;
    const air = def.domain === 'air';
    const c = sc.add.container(u.x, u.y).setDepth(naval ? 20 : air ? 26 : 21);
    const shadow = sc.add.image(3, 4, def.sprite).setTint(0x000000).setAlpha(0.35).setScale(UNIT_TEXTURE_SCALE);
    const body = sc.add.image(0, 0, def.sprite).setTint(color).setScale(UNIT_TEXTURE_SCALE);
    const turret = def.turret ? sc.add.image(0, 0, def.turret).setTint(air ? 0x2a2f36 : color).setScale(UNIT_TEXTURE_SCALE) : null;
    if (air && turret) turret.setAlpha(0.85);
    const ring = sc.add.image(0, 0, 'fx_ring_dash').setVisible(false);
    ring.setDisplaySize(size * 1.5, size * 1.5);
    const hpY = -size * 0.62 - 4;
    const hpBg = sc.add.rectangle(0, hpY, size + 2, 5, 0x000000, 0.7).setVisible(false);
    const hpFill = sc.add.rectangle(-size / 2, hpY, size, 3, 0x4cd964).setOrigin(0, 0.5).setVisible(false);
    const children: Phaser.GameObjects.GameObject[] = [ring, shadow, body];
    if (turret) children.push(turret);
    children.push(hpBg, hpFill);
    c.add(children);
    const v: UnitView = {
      unit: u, c, shadow, body, turret, transport: null, hpBg, hpFill, ring, color, size, naval, air, heli: def.cls === 'heli',
      lastHp: -1, flash: 0, bodyAngle: u.angle, turretAngle: u.turret, phase: Math.random() * 10, embarked: false,
    };
    this.views.set(u.id, v);
    // Spawn pop-in.
    c.setScale(0.2 * this.lod);
    c.setAlpha(0);
    sc.tweens.add({ targets: c, alpha: 1, duration: 300 });
    this.sync(v, 0, true);
  }

  private remove(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.views.delete(id);
    this.selected.delete(id);
    v.c.destroy();
  }

  isVisibleToPlayer(u: Unit): boolean {
    return this.reveal || this.sim.combat.canSee(this.sim.state.player, u);
  }

  /** Per-frame sync. `view` is the camera world rectangle used for culling. */
  update(dt: number, view: Phaser.Geom.Rectangle): void {
    const margin = 80 * this.lod;
    for (const v of this.views.values()) {
      const u = v.unit;
      const onScreen = u.x > view.x - margin && u.x < view.right + margin && u.y > view.y - margin && u.y < view.bottom + margin;
      if (!onScreen || !this.isVisibleToPlayer(u)) {
        v.c.setVisible(false);
        continue;
      }
      v.c.setVisible(true);
      this.sync(v, dt, false);
    }
  }

  private sync(v: UnitView, dt: number, instant: boolean): void {
    const u = v.unit;
    const def = unitDef(u.type);
    const k = instant ? 1 : Math.min(1, dt * 8);
    v.phase += dt;
    let bob = 0;
    if (v.air) {
      // Altitude: shadow drops away from airborne aircraft; helicopters sway gently.
      const up = !u.landed;
      if (v.heli && up) bob = Math.sin(v.phase * 3) * 0.7;
      const [sx, sy, sa] = !up ? [2, 3, 0.35] : v.heli ? [6, 10, 0.24] : [11, 17, 0.18];
      v.shadow.setPosition(sx, sy).setAlpha(sa);
      v.c.setDepth(up ? 26 : 22);
      if (v.turret && (up || u.order)) v.turret.rotation += dt * 26;
    } else if (u.moving && !v.naval && !u.embarked) bob = def.cls === 'infantry' ? Math.sin(v.phase * 14) * 0.8 : Math.sin(v.phase * 30) * 0.35;
    v.c.setPosition(u.x, u.y + bob);
    if (v.c.scaleX !== this.lod && v.c.alpha >= 1) v.c.setScale(this.lod);
    else if (v.c.alpha < 1) v.c.setScale(Phaser.Math.Linear(v.c.scaleX, this.lod, Math.min(1, dt * 10)));

    // Embarked land units ride a transport.
    if (u.embarked !== v.embarked) {
      v.embarked = u.embarked;
      if (u.embarked && !v.transport) {
        v.transport = this.scene.add.image(0, 0, 'n_transport').setTint(v.color).setScale(UNIT_TEXTURE_SCALE);
        v.c.addAt(v.transport, 1);
      }
      if (v.transport) v.transport.setVisible(u.embarked);
      const s = u.embarked ? UNIT_TEXTURE_SCALE * 0.55 : UNIT_TEXTURE_SCALE;
      v.body.setScale(s);
      v.turret?.setScale(s);
      v.shadow.setVisible(!u.embarked);
    }

    v.bodyAngle = lerpAngle(v.bodyAngle, u.angle, k);
    v.body.rotation = v.bodyAngle;
    v.shadow.rotation = v.bodyAngle;
    if (v.transport) v.transport.rotation = v.bodyAngle;
    if (v.turret && !v.air) {
      const engaged = u.targetUnit >= 0 || u.targetCity >= 0;
      const want = engaged ? u.turret : v.bodyAngle;
      v.turretAngle = lerpAngle(v.turretAngle, want, Math.min(1, dt * 5));
      v.turret.rotation = v.turretAngle;
      if (v.naval) {
        const off = v.size * 0.26;
        v.turret.setPosition(Math.cos(v.bodyAngle) * off, Math.sin(v.bodyAngle) * off);
      }
    }

    // Submarines are translucent while submerged.
    if (def.stealth) {
      const surfaced = u.revealed > 0;
      const a = u.owner === this.sim.state.player ? (surfaced ? 1 : 0.5) : 0.85;
      v.body.setAlpha(a);
      v.shadow.setVisible(surfaced);
    }

    // Hit flash.
    if (v.flash > 0) {
      v.flash -= dt;
      if (v.flash > 0) {
        v.body.setTintFill(0xffffff);
        v.turret?.setTintFill(0xffffff);
      } else {
        v.body.setTint(v.color);
        v.turret?.setTint(v.color);
      }
    }

    // HP bar & selection.
    const sel = this.selected.has(u.id);
    const hover = this.hovered === u.id;
    const showHp = sel || hover || u.hp < u.maxHp - 0.5;
    v.hpBg.setVisible(showHp);
    v.hpFill.setVisible(showHp);
    if (showHp && Math.abs(v.lastHp - u.hp) > 0.2) {
      v.lastHp = u.hp;
      const r = Math.max(0, u.hp / u.maxHp);
      v.hpFill.width = v.size * r;
      v.hpFill.fillColor = r > 0.6 ? 0x4cd964 : r > 0.3 ? 0xffc53d : 0xff4d3d;
    }
    v.ring.setVisible(sel || hover);
    if (sel || hover) {
      const own = u.owner === this.sim.state.player;
      v.ring.setTint(own ? (sel ? 0x6bff8f : 0xb8ffc8) : 0xff5a4f);
      v.ring.rotation += dt * 0.8;
      v.ring.setAlpha(sel ? 0.95 : 0.6);
    }
  }

  /** Topmost visible unit under a world point (radius scaled by LOD). */
  pick(x: number, y: number, pred?: (u: Unit) => boolean): Unit | null {
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const v of this.views.values()) {
      if (!v.c.visible) continue;
      const u = v.unit;
      if (pred && !pred(u)) continue;
      const r = (v.size * 0.6 + 4) * this.lod;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d < r && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  all(): IterableIterator<UnitView> {
    return this.views.values();
  }
}
