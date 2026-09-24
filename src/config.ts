// Global configuration & world projection helpers.
// The world is an equirectangular projection of Earth sampled on a grid.

export const GAME_TITLE = 'STEEL MERIDIAN';
export const GAME_SUBTITLE = 'Global War Strategy';
export const GAME_VERSION = '1.0.0';

/** World grid cell size in world pixels. */
export const CELL = 16;
export const COLS = 400;
export const ROWS = 160;
export const WORLD_W = COLS * CELL; // 6400
export const WORLD_H = ROWS * CELL; // 2560

/** Geographic extent of the map. */
export const LON_WEST = -170;
export const LAT_TOP = 81;
export const DEG_PER_CELL = 0.9;

/** Terrain / territory textures are rendered at WORLD / TEX_SCALE. */
export const TEX_SCALE = 2.5;
export const TEX_W = WORLD_W / TEX_SCALE; // 2560
export const TEX_H = WORLD_H / TEX_SCALE; // 1024

/** Developer debug overlay (F3 / backquote). Set to false to strip it from a release build. */
export const DEBUG_ALLOWED = true;

/** Fixed simulation step (game seconds). */
export const SIM_STEP = 0.1;

export const SAVE_PREFIX = 'steelmeridian';
export const SAVE_VERSION = 1;

/** One game second == one in-game hour. */
export const START_DATE = Date.UTC(2032, 2, 1, 0, 0, 0);

export function lonToX(lon: number): number {
  let l = lon;
  if (l < LON_WEST) l += 360;
  return ((l - LON_WEST) / DEG_PER_CELL) * CELL;
}

export function latToY(lat: number): number {
  return ((LAT_TOP - lat) / DEG_PER_CELL) * CELL;
}

export function xToLon(x: number): number {
  return (x / CELL) * DEG_PER_CELL + LON_WEST;
}

export function yToLat(y: number): number {
  return LAT_TOP - (y / CELL) * DEG_PER_CELL;
}

export function cellIndex(cx: number, cy: number): number {
  return cy * COLS + cx;
}

export function worldToCell(x: number, y: number): number {
  const cx = Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL)));
  const cy = Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL)));
  return cy * COLS + cx;
}

export function cellCenterX(cell: number): number {
  return (cell % COLS) * CELL + CELL / 2;
}

export function cellCenterY(cell: number): number {
  return Math.floor(cell / COLS) * CELL + CELL / 2;
}
