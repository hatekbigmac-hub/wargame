// Procedurally generated textures: units (grayscale, tinted per faction at runtime),
// cities, effects and ocean waves. No external art pipeline required.
import Phaser from 'phaser';

type Ctx = CanvasRenderingContext2D;

const OUT = '#15181c';
const L1 = '#f0f0f0';
const L2 = '#d2d2d2';
const L3 = '#a8a8a8';
const D1 = '#6a6a6a';
const D2 = '#3c3c3c';

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return [c, c.getContext('2d')!];
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fillStroke(ctx: Ctx, fill: string | CanvasGradient, lw = 2, stroke = OUT): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function vgrad(ctx: Ctx, y0: number, y1: number, a: string, b: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}

// ------------------------------------------------------------------ land units

function tankHull(ctx: Ctx, cx: number, cy: number, L: number, W: number): void {
  // tracks
  for (const side of [-1, 1]) {
    const ty = side < 0 ? cy - W / 2 : cy + W / 2 - W * 0.27;
    rr(ctx, cx - L / 2, ty, L, W * 0.27, 4);
    fillStroke(ctx, D2, 2);
    ctx.strokeStyle = '#5c5c5c';
    ctx.lineWidth = 1.5;
    for (let x = cx - L / 2 + 4; x < cx + L / 2 - 2; x += 5) {
      ctx.beginPath();
      ctx.moveTo(x, ty + 2);
      ctx.lineTo(x, ty + W * 0.27 - 2);
      ctx.stroke();
    }
  }
  rr(ctx, cx - L / 2 + 3, cy - W * 0.34, L - 5, W * 0.68, 5);
  fillStroke(ctx, vgrad(ctx, cy - W * 0.34, cy + W * 0.34, L1, L3), 2);
  // front glacis highlight & engine deck
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(cx + L * 0.3, cy - W * 0.28, L * 0.12, W * 0.56);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 4; i++) {
    const x = cx - L * 0.42 + i * 4;
    ctx.beginPath();
    ctx.moveTo(x, cy - W * 0.22);
    ctx.lineTo(x, cy + W * 0.22);
    ctx.stroke();
  }
}

function tankTurret(ctx: Ctx, cx: number, cy: number, r: number, barrel: number, bw: number): void {
  rr(ctx, cx, cy - bw / 2, barrel, bw, 1.5);
  fillStroke(ctx, L2, 1.6);
  rr(ctx, cx + barrel - 5, cy - bw / 2 - 1.5, 6, bw + 3, 1.5);
  fillStroke(ctx, L3, 1.4);
  ctx.beginPath();
  ctx.moveTo(cx - r * 1.1, cy - r * 0.8);
  ctx.lineTo(cx + r * 0.7, cy - r * 0.95);
  ctx.lineTo(cx + r * 1.15, cy - r * 0.3);
  ctx.lineTo(cx + r * 1.15, cy + r * 0.3);
  ctx.lineTo(cx + r * 0.7, cy + r * 0.95);
  ctx.lineTo(cx - r * 1.1, cy + r * 0.8);
  ctx.closePath();
  fillStroke(ctx, vgrad(ctx, cy - r, cy + r, L1, L3), 2);
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, cy - r * 0.3, r * 0.28, 0, Math.PI * 2);
  fillStroke(ctx, L3, 1.2);
}

function soldier(ctx: Ctx, x: number, y: number, s: number, dark = false): void {
  // rifle
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2.2 * s;
  ctx.beginPath();
  ctx.moveTo(x + 2 * s, y + 4 * s);
  ctx.lineTo(x + 15 * s, y + 3 * s);
  ctx.stroke();
  // pack
  rr(ctx, x - 9 * s, y - 4 * s, 6 * s, 8 * s, 2);
  fillStroke(ctx, D1, 1.4);
  // shoulders
  ctx.beginPath();
  ctx.ellipse(x, y, 5.5 * s, 8.5 * s, 0, 0, Math.PI * 2);
  fillStroke(ctx, L3, 1.6);
  // helmet
  ctx.beginPath();
  ctx.arc(x + 1 * s, y, 5 * s, 0, Math.PI * 2);
  fillStroke(ctx, dark ? D1 : L1, 1.6);
}

