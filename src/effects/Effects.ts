// Reusable, pooled visual effects driven by simulation events.
import Phaser from 'phaser';
import { t as tr } from '../i18n';
import type { Sim } from '../core/Simulation';
import type { Projectile, ProjectileKind, Unit } from '../core/types';
import { projectilePos } from '../combat/CombatSystem';
import { unitDef } from '../data/units';
import { worldToCell } from '../config';
import type { AudioManager, SfxId } from '../audio/AudioManager';
import type { UnitViews } from '../units/UnitViews';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

interface ProjSprite {
  img: Phaser.GameObjects.Image;
  stamp: number;
  trail: number;
}

interface FloatText {
  t: Phaser.GameObjects.Text;
  life: number;
}

const FIRE_SOUND: Partial<Record<ProjectileKind, SfxId>> = {
  bullet: 'rifle', cannon: 'cannon', shell: 'shell', rocket: 'missile', flak: 'flak', torpedo: 'torpedo', air: 'jet', bomb: 'jet',
};

export class Effects {
  private fire: Emitter;
  private bigFire: Emitter;
  private smoke: Emitter;
  private sparks: Emitter;
  private debris: Emitter;
  private water: Emitter;
  private wake: Emitter;
  private contrail: Emitter;
  private trail: Emitter;
  private flash: Emitter;
  private bubbles: Emitter;
  private sparkle: Emitter;
  private proj = new Map<number, ProjSprite>();
  private stamp = 0;
  private floats: FloatText[] = [];
  private floatPool: Phaser.GameObjects.Text[] = [];
  private wrecks: { img: Phaser.GameObjects.Image; life: number }[] = [];
  private rings: Phaser.GameObjects.Image[] = [];
  private lines: Phaser.GameObjects.Graphics;
  private lineFx: { x1: number; y1: number; x2: number; y2: number; life: number; color: number }[] = [];
  private wakeT = 0;
  private sparkleT = 0;
  private cityFxT = 0;
  private view = new Phaser.Geom.Rectangle();
  lod = 1;
  zoom = 1;
  shake = true;
  damageNumbers = true;
  reveal = false;

