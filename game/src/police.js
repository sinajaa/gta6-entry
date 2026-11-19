// police.js — level buruan dan polisi AI pengejar
// SUNNY CITY — authored pass 2026-11-19 (recording 03)
import { TILE, T, tileAt } from './world.js';

const ROAD_PERIOD = 10 * TILE, ROAD_WIDTH = 2 * TILE, LANE_NEAR = 16, LANE_FAR = 48;
const HALF_LENGTH = 18, HALF_WIDTH = 9;
const ACCEL = 260, BRAKE = 420, PATROL_SPEED = 130, TURN_RATE = 3.2;
const MAX_SPEED = [0, 240, 290, 320, 330, 360];
const COP_COUNT = [0, 1, 2, 3, 4, 5];
const EVADE_SECONDS = [10, 14, 18, 24, 30];
const HEAT_DECAY = 6, NEAR_COP_RANGE = 450, MAX_HEAT = 500;
const SPAWN_MIN = 450, SPAWN_MAX = 950, DESPAWN_RANGE = 1700, SPAWN_INTERVAL = 0.35;
const COP_COLOR = '#2456c4', BLOCK_COLOR = '#2a5aff';
const HELI_SPEED = 260, HELI_OFFSET = 150, BLOCK_MIN = 400, BLOCK_MAX = 700;

export function createPolice(world) {
  const state = { stars: 0, heat: 0, cars: [], evadeTimer: 0, lastSeen: null, evading: false, spawnTimer: 0, heli: null, blocks: [] };
  world.police = state;
  return state;
}

// Bintang = floor(heat/100) + 1 selama heat > 0: 1-99 -> 1, 100-199 -> 2, 200-299 -> 3, 300-399 -> 4, 400+ -> 5.
function starsFromHeat(heat) {
  return Math.max(0, Math.min(5, Math.floor(heat / 100) + (heat > 0 ? 1 : 0)));
}

export function addHeat(world, amount, reason) {
  const state = world.police;
  state.heat = Math.max(0, Math.min(MAX_HEAT, state.heat + amount));
  state.lastReason = reason;
  const stars = starsFromHeat(state.heat);
  if (stars !== state.stars) { state.stars = stars; state.evading = false; state.evadeTimer = 0; }
}

function focusOf(player) {
  return player.car || player;
}

export function updateWanted(state, player, dt) {
  const focus = focusOf(player);
  const near = state.cars.some((cop) => Math.hypot(cop.x - focus.x, cop.y - focus.y) < NEAR_COP_RANGE);
  if (state.heat <= 0) { state.stars = 0; state.evadeTimer = 0; state.evading = false; return; }

  if (near) {
    state.evadeTimer = 0;
    state.evading = false;
    return;
  }

  state.heat = Math.max(0, state.heat - HEAT_DECAY * dt);
  const decayedStars = starsFromHeat(state.heat);
  if (decayedStars !== state.stars) { state.stars = decayedStars; state.evading = false; state.evadeTimer = 0; }
  if (state.stars === 0) return;

  if (!state.evading) {
    state.evading = true;
    state.evadeTimer = EVADE_SECONDS[state.stars - 1];
    return;
  }
  state.evadeTimer -= dt;
  if (state.evadeTimer > 0) return;
  const lowered = state.stars - 1;
  state.heat = lowered > 0 ? (lowered - 1) * 100 + 50 : 0;
  state.stars = lowered;
  state.evading = false;
  state.evadeTimer = 0;
}

export function hasLineOfSight(world, ax, ay, bx, by) {
  let tx = Math.floor(ax / TILE), ty = Math.floor(ay / TILE);
  const endX = Math.floor(bx / TILE), endY = Math.floor(by / TILE);
  const dx = bx - ax, dy = by - ay;
  const stepX = Math.sign(dx), stepY = Math.sign(dy);
  const deltaX = dx !== 0 ? TILE / Math.abs(dx) : Infinity;
  const deltaY = dy !== 0 ? TILE / Math.abs(dy) : Infinity;
  let maxX = dx > 0 ? ((tx + 1) * TILE - ax) / dx : dx < 0 ? (tx * TILE - ax) / dx : Infinity;
  let maxY = dy > 0 ? ((ty + 1) * TILE - ay) / dy : dy < 0 ? (ty * TILE - ay) / dy : Infinity;

  for (let guard = 0; guard < 400; guard++) {
    if (tileAt(world, tx * TILE + 1, ty * TILE + 1) === T.BUILDING) return false;
    if (tx === endX && ty === endY) return true;
    if (maxX < maxY) { tx += stepX; maxX += deltaX; } else { ty += stepY; maxY += deltaY; }
  }
  return true;
}