function wheels(ctx: Ctx, cx: number, cy: number, L: number, W: number, n: number): void {
  ctx.fillStyle = '#2a2a2a';
  for (let i = 0; i < n; i++) {
    const x = cx - L * 0.38 + (i * (L * 0.76)) / Math.max(1, n - 1);
    rr(ctx, x - 4, cy - W / 2 - 1, 8, 5, 2);
    ctx.fill();
    rr(ctx, x - 4, cy + W / 2 - 4, 8, 5, 2);
    ctx.fill();
  }
}

// ------------------------------------------------------------------ ships

function hullPath(ctx: Ctx, x0: number, cy: number, L: number, W: number, bow = 0.22, stern = 0.08): void {
  ctx.beginPath();
  ctx.moveTo(x0, cy - W / 2 + W * stern);
  ctx.lineTo(x0 + L * (1 - bow), cy - W / 2);
  ctx.quadraticCurveTo(x0 + L * 0.96, cy - W * 0.35, x0 + L, cy);
  ctx.quadraticCurveTo(x0 + L * 0.96, cy + W * 0.35, x0 + L * (1 - bow), cy + W / 2);
  ctx.lineTo(x0, cy + W / 2 - W * stern);
  ctx.closePath();
}

function ship(ctx: Ctx, w: number, h: number, L: number, W: number, deco: (x0: number, cy: number) => void): void {
  const x0 = (w - L) / 2;
  const cy = h / 2;
  hullPath(ctx, x0, cy, L, W);
  fillStroke(ctx, vgrad(ctx, cy - W / 2, cy + W / 2, L2, L3), 2);
  hullPath(ctx, x0 + 3, cy, L - 7, W - 6);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fill();
  deco(x0, cy);
}

function gun(ctx: Ctx, x: number, y: number, r: number, len: number, dir = 1): void {
  ctx.fillStyle = D2;
  ctx.fillRect(dir > 0 ? x : x - len, y - 1.5, len, 3);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  fillStroke(ctx, L1, 1.4);
}

// ------------------------------------------------------------------ registry

export const UNIT_TEXTURE_SCALE = 0.5; // textures are drawn at 2x for crisp zoom

type Draw = (ctx: Ctx, w: number, h: number) => void;

