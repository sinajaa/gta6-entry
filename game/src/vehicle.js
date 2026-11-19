// vehicle.js — mobil, fisika mengemudi, dan lalu lintas NPC
// Fisika mobil dan lalu lintas NPC dikembangkan sendiri dari awal.
import { TILE, T, tileAt } from './world.js';

const ACCEL = 260, BRAKE = 420, DRAG = 0.9, TURN = 2.4, MAX = 320, REVERSE_MAX = -90;
const CRUISE = 130, NPC_COUNT = 28, LOOKAHEAD = 40, FOLLOW_DISTANCE = 50, FOLLOW_ANGLE = 0.6;
const ENTER_RANGE = 60, SPAWN_CAR_RADIUS = 40, HALF_LENGTH = 18, HALF_WIDTH = 9;
const ROAD_PERIOD = 10 * TILE, ROAD_WIDTH = 2 * TILE, PHASE_SECONDS = 6, STOP_MARGIN = 6;
const COLORS = ['#e4572e', '#f3a712', '#29a3a3', '#4f86f7', '#e86a92', '#7bc950', '#f5d547', '#a06cd5'];
const PARKED_SPOTS = [[400, 400, 0], [560, 400, Math.PI], [400, 520, Math.PI / 2], [304, 520, -Math.PI / 2]];

function seededRandom(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function makeCar(x, y, angle, color, driver) {
  return { x, y, angle, speed: 0, color, driver };
}

function parkedNearSpawn(world, spawnX, spawnY) {
  const isRoad = (x, y) => tileAt(world, x, y) === T.ROAD;
  let best = null, bestDistance = Infinity;
  for (let dy = -SPAWN_CAR_RADIUS; dy <= SPAWN_CAR_RADIUS; dy += TILE) {
    for (let dx = -SPAWN_CAR_RADIUS; dx <= SPAWN_CAR_RADIUS; dx += TILE) {
      const x = Math.floor((spawnX + dx) / TILE) * TILE + TILE / 2;
      const y = Math.floor((spawnY + dy) / TILE) * TILE + TILE / 2;
      const distance = Math.hypot(x - spawnX, y - spawnY);
      if (distance >= bestDistance || distance > SPAWN_CAR_RADIUS || !isRoad(x, y)) continue;
      best = { x, y }; bestDistance = distance;
    }
  }
  if (!best) return null;
  const alongX = isRoad(best.x - TILE, best.y) && isRoad(best.x + TILE, best.y);
  const alongY = isRoad(best.x, best.y - TILE) && isRoad(best.x, best.y + TILE);
  const angle = alongX && !alongY ? 0 : Math.PI / 2;
  return makeCar(best.x, best.y, angle, COLORS[0], null);
}

export function createCars(world, spawnX, spawnY) {
  const rand = seededRandom(2026);
  const cars = [];
  PARKED_SPOTS.forEach(([x, y, angle], i) => cars.push(makeCar(x, y, angle, COLORS[i * 2 % COLORS.length], null)));

  const spawnCar = parkedNearSpawn(world, spawnX, spawnY);
  if (spawnCar) cars.push(spawnCar);

  let attempts = 0;
  while (cars.length < PARKED_SPOTS.length + NPC_COUNT && attempts++ < 500) {
    const axis = rand() < 0.5 ? 'h' : 'v';
    const roadStart = Math.floor(rand() * (world.width / ROAD_PERIOD)) * ROAD_PERIOD;
    const positiveLane = rand() < 0.5;
    const lane = roadStart + (positiveLane === (axis === 'h') ? 48 : 16);
    const dir = positiveLane ? 1 : -1;
    const along = 40 + rand() * (world.width - 80);
    const inIntersection = along % ROAD_PERIOD < ROAD_WIDTH + 40 || along % ROAD_PERIOD > ROAD_PERIOD - 40;
    if (inIntersection) continue;
    const x = axis === 'h' ? along : lane, y = axis === 'h' ? lane : along;
    if (Math.hypot(x - spawnX, y - spawnY) < 200) continue;
    if (cars.some((c) => Math.hypot(c.x - x, c.y - y) < 80)) continue;
    const angle = axis === 'h' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    const car = makeCar(x, y, angle, COLORS[Math.floor(rand() * COLORS.length)], 'npc');
    car.axis = axis; car.lane = lane; car.dir = dir; car.speed = CRUISE;
    cars.push(car);
  }
  world.cars = cars;
  world.time = 0;
}

export function updateDrivenCar(car, keys, world, dt) {
  const throttle = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 0.6 : 0);
  const steer = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const previous = { x: car.x, y: car.y, angle: car.angle };
  const boosting = car.nitro && car.nitroFuel > 0 && throttle > 0 && keys.has('shift');
  if (car.nitro) {
    car.nitroFuel = Math.max(0, Math.min(1, car.nitroFuel + (boosting ? -0.35 : 0.08) * dt));
  }
  const hpMax = car.maxHp || 100;
  const health = 0.6 + 0.4 * Math.max(0, Math.min(1, (car.hp ?? hpMax) / hpMax));
  const flat = Math.max(0, car.flatT ?? 0);
  if (flat > 0) car.flatT = flat - dt;
  const flatPenalty = flat > 0 ? 0.45 : 1;
  const top = (boosting ? MAX * 1.45 : MAX) * health * flatPenalty;

  car.speed += (throttle > 0 ? ACCEL * throttle * (boosting ? 2 : 1) : BRAKE * throttle) * dt;
  car.speed *= 1 - DRAG * dt;
  car.speed = Math.max(REVERSE_MAX, Math.min(top, car.speed));
  car.angle += steer * TURN * dt * (car.speed / MAX) * Math.sign(car.speed) + (flat > 0 ? Math.sin(world.time * 22) * 0.5 * dt : 0);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;

  if (hitsBuilding(car, world)) {
    car.x = previous.x; car.y = previous.y; car.angle = previous.angle;
    car.speed *= -0.25;
  }
}