  constructor(private scene: Phaser.Scene, private sim: Sim, private views: UnitViews, private audio: AudioManager) {
    const sc = scene;
    const P = (tex: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig, depth: number) =>
      sc.add.particles(0, 0, tex, { emitting: false, ...cfg }).setDepth(depth);
    this.fire = P('fx_soft', {
      lifespan: { min: 220, max: 560 }, speed: { min: 15, max: 95 }, angle: { min: 0, max: 360 },
      scale: { start: 0.42, end: 0.05 }, alpha: { start: 0.9, end: 0 }, blendMode: 'ADD',
      color: [0xffd070, 0xff8a28, 0xd0400f, 0x3a1004], colorEase: 'quad.out',
    }, 32);
    this.bigFire = P('fx_soft', {
      lifespan: { min: 400, max: 900 }, speed: { min: 20, max: 150 }, angle: { min: 0, max: 360 },
      scale: { start: 0.75, end: 0.1 }, alpha: { start: 0.85, end: 0 }, blendMode: 'ADD',
      color: [0xffe090, 0xffa040, 0xf0601a, 0x902406, 0x301006], colorEase: 'quad.out',
    }, 32);
    this.smoke = P('fx_smoke', {
      lifespan: { min: 1200, max: 2600 }, speed: { min: 4, max: 22 }, angle: { min: 240, max: 300 },
      scale: { start: 0.35, end: 1.4 }, alpha: { start: 0.5, end: 0 }, tint: [0x2c2c2c, 0x444444, 0x5a5a5a],
      rotate: { min: 0, max: 360 }, gravityY: -10,
    }, 31);
    this.sparks = P('fx_dot', {
      lifespan: { min: 180, max: 420 }, speed: { min: 70, max: 240 }, angle: { min: 0, max: 360 },
      scale: { start: 0.55, end: 0 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD', tint: [0xffe08a, 0xffb347, 0xffffff],
    }, 33);
    this.debris = P('fx_debris', {
      lifespan: { min: 500, max: 900 }, speed: { min: 50, max: 150 }, angle: { min: 200, max: 340 },
      gravityY: 240, rotate: { start: 0, end: 540 }, scale: { start: 0.9, end: 0.5 }, alpha: { start: 1, end: 0.2 },
    }, 32);
    this.water = P('fx_dot', {
      lifespan: { min: 380, max: 800 }, speed: { min: 30, max: 120 }, angle: { min: 235, max: 305 }, gravityY: 260,
      scale: { start: 0.7, end: 0.2 }, alpha: { start: 0.95, end: 0 }, tint: [0xffffff, 0xcdeeff, 0x9fd8f5],
    }, 32);
    this.wake = P('fx_soft', {
      lifespan: { min: 900, max: 1500 }, speed: { min: 0, max: 5 }, scale: { start: 0.12, end: 0.5 },
      alpha: { start: 0.32, end: 0 }, tint: 0xe6f7ff,
    }, 19);
    this.contrail = P('fx_soft', {
      lifespan: { min: 500, max: 800 }, speed: 0, scale: { start: 0.06, end: 0.16 },
      alpha: { start: 0.45, end: 0 }, tint: 0xffffff,
    }, 25);
    this.trail = P('fx_smoke', {
      lifespan: { min: 700, max: 1300 }, speed: { min: 0, max: 8 }, scale: { start: 0.16, end: 0.6 },
      alpha: { start: 0.55, end: 0 }, tint: [0xdedede, 0xbfbfbf], rotate: { min: 0, max: 360 },
    }, 34);
    this.flash = P('fx_glow', {
      lifespan: { min: 70, max: 130 }, speed: 0, scale: { start: 0.32, end: 0.08 }, alpha: { start: 1, end: 0 },
      blendMode: 'ADD', tint: 0xfff0b0,
    }, 33);
    this.bubbles = P('fx_dot', {
      lifespan: { min: 500, max: 900 }, speed: { min: 2, max: 12 }, angle: { min: 0, max: 360 },
      scale: { start: 0.3, end: 0.05 }, alpha: { start: 0.7, end: 0 }, tint: 0xd8f2ff,
    }, 19);
    this.sparkle = P('fx_sparkle', {
      lifespan: { min: 600, max: 1100 }, speed: 0, scale: { start: 0.35, end: 0 }, alpha: { start: 0.8, end: 0 },
      blendMode: 'ADD', tint: 0xffffff, rotate: { min: 0, max: 90 },
    }, 5);
    this.lines = sc.add.graphics().setDepth(35);

    const bus = sim.bus;
    bus.on('unitFired', (e) => this.onFired(e.unit, e.kind, e.x, e.y, e.tx, e.ty));
    bus.on('projectileSpawn', ({ p }) => this.onSpawn(p));
    bus.on('projectileImpact', ({ p, x, y, hit }) => this.onImpact(p, x, y, hit));
    bus.on('missileIntercepted', ({ x, y, bx, by }) => this.onIntercept(x, y, bx, by));
    bus.on('unitRemoved', ({ unit, killed }) => killed && this.onDeath(unit));
    bus.on('unitDamaged', ({ unit, amount }) => this.onDamage(unit, amount));
    bus.on('cityCaptured', ({ city, to, from }) => this.onCapture(city.x, city.y, to, from));
  }

  // ------------------------------------------------------------------ helpers

  private visible(x: number, y: number, margin = 60): boolean {
    const v = this.view;
    if (x < v.x - margin || x > v.right + margin || y < v.y - margin || y > v.bottom + margin) return false;
    return this.reveal || this.sim.combat.cellVisible(this.sim.state.player, worldToCell(x, y));
  }

  private isWater(x: number, y: number): boolean {
    return !this.sim.geo.land[worldToCell(x, y)];
  }

  private ring(x: number, y: number, color: number, size: number, dur: number, alpha = 0.9): void {
    const img = this.rings.pop() ?? this.scene.add.image(0, 0, 'fx_ring').setDepth(33);
    img.setPosition(x, y).setTint(color).setAlpha(alpha).setVisible(true).setScale(0.05).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: img,
      scale: size / 128,
      alpha: 0,
      duration: dur,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        img.setVisible(false);
        this.rings.push(img);
      },
    });
  }

  explosion(x: number, y: number, size: 'small' | 'medium' | 'large' | 'huge'): void {
    const water = this.isWater(x, y);
    switch (size) {
      case 'small':
        this.fire.explode(4, x, y);
        this.sparks.explode(3, x, y);
        break;
      case 'medium':
        this.fire.explode(9, x, y);
        this.sparks.explode(6, x, y);
        this.smoke.explode(3, x, y);
        if (water) this.water.explode(8, x, y);
        else this.debris.explode(3, x, y);
        break;
      case 'large':
        this.bigFire.explode(10, x, y);
        this.fire.explode(10, x, y);
        this.sparks.explode(12, x, y);
        this.smoke.explode(7, x, y);
        if (water) this.water.explode(16, x, y);
        else this.debris.explode(7, x, y);
        this.ring(x, y, 0xffc070, 90, 450, 0.7);
        break;
      case 'huge':
        this.bigFire.explode(22, x, y);
        this.fire.explode(16, x, y);
        this.sparks.explode(22, x, y);
        this.smoke.explode(12, x, y);
        if (water) this.water.explode(26, x, y);
        else this.debris.explode(12, x, y);
        this.ring(x, y, 0xfff0c0, 190, 600, 0.9);
        this.ring(x, y, 0xff8030, 120, 800, 0.6);
        break;
    }
  }

  private cameraShake(intensity: number, dur: number): void {
    if (!this.shake) return;
    this.scene.cameras.main.shake(dur, intensity);
  }

  // ------------------------------------------------------------------ event handlers

  private onFired(unit: Unit | null, kind: ProjectileKind, x: number, y: number, tx: number, ty: number): void {
    if (!this.visible(x, y)) return;
    const a = Math.atan2(ty - y, tx - x);
    const len = unit ? unitDef(unit.type).size * 0.55 * this.lod : 8;
    const fx = x + Math.cos(a) * len;
    const fy = y + Math.sin(a) * len;
    if (kind !== 'torpedo' && kind !== 'air' && kind !== 'bomb') this.flash.explode(kind === 'bullet' || kind === 'flak' ? 1 : 2, fx, fy);
    if (kind === 'shell' || kind === 'cannon') this.smoke.explode(1, fx, fy);
    if (kind === 'rocket') this.trail.explode(4, x, y);
    const snd = FIRE_SOUND[kind];
    if (snd) this.audio.playAt(snd, x, y, kind === 'bullet' ? 0.5 : 0.8);
  }

  private onSpawn(p: Projectile): void {
    if (p.kind !== 'missile') return;
    if (this.visible(p.sx, p.sy, 300)) {
      this.trail.explode(10, p.sx, p.sy);
      this.fire.explode(6, p.sx, p.sy);
      this.audio.playAt('missile', p.sx, p.sy, 1);
    }
  }

  private onImpact(p: Projectile, x: number, y: number, hit: boolean): void {
    if (p.kind === 'air') this.returnFlight(p);
    if (!this.visible(x, y)) return;
    const water = this.isWater(x, y);
    switch (p.kind) {
      case 'bullet':
      case 'flak':
        if (hit) this.sparks.explode(2, x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 8);
        else if (water) this.water.explode(2, x, y);
        break;
      case 'cannon':
        this.explosion(x, y, hit ? 'small' : 'small');
        if (!hit && water) this.water.explode(5, x, y);
        break;
      case 'shell':
      case 'rocket':
        this.explosion(x, y, 'medium');
        this.audio.playAt('explosion', x, y, 0.55);
        break;
      case 'torpedo':
        this.water.explode(18, x, y);
        this.explosion(x, y, 'medium');
        this.ring(x, y, 0xcdefff, 70, 700, 0.6);
        this.audio.playAt('explosion', x, y, 0.8);
        break;
      case 'bomb':
        this.explosion(x, y, p.splash >= 50 ? 'large' : 'medium');
        if (p.splash >= 50) {
          for (let i = 1; i < 4; i++) {
            const ox = (Math.random() - 0.5) * 50;
            const oy = (Math.random() - 0.5) * 50;
            this.scene.time.delayedCall(i * 90, () => this.explosion(x + ox, y + oy, 'medium'));
          }
          this.cameraShake(0.003, 200);
        }
        if (!water) this.addWreck(x, y, p.splash >= 50 ? 1.3 : 0.8);
        this.audio.playAt('explosion', x, y, 0.8);
        break;
      case 'air':
        for (let i = 0; i < 3; i++) {
          const ox = (Math.random() - 0.5) * 36;
          const oy = (Math.random() - 0.5) * 36;
          this.scene.time.delayedCall(i * 110, () => this.explosion(x + ox, y + oy, 'medium'));
        }
        this.audio.playAt('explosion', x, y, 0.9);
        break;
      case 'missile':
        this.explosion(x, y, 'huge');
        this.audio.playAt('bigExplosion', x, y, 1);
        this.cameraShake(0.006, 350);
        if (!water) this.addWreck(x, y, 1.6);
        break;
    }
  }

  private onIntercept(x: number, y: number, bx: number, by: number): void {
    if (!this.visible(x, y, 200)) return;
    this.lineFx.push({ x1: bx, y1: by, x2: x, y2: y, life: 0.35, color: 0x9fe8ff });
    this.explosion(x, y, 'medium');
    this.ring(x, y, 0x9fe8ff, 60, 400, 0.8);
    this.audio.playAt('intercept', x, y, 1);
  }

  private onDeath(u: Unit): void {
    if (!this.visible(u.x, u.y)) return;
    const def = unitDef(u.type);
    const big = def.size >= 40 || def.cls === 'armor';
    this.explosion(u.x, u.y, def.size >= 45 ? 'large' : big ? 'medium' : 'small');
    if (def.domain === 'naval' || u.embarked) {
      this.water.explode(20, u.x, u.y);
      this.ring(u.x, u.y, 0xcdefff, def.size * 2, 900, 0.5);
      // lingering smoke column
      for (let i = 1; i <= 4; i++) this.scene.time.delayedCall(i * 350, () => this.smoke.explode(2, u.x, u.y));
    } else {
      if (def.cls !== 'infantry') {
        this.addWreck(u.x, u.y, def.size / 34);
        for (let i = 1; i <= 3; i++) this.scene.time.delayedCall(i * 400, () => this.smoke.explode(2, u.x, u.y));
      }
    }
    this.audio.playAt(def.size >= 45 ? 'bigExplosion' : big ? 'explosion' : 'rifle', u.x, u.y, big ? 1 : 0.6);
    if (def.size >= 45) this.cameraShake(0.004, 250);
  }

  private onDamage(u: Unit, amount: number): void {
    if (!this.damageNumbers || this.zoom < 0.7 || amount < 4) return;
    if (!this.visible(u.x, u.y, 0)) return;
    if (this.floats.length > 36) return;
    const t = this.floatPool.pop() ?? this.scene.add.text(0, 0, '', {
      fontFamily: 'Oxanium, sans-serif', fontSize: '13px', fontStyle: '700', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(40).setResolution(2);
    const own = u.owner === this.sim.state.player;
    t.setText(`-${Math.round(amount)}`).setColor(own ? '#ff8a80' : '#ffe9a8').setVisible(true).setAlpha(1);
    t.setPosition(u.x + (Math.random() - 0.5) * 14, u.y - unitDef(u.type).size * 0.5 * this.lod);
    t.setScale(this.lod * 0.9);
    this.floats.push({ t, life: 0.9 });
  }

  private onCapture(x: number, y: number, to: string, from: string): void {
    const color = this.sim.state.factions[to]?.color ?? 0xffffff;
    const player = this.sim.state.player;
    if (to === player || from === player) this.audio.play(to === player ? 'capture' : 'lost');
    if (!this.visible(x, y, 200)) return;
    this.ring(x, y, color, 160, 900, 1);
    this.ring(x, y, 0xffffff, 100, 600, 0.8);
    this.sparks.explode(18, x, y);
    this.fire.explode(6, x, y);
    const t = this.scene.add.text(x, y - 30 * this.lod, tr('CAPTURED'), {
      fontFamily: 'Oxanium, sans-serif', fontSize: '16px', fontStyle: '800', color: '#ffffff', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(41).setTint(color).setScale(this.lod).setResolution(2);
    this.scene.tweens.add({ targets: t, y: t.y - 40 * this.lod, alpha: 0, delay: 600, duration: 1200, onComplete: () => t.destroy() });
  }

  private addWreck(x: number, y: number, scale: number): void {
    let w = this.wrecks.length >= 50 ? this.wrecks.shift()! : null;
    if (!w) w = { img: this.scene.add.image(0, 0, 'fx_scorch').setDepth(5), life: 0 };
    w.img.setPosition(x, y).setScale(scale * (0.8 + Math.random() * 0.4)).setAlpha(0.85).setRotation(Math.random() * 6).setVisible(true);
    w.life = 40;
    this.wrecks.push(w);
  }

  private returnFlight(p: Projectile): void {
    if (!this.visible(p.tx, p.ty, 400) && !this.visible(p.sx, p.sy, 400)) return;
    const color = this.sim.state.factions[p.owner]?.color ?? 0xffffff;
    const img = this.scene.add.image(p.tx, p.ty, 'a_jet').setTint(color).setDepth(36).setScale(0.45 * this.lod);
    img.rotation = Math.atan2(p.sy - p.ty, p.sx - p.tx);
    this.scene.tweens.add({ targets: img, x: p.sx, y: p.sy, duration: 1300, ease: 'Sine.easeIn', onComplete: () => img.destroy() });
  }

  // ------------------------------------------------------------------ per-frame

  update(dt: number, view: Phaser.Geom.Rectangle, time: number): void {
    this.view.setTo(view.x, view.y, view.width, view.height);
    this.stamp++;
    // Projectiles
    for (const p of this.sim.combat.projectiles) {
      if (p.done) continue;
      const pos = projectilePos(p);
      let s = this.proj.get(p.id);
      const vis = this.visible(pos.x, pos.y, 40) || (p.kind === 'missile' && this.visible(pos.x, pos.y, 400));
      if (!s) {
        if (!vis) continue;
        s = { img: this.makeProjSprite(p), stamp: this.stamp, trail: 0 };
        this.proj.set(p.id, s);
      }
      s.stamp = this.stamp;
      s.img.setVisible(vis);
      if (!vis) continue;
      const ahead = projectilePos(p, p.t + 0.03);
      s.img.setPosition(pos.x, pos.y);
      if (p.kind !== 'shell' && p.kind !== 'flak') s.img.rotation = Math.atan2(ahead.y - pos.y, ahead.x - pos.x);
      if (p.kind === 'shell') s.img.setScale((0.9 + Math.sin(Math.PI * p.t) * 0.9) * this.lod);
      if (p.kind === 'missile' || p.kind === 'rocket') {
        this.trail.emitParticleAt(pos.x, pos.y, 1);
        if (p.kind === 'missile' && Math.random() < 0.6) this.flash.emitParticleAt(pos.x, pos.y, 1);
      } else if (p.kind === 'torpedo') {
        s.trail -= dt;
        if (s.trail <= 0) {
          s.trail = 0.05;
          this.bubbles.emitParticleAt(pos.x, pos.y, 1);
        }
      }
    }
    for (const [id, s] of this.proj) {
      if (s.stamp !== this.stamp) {
        s.img.destroy();
        this.proj.delete(id);
      }
    }
    // Ship wakes
    this.wakeT -= dt;
    if (this.wakeT <= 0) {
      this.wakeT = 0.09;
      for (const v of this.views.all()) {
        const u = v.unit;
        if (!v.c.visible || !u.moving) continue;
        const def = unitDef(u.type);
        if (def.domain === 'air') {
          // Contrails behind jets (helicopters leave none).
          if (def.cls !== 'air' || u.landed) continue;
          const back = def.size * 0.5 * this.lod;
          this.contrail.emitParticleAt(u.x - Math.cos(u.angle) * back, u.y - Math.sin(u.angle) * back, 1);
          continue;
        }
        if (def.domain !== 'naval' && !u.embarked) continue;
        const back = def.size * 0.45 * this.lod;
        const sx = u.x - Math.cos(u.angle) * back;
        const sy = u.y - Math.sin(u.angle) * back;
        if (def.stealth && u.revealed <= 0) this.bubbles.emitParticleAt(sx, sy, 1);
        else this.wake.emitParticleAt(sx, sy, 1);
      }
    }
    // Burning cities
    this.cityFxT -= dt;
    if (this.cityFxT <= 0) {
      this.cityFxT = 0.35;
      for (const c of this.sim.state.cities) {
        if (c.hp > c.maxHp * 0.5 || !this.visible(c.x, c.y, 0)) continue;
        const ox = (Math.random() - 0.5) * 20;
        this.smoke.emitParticleAt(c.x + ox, c.y - 4, 1);
        if (c.hp < c.maxHp * 0.25) this.fire.emitParticleAt(c.x + ox, c.y, 1);
      }
    }
    // Ocean glints
    this.sparkleT -= dt;
    if (this.sparkleT <= 0 && this.zoom > 0.45) {
      this.sparkleT = 0.12;
      const x = view.x + Math.random() * view.width;
      const y = view.y + Math.random() * view.height;
      if (this.isWater(x, y) && this.sim.geo.coastDist[worldToCell(x, y)] > 2) this.sparkle.emitParticleAt(x, y, 1);
    }
    // Floating texts
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dt;
      f.t.y -= dt * 26 * this.lod;
      f.t.setAlpha(Math.min(1, f.life * 2.5));
      if (f.life <= 0) {
        f.t.setVisible(false);
        this.floatPool.push(f.t);
        this.floats.splice(i, 1);
      }
    }
    // Wrecks fade
    for (const w of this.wrecks) {
      if (w.life <= 0) continue;
      w.life -= dt;
      w.img.setAlpha(Math.max(0, Math.min(0.85, w.life / 12)));
      if (w.life <= 0) w.img.setVisible(false);
    }
    // Beam lines
    this.lines.clear();
    for (let i = this.lineFx.length - 1; i >= 0; i--) {
      const l = this.lineFx[i];
      l.life -= dt;
      if (l.life <= 0) {
        this.lineFx.splice(i, 1);
        continue;
      }
      this.lines.lineStyle(2.5, l.color, l.life / 0.35);
      this.lines.lineBetween(l.x1, l.y1, l.x2, l.y2);
    }
    void time;
  }

  private makeProjSprite(p: Projectile): Phaser.GameObjects.Image {
    const sc = this.scene;
    const color = this.sim.state.factions[p.owner]?.color ?? 0xffffff;
    let img: Phaser.GameObjects.Image;
    switch (p.kind) {
      case 'bullet': img = sc.add.image(0, 0, 'fx_tracer').setScale(0.45 * this.lod, 0.5 * this.lod).setTint(0xffeaa0); break;
      case 'cannon': img = sc.add.image(0, 0, 'fx_tracer').setScale(0.7 * this.lod, 0.9 * this.lod).setTint(0xffc060); break;
      case 'flak': img = sc.add.image(0, 0, 'fx_dot').setScale(0.35 * this.lod).setTint(0xfff2b0); break;
      case 'shell': img = sc.add.image(0, 0, 'fx_dot').setScale(this.lod).setTint(0xffb060).setBlendMode(Phaser.BlendModes.ADD); break;
      case 'rocket': img = sc.add.image(0, 0, 'fx_missile').setScale(0.6 * this.lod); break;
      case 'torpedo': img = sc.add.image(0, 0, 'fx_torpedo').setScale(this.lod).setAlpha(0.85); break;
      case 'missile': img = sc.add.image(0, 0, 'fx_missile').setScale(1.1 * this.lod); break;
      case 'air': img = sc.add.image(0, 0, 'a_jet').setScale(0.45 * this.lod).setTint(color); break;
      case 'bomb': img = sc.add.image(0, 0, 'fx_torpedo').setScale(0.6 * this.lod).setTint(0x2a2a2a); break;
      default: img = sc.add.image(0, 0, 'fx_dot');
    }
    img.setDepth(p.kind === 'missile' || p.kind === 'air' ? 36 : p.kind === 'torpedo' ? 19 : p.kind === 'bomb' ? 27 : 30);
    return img;
  }
}