const UNIT_DRAW: Record<string, [number, number, Draw]> = {
  u_infantry: [64, 64, (ctx, w, h) => {
    soldier(ctx, w / 2 + 9, h / 2, 1);
    soldier(ctx, w / 2 - 7, h / 2 - 12, 1);
    soldier(ctx, w / 2 - 7, h / 2 + 12, 1);
  }],
  u_elite: [64, 64, (ctx, w, h) => {
    soldier(ctx, w / 2 + 10, h / 2, 1, true);
    soldier(ctx, w / 2 - 6, h / 2 - 13, 1, true);
    soldier(ctx, w / 2 - 6, h / 2 + 13, 1, true);
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc(w / 2 - 16, h / 2, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }],
  u_engineer: [64, 64, (ctx, w, h) => {
    rr(ctx, w / 2 + 2, h / 2 - 7, 16, 14, 2);
    fillStroke(ctx, D1, 1.6);
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2 + 4, h / 2 - 5);
    ctx.lineTo(w / 2 + 16, h / 2 + 5);
    ctx.stroke();
    soldier(ctx, w / 2 - 8, h / 2 - 11, 0.95);
    soldier(ctx, w / 2 - 8, h / 2 + 11, 0.95);
  }],
  u_recon: [60, 60, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    wheels(ctx, cx, cy, 36, 22, 2);
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy - 10);
    ctx.lineTo(cx + 10, cy - 10);
    ctx.lineTo(cx + 19, cy - 4);
    ctx.lineTo(cx + 19, cy + 4);
    ctx.lineTo(cx + 10, cy + 10);
    ctx.lineTo(cx - 18, cy + 10);
    ctx.closePath();
    fillStroke(ctx, vgrad(ctx, cy - 10, cy + 10, L1, L3), 2);
    rr(ctx, cx - 6, cy - 6, 12, 12, 3);
    fillStroke(ctx, L3, 1.4);
    ctx.fillStyle = D2;
    ctx.fillRect(cx, cy - 1.2, 14, 2.4);
  }],
  u_apc: [64, 64, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    wheels(ctx, cx, cy, 46, 28, 4);
    ctx.beginPath();
    ctx.moveTo(cx - 23, cy - 13);
    ctx.lineTo(cx + 14, cy - 13);
    ctx.lineTo(cx + 24, cy - 5);
    ctx.lineTo(cx + 24, cy + 5);
    ctx.lineTo(cx + 14, cy + 13);
    ctx.lineTo(cx - 23, cy + 13);
    ctx.closePath();
    fillStroke(ctx, vgrad(ctx, cy - 13, cy + 13, L1, L3), 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.strokeRect(cx - 20, cy - 8, 10, 16);
  }],
  u_tank_l: [64, 64, (ctx, w, h) => tankHull(ctx, w / 2, h / 2, 46, 30)],
  u_tank_m: [72, 72, (ctx, w, h) => tankHull(ctx, w / 2, h / 2, 56, 36)],
  u_tank_h: [80, 80, (ctx, w, h) => tankHull(ctx, w / 2, h / 2, 66, 42)],
  u_artillery: [64, 64, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    ctx.strokeStyle = D2;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy);
    ctx.lineTo(cx - 24, cy - 12);
    ctx.moveTo(cx - 4, cy);
    ctx.lineTo(cx - 24, cy + 12);
    ctx.stroke();
    for (const s of [-1, 1]) {
      rr(ctx, cx - 7, cy + s * 12 - 4, 12, 8, 3);
      fillStroke(ctx, '#2a2a2a', 1.4);
    }
    rr(ctx, cx - 8, cy - 8, 16, 16, 3);
    fillStroke(ctx, L3, 1.6);
  }],
  u_launcher: [72, 72, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    wheels(ctx, cx, cy, 50, 26, 3);
    rr(ctx, cx - 26, cy - 12, 40, 24, 3);
    fillStroke(ctx, vgrad(ctx, cy - 12, cy + 12, L2, L3), 2);
    rr(ctx, cx + 14, cy - 11, 12, 22, 4);
    fillStroke(ctx, L1, 2);
    ctx.fillStyle = '#2a3440';
    ctx.fillRect(cx + 21, cy - 8, 3, 16);
  }],
  u_aa: [64, 64, (ctx, w, h) => tankHull(ctx, w / 2, h / 2, 48, 32)],

  t_small: [40, 40, (ctx, w, h) => tankTurret(ctx, w / 2, h / 2, 6, 15, 3)],
  t_tank_l: [56, 56, (ctx, w, h) => tankTurret(ctx, w / 2, h / 2, 8, 22, 4)],
  t_tank_m: [72, 72, (ctx, w, h) => tankTurret(ctx, w / 2, h / 2, 10, 30, 5)],
  t_tank_h: [84, 84, (ctx, w, h) => tankTurret(ctx, w / 2, h / 2, 12, 36, 6)],
  t_artillery: [84, 84, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    rr(ctx, cx - 4, cy - 2.5, 38, 5, 1.5);
    fillStroke(ctx, L2, 1.6);
    rr(ctx, cx + 30, cy - 4, 6, 8, 1.5);
    fillStroke(ctx, L3, 1.2);
    ctx.beginPath();
    ctx.moveTo(cx - 2, cy - 11);
    ctx.lineTo(cx + 6, cy - 9);
    ctx.lineTo(cx + 6, cy + 9);
    ctx.lineTo(cx - 2, cy + 11);
    ctx.closePath();
    fillStroke(ctx, L1, 1.8);
  }],
  t_launcher: [56, 56, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    rr(ctx, cx - 12, cy - 10, 26, 20, 2);
    fillStroke(ctx, vgrad(ctx, cy - 10, cy + 10, L1, L3), 2);
    ctx.fillStyle = '#26303a';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      ctx.beginPath();
      ctx.arc(cx + 10, cy - 6 + r * 6, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#e04a3a';
    ctx.fillRect(cx - 10, cy - 1.5, 4, 3);
  }],
  t_aa: [56, 56, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    ctx.fillStyle = D2;
    ctx.fillRect(cx, cy - 6, 20, 2.5);
    ctx.fillRect(cx, cy + 3.5, 20, 2.5);
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    fillStroke(ctx, vgrad(ctx, cy - 9, cy + 9, L1, L3), 2);
    ctx.beginPath();
    ctx.ellipse(cx - 5, cy, 3, 6, 0, 0, Math.PI * 2);
    fillStroke(ctx, L1, 1.2);
  }],
  t_naval: [36, 36, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    ctx.fillStyle = D2;
    ctx.fillRect(cx, cy - 1.5, 12, 3);
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    fillStroke(ctx, L1, 1.5);
  }],
  t_naval_h: [48, 48, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    ctx.fillStyle = D2;
    ctx.fillRect(cx, cy - 4, 16, 2.6);
    ctx.fillRect(cx, cy + 1.4, 16, 2.6);
    rr(ctx, cx - 7, cy - 7, 13, 14, 3);
    fillStroke(ctx, L1, 1.6);
  }],

  n_patrol: [72, 26, (ctx, w, h) => ship(ctx, w, h, 60, 16, (x0, cy) => {
    rr(ctx, x0 + 18, cy - 5, 18, 10, 2);
    fillStroke(ctx, L1, 1.4);
    gun(ctx, x0 + 44, cy, 3, 8);
  })],
  n_frigate: [100, 30, (ctx, w, h) => ship(ctx, w, h, 86, 20, (x0, cy) => {
    rr(ctx, x0 + 22, cy - 6, 30, 12, 2);
    fillStroke(ctx, L1, 1.5);
    rr(ctx, x0 + 36, cy - 4, 8, 8, 2);
    fillStroke(ctx, L3, 1.2);
    ctx.fillStyle = '#2a3440';
    ctx.fillRect(x0 + 10, cy - 4, 8, 8);
  })],
  n_destroyer: [112, 32, (ctx, w, h) => ship(ctx, w, h, 98, 22, (x0, cy) => {
    rr(ctx, x0 + 26, cy - 7, 34, 14, 2);
    fillStroke(ctx, L1, 1.5);
    rr(ctx, x0 + 42, cy - 5, 10, 10, 2);
    fillStroke(ctx, L3, 1.2);
    gun(ctx, x0 + 14, cy, 4, 8, -1);
    ctx.fillStyle = '#2a3440';
    for (let i = 0; i < 4; i++) ctx.fillRect(x0 + 64 + i * 4, cy - 4, 3, 3), ctx.fillRect(x0 + 64 + i * 4, cy + 1, 3, 3);
  })],
  n_cruiser: [132, 38, (ctx, w, h) => ship(ctx, w, h, 118, 28, (x0, cy) => {
    rr(ctx, x0 + 36, cy - 9, 40, 18, 3);
    fillStroke(ctx, L1, 1.6);
    rr(ctx, x0 + 50, cy - 6, 14, 12, 2);
    fillStroke(ctx, L3, 1.3);
    gun(ctx, x0 + 20, cy, 6, 14, -1);
    gun(ctx, x0 + 84, cy, 6, 12);
  })],
  n_missile: [116, 34, (ctx, w, h) => ship(ctx, w, h, 102, 24, (x0, cy) => {
    rr(ctx, x0 + 22, cy - 8, 30, 16, 2);
    fillStroke(ctx, L1, 1.5);
    ctx.fillStyle = '#2a3440';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) ctx.fillRect(x0 + 56 + c * 5, cy - 7 + r * 5, 4, 4);
    ctx.fillStyle = '#e04a3a';
    ctx.fillRect(x0 + 56, cy - 9, 30, 1.5);
    ctx.fillRect(x0 + 56, cy + 7.5, 30, 1.5);
  })],
  n_sub: [96, 24, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 42, 8, 0, 0, Math.PI * 2);
    fillStroke(ctx, vgrad(ctx, cy - 8, cy + 8, L3, D1), 2);
    rr(ctx, cx + 4, cy - 4, 14, 8, 3);
    fillStroke(ctx, L2, 1.5);
    ctx.fillStyle = D2;
    ctx.fillRect(cx - 40, cy - 9, 5, 18);
  }],
  n_carrier: [156, 48, (ctx, w, h) => {
    const x0 = (w - 144) / 2, cy = h / 2;
    ctx.beginPath();
    ctx.moveTo(x0, cy - 16);
    ctx.lineTo(x0 + 124, cy - 19);
    ctx.lineTo(x0 + 144, cy - 6);
    ctx.lineTo(x0 + 144, cy + 8);
    ctx.lineTo(x0 + 118, cy + 18);
    ctx.lineTo(x0, cy + 16);
    ctx.closePath();
    fillStroke(ctx, vgrad(ctx, cy - 18, cy + 18, L3, D1), 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0 + 8, cy + 4);
    ctx.lineTo(x0 + 138, cy + 2);
    ctx.moveTo(x0 + 30, cy + 12);
    ctx.lineTo(x0 + 100, cy - 12);
    ctx.stroke();
    ctx.setLineDash([]);
    rr(ctx, x0 + 70, cy - 17, 22, 7, 2);
    fillStroke(ctx, L1, 1.5);
    ctx.fillStyle = '#2a2f36';
    for (const px of [20, 40, 110]) {
      ctx.beginPath();
      ctx.moveTo(x0 + px + 7, cy - 6);
      ctx.lineTo(x0 + px, cy - 11);
      ctx.lineTo(x0 + px + 2, cy - 6);
      ctx.lineTo(x0 + px, cy - 1);
      ctx.closePath();
      ctx.fill();
    }
  }],
  n_transport: [72, 28, (ctx, w, h) => ship(ctx, w, h, 62, 18, (x0, cy) => {
    const cols = [L1, L3, L2, L1];
    cols.forEach((c, i) => {
      rr(ctx, x0 + 10 + i * 9, cy - 6, 8, 12, 1);
      fillStroke(ctx, c, 1);
    });
    rr(ctx, x0 + 4, cy - 4, 5, 8, 1);
    fillStroke(ctx, L1, 1);
  })],
  // Aircraft face +x. Drawn light grey and tinted per faction; rotors are separate sprites.
  a_jet: [64, 64, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    const P = (pts: number[]) => {
      ctx.beginPath();
      ctx.moveTo(cx + pts[0], cy + pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(cx + pts[i], cy + pts[i + 1]);
      ctx.closePath();
    };
    // Swept wings and twin tails of a modern fighter.
    P([6, -3, -8, -22, -14, -22, -8, -3, -8, 3, -14, 22, -8, 22, 6, 3]);
    fillStroke(ctx, vgrad(ctx, cy - 22, cy + 22, L2, L3), 1.4);
    P([-16, -3, -24, -12, -28, -12, -24, -2, -24, 2, -28, 12, -24, 12, -16, 3]);
    fillStroke(ctx, L3, 1.4);
    // Fuselage.
    ctx.beginPath();
    ctx.moveTo(cx + 28, cy);
    ctx.quadraticCurveTo(cx + 14, cy - 5, cx - 26, cy - 3.5);
    ctx.lineTo(cx - 26, cy + 3.5);
    ctx.quadraticCurveTo(cx + 14, cy + 5, cx + 28, cy);
    fillStroke(ctx, vgrad(ctx, cy - 5, cy + 5, L1, L2), 1.4);
    ctx.fillStyle = '#2b3a4a';
    ctx.beginPath();
    ctx.ellipse(cx + 12, cy, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }],
  a_strike: [64, 64, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    // Straight, broad wings with bomb pylons.
    rr(ctx, cx - 8, cy - 25, 12, 50, 3);
    fillStroke(ctx, vgrad(ctx, cy - 25, cy + 25, L2, L3), 1.4);
    ctx.fillStyle = D2;
    for (const oy of [-17, -10, 10, 17]) {
      ctx.beginPath();
      ctx.ellipse(cx - 1, cy + oy, 4.5, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    rr(ctx, cx - 26, cy - 11, 7, 22, 2);
    fillStroke(ctx, L3, 1.4);
    ctx.beginPath();
    ctx.moveTo(cx + 26, cy);
    ctx.quadraticCurveTo(cx + 12, cy - 6, cx - 26, cy - 4);
    ctx.lineTo(cx - 26, cy + 4);
    ctx.quadraticCurveTo(cx + 12, cy + 6, cx + 26, cy);
    fillStroke(ctx, vgrad(ctx, cy - 6, cy + 6, L1, L2), 1.4);
    ctx.fillStyle = '#2b3a4a';
    ctx.beginPath();
    ctx.ellipse(cx + 13, cy, 4.5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }],
  a_bomber: [96, 96, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    // Large swept wings with four engines.
    ctx.beginPath();
    ctx.moveTo(cx + 10, cy - 4);
    ctx.lineTo(cx - 18, cy - 42);
    ctx.lineTo(cx - 26, cy - 42);
    ctx.lineTo(cx - 12, cy - 4);
    ctx.lineTo(cx - 12, cy + 4);
    ctx.lineTo(cx - 26, cy + 42);
    ctx.lineTo(cx - 18, cy + 42);
    ctx.lineTo(cx + 10, cy + 4);
    ctx.closePath();
    fillStroke(ctx, vgrad(ctx, cy - 42, cy + 42, L2, L3), 1.6);
    ctx.fillStyle = D1;
    for (const [ox, oy] of [[-6, -16], [-12, -28], [-6, 16], [-12, 28]]) {
      rr(ctx, cx + ox - 5, cy + oy - 2.5, 10, 5, 2);
      fillStroke(ctx, D1, 1);
    }
    ctx.beginPath();
    ctx.moveTo(cx - 34, cy);
    ctx.lineTo(cx - 44, cy - 14);
    ctx.lineTo(cx - 47, cy - 14);
    ctx.lineTo(cx - 42, cy);
    ctx.lineTo(cx - 47, cy + 14);
    ctx.lineTo(cx - 44, cy + 14);
    ctx.closePath();
    fillStroke(ctx, L3, 1.4);
    ctx.beginPath();
    ctx.moveTo(cx + 44, cy);
    ctx.quadraticCurveTo(cx + 26, cy - 6.5, cx - 44, cy - 4);
    ctx.lineTo(cx - 44, cy + 4);
    ctx.quadraticCurveTo(cx + 26, cy + 6.5, cx + 44, cy);
    fillStroke(ctx, vgrad(ctx, cy - 6, cy + 6, L1, L2), 1.6);
    ctx.fillStyle = '#2b3a4a';
    ctx.beginPath();
    ctx.ellipse(cx + 33, cy, 5, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }],
  a_heli: [64, 64, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    // Tail boom and rotor.
    rr(ctx, cx - 28, cy - 2, 26, 4, 2);
    fillStroke(ctx, L3, 1.2);
    rr(ctx, cx - 30, cy - 7, 4, 14, 1.5);
    fillStroke(ctx, L3, 1.2);
    // Stub wings with rocket pods.
    rr(ctx, cx - 3, cy - 14, 6, 28, 2);
    fillStroke(ctx, L3, 1.2);
    ctx.fillStyle = D2;
    for (const oy of [-12, 12]) {
      rr(ctx, cx - 5, cy + oy - 2.5, 10, 5, 2);
      ctx.fill();
    }
    // Narrow tandem-seat fuselage.
    ctx.beginPath();
    ctx.ellipse(cx + 6, cy, 16, 6.5, 0, 0, Math.PI * 2);
    fillStroke(ctx, vgrad(ctx, cy - 7, cy + 7, L1, L2), 1.4);
    ctx.fillStyle = '#2b3a4a';
    ctx.beginPath();
    ctx.ellipse(cx + 14, cy, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }],
  a_heli_t: [72, 72, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    rr(ctx, cx - 32, cy - 2.5, 26, 5, 2);
    fillStroke(ctx, L3, 1.2);
    rr(ctx, cx - 34, cy - 8, 4, 16, 1.5);
    fillStroke(ctx, L3, 1.2);
    // Roomy cabin.
    rr(ctx, cx - 12, cy - 9, 34, 18, 8);
    fillStroke(ctx, vgrad(ctx, cy - 9, cy + 9, L1, L2), 1.4);
    ctx.fillStyle = D1;
    for (const ox of [-6, 2, 10]) ctx.fillRect(cx + ox, cy - 8, 4, 2);
    for (const ox of [-6, 2, 10]) ctx.fillRect(cx + ox, cy + 6, 4, 2);
    ctx.fillStyle = '#2b3a4a';
    ctx.beginPath();
    ctx.ellipse(cx + 18, cy, 3.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }],
  a_rotor: [76, 76, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    // Motion-blurred disc plus four blades.
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 36);
    g.addColorStop(0, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0.04)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + 0.3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * 35, cy + Math.sin(a) * 35);
      ctx.stroke();
    }
    ctx.fillStyle = L2;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  }],
};

