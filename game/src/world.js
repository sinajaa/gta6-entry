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

const COLORS = ['#b5651d', '#8c5a3c', '#4a6fa5', '#6b8e23', '#a0522d', '#c2b280', '#7a8fa6', '#b8860b', '#8f4b3a', '#5f7a52', '#9a6b4f', '#c47a5a'];
const BLOCKS = COLS / PERIOD;

function splitRect(r, axis, rand) {
  const d = axis === 'x' ? r.w : r.h;
  if (d < 3) return [r];
  const a = d === 3 ? 1 : 2 + Math.floor(rand() * (d - 3));
  const b = d - 1 - a;
  return axis === 'x'
    ? [{ ...r, w: a }, { ...r, x: r.x + a + 1, w: b }]
    : [{ ...r, h: a }, { ...r, y: r.y + a + 1, h: b }];
}

function layoutLots(x0, y0, rand) {
  const count = rand() < 0.2 ? 3 : 4;
  const axis = rand() < 0.5 ? 'x' : 'y';
  const other = axis === 'x' ? 'y' : 'x';
  const halves = splitRect({ x: x0, y: y0, w: 6, h: 6 }, axis, rand);
  if (count === 2) return halves;
  if (count === 3) {
    const pick = rand() < 0.5 ? 0 : 1;
    return halves.flatMap((h, i) => (i === pick ? splitRect(h, other, rand) : [h]));
  }
  return halves.flatMap((h) => splitRect(h, other, rand));
}

function districtFloors(bx, by, rand) {
  const dist = Math.hypot(bx - (BLOCKS - 1) / 2, by - (BLOCKS - 1) / 2);
  const [lo, hi] = dist < 2.2 ? [3, 6] : dist < 3.6 ? [2, 4] : [1, 2];
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function buildLanePoints() {
  const points = [];
  for (let axis = 0; axis < 2; axis++) {
    for (let r = 0; r < BLOCKS; r++) {
      const roadStart = r * PERIOD * TILE;
      for (const positive of [true, false]) {
        const horizontal = axis === 0;
        const lane = roadStart + (positive === horizontal ? 48 : 16);
        for (let along = 32; along < WORLD_W - 16; along += 32) {
          if (along % (PERIOD * TILE) < 2 * TILE) continue;
          points.push(horizontal ? { x: along, y: lane, dir: positive ? 1 : -1, horizontal } : { x: lane, y: along, dir: positive ? 1 : -1, horizontal });
        }
      }
    }
  }
  return points;
}

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

  for (let by = 0; by < BLOCKS; by++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      const x0 = bx * PERIOD + 3, y0 = by * PERIOD + 3;
      if (rand() < 0.1) { parks.push({ x: x0 * TILE, y: y0 * TILE, w: 6 * TILE, h: 6 * TILE }); continue; }
      for (const lot of layoutLots(x0, y0, rand)) {
        for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) tiles[y * COLS + x] = T.BUILDING;
        const color = COLORS[Math.floor(rand() * COLORS.length)];
        buildings.push({
          x: lot.x * TILE, y: lot.y * TILE, w: lot.w * TILE, h: lot.h * TILE,
          tiles: lot.w * lot.h, height: districtFloors(bx, by, rand) * TILE, color, roof: color,
        });
      }
    }
  }
  return { tiles, buildings, parks, lanePoints: buildLanePoints(), width: WORLD_W, height: WORLD_H };
}

export function tileAt(world, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return T.BUILDING;
  return world.tiles[ty * COLS + tx];
}