function hitsBuilding(car, world) {
  const cos = Math.cos(car.angle), sin = Math.sin(car.angle);
  for (const [lx, ly] of [[HALF_LENGTH, HALF_WIDTH], [HALF_LENGTH, -HALF_WIDTH], [-HALF_LENGTH, HALF_WIDTH], [-HALF_LENGTH, -HALF_WIDTH]]) {
    if (tileAt(world, car.x + lx * cos - ly * sin, car.y + lx * sin + ly * cos) === T.BUILDING) return true;
  }
  return false;
}

export function updateTraffic(world, dt) {
  world.time += dt;
  for (const car of world.cars) {
    if (car.driver === 'npc') updateNpc(car, world, dt);
  }
}

function updateNpc(car, world, dt) {
  const horizontal = car.axis === 'h';
  const along = horizontal ? car.x : car.y;
  const targetX = horizontal ? car.x + car.dir * LOOKAHEAD : car.lane;
  const targetY = horizontal ? car.lane : car.y + car.dir * LOOKAHEAD;
  const wanted = Math.atan2(targetY - car.y, targetX - car.x);
  const diff = Math.atan2(Math.sin(wanted - car.angle), Math.cos(wanted - car.angle));
  const maxTurn = TURN * dt;
  car.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));

  const desired = blockedByCar(car, world) || mustStopAtLight(car, along, world.time) ? 0 : CRUISE;
  if (car.speed < desired) car.speed = Math.min(desired, car.speed + ACCEL * dt);
  else car.speed = Math.max(desired, car.speed - BRAKE * dt);

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;

  const limit = world.width - 30;
  if (horizontal) { if (car.x > limit) car.x = 30; else if (car.x < 30) car.x = limit; }
  else if (car.y > limit) car.y = 30; else if (car.y < 30) car.y = limit;
}

function blockedByCar(car, world) {
  for (const other of world.cars) {
    if (other === car) continue;
    const dx = other.x - car.x, dy = other.y - car.y;
    if (dx * dx + dy * dy > FOLLOW_DISTANCE * FOLLOW_DISTANCE) continue;
    const relative = Math.atan2(Math.sin(Math.atan2(dy, dx) - car.angle), Math.cos(Math.atan2(dy, dx) - car.angle));
    if (Math.abs(relative) < FOLLOW_ANGLE) return true;
  }
  return false;
}

function mustStopAtLight(car, along, time) {
  const greenAxis = Math.floor(time / PHASE_SECONDS) % 2 === 0 ? 'h' : 'v';
  if (greenAxis === car.axis) return false;
  const base = Math.floor(along / ROAD_PERIOD) * ROAD_PERIOD;
  const frontDistance = car.dir > 0
    ? base + ROAD_PERIOD - (along + HALF_LENGTH)
    : along - HALF_LENGTH - (along - base < ROAD_WIDTH ? base - ROAD_PERIOD + ROAD_WIDTH : base + ROAD_WIDTH);
  return frontDistance > -4 && frontDistance <= STOP_MARGIN + (car.speed * car.speed) / (2 * BRAKE);
}

export function nearestEnterable(world, player) {
  let best = null, bestDistance = ENTER_RANGE;
  for (const car of world.cars) {
    if (car.driver !== null) continue;
    const distance = Math.hypot(car.x - player.x, car.y - player.y);
    if (distance < bestDistance) { best = car; bestDistance = distance; }
  }
  return best;
}

export function toggleVehicle(world, player) {
  const car = player.car;
  if (!car) {
    const target = nearestEnterable(world, player);
    if (!target) return;
    target.driver = 'player';
    player.car = target;
    player.vx = 0; player.vy = 0;
    return;
  }
  const side = car.angle + Math.PI / 2;
  const exits = [1, -1].map((s) => [car.x + Math.cos(side) * s * 28, car.y + Math.sin(side) * s * 28]);
  const [exitX, exitY] = exits.find(([x, y]) => tileAt(world, x, y) !== T.BUILDING) || [car.x, car.y];
  player.x = exitX; player.y = exitY; player.vx = 0; player.vy = 0;
  car.driver = null;
  car.speed = 0;
  player.car = null;
}

export function carFocus(car) {
  return { x: car.x, y: car.y, vx: Math.cos(car.angle) * car.speed, vy: Math.sin(car.angle) * car.speed };
}