// ------------------------------------------------------------------ cities & fx

const CITY_R = [0, 13, 16, 20, 24];

function drawCityDisc(ctx: Ctx, w: number, h: number, r: number): void {
  const cx = w / 2, cy = h / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill();
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.7, '#e2e2e2');
  g.addColorStop(1, '#b4b4b4');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#1a1d22';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function drawGlyph(ctx: Ctx, w: number, h: number, tier: number): void {
  const cx = w / 2, cy = h / 2;
  ctx.fillStyle = '#10151c';
  const b = (x: number, bw: number, bh: number) => ctx.fillRect(cx + x, cy + 7 - bh, bw, bh);
  if (tier === 1) {
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + 5); ctx.lineTo(cx - 6, cy - 1); ctx.lineTo(cx - 2, cy - 5); ctx.lineTo(cx + 2, cy - 1); ctx.lineTo(cx + 2, cy + 5);
    ctx.closePath(); ctx.fill();
    b(3, 4, 7);
  } else if (tier === 2) {
    b(-8, 5, 9); b(-2, 5, 14); b(4, 5, 10);
  } else if (tier === 3) {
    b(-11, 4, 9); b(-6, 5, 16); b(0, 4, 20); b(5, 5, 13); b(10, 3, 8);
  } else {
    // capital star
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 12 : 5;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function radial(size: number, stops: [number, string][]): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

function waveTile(size: number, seed: number, count: number, alpha: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = 6 + rnd() * 16;
    ctx.strokeStyle = `rgba(255,255,255,${alpha * (0.4 + rnd() * 0.6)})`;
    ctx.lineWidth = 1 + rnd() * 1.2;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.quadraticCurveTo(x + ox + len / 2, y + oy - 3, x + ox + len, y + oy);
      ctx.stroke();
    }
  }
  return c;
}

