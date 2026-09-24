// Strategic camera (smooth zoom-to-cursor, drag pan, keys, edge scroll, bounds) and
// map interaction (selection, box select, context commands, targeting modes, hotkeys).
import Phaser from 'phaser';
import { WORLD_W, WORLD_H } from '../config';
import { Settings } from '../core/Settings';
import type { GameScene } from '../scenes/GameScene';
import { unitDef } from '../data/units';

export type InputMode = 'normal' | 'attackMove' | 'missile' | 'cityMissile';

export class InputController {
  targetZoom = 0.9;
  minZoom = 0.3;
  maxZoom = 2.4;
  private anchor: { wx: number; wy: number; sx: number; sy: number } | null = null;
  private drag: { button: number; sx: number; sy: number; scrollX: number; scrollY: number; moved: boolean; box: boolean; shift: boolean } | null = null;
  private box: Phaser.GameObjects.Graphics;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private mouse = { x: -1, y: -1, inside: false };
  private lastClick = { t: 0, id: -1 };
  private panTween: { x: number; y: number; t: number } | null = null;
  private groups = new Map<number, number[]>();
  private onWinMove = (e: MouseEvent) => {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.inside = true;
  };
  private onWinLeave = () => (this.mouse.inside = false);

  constructor(private scene: GameScene) {
    const input = scene.input;
    input.mouse?.disableContextMenu();
    this.box = scene.add.graphics().setDepth(50);
    input.on('pointerdown', this.onDown, this);
    input.on('pointermove', this.onMove, this);
    input.on('pointerup', this.onUp, this);
    input.on('wheel', this.onWheel, this);
    window.addEventListener('mousemove', this.onWinMove);
    document.addEventListener('mouseleave', this.onWinLeave);
    const kb = input.keyboard!;
    kb.addCapture('SPACE,TAB,UP,DOWN,LEFT,RIGHT');
    for (const k of ['UP', 'DOWN', 'LEFT', 'RIGHT', 'SHIFT', 'CTRL']) this.keys[k] = kb.addKey(k, false);
    kb.on('keydown', this.onKey, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    this.updateLimits();
  }

  destroy(): void {
    window.removeEventListener('mousemove', this.onWinMove);
    document.removeEventListener('mouseleave', this.onWinLeave);
  }

  get cam(): Phaser.Cameras.Scene2D.Camera {
    return this.scene.cameras.main;
  }

  updateLimits(): void {
    const cam = this.cam;
    this.minZoom = Math.max(0.2, Math.min(cam.width / WORLD_W, cam.height / WORLD_H) * 1.02, cam.width / WORLD_W * 0.98);
    this.targetZoom = Phaser.Math.Clamp(this.targetZoom, this.minZoom, this.maxZoom);
  }

  /** World coordinates of a screen point for the current camera state. */
  toWorld(sx: number, sy: number): { x: number; y: number } {
    const cam = this.cam;
    return {
      x: (sx - cam.width / 2) / cam.zoom + cam.width / 2 + cam.scrollX,
      y: (sy - cam.height / 2) / cam.zoom + cam.height / 2 + cam.scrollY,
    };
  }

  centerOn(x: number, y: number, smooth = true): void {
    if (!smooth) {
      this.cam.centerOn(x, y);
      this.panTween = null;
      return;
    }
    this.panTween = { x, y, t: 0 };
  }

  zoomTo(z: number): void {
    this.targetZoom = Phaser.Math.Clamp(z, this.minZoom, this.maxZoom);
    this.anchor = null;
  }

  update(dt: number): void {
    const cam = this.cam;
    // Smooth zoom anchored at the cursor.
    if (Math.abs(cam.zoom - this.targetZoom) > 0.0005) {
      const z = Phaser.Math.Linear(cam.zoom, this.targetZoom, 1 - Math.exp(-dt * 12));
      const center = !this.anchor ? { wx: cam.scrollX + cam.width / 2, wy: cam.scrollY + cam.height / 2, sx: cam.width / 2, sy: cam.height / 2 } : this.anchor;
      cam.setZoom(z);
      cam.scrollX = center.wx - (center.sx - cam.width / 2) / z - cam.width / 2;
      cam.scrollY = center.wy - (center.sy - cam.height / 2) / z - cam.height / 2;
    } else if (cam.zoom !== this.targetZoom) {
      cam.setZoom(this.targetZoom);
      this.anchor = null;
    }
    // Keyboard / edge panning.
    const speed = (900 / cam.zoom) * dt;
    let vx = 0;
    let vy = 0;
    const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (!typing && !this.keys.CTRL.isDown) {
      if (this.keys.LEFT.isDown) vx -= 1;
      if (this.keys.RIGHT.isDown) vx += 1;
      if (this.keys.UP.isDown) vy -= 1;
      if (this.keys.DOWN.isDown) vy += 1;
    }
    if (Settings.data.edgeScroll && this.mouse.inside && document.hasFocus() && !this.drag && !this.scene.ui.modalOpen) {
      const m = 6;
      if (this.mouse.x <= m) vx -= 1;
      if (this.mouse.x >= window.innerWidth - m) vx += 1;
      if (this.mouse.y <= m) vy -= 1;
      if (this.mouse.y >= window.innerHeight - m) vy += 1;
    }
    if (vx || vy) {
      cam.scrollX += vx * speed;
      cam.scrollY += vy * speed;
      this.panTween = null;
    }
    if (this.panTween) {
      const p = this.panTween;
      p.t += dt;
      const cx = cam.scrollX + cam.width / 2;
      const cy = cam.scrollY + cam.height / 2;
      const k = 1 - Math.exp(-dt * 7);
      cam.centerOn(cx + (p.x - cx) * k, cy + (p.y - cy) * k);
      if (Math.hypot(p.x - cx, p.y - cy) < 2 || p.t > 2) this.panTween = null;
    }
    this.clampScroll();
    // Hover (only while the cursor is actually over the map canvas, not the HUD).
    const ptr = this.scene.input.activePointer;
    const overCanvas = this.mouse.inside && document.elementFromPoint(this.mouse.x, this.mouse.y) === this.scene.game.canvas;
    if (!this.drag && ptr.x >= 0 && overCanvas) {
      const w = this.toWorld(ptr.x, ptr.y);
      this.scene.hoverAt(w.x, w.y, ptr.x, ptr.y);
    } else if (!overCanvas) this.scene.clearHover();
  }

  private clampScroll(): void {
    const cam = this.cam;
    const vw = cam.width / cam.zoom;
    const vh = cam.height / cam.zoom;
    const minX = WORLD_W > vw ? 0 : (WORLD_W - vw) / 2;
    const maxX = WORLD_W > vw ? WORLD_W - vw : minX;
    const minY = WORLD_H > vh ? 0 : (WORLD_H - vh) / 2;
    const maxY = WORLD_H > vh ? WORLD_H - vh : minY;
    // Convert view-space bounds to Phaser scroll (scroll = viewLeft - (width - vw)/2).
    const offX = (cam.width - vw) / 2;
    const offY = (cam.height - vh) / 2;
    cam.scrollX = Phaser.Math.Clamp(cam.scrollX, minX - offX, maxX - offX);
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY, minY - offY, maxY - offY);
  }

