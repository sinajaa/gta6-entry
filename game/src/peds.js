// peds.js — pejalan kaki: jalan di trotoar, panik, jongkok, recycle dekat pemain
// Perilaku pejalan kaki ditulis ulang dari nol, bukan salinan dari mana pun.
import { TILE, COLS, ROWS, T, tileAt } from './world.js';

export const PED_ACTIVE_RADIUS = 900;
const WALK_SPEED = 55, PANIC_SPEED = 160, PANIC_TIME = 4, COWER_TIME = 2;
const RECYCLE_MIN = 300, RECYCLE_MAX = 800;
const SPAWN_MIN = 250, SPAWN_MAX = 900, NEAR_RADIUS = 700, NEAR_MIN = 45, REFILL_MIN = 300, REFILL_MAX = 700;
const SHIRT_COUNT = 6;
const LOOKAHEAD = 20, SCARE_CAR_SPEED = 150, SCARE_CAR_DIST = 50;
const HALF_PI = Math.PI / 2;

const sidewalkCache = new WeakMap();
function sidewalkTiles(world) {
  let list = sidewalkCache.get(world);
  if (!list) {
    list = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (world.tiles[y * COLS + x] === T.SIDEWALK) list.push([x * TILE + TILE / 2, y * TILE + TILE / 2]);
    sidewalkCache.set(world, list);
  }
  return list;
}

function placeNear(world, p, cx, cy, minD, maxD) {
  const list = sidewalkTiles(world);
  let pick = null;
  for (let i = 0; i < 80 && !pick; i++) {
    const c = list[Math.floor(Math.random() * list.length)];
    const d = Math.hypot(c[0] - cx, c[1] - cy);
    if (d >= minD && d <= maxD) pick = c;
  }
  if (!pick) {
    let best = Infinity;
    for (let i = 0; i < 200; i++) {
      const c = list[Math.floor(Math.random() * list.length)];
      const e = Math.abs(Math.hypot(c[0] - cx, c[1] - cy) - (minD + maxD) / 2);
      if (e < best) { best = e; pick = c; }
    }
  }
  p.x = pick[0]; p.y = pick[1];
  p.angle = Math.floor(Math.random() * 4) * HALF_PI;
  p.state = 'WALK';
  p.timer = 1 + Math.random() * 4;
}

export function createPeds(world, px, py, count = 120) {
  const peds = [];
  for (let i = 0; i < count; i++) {
    const p = {
      x: 0, y: 0, angle: 0, speed: WALK_SPEED, state: 'WALK', timer: 0, fx: 0, fy: 0,
      shirt: Math.floor(Math.random() * SHIRT_COUNT), scale: 0.85 + Math.random() * 0.3,
    };
    placeNear(world, p, px, py, SPAWN_MIN, SPAWN_MAX);
    peds.push(p);
  }
  return peds;
}

function onSidewalk(world, x, y) { return tileAt(world, x, y) === T.SIDEWALK; }

function nearShopFront(world, x, y) {
  return onSidewalk(world, x, y) && (
    tileAt(world, x + TILE, y) === T.BUILDING || tileAt(world, x - TILE, y) === T.BUILDING ||
    tileAt(world, x, y + TILE) === T.BUILDING || tileAt(world, x, y - TILE) === T.BUILDING);
}

function inPark(world, x, y) {
  for (const p of world.parks) if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return true;
  return false;
}

function turnWalk(world, p) {
  const options = [];
  for (let k = 0; k < 4; k++) {
    const a = k * HALF_PI;
    if (onSidewalk(world, p.x + Math.cos(a) * LOOKAHEAD, p.y + Math.sin(a) * LOOKAHEAD)) options.push(a);
  }
  if (!options.length) { p.angle += Math.PI; return; }
  const back = p.angle + Math.PI;
  const forward = options.filter((a) => Math.abs(Math.atan2(Math.sin(a - back), Math.cos(a - back))) > 0.1);
  const pool = forward.length ? forward : options;
  p.angle = pool[Math.floor(Math.random() * pool.length)];
}

function snapToSidewalk(world, p) {
  if (onSidewalk(world, p.x, p.y)) return;
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = (tx + dx) * TILE + TILE / 2, y = (ty + dy) * TILE + TILE / 2;
        if (onSidewalk(world, x, y)) { p.x = x; p.y = y; return; }
      }
    }
  }
  placeNear(world, p, p.x, p.y, 0, 400);
}

function findCrossing(world, p) {
  const ahead = 24, span = TILE * 4;
  for (let k = 0; k < 4; k++) {
    const a = k * HALF_PI;
    const x1 = p.x + Math.cos(a) * ahead, y1 = p.y + Math.sin(a) * ahead;
    const x2 = p.x + Math.cos(a) * span, y2 = p.y + Math.sin(a) * span;
    if (tileAt(world, x1, y1) === T.ROAD && tileAt(world, x2, y2) === T.SIDEWALK) return { angle: a };
  }
  return null;
}

function startPanic(p, fx, fy) {
  p.state = 'PANIC'; p.timer = PANIC_TIME; p.speed = PANIC_SPEED; p.fx = fx; p.fy = fy;
}