export function generateTextures(scene: Phaser.Scene): void {
  const tm = scene.textures;
  const add = (key: string, c: HTMLCanvasElement) => {
    if (!tm.exists(key)) tm.addCanvas(key, c);
  };
  for (const [key, [w, h, draw]] of Object.entries(UNIT_DRAW)) {
    const [c, ctx] = canvas(w, h);
    draw(ctx, w, h);
    add(key, c);
  }
  for (let t = 1; t <= 4; t++) {
    const s = CITY_R[t] * 2 + 8;
    const [c, ctx] = canvas(s, s);
    drawCityDisc(ctx, s, s, CITY_R[t]);
    add(`city_disc_${t}`, c);
    const [g, gctx] = canvas(s, s);
    drawGlyph(gctx, s, s, t);
    add(`city_glyph_${t}`, g);
  }
  // Port anchor icon.
  {
    const [c, ctx] = canvas(20, 20);
    ctx.strokeStyle = '#eaf6ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(10, 5, 2.2, 0, Math.PI * 2);
    ctx.moveTo(10, 7);
    ctx.lineTo(10, 17);
    ctx.moveTo(5, 10);
    ctx.lineTo(15, 10);
    ctx.moveTo(3.5, 13);
    ctx.quadraticCurveTo(10, 20, 16.5, 13);
    ctx.stroke();
    add('ic_anchor', c);
  }
  add('fx_glow', radial(64, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]));
  add('fx_soft', radial(64, [[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]));
  {
    // smoke puff with lumpy edge
    const [c, ctx] = canvas(64, 64);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const g = ctx.createRadialGradient(32 + Math.cos(a) * 9, 32 + Math.sin(a) * 9, 0, 32 + Math.cos(a) * 9, 32 + Math.sin(a) * 9, 18);
      g.addColorStop(0, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }
    add('fx_smoke', c);
  }
  {
    const [c, ctx] = canvas(128, 128);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.stroke();
    add('fx_ring', c);
  }
  {
    const [c, ctx] = canvas(96, 96);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.arc(48, 48, 44, 0, Math.PI * 2);
    ctx.stroke();
    add('fx_ring_dash', c);
  }
  {
    const [c, ctx] = canvas(8, 8);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(4, 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
    add('fx_dot', c);
  }
  {
    const [c, ctx] = canvas(16, 4);
    const g = ctx.createLinearGradient(0, 0, 16, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 4);
    add('fx_spark', c);
  }
  {
    const [c, ctx] = canvas(40, 6);
    const g = ctx.createLinearGradient(0, 0, 40, 0);
    g.addColorStop(0, 'rgba(255,230,150,0)');
    g.addColorStop(0.8, 'rgba(255,240,190,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    rr(ctx, 0, 1, 40, 4, 2);
    ctx.fill();
    add('fx_tracer', c);
  }
  {
    const [c, ctx] = canvas(28, 10);
    rr(ctx, 4, 3, 18, 4, 2);
    ctx.fillStyle = '#e8ecef';
    ctx.fill();
    ctx.fillStyle = '#d23a2a';
    ctx.beginPath();
    ctx.moveTo(22, 3);
    ctx.lineTo(27, 5);
    ctx.lineTo(22, 7);
    ctx.fill();
    ctx.fillStyle = '#9aa3aa';
    ctx.fillRect(4, 1, 4, 8);
    add('fx_missile', c);
  }
  {
    const [c, ctx] = canvas(18, 6);
    rr(ctx, 1, 1.5, 16, 3, 1.5);
    ctx.fillStyle = '#20262c';
    ctx.fill();
    add('fx_torpedo', c);
  }
  {
    const [c, ctx] = canvas(64, 64);
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(20,14,10,0.85)');
    g.addColorStop(0.6, 'rgba(30,22,16,0.45)');
    g.addColorStop(1, 'rgba(30,22,16,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    add('fx_scorch', c);
  }
  {
    const [c, ctx] = canvas(10, 10);
    ctx.fillStyle = '#2c2c2c';
    ctx.beginPath();
    ctx.moveTo(1, 3); ctx.lineTo(7, 1); ctx.lineTo(9, 6); ctx.lineTo(4, 9);
    ctx.closePath();
    ctx.fill();
    add('fx_debris', c);
  }
  {
    const [c, ctx] = canvas(24, 24);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const r = i % 2 === 0 ? 11 : 2.5;
      ctx.lineTo(12 + Math.cos(a) * r, 12 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    add('fx_sparkle', c);
  }
  add('fx_waves_a', waveTile(256, 7, 70, 0.55));
  add('fx_waves_b', waveTile(512, 19, 110, 0.4));
  {
    // Fine noise used to add grain to terrain when zoomed in.
    const [c, ctx] = canvas(256, 256);
    const img = ctx.createImageData(256, 256);
    let s = 99;
    for (let i = 0; i < 256 * 256; i++) {
      s = (s * 16807) % 2147483647;
      const v = 110 + (s % 40);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    add('fx_grain', c);
  }
  {
    // 1x1 white pixel for bars & overlays.
    const [c, ctx] = canvas(4, 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 4, 4);
    add('px', c);
  }
}

// ------------------------------------------------------------------ UI portraits

const portraitCache = new Map<string, string>();

/** Faction-coloured data URL of a unit texture for DOM UI. */
export function portraitURL(scene: Phaser.Scene, key: string, color: string): string {
  const ck = `${key}|${color}`;
  const hit = portraitCache.get(ck);
  if (hit) return hit;
  try {
    const src = scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
    const [c, ctx] = canvas(src.width, src.height);
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(src, 0, 0);
    const url = c.toDataURL();
    portraitCache.set(ck, url);
    return url;
  } catch {
    return '';
  }
}

export function turretURL(scene: Phaser.Scene, hull: string, turret: string | undefined, color: string): string {
  const ck = `${hull}+${turret}|${color}`;
  const hit = portraitCache.get(ck);
  if (hit) return hit;
  try {
    const h = scene.textures.get(hull).getSourceImage() as HTMLCanvasElement;
    const size = Math.max(h.width, h.height);
    const [c, ctx] = canvas(size, size);
    ctx.drawImage(h, (size - h.width) / 2, (size - h.height) / 2);
    if (turret && scene.textures.exists(turret)) {
      const t = scene.textures.get(turret).getSourceImage() as HTMLCanvasElement;
      ctx.drawImage(t, (size - t.width) / 2, (size - t.height) / 2);
    }
    const mask = document.createElement('canvas');
    mask.width = size;
    mask.height = size;
    mask.getContext('2d')!.drawImage(c, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    // Crop to visible pixels so small sprites fill their UI slot.
    const data = ctx.getImageData(0, 0, size, size).data;
    let x0 = size, y0 = size, x1 = 0, y1 = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * 4 + 3] > 20) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    let url: string;
    if (x1 > x0 && y1 > y0) {
      const [cc, cctx] = canvas(x1 - x0 + 3, y1 - y0 + 3);
      cctx.drawImage(c, x0 - 1, y0 - 1, x1 - x0 + 3, y1 - y0 + 3, 0, 0, x1 - x0 + 3, y1 - y0 + 3);
      url = cc.toDataURL();
    } else url = c.toDataURL();
    portraitCache.set(ck, url);
    return url;
  } catch {
    return '';
  }
}
