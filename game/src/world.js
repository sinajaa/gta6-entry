// world.js — grid kota, tile, dan bounding box bangunan
export const TILE = 32;
export const COLS = 80;
export const ROWS = 80;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;
export const T = { ROAD: 0, SIDEWALK: 1, GRASS: 2, BUILDING: 3 };
const PERIOD = 10;

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROOFS = ['#c8553d', '#e0a458', '#6a8caf', '#8a9a5b', '#b5838d', '#d4c4a8', '#7d6b91', '#e8825a'];

export function createWorld(seed = 1337) {
  const rand = mulberry32(seed);
  const tiles = new Uint8Array(COLS * ROWS);
  const buildings = [];
  const parks = [];

  const kind = (i) => {
    const m = i % PERIOD;
    return m < 2 ? 'road' : m === 2 || m === 9 ? 'walk' : 'block';
  };

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const kx = kind(x), ky = kind(y);
      let t = T.GRASS;
      if (kx === 'road' || ky === 'road') t = T.ROAD;
      else if (kx === 'walk' || ky === 'walk') t = T.SIDEWALK;
      tiles[y * COLS + x] = t;
    }
  }

  for (let by = 0; by < ROWS / PERIOD; by++) {
    for (let bx = 0; bx < COLS / PERIOD; bx++) {
      const x0 = bx * PERIOD + 3, y0 = by * PERIOD + 3;
      if (rand() < 0.15) { parks.push({ x: x0 * TILE, y: y0 * TILE, w: 6 * TILE, h: 6 * TILE }); continue; }
      const splitX = rand() < 0.5;
      const parts = rand() < 0.5
        ? [[x0, y0, 6, 6]]
        : splitX ? [[x0, y0, 3, 6], [x0 + 3, y0, 3, 6]] : [[x0, y0, 6, 3], [x0, y0 + 3, 6, 3]];
      for (const [px, py, pw, ph] of parts) {
        const inset = parts.length === 1 ? 0 : 0;
        for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) tiles[y * COLS + x] = T.BUILDING;
        buildings.push({
          x: px * TILE + inset, y: py * TILE, w: pw * TILE, h: ph * TILE,
          roof: ROOFS[Math.floor(rand() * ROOFS.length)],
          height: 10 + Math.floor(rand() * 14),
        });
      }
    }
  }
  return { tiles, buildings, parks, width: WORLD_W, height: WORLD_H };
}

export function tileAt(world, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return T.BUILDING;
  return world.tiles[ty * COLS + tx];
}