  // ------------------------------------------------------------------ pointer

  private onWheel(pointer: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number): void {
    if (this.scene.ui.modalOpen) return;
    const factor = dy > 0 ? 1 / 1.18 : 1.18;
    this.targetZoom = Phaser.Math.Clamp(this.targetZoom * factor, this.minZoom, this.maxZoom);
    const w = this.toWorld(pointer.x, pointer.y);
    this.anchor = { wx: w.x, wy: w.y, sx: pointer.x, sy: pointer.y };
    this.panTween = null;
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    this.scene.audioUnlock();
    const shift = pointer.event.shiftKey;
    const button = pointer.button;
    const boxMode = button === 0 && (shift || !Settings.data.leftDragPan) && this.scene.mode === 'normal';
    this.drag = { button, sx: pointer.x, sy: pointer.y, scrollX: this.cam.scrollX, scrollY: this.cam.scrollY, moved: false, box: boxMode, shift };
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    const d = this.drag;
    if (!d || !pointer.isDown) return;
    const dx = pointer.x - d.sx;
    const dy = pointer.y - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 6) d.moved = true;
    if (!d.moved) return;
    if (d.box) {
      const a = this.toWorld(d.sx, d.sy);
      const b = this.toWorld(pointer.x, pointer.y);
      this.box.clear();
      this.box.fillStyle(0x6bff8f, 0.08);
      this.box.lineStyle(1.5 / this.cam.zoom, 0x6bff8f, 0.9);
      this.box.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      this.box.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else {
      this.cam.scrollX = d.scrollX - dx / this.cam.zoom;
      this.cam.scrollY = d.scrollY - dy / this.cam.zoom;
      this.panTween = null;
      this.clampScroll();
    }
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    const d = this.drag;
    this.drag = null;
    this.box.clear();
    if (!d) return;
    const w = this.toWorld(pointer.x, pointer.y);
    if (d.moved) {
      if (d.box) {
        const a = this.toWorld(d.sx, d.sy);
        this.scene.boxSelect(Math.min(a.x, w.x), Math.min(a.y, w.y), Math.max(a.x, w.x), Math.max(a.y, w.y), d.shift);
      }
      return;
    }
    if (d.button === 2) {
      if (this.scene.mode !== 'normal') this.scene.setMode('normal');
      else this.scene.commandAt(w.x, w.y, false);
      return;
    }
    if (d.button === 1) return;
    // Left click
    const mode = this.scene.mode;
    if (mode === 'attackMove') {
      this.scene.commandAt(w.x, w.y, true);
      if (!pointer.event.shiftKey) this.scene.setMode('normal');
      return;
    }
    if (mode === 'missile' || mode === 'cityMissile') {
      this.scene.missileAt(w.x, w.y);
      return;
    }
    // Touch has no right button: with units selected, a tap on anything that is not one
    // of our own units issues a command instead of changing the selection.
    if (pointer.wasTouch && this.scene.selection.size) {
      const own = this.scene.unitViews.pick(w.x, w.y, (u) => u.owner === this.scene.sim.state.player);
      if (!own) {
        this.scene.commandAt(w.x, w.y, false);
        return;
      }
    }
    const now = performance.now();
    const picked = this.scene.clickSelect(w.x, w.y, d.shift);
    if (picked >= 0 && picked === this.lastClick.id && now - this.lastClick.t < 350) this.scene.selectSameType(picked);
    this.lastClick = { t: now, id: picked };
  }

