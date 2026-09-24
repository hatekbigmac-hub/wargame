// Renders the world: ocean depth, animated waves, painted terrain, territory overlay
// with organic borders (political / terrain / resources / military / strategic layers)
// and fog of war. Heavy preprocessing is cached in MapAssets and shared across scenes.
import Phaser from 'phaser';
import { COLS, ROWS, CELL, WORLD_W, WORLD_H, TEX_W, TEX_H, TEX_SCALE, xToLon, yToLat } from '../config';
import { Terrain, type City, type FactionId } from '../core/types';
import { fbm, RNG } from '../core/rng';
import type { WorldGeo, WorldPoly } from './WorldGeo';
import { FACTIONS, NEUTRAL_COLOR, NEUTRAL_ID } from '../data/factions';

export type MapLayer = 'political' | 'terrain' | 'resources' | 'military' | 'strategic';

const S = 1 / TEX_SCALE;
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

function rgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function pack(r: number, g: number, b: number, a: number): number {
  // Little-endian RGBA in a Uint32Array => ABGR.
  return ((Math.round(a * 255) & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function tracePoly(ctx: CanvasRenderingContext2D, pts: Float32Array): void {
  ctx.moveTo(pts[0] * S, pts[1] * S);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * S, pts[i + 1] * S);
  ctx.closePath();
}

function traceLine(ctx: CanvasRenderingContext2D, pts: Float32Array): void {
  ctx.moveTo(pts[0] * S, pts[1] * S);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * S, pts[i + 1] * S);
}

// ------------------------------------------------------------------ biome colours

const C = {
  plains: [126, 158, 86] as [number, number, number],
  steppe: [170, 164, 108] as [number, number, number],
  savanna: [164, 158, 88] as [number, number, number],
  forest: [72, 112, 66] as [number, number, number],
  taiga: [66, 98, 74] as [number, number, number],
  jungle: [44, 100, 54] as [number, number, number],
  desert: [220, 196, 140] as [number, number, number],
  mountain: [136, 122, 104] as [number, number, number],
  tundra: [158, 164, 146] as [number, number, number],
  ice: [236, 242, 246] as [number, number, number],
};

function biomeColor(geo: WorldGeo, x: number, y: number, terrain: Terrain): [number, number, number] {
  const lon = xToLon(x);
  const lat = yToLat(y);
  const alat = Math.abs(lat);
  const n = fbm(lon * 0.35, lat * 0.35, 3, 101);
  let c: [number, number, number];
  switch (terrain) {
    case Terrain.Desert:
      c = mix(C.desert, [205, 170, 118], n);
      break;
    case Terrain.Jungle:
      c = mix(C.jungle, [58, 118, 60], n);
      break;
    case Terrain.Forest:
      c = lat > 50 ? mix(C.taiga, C.forest, n * 0.6) : mix(C.forest, [86, 124, 70], n);
      break;
    case Terrain.Mountain:
      c = mix(C.mountain, [160, 146, 124], n);
      break;
    case Terrain.Arctic: {
      const z = geo.zoneStrength(lon, lat);
      c = z.ice > 0.1 || alat > 74 ? C.ice : mix(C.tundra, C.ice, Math.max(0, (alat - 64) / 12) * 0.6 + n * 0.25);
      break;
    }
    default: {
      const z = geo.zoneStrength(lon, lat);
      if (z.steppe > 0.2) c = mix(C.plains, C.steppe, Math.min(1, z.steppe * 1.5));
      else if (alat < 22) c = mix(C.plains, C.savanna, 0.55 + (n - 0.5) * 0.4);
      else c = mix(C.plains, [142, 170, 96], n);
      if (z.desert > 0.05) c = mix(c, C.steppe, Math.min(1, z.desert * 2.5));
    }
  }
  return c;
}

// ------------------------------------------------------------------ shared assets

class MapAssetsCache {
  ready = false;
  terrainCanvas!: HTMLCanvasElement;
  oceanCanvas!: HTMLCanvasElement;
  pixRegion!: Int16Array;
  pixNb!: Int16Array;
  pixNbDist!: Uint8Array;

  async build(geo: WorldGeo, progress: (p: number, msg: string) => void): Promise<void> {
    if (this.ready) return;
    progress(0.1, 'Charting oceans…');
    await nextFrame();
    this.oceanCanvas = this.buildOcean(geo);
    progress(0.2, 'Painting continents…');
    await nextFrame();
    const biome = this.buildBiome(geo);
    progress(0.35, 'Raising mountains…');
    await nextFrame();
    this.terrainCanvas = this.buildTerrain(geo, biome);
    progress(0.6, 'Drawing borders…');
    await nextFrame();
    this.buildRegions(geo);
    progress(0.85, 'Deploying forces…');
    await nextFrame();
    this.ready = true;
  }

  private buildOcean(geo: WorldGeo): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = COLS;
    c.height = ROWS;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(COLS, ROWS);
    const d32 = new Uint32Array(img.data.buffer);
    const shallow: [number, number, number] = [44, 124, 160];
    const mid: [number, number, number] = [24, 84, 130];
    const deep: [number, number, number] = [11, 44, 84];
    const abyss: [number, number, number] = [8, 30, 62];
    for (let i = 0; i < COLS * ROWS; i++) {
      const d = geo.land[i] ? 0.5 : geo.coastDist[i];
      const x = (i % COLS) * CELL;
      const y = Math.floor(i / COLS) * CELL;
      const n = fbm(x * 0.004, y * 0.004, 3, 55) - 0.5;
      let col: [number, number, number];
      if (d <= 1) col = shallow;
      else if (d <= 3) col = mix(shallow, mid, (d - 1) / 2);
      else if (d <= 10) col = mix(mid, deep, (d - 3) / 7);
      else col = mix(deep, abyss, Math.min(1, (d - 10) / 14));
      col = mix(col, [30, 60, 90], Math.max(0, n * 0.35));
      const lat = Math.abs(yToLat(y));
      if (lat > 60) col = mix(col, [70, 100, 120], Math.min(0.35, (lat - 60) / 50));
      d32[i] = pack(col[0], col[1], col[2], 1);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private buildBiome(geo: WorldGeo): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = COLS;
    c.height = ROWS;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(COLS, ROWS);
    const d32 = new Uint32Array(img.data.buffer);
    for (let i = 0; i < COLS * ROWS; i++) {
      const x = (i % COLS) * CELL + CELL / 2;
      const y = Math.floor(i / COLS) * CELL + CELL / 2;
      const t = geo.land[i] ? (geo.terrain[i] as Terrain) : geo.biomeAt(x, y, geo.mountainStrength[i]);
      const col = biomeColor(geo, x, y, t);
      d32[i] = pack(col[0], col[1], col[2], 1);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private buildTerrain(geo: WorldGeo, biome: HTMLCanvasElement): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = TEX_W;
    c.height = TEX_H;
    const ctx = c.getContext('2d')!;
    const landPath = () => {
      ctx.beginPath();
      for (const p of geo.landPolys) tracePoly(ctx, p.pts);
    };
    // Shallow shelf glow around coasts.
    ctx.save();
    ctx.shadowColor = 'rgba(120,205,230,0.6)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(120,205,230,0.4)';
    landPath();
    ctx.fill();
    ctx.shadowBlur = 5;
    ctx.fill();
    ctx.restore();

    // Land base from smoothed biome map.
    ctx.save();
    landPath();
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(biome, 0, 0, TEX_W, TEX_H);

    // Terrain detail: forests, dunes, tundra speckle.
    const rng = new RNG(4242);
    const cellT = CELL * S;
    const forest = new Path2D();
    const forestHi = new Path2D();
    const dunes = new Path2D();
    const speck = new Path2D();
    for (let i = 0; i < COLS * ROWS; i++) {
      if (!geo.land[i]) continue;
      const t = geo.terrain[i];
      const x0 = (i % COLS) * cellT;
      const y0 = Math.floor(i / COLS) * cellT;
      if (t === Terrain.Forest || t === Terrain.Jungle) {
        const n = t === Terrain.Jungle ? 4 : 3;
        for (let k = 0; k < n; k++) {
          const x = x0 + rng.next() * cellT;
          const y = y0 + rng.next() * cellT;
          const r = 0.9 + rng.next() * 1.1;
          forest.moveTo(x + r, y);
          forest.arc(x, y, r, 0, Math.PI * 2);
          forestHi.moveTo(x - r * 0.3 + r * 0.45, y - r * 0.35);
          forestHi.arc(x - r * 0.3, y - r * 0.35, r * 0.45, 0, Math.PI * 2);
        }
      } else if (t === Terrain.Desert && rng.chance(0.55)) {
        const x = x0 + rng.next() * cellT;
        const y = y0 + rng.next() * cellT;
        dunes.moveTo(x, y);
        dunes.quadraticCurveTo(x + 2.5, y - 1.8, x + 5, y);
      } else if ((t === Terrain.Arctic || t === Terrain.Plains) && rng.chance(0.4)) {
        const x = x0 + rng.next() * cellT;
        const y = y0 + rng.next() * cellT;
        speck.rect(x, y, 1, 1);
      }
    }
    ctx.fillStyle = 'rgba(30,72,38,0.38)';
    ctx.fill(forest);
    ctx.fillStyle = 'rgba(150,190,110,0.22)';
    ctx.fill(forestHi);
    ctx.strokeStyle = 'rgba(150,110,60,0.35)';
    ctx.lineWidth = 0.9;
    ctx.stroke(dunes);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill(speck);

    // Rivers.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(62,128,178,0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const r of geo.riverLines) traceLine(ctx, r);
    ctx.stroke();

    // Mountains: soft base then shaded peaks.
    for (const m of geo.mountainLines) {
      ctx.save();
      ctx.strokeStyle = 'rgba(92,76,58,0.32)';
      ctx.lineWidth = m.width * S * 1.15;
      ctx.shadowColor = 'rgba(60,45,30,0.4)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      traceLine(ctx, m.pts);
      ctx.stroke();
      ctx.restore();
    }
    const prng = new RNG(777);
    for (const m of geo.mountainLines) {
      const pts = m.pts;
      const w = m.width * S;
      const rows = w > 9 ? 3 : w > 6 ? 2 : 1;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const ax = pts[i] * S, ay = pts[i + 1] * S, bx = pts[i + 2] * S, by = pts[i + 3] * S;
        const len = Math.hypot(bx - ax, by - ay);
        const nx = -(by - ay) / (len || 1), ny = (bx - ax) / (len || 1);
        const steps = Math.max(1, Math.round(len / 4.2));
        for (let sI = 0; sI < steps; sI++) {
          for (let r = 0; r < rows; r++) {
            const t = (sI + prng.next() * 0.8) / steps;
            const off = (rows === 1 ? 0 : (r / (rows - 1) - 0.5) * w * 0.8) + (prng.next() - 0.5) * w * 0.3;
            const x = ax + (bx - ax) * t + nx * off;
            const y = ay + (by - ay) * t + ny * off;
            const h = (m.high ? 5.5 : 4) + prng.next() * 3;
            const hw = h * 0.75;
            ctx.beginPath();
            ctx.moveTo(x - hw, y + h * 0.4);
            ctx.lineTo(x, y - h * 0.6);
            ctx.lineTo(x, y + h * 0.4);
            ctx.closePath();
            ctx.fillStyle = 'rgba(196,184,158,0.85)';
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(x, y - h * 0.6);
            ctx.lineTo(x + hw, y + h * 0.4);
            ctx.lineTo(x, y + h * 0.4);
            ctx.closePath();
            ctx.fillStyle = 'rgba(88,72,56,0.85)';
            ctx.fill();
            if (m.high && prng.next() < 0.7) {
              ctx.beginPath();
              ctx.moveTo(x - hw * 0.35, y - h * 0.2);
              ctx.lineTo(x, y - h * 0.6);
              ctx.lineTo(x + hw * 0.35, y - h * 0.2);
              ctx.closePath();
              ctx.fillStyle = 'rgba(250,252,255,0.95)';
              ctx.fill();
            }
          }
        }
      }
    }
    ctx.restore();

    // Carve inland seas, lakes and straits.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    for (const h of geo.holePolys) tracePoly(ctx, h.pts);
    ctx.fill();
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const s of geo.straitLines) traceLine(ctx, s);
    ctx.stroke();
    ctx.restore();

    // Coastlines.
    const strokeCoast = (polys: WorldPoly[]) => {
      ctx.beginPath();
      for (const p of polys) tracePoly(ctx, p.pts);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(16,34,44,0.55)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(240,236,210,0.28)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    };
    strokeCoast(geo.landPolys);
    strokeCoast(geo.holePolys);
    return c;
  }

  private buildRegions(geo: WorldGeo): void {
    const W = TEX_W;
    const H = TEX_H;
    const alpha = this.terrainCanvas.getContext('2d')!.getImageData(0, 0, W, H).data;
    // Jitter field (quarter resolution) for organic borders.
    const JW = (W >> 2) + 2;
    const JH = (H >> 2) + 2;
    const jx = new Float32Array(JW * JH);
    const jy = new Float32Array(JW * JH);
    for (let y = 0; y < JH; y++) for (let x = 0; x < JW; x++) {
      jx[y * JW + x] = (fbm(x * 0.13, y * 0.13, 4, 11) - 0.5) * 30 + (fbm(x * 0.5, y * 0.5, 2, 5) - 0.5) * 16;
      jy[y * JW + x] = (fbm(x * 0.13, y * 0.13, 4, 23) - 0.5) * 30 + (fbm(x * 0.5, y * 0.5, 2, 9) - 0.5) * 16;
    }
    const pr = new Int16Array(W * H).fill(-1);
    const region = geo.region;
    const land = geo.land;
    for (let py = 0; py < H; py++) {
      const fy = py / 4;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      for (let px = 0; px < W; px++) {
        const i = py * W + px;
        if (alpha[i * 4 + 3] < 140) continue;
        const fx = px / 4;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const j = y0 * JW + x0;
        const ox = (jx[j] * (1 - tx) + jx[j + 1] * tx) * (1 - ty) + (jx[j + JW] * (1 - tx) + jx[j + JW + 1] * tx) * ty;
        const oy = (jy[j] * (1 - tx) + jy[j + 1] * tx) * (1 - ty) + (jy[j + JW] * (1 - tx) + jy[j + JW + 1] * tx) * ty;
        const wx = (px + 0.5) * TEX_SCALE;
        const wy = (py + 0.5) * TEX_SCALE;
        let cx = Math.floor((wx + ox) / CELL);
        let cy = Math.floor((wy + oy) / CELL);
        cx = cx < 0 ? 0 : cx >= COLS ? COLS - 1 : cx;
        cy = cy < 0 ? 0 : cy >= ROWS ? ROWS - 1 : cy;
        let r = land[cy * COLS + cx] ? region[cy * COLS + cx] : -1;
        if (r < 0) {
          const ux = Math.min(COLS - 1, Math.floor(wx / CELL));
          const uy = Math.min(ROWS - 1, Math.floor(wy / CELL));
          r = region[uy * COLS + ux];
          if (r < 0) {
            for (let dy = -1; dy <= 1 && r < 0; dy++) for (let dx = -1; dx <= 1 && r < 0; dx++) {
              const nx = ux + dx, ny = uy + dy;
              if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS) r = region[ny * COLS + nx];
            }
          }
        }
        pr[i] = r;
      }
    }
    const nb = new Int16Array(W * H).fill(-1);
    const nd = new Uint8Array(W * H);
    const offs: [number, number, number][] = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [2, 0, 2], [-2, 0, 2], [0, 2, 2], [0, -2, 2], [1, 1, 2], [-1, 1, 2], [1, -1, 2], [-1, -1, 2],
      [3, 0, 3], [-3, 0, 3], [0, 3, 3], [0, -3, 3],
    ];
    for (let py = 3; py < H - 3; py++) {
      for (let px = 3; px < W - 3; px++) {
        const i = py * W + px;
        const r = pr[i];
        if (r < 0) continue;
        for (const [dx, dy, d] of offs) {
          const o = pr[i + dy * W + dx];
          if (o >= 0 && o !== r) {
            nb[i] = o;
            nd[i] = d;
            break;
          }
        }
      }
    }
    this.pixRegion = pr;
    this.pixNb = nb;
    this.pixNbDist = nd;
  }
}