export function alarmPeds(peds, x, y, radius) {
  for (const p of peds) {
    if (Math.hypot(p.x - x, p.y - y) <= radius) startPanic(p, x, y);
  }
}

function movePanic(world, p, dt) {
  p.angle = Math.atan2(p.y - p.fy, p.x - p.fx);
  const step = p.speed * dt, dx = Math.cos(p.angle) * step, dy = Math.sin(p.angle) * step;
  if (tileAt(world, p.x + dx, p.y + dy) !== T.BUILDING) { p.x += dx; p.y += dy; }
  else if (tileAt(world, p.x + dx, p.y) !== T.BUILDING) p.x += dx;
  else if (tileAt(world, p.x, p.y + dy) !== T.BUILDING) p.y += dy;
}

export function updatePeds(world, player, peds, dt) {
  const focus = player.car || player;
  const carSpeed = player.car ? Math.abs(player.car.speed) : 0;
  let near = 0, far = null, farD = -1;
  for (const p of peds) {
    const d = Math.hypot(p.x - focus.x, p.y - focus.y);
    if (d <= NEAR_RADIUS) near++;
    else if (d > farD) { farD = d; far = p; }
  }
  if (near < NEAR_MIN && far) placeNear(world, far, focus.x, focus.y, REFILL_MIN, REFILL_MAX);
  for (const p of peds) {
    const d = Math.hypot(p.x - focus.x, p.y - focus.y);
    if (d > PED_ACTIVE_RADIUS) { placeNear(world, p, focus.x, focus.y, RECYCLE_MIN, RECYCLE_MAX); continue; }
    if (p.state !== 'PANIC' && carSpeed > SCARE_CAR_SPEED && d < SCARE_CAR_DIST) startPanic(p, focus.x, focus.y);

    if (p.state === 'PANIC') {
      movePanic(world, p, dt);
      p.timer -= dt;
      if (p.timer <= 0) { p.state = 'COWER'; p.timer = COWER_TIME; p.speed = 0; }
    } else if (p.state === 'DOWN') {
      // Short ragdoll-like tumble: a dead ped flops backward a little and folds over,
      // then is recycled away from the player.
      const t = p.tumble;
      p.timer -= dt;
      const k = Math.min(1, (1.2 - p.timer) * 3);
      if (t) {
        const nx = p.x + t.dx * dt * 3, ny = p.y + t.dy * dt * 3;
        if (tileAt(world, nx, ny) !== T.BUILDING) { p.x = nx; p.y = ny; }
        p.angle = Math.atan2(t.dy, t.dx);
      }
      p.fold = Math.min(1, k * 1.5); // how flattened the capsule renders
      if (p.timer <= 0) { p.x = -5000; p.y = -5000; p.fold = 0; p.state = 'WALK'; p.speed = WALK_SPEED; }
    } else if (p.state === 'COWER') {
      p.timer -= dt;
      if (p.timer <= 0) { p.state = 'WALK'; p.speed = WALK_SPEED; p.timer = 1 + Math.random() * 4; snapToSidewalk(world, p); }
    } else if (p.state === 'CROSS') {
      const step = p.speed * dt;
      const nx = p.x + Math.cos(p.angle) * step, ny = p.y + Math.sin(p.angle) * step;
      if (tileAt(world, nx, ny) !== T.BUILDING) { p.x = nx; p.y = ny; }
      if (onSidewalk(world, p.x, p.y)) {
        p.state = 'WALK'; p.angle = Math.floor(Math.random() * 4) * HALF_PI; p.timer = 1 + Math.random() * 4;
        snapToSidewalk(world, p);
      }
    } else if (p.state === 'PHONE' || p.state === 'SIT') {
      // A ped pauses in place to check a phone (near a shop front) or rest on a bench (in a park),
      // then resumes walking once the timer runs out.
      p.speed = 0;
      p.timer -= dt;
      if (p.timer <= 0) { p.state = 'WALK'; p.speed = WALK_SPEED; p.timer = 1 + Math.random() * 4; }
    } else {
      p.speed = WALK_SPEED;
      p.timer -= dt;
      const step = p.speed * dt;
      if (p.timer <= 0) {
        if (Math.random() < 0.14 && nearShopFront(world, p.x, p.y)) {
          p.state = 'PHONE'; p.timer = 2 + Math.random() * 3; p.speed = 0;
        } else if (Math.random() < 0.18 && inPark(world, p.x, p.y)) {
          p.state = 'SIT'; p.timer = 3 + Math.random() * 4; p.speed = 0;
        } else {
          p.timer = 2 + Math.random() * 4;
          const cross = Math.random() < 0.12 ? findCrossing(world, p) : null;
          if (cross) { p.state = 'CROSS'; p.angle = cross.angle; }
          else turnWalk(world, p);
        }
      }
      if (p.state === 'CROSS') continue;
      const nx = p.x + Math.cos(p.angle) * step, ny = p.y + Math.sin(p.angle) * step;
      if (onSidewalk(world, nx + Math.cos(p.angle) * 8, ny + Math.sin(p.angle) * 8)) { p.x = nx; p.y = ny; }
      else if (p.timer <= 0) turnWalk(world, p);
    }
  }
}