  // ------------------------------------------------------------------ keyboard

  private onKey(e: KeyboardEvent): void {
    const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (typing) return;
    this.scene.audioUnlock();
    const sc = this.scene;
    const k = e.key.toLowerCase();
    // Control groups
    if (/^[1-9]$/.test(k)) {
      const n = Number(k);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.groups.set(n, [...sc.selection]);
        sc.ui.toast(`Group ${n} assigned (${sc.selection.size} units)`, 'info');
      } else {
        const ids = (this.groups.get(n) ?? []).filter((id) => sc.sim.state.units.has(id));
        if (ids.length) {
          const already = ids.length === sc.selection.size && ids.every((id) => sc.selection.has(id));
          sc.select(ids, false);
          if (already) sc.centerOnSelection();
        }
      }
      return;
    }
    switch (k) {
      case ' ':
        e.preventDefault();
        sc.togglePause();
        break;
      case 'escape':
        if (sc.mode !== 'normal') sc.setMode('normal');
        else if (sc.ui.modalOpen) sc.ui.closeWindow();
        else if (sc.selection.size || sc.selectedCity >= 0) sc.clearSelection();
        else sc.ui.openPause();
        break;
      case 'a':
        if (sc.selection.size) sc.setMode('attackMove');
        break;
      case 's':
        sc.orderStop();
        break;
      case 'h':
        sc.orderHold();
        break;
      case 'm':
        sc.beginMissile();
        break;
      case 'c':
      case 'f':
        sc.centerOnSelection();
        break;
      case 'delete':
        sc.disbandSelected();
        break;
      case '+':
      case '=':
        sc.setSpeed(Math.min(4, sc.sim.state.speed * 2));
        break;
      case '-':
        sc.setSpeed(Math.max(1, sc.sim.state.speed / 2));
        break;
      case 'r':
        sc.ui.openResearch();
        break;
      case 'tab':
        e.preventDefault();
        sc.cycleIdle();
        break;
      case 'home':
      case 'backspace':
        sc.centerOnCapital();
        break;
      case 'f1':
        e.preventDefault();
        sc.ui.openHelp();
        break;
      case 'f3':
      case '`':
        e.preventDefault();
        sc.ui.toggleDebug();
        break;
      case 'f5':
        e.preventDefault();
        sc.quickSave();
        break;
      case 'f9':
        e.preventDefault();
        sc.quickLoad();
        break;
      case 'q':
        this.zoomTo(this.targetZoom / 1.3);
        break;
      case 'e':
        this.zoomTo(this.targetZoom * 1.3);
        break;
    }
  }

  /** True if the pointer is over a unit type that can use missiles (for cursor hints). */
  hasMissileUnits(): boolean {
    for (const id of this.scene.selection) {
      const u = this.scene.sim.state.units.get(id);
      if (u && unitDef(u.type).missiles) return true;
    }
    return false;
  }
}