export const MapAssets = new MapAssetsCache();

// ------------------------------------------------------------------ renderer

let territorySeq = 0;

export class MapRenderer {
  layer: MapLayer = 'political';
  private territoryKey: string;
  private territoryTex!: Phaser.Textures.CanvasTexture;
  private territoryImg!: Phaser.GameObjects.Image;
  private fogTex: Phaser.Textures.CanvasTexture | null = null;
  fogImg: Phaser.GameObjects.Image | null = null;
  private wavesA!: Phaser.GameObjects.TileSprite;
  private wavesB!: Phaser.GameObjects.TileSprite;
  private dirty = true;
  private lastRender = 0;
  renderMs = 0;
  /** Incremented whenever the territory texture changes (minimap cache key). */
  version = 0;

  constructor(private scene: Phaser.Scene, private geo: WorldGeo, private ownerOf: () => FactionId[], private cities: () => City[]) {
    this.territoryKey = `territory_${++territorySeq}`;
  }

  create(): void {
    const sc = this.scene;
    const tm = sc.textures;
    if (!tm.exists('ocean')) tm.addCanvas('ocean', MapAssets.oceanCanvas);
    if (!tm.exists('terrain')) tm.addCanvas('terrain', MapAssets.terrainCanvas);
    sc.add.image(0, 0, 'ocean').setOrigin(0).setDisplaySize(WORLD_W, WORLD_H).setDepth(0);
    this.wavesA = sc.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'fx_waves_a').setOrigin(0).setDepth(1).setAlpha(0.1);
    this.wavesA.setTileScale(1.6, 1.6);
    this.wavesB = sc.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'fx_waves_b').setOrigin(0).setDepth(1).setAlpha(0.07);
    this.wavesB.setTileScale(2.4, 2.4);
    sc.add.image(0, 0, 'terrain').setOrigin(0).setScale(TEX_SCALE).setDepth(2);
    this.territoryTex = tm.createCanvas(this.territoryKey, TEX_W, TEX_H)!;
    this.territoryImg = sc.add.image(0, 0, this.territoryKey).setOrigin(0).setScale(TEX_SCALE).setDepth(3);
    this.renderTerritory();
    sc.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  private fogSmall: HTMLCanvasElement | null = null;

  createFog(): void {
    const tm = this.scene.textures;
    const key = `${this.territoryKey}_fog`;
    // Rendered at 4x cell resolution with a blur so fog edges are soft, not blocky.
    this.fogTex = tm.createCanvas(key, COLS * 2, ROWS * 2)!;
    this.fogImg = this.scene.add.image(0, 0, key).setOrigin(0).setScale(CELL / 2).setDepth(4);
    this.fogSmall = document.createElement('canvas');
    this.fogSmall.width = COLS;
    this.fogSmall.height = ROWS;
  }

  destroy(): void {
    const tm = this.scene.textures;
    if (tm.exists(this.territoryKey)) tm.remove(this.territoryKey);
    const fk = `${this.territoryKey}_fog`;
    if (tm.exists(fk)) tm.remove(fk);
  }

  markDirty(): void {
    this.dirty = true;
  }

  setLayer(l: MapLayer): void {
    this.layer = l;
    this.dirty = true;
    this.renderTerritory();
  }

  update(time: number): void {
    this.wavesA.tilePositionX = time * 0.006;
    this.wavesA.tilePositionY = Math.sin(time * 0.0002) * 30;
    this.wavesB.tilePositionX = -time * 0.004;
    this.wavesB.tilePositionY = time * 0.002;
    this.wavesA.setAlpha(0.085 + Math.sin(time * 0.0011) * 0.025);
    if (this.dirty && time - this.lastRender > 250) this.renderTerritory(time);
  }

  private regionColors(): { fill: Uint32Array; bright: Uint32Array; bright2: Uint32Array; prov: Uint32Array; owner: Int16Array } {
    const cities = this.cities();
    const owners = this.ownerOf();
    const R = cities.length;
    const fill = new Uint32Array(R);
    const bright = new Uint32Array(R);
    const bright2 = new Uint32Array(R);
    const prov = new Uint32Array(R);
    const owner = new Int16Array(R);
    const fIndex = new Map<FactionId, number>(FACTIONS.map((f, i) => [f.id, i]));
    const colorOf = (f: FactionId) => (f === NEUTRAL_ID ? NEUTRAL_COLOR : FACTIONS[fIndex.get(f) ?? 0]?.color ?? NEUTRAL_COLOR);
    const layer = this.layer;
    let minI = Infinity, maxI = -Infinity;
    for (const c of cities) { minI = Math.min(minI, c.importance); maxI = Math.max(maxI, c.importance); }
    for (let r = 0; r < R; r++) {
      const f = owners[r];
      owner[r] = f === NEUTRAL_ID ? 99 : fIndex.get(f) ?? 98;
      const fc = rgb(colorOf(f));
      const light = mix(fc, [255, 255, 255], 0.35);
      const dark = mix(fc, [0, 0, 0], 0.45);
      let base = fc;
      let a = 0.3;
      if (layer === 'terrain') a = 0.03;
      else if (layer === 'military') a = 0.16;
      else if (layer === 'resources') {
        const t = cities[r].tags;
        base = t.includes('o') ? [58, 40, 80] : t.includes('m') ? [120, 150, 185] : t.includes('f') ? [170, 210, 70] : t.includes('e') ? [250, 210, 60] : [120, 120, 120];
        a = t.length ? 0.5 : 0.18;
      } else if (layer === 'strategic') {
        const k = (cities[r].importance - minI) / Math.max(1, maxI - minI);
        base = k < 0.5 ? mix([40, 110, 220], [240, 210, 60], k * 2) : mix([240, 210, 60], [224, 52, 40], (k - 0.5) * 2);
        a = 0.5;
      }
      fill[r] = pack(base[0], base[1], base[2], a);
      const ba = layer === 'terrain' ? 0.55 : 0.85;
      bright[r] = pack(light[0], light[1], light[2], ba);
      bright2[r] = pack(fc[0], fc[1], fc[2], ba * 0.6);
      prov[r] = pack(dark[0], dark[1], dark[2], layer === 'terrain' ? 0.12 : 0.4);
    }
    return { fill, bright, bright2, prov, owner };
  }

  renderTerritory(time = 0): void {
    const t0 = performance.now();
    this.dirty = false;
    this.lastRender = time;
    const { fill, bright, bright2, prov, owner } = this.regionColors();
    const ctx = this.territoryTex.getContext();
    const img = ctx.createImageData(TEX_W, TEX_H);
    const d32 = new Uint32Array(img.data.buffer);
    const pr = MapAssets.pixRegion;
    const nb = MapAssets.pixNb;
    const nd = MapAssets.pixNbDist;
    const edge = pack(8, 10, 14, 0.85);
    const n = TEX_W * TEX_H;
    for (let i = 0; i < n; i++) {
      const r = pr[i];
      if (r < 0) continue;
      const o = nb[i];
      if (o < 0) {
        d32[i] = fill[r];
      } else if (owner[o] !== owner[r]) {
        const d = nd[i];
        d32[i] = d === 1 ? edge : d === 2 ? bright[r] : bright2[r];
      } else {
        d32[i] = nd[i] === 1 ? prov[r] : fill[r];
      }
    }
    ctx.putImageData(img, 0, 0);
    this.territoryTex.refresh();
    this.version++;
    this.renderMs = performance.now() - t0;
  }

  territoryCanvas(): HTMLCanvasElement | null {
    return this.territoryTex ? this.territoryTex.getSourceImage() as HTMLCanvasElement : null;
  }

  /** Update fog of war from a per-cell visibility predicate. */
  updateFog(visible: (cell: number) => boolean, enabled: boolean): void {
    if (!this.fogTex || !this.fogImg) return;
    this.fogImg.setVisible(enabled);
    if (!enabled) return;
    const sctx = this.fogSmall!.getContext('2d')!;
    const img = sctx.createImageData(COLS, ROWS);
    const d32 = new Uint32Array(img.data.buffer);
    const dark = pack(3, 9, 20, 0.36);
    for (let i = 0; i < COLS * ROWS; i++) d32[i] = visible(i) ? 0 : dark;
    sctx.putImageData(img, 0, 0);
    const ctx = this.fogTex.getContext();
    ctx.clearRect(0, 0, COLS * 2, ROWS * 2);
    ctx.imageSmoothingEnabled = true;
    ctx.filter = 'blur(1.6px)';
    ctx.drawImage(this.fogSmall!, 0, 0, COLS * 2, ROWS * 2);
    ctx.filter = 'none';
    this.fogTex.refresh();
  }
}