function hitsBuilding(car, world) {
  const cos = Math.cos(car.angle), sin = Math.sin(car.angle);
  for (const [lx, ly] of [[HALF_LENGTH, HALF_WIDTH], [HALF_LENGTH, -HALF_WIDTH], [-HALF_LENGTH, HALF_WIDTH], [-HALF_LENGTH, -HALF_WIDTH]]) {
    if (tileAt(world, car.x + lx * cos - ly * sin, car.y + lx * sin + ly * cos) === T.BUILDING) return true;
  }
  return false;
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function moveCar(car, world, dt) {
  const previous = { x: car.x, y: car.y, angle: car.angle };
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  if (!hitsBuilding(car, world)) return;
  car.x = previous.x; car.y = previous.y; car.angle = previous.angle;
  car.speed = 0;
  car.backoff = 0.6;
}

function approachSpeed(car, desired, dt) {
  if (car.speed < desired) car.speed = Math.min(desired, car.speed + ACCEL * dt);
  else car.speed = Math.max(desired, car.speed - BRAKE * dt);
}

function centerOfRoad(index) {
  return Math.max(0, Math.min(7, index)) * ROAD_PERIOD + TILE;
}

function roadWaypoint(car, targetX, targetY) {
  const onHorizontal = Math.floor(car.y / TILE) % 10 < 2, onVertical = Math.floor(car.x / TILE) % 10 < 2;
  const dx = targetX - car.x, dy = targetY - car.y;
  const signX = dx >= 0 ? 1 : -1, signY = dy >= 0 ? 1 : -1;
  const blockX = Math.floor(car.x / ROAD_PERIOD), blockY = Math.floor(car.y / ROAD_PERIOD);
  if (onHorizontal && !onVertical) return [centerOfRoad(blockX + (signX > 0 ? 1 : 0)), car.y];
  if (onVertical && !onHorizontal) return [car.x, centerOfRoad(blockY + (signY > 0 ? 1 : 0))];
  if (onHorizontal && onVertical) {
    return Math.abs(dx) > Math.abs(dy)
      ? [centerOfRoad(blockX + signX), centerOfRoad(blockY)]
      : [centerOfRoad(blockX), centerOfRoad(blockY + signY)];
  }
  const roadY = centerOfRoad(Math.round((car.y - TILE) / ROAD_PERIOD)), roadX = centerOfRoad(Math.round((car.x - TILE) / ROAD_PERIOD));
  return Math.abs(roadY - car.y) < Math.abs(roadX - car.x) ? [car.x, roadY] : [roadX, car.y];
}

function chase(car, world, focus, stars, dt) {
  const velocityX = focus.vx ?? 0, velocityY = focus.vy ?? 0;
  const playerSpeed = focus.speed !== undefined ? Math.abs(focus.speed) : Math.hypot(velocityX, velocityY);
  const aheadX = focus.vx !== undefined ? focus.vx : Math.cos(focus.angle) * focus.speed;
  const aheadY = focus.vy !== undefined ? focus.vy : Math.sin(focus.angle) * focus.speed;
  const predictedX = focus.x + 0.4 * aheadX, predictedY = focus.y + 0.4 * aheadY;
  const distance = Math.hypot(focus.x - car.x, focus.y - car.y);
  const visible = hasLineOfSight(world, car.x, car.y, predictedX, predictedY);
  const [targetX, targetY] = visible ? [predictedX, predictedY] : roadWaypoint(car, focus.x, focus.y);

  const diff = normalizeAngle(Math.atan2(targetY - car.y, targetX - car.x) - car.angle);
  if (car.backoff > 0) {
    car.backoff -= dt;
    car.speed = -70;
    car.angle += Math.sign(diff || 1) * 2 * dt;
    moveCar(car, world, dt);
    return;
  }
  const grip = Math.max(0.35, Math.min(1, Math.abs(car.speed) / 120));
  const turn = TURN_RATE * dt * grip;
  car.angle += Math.max(-turn, Math.min(turn, diff));

  let desired = MAX_SPEED[stars];
  if (Math.abs(diff) > 1.2) desired *= 0.45;
  if (visible && distance < 90) desired = Math.min(desired, playerSpeed * 0.9 + 20);
  approachSpeed(car, desired, dt);
  moveCar(car, world, dt);
}

function assignLane(car) {
  const horizontal = Math.abs(Math.cos(car.angle)) >= Math.abs(Math.sin(car.angle));
  const cross = horizontal ? car.y : car.x;
  const roadStart = Math.floor(cross / ROAD_PERIOD) * ROAD_PERIOD;
  car.axis = horizontal ? 'h' : 'v';
  car.dir = (horizontal ? Math.cos(car.angle) : Math.sin(car.angle)) >= 0 ? 1 : -1;
  car.lane = roadStart + (cross - roadStart < TILE ? LANE_NEAR : LANE_FAR);
}

function patrol(car, world, dt) {
  if (!car.axis) assignLane(car);
  if (car.backoff > 0) {
    car.backoff -= dt;
    car.speed = -50;
    car.angle += 1.5 * dt;
    moveCar(car, world, dt);
    return;
  }
  const horizontal = car.axis === 'h';
  const targetX = horizontal ? car.x + car.dir * 40 : car.lane;
  const targetY = horizontal ? car.lane : car.y + car.dir * 40;
  const diff = normalizeAngle(Math.atan2(targetY - car.y, targetX - car.x) - car.angle);
  const turn = 2.4 * dt;
  car.angle += Math.max(-turn, Math.min(turn, diff));

  const blocked = blockedByCar(car, world);
  approachSpeed(car, blocked ? 0 : PATROL_SPEED, dt);
  moveCar(car, world, dt);

  const limit = world.width - 30;
  if (horizontal) { if (car.x > limit) car.x = 30; else if (car.x < 30) car.x = limit; }
  else if (car.y > limit) car.y = 30; else if (car.y < 30) car.y = limit;
}

function blockedByCar(car, world) {
  for (const other of world.cars) {
    if (other === car) continue;
    const dx = other.x - car.x, dy = other.y - car.y;
    if (dx * dx + dy * dy > 50 * 50) continue;
    if (Math.abs(normalizeAngle(Math.atan2(dy, dx) - car.angle)) < 0.6) return true;
  }
  return false;
}

function nearCar(world, x, y) {
  return world.cars.some((other) => Math.hypot(other.x - x, other.y - y) < 80);
}

function laneAngle(point) {
  return point.horizontal ? (point.dir > 0 ? 0 : Math.PI) : (point.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
}

function trySpawn(state, world, focus, facing) {
  const fx = Math.cos(facing), fy = Math.sin(facing);
  const behind = [], hidden = [], ring = [];
  for (const point of world.lanePoints) {
    const ox = point.x - focus.x, oy = point.y - focus.y;
    const distance = Math.hypot(ox, oy);
    if (distance < SPAWN_MIN || distance > SPAWN_MAX) continue;
    const dot = (ox * fx + oy * fy) / distance;
    ring.push(point);
    if (dot < 0.2) { hidden.push(point); if (dot < -0.2) behind.push(point); }
  }
  for (const pool of [behind, hidden, ring]) {
    for (let attempt = 0; attempt < 8 && pool.length; attempt++) {
      const point = pool[Math.floor(Math.random() * pool.length)];
      if (nearCar(world, point.x, point.y)) continue;
      const cop = { x: point.x, y: point.y, angle: laneAngle(point), speed: 100, color: COP_COLOR, driver: 'cop', state: 'PATROL', axis: point.horizontal ? 'h' : 'v', lane: point.horizontal ? point.y : point.x, dir: point.dir, backoff: 0 };
      world.cars.push(cop);
      state.cars.push(cop);
      return;
    }
  }
}

function removeCar(world, car) {
  const index = world.cars.indexOf(car);
  if (index >= 0) world.cars.splice(index, 1);
}

function updateHeli(state, world, focus, facing, dt) {
  if (state.stars < 5) { state.heli = null; return; }
  const targetX = focus.x + Math.cos(facing) * HELI_OFFSET, targetY = focus.y + Math.sin(facing) * HELI_OFFSET;
  if (!state.heli) {
    const away = Math.random() * Math.PI * 2;
    state.heli = { x: focus.x + Math.cos(away) * 600, y: focus.y + Math.sin(away) * 600, z: 200, angle: 0, rotor: 0 };
  }
  const heli = state.heli;
  const dx = targetX - heli.x, dy = targetY - heli.y, distance = Math.hypot(dx, dy);
  if (distance > 0.001) {
    const step = Math.min(distance, HELI_SPEED * dt);
    heli.x += dx / distance * step;
    heli.y += dy / distance * step;
    if (distance > 20) heli.angle = Math.atan2(dy, dx);
  }
  heli.rotor += 30 * dt;
}

function updateRoadblock(state, world, focus, facing) {
  if (state.stars < 5) {
    for (const car of state.blocks) removeCar(world, car);
    state.blocks.length = 0;
    return;
  }
  for (let i = state.blocks.length - 1; i >= 0; i--) {
    if (Math.hypot(state.blocks[i].x - focus.x, state.blocks[i].y - focus.y) > DESPAWN_RANGE) {
      removeCar(world, state.blocks[i]);
      state.blocks.splice(i, 1);
    }
  }
  if (state.blocks.length > 0) return;
  const fx = Math.cos(facing), fy = Math.sin(facing);
  const candidates = world.lanePoints.filter((point) => {
    const ox = point.x - focus.x, oy = point.y - focus.y;
    const distance = Math.hypot(ox, oy);
    return distance >= BLOCK_MIN && distance <= BLOCK_MAX && (ox * fx + oy * fy) / distance > 0.5;
  });
  while (candidates.length) {
    const point = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0];
    const mate = world.lanePoints.find((other) => other.horizontal === point.horizontal && other.dir !== point.dir
      && Math.abs((point.horizontal ? other.x - point.x : other.y - point.y)) < 1
      && Math.abs((point.horizontal ? other.y - point.y : other.x - point.x)) <= 40);
    if (!mate || nearCar(world, point.x, point.y) || nearCar(world, mate.x, mate.y)) continue;
    for (const spot of [point, mate]) {
      const car = { x: spot.x, y: spot.y, angle: laneAngle(spot) + Math.PI / 2, speed: 0, color: BLOCK_COLOR, driver: 'cop', state: 'BLOCK', backoff: 0 };
      world.cars.push(car);
      state.blocks.push(car);
    }
    return;
  }
}

export function updatePolice(state, world, player, dt) {
  const focus = focusOf(player);
  const facing = player.car ? player.car.angle : player.facing;
  state.spawnTimer -= dt;

  if (state.cars.length < COP_COUNT[state.stars] && state.spawnTimer <= 0) {
    state.spawnTimer = SPAWN_INTERVAL;
    trySpawn(state, world, focus, facing);
  }

  let seen = false;
  for (let i = state.cars.length - 1; i >= 0; i--) {
    const cop = state.cars[i];
    if (Math.hypot(cop.x - focus.x, cop.y - focus.y) > DESPAWN_RANGE) {
      state.cars.splice(i, 1);
      removeCar(world, cop);
      continue;
    }
    if (state.stars > 0) {
      if (cop.state !== 'CHASE') cop.state = 'CHASE';
      chase(cop, world, player.car ? player.car : { ...player }, state.stars, dt);
      if (hasLineOfSight(world, cop.x, cop.y, focus.x, focus.y) && Math.hypot(cop.x - focus.x, cop.y - focus.y) < 600) seen = true;
    } else {
      if (cop.state !== 'PATROL') { cop.state = 'PATROL'; assignLane(cop); }
      patrol(cop, world, dt);
    }
  }
  updateHeli(state, world, focus, facing, dt);
  updateRoadblock(state, world, focus, facing);
  if (seen) state.lastSeen = { x: focus.x, y: focus.y, time: world.time };
  else if (state.stars === 0) state.lastSeen = null;
}
