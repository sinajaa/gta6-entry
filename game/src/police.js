// police.js — level buruan dan polisi AI pengejar
// Sistem buruan dan polisi AI ini murni buatan penulis entry.
import { TILE, T, tileAt } from './world.js';

// --- Konstanta jalan & ukuran kendaraan ---
const ROAD_PERIOD = 10 * TILE, ROAD_WIDTH = 2 * TILE, LANE_NEAR = 16, LANE_FAR = 48;
const HALF_LENGTH = 18, HALF_WIDTH = 9;

// --- Konstanta fisika kendaraan ---
const ACCEL = 260, BRAKE = 420, PATROL_SPEED = 130, TURN_RATE = 3.2;

// --- Konstanta level buruan (indeks = bintang) ---
const MAX_SPEED = [0, 240, 290, 320, 330, 360];
const COP_COUNT = [0, 1, 2, 3, 4, 5];
const EVADE_SECONDS = [10, 14, 18, 24, 30];
const MAX_HEAT = 500, HEAT_DECAY = 6, NEAR_COP_RANGE = 450;

// --- Konstanta spawn & despawn ---
const SPAWN_MIN = 450, SPAWN_MAX = 950, DESPAWN_RANGE = 1700, SPAWN_INTERVAL = 0.35;

// --- Konstanta visual kendaraan polisi ---
const COP_COLOR = '#2456c4', BLOCK_COLOR = '#2a5aff';

// --- Konstanta helikopter ---
const HELI_SPEED = 260, HELI_OFFSET = 150;

// --- Konstanta barikade jalan ---
const BLOCK_MIN = 400, BLOCK_MAX = 700;

// --- Konstanta manuver PIT ---
const PIT_RANGE = 60, PIT_ANGLE = 0.7, PIT_SPIN = 0.9, PIT_COOLDOWN = 3;

// --- Konstanta paku ranjau ---
const SPIKE_AHEAD_MIN = 170, SPIKE_AHEAD_MAX = 330, SPIKE_MAX = 6, SPIKE_LIFE = 14, SPIKE_CLEAR = 48;

// Batas iterasi DDA pengecekan line-of-sight; mencegah loop tak berujung pada sinar degenerasi.
const LOS_STEPS = 400;

// --- Konstanta polisi berjalan kaki ---
const FOOT_WALK = 2, FOOT_RUN = 95, FOOT_ARRIVE = 150;
const LOOP_MIN = 3 * ROAD_PERIOD + TILE, LOOP_MAX = 4 * ROAD_PERIOD + TILE;
const LOOP = [[LOOP_MIN, LOOP_MIN], [LOOP_MAX, LOOP_MIN], [LOOP_MAX, LOOP_MAX], [LOOP_MIN, LOOP_MAX]];

// --- Alur kecil: pembentukan data ---

function makeOfficers() {
  return [0, 2].map((corner) => ({
    x: LOOP[corner][0], y: LOOP[corner][1],
    target: (corner + 1) % 4, angle: 0, running: false,
  }));
}

function makeState() {
  return {
    stars: 0, heat: 0, cars: [], evadeTimer: 0, lastSeen: null, evading: false,
    spawnTimer: 0, heli: null, blocks: [], spikes: [], pitCooldown: 0, officers: makeOfficers(),
  };
}

function makeCopCar(x, y, angle, speed, color, driver, state) {
  return { x, y, angle, speed, color, driver, state, backoff: 0 };
}

// --- Alur kecil: transformasi numerik ---

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

// Bintang = floor(heat/100) + 1 selama heat > 0: 1-99 -> 1, 100-199 -> 2, 200-299 -> 3, 300-399 -> 4, 400+ -> 5.
function starsFromHeat(heat) {
  return heat <= 0 ? 0 : clamp(Math.floor(heat / 100) + 1, 1, 5);
}

function focusOf(player) {
  return player.car || player;
}

function facingOf(player) {
  return player.car ? player.car.angle : player.facing;
}

function distanceOf(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// --- Alur kecil: deteksi tabrakan & line-of-sight ---

function hitsBuilding(car, world) {
  const cos = Math.cos(car.angle), sin = Math.sin(car.angle);
  const corners = [
    [HALF_LENGTH, HALF_WIDTH], [HALF_LENGTH, -HALF_WIDTH],
    [-HALF_LENGTH, HALF_WIDTH], [-HALF_LENGTH, -HALF_WIDTH],
  ];
  for (const [lx, ly] of corners) {
    if (tileAt(world, car.x + lx * cos - ly * sin, car.y + lx * sin + ly * cos) === T.BUILDING) return true;
  }
  return false;
}

export function hasLineOfSight(world, ax, ay, bx, by) {
  const startX = Math.floor(ax / TILE), startY = Math.floor(ay / TILE);
  const endX = Math.floor(bx / TILE), endY = Math.floor(by / TILE);
  const dx = bx - ax, dy = by - ay;

  if (dx === 0 && dy === 0) return tileAt(world, ax, ay) !== T.BUILDING;

  const stepX = Math.sign(dx), stepY = Math.sign(dy);
  const invX = dx !== 0 ? TILE / Math.abs(dx) : Infinity;
  const invY = dy !== 0 ? TILE / Math.abs(dy) : Infinity;
  let maxX = dx > 0 ? ((startX + 1) * TILE - ax) / dx : dx < 0 ? (startX * TILE - ax) / dx : Infinity;
  let maxY = dy > 0 ? ((startY + 1) * TILE - ay) / dy : dy < 0 ? (startY * TILE - ay) / dy : Infinity;

  let tx = startX, ty = startY;
  for (let guard = 0; guard < LOS_STEPS; guard++) {
    if (tileAt(world, tx * TILE + 1, ty * TILE + 1) === T.BUILDING) return false;
    if (tx === endX && ty === endY) return true;
    if (maxX < maxY) { tx += stepX; maxX += invX; } else { ty += stepY; maxY += invY; }
  }
  return true;
}

// --- Alur kecil: geometeri jalan & rute ---

function roadIndex(coord) {
  return clamp(Math.floor(coord / ROAD_PERIOD), 0, 7);
}

function centerOfRoad(index) {
  return roadIndex(index) * ROAD_PERIOD + TILE;
}

function laneAngleOf(point) {
  if (point.horizontal) return point.dir > 0 ? 0 : Math.PI;
  return point.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
}

function assignLane(car) {
  const horizontal = Math.abs(Math.cos(car.angle)) >= Math.abs(Math.sin(car.angle));
  const cross = horizontal ? car.y : car.x;
  const roadStart = Math.floor(cross / ROAD_PERIOD) * ROAD_PERIOD;
  car.axis = horizontal ? 'h' : 'v';
  car.dir = (horizontal ? Math.cos(car.angle) : Math.sin(car.angle)) >= 0 ? 1 : -1;
  car.lane = roadStart + (cross - roadStart < TILE ? LANE_NEAR : LANE_FAR);
}

function roadWaypoint(car, targetX, targetY) {
  const onHorizontal = Math.floor(car.y / TILE) % 10 < 2;
  const onVertical = Math.floor(car.x / TILE) % 10 < 2;
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
  const roadY = centerOfRoad(Math.round((car.y - TILE) / ROAD_PERIOD));
  const roadX = centerOfRoad(Math.round((car.x - TILE) / ROAD_PERIOD));
  return Math.abs(roadY - car.y) < Math.abs(roadX - car.x) ? [car.x, roadY] : [roadX, car.y];
}

// --- Alur kecil: penggerak kendaraan ---

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

function steerToward(car, targetX, targetY, maxTurn) {
  const diff = normalizeAngle(Math.atan2(targetY - car.y, targetX - car.x) - car.angle);
  car.angle += clamp(diff, -maxTurn, maxTurn);
}

function isBlockedByCar(car, world) {
  for (const other of world.cars) {
    if (other === car) continue;
    const dx = other.x - car.x, dy = other.y - car.y;
    if (dx * dx + dy * dy > 56 * 56) continue;
    if (Math.abs(normalizeAngle(Math.atan2(dy, dx) - car.angle)) < 0.5) return true;
  }
  return false;
}

function nearCar(world, x, y) {
  return world.cars.some((other) => Math.hypot(other.x - x, other.y - y) < 80);
}

function removeCar(world, car) {
  const index = world.cars.indexOf(car);
  if (index >= 0) world.cars.splice(index, 1);
}

// --- Alur kecil: mode mengemudi ---

function driveBackoff(car, world, dt, reverseSpeed, turnSpeed) {
  car.backoff -= dt;
  car.speed = reverseSpeed;
  car.angle += turnSpeed * dt;
  moveCar(car, world, dt);
}

function chase(car, world, focus, stars, dt) {
  if (car.backoff > 0) {
    driveBackoff(car, world, dt, -70, Math.sign(normalizeAngle(Math.atan2(
      focus.y - car.y, focus.x - car.x) - car.angle) || 1) * 2);
    return;
  }

  const hasVelocity = focus.vx !== undefined && focus.vy !== undefined;
  const aheadX = hasVelocity ? focus.vx : Math.cos(focus.angle) * focus.speed;
  const aheadY = hasVelocity ? focus.vy : Math.sin(focus.angle) * focus.speed;
  const predictedX = focus.x + 0.4 * aheadX, predictedY = focus.y + 0.4 * aheadY;
  const visible = hasLineOfSight(world, car.x, car.y, predictedX, predictedY);
  const [targetX, targetY] = visible ? [predictedX, predictedY] : roadWaypoint(car, focus.x, focus.y);
  const distance = distanceOf(focus, car);
  const playerSpeed = hasVelocity ? Math.hypot(focus.vx, focus.vy) : Math.abs(focus.speed);

  const diff = normalizeAngle(Math.atan2(targetY - car.y, targetX - car.x) - car.angle);
  const grip = clamp(Math.abs(car.speed) / 120, 0.35, 1);
  steerToward(car, targetX, targetY, TURN_RATE * dt * grip);

  let desired = MAX_SPEED[stars];
  if (Math.abs(diff) > 1.2) desired *= 0.45;
  if (visible && distance < 90) desired = Math.min(desired, playerSpeed * 0.9 + 20);
  approachSpeed(car, desired, dt);
  moveCar(car, world, dt);
}

function patrol(car, world, dt) {
  if (!car.axis) assignLane(car);
  if (car.backoff > 0) {
    driveBackoff(car, world, dt, -50, 1.5);
    return;
  }
  const horizontal = car.axis === 'h';
  const targetX = horizontal ? car.x + car.dir * 40 : car.lane;
  const targetY = horizontal ? car.lane : car.y + car.dir * 40;
  steerToward(car, targetX, targetY, 2.4 * dt);
  approachSpeed(car, isBlockedByCar(car, world) ? 0 : PATROL_SPEED, dt);
  moveCar(car, world, dt);

  const limit = world.width - 30;
  if (horizontal) car.x = car.x > limit ? 30 : car.x < 30 ? limit : car.x;
  else car.y = car.y > limit ? 30 : car.y < 30 ? limit : car.y;
}

function blockAhead(cop, world, focus, facing, dt) {
  const aheadX = focus.x + Math.cos(facing) * 170, aheadY = focus.y + Math.sin(facing) * 170;
  const dx = aheadX - cop.x, dy = aheadY - cop.y;
  const near = Math.hypot(dx, dy) < 90;
  const targetAngle = near ? facing + Math.PI / 2 : Math.atan2(dy, dx);
  const diff = normalizeAngle(targetAngle - cop.angle);
  cop.angle += clamp(diff, -2.6 * dt, 2.6 * dt);
  approachSpeed(cop, near && Math.hypot(dx, dy) < 55 ? 0 : 150, dt);
  moveCar(cop, world, dt);
}

function pitManeuver(cop, state, world, player, dt) {
  const target = player.car;
  if (!target) return chase(cop, world, player, state.stars, dt);
  const behindX = target.x - Math.cos(target.angle) * 34, behindY = target.y - Math.sin(target.angle) * 34;
  const targetAngle = Math.atan2(behindY - cop.y, behindX - cop.x);
  steerToward(cop, behindX, behindY, 3.0 * dt);
  approachSpeed(cop, 205, dt);
  moveCar(cop, world, dt);

  const dist = distanceOf(target, cop);
  const rel = normalizeAngle(target.angle - cop.angle);
  if (dist < PIT_RANGE && Math.abs(Math.sin(rel)) > PIT_ANGLE && state.pitCooldown <= 0) {
    const side = Math.sign(Math.sin(targetAngle - target.angle)) || 1;
    target.angle += side * PIT_SPIN;
    target.speed *= 0.5;
    state.pitCooldown = PIT_COOLDOWN;
    addHeat(world, 15, 'PIT');
  }
}

// --- Alur kecil: pelengkap pengejaran (spawn, heli, barikade, peran, paku) ---

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
      const cop = makeCopCar(point.x, point.y, laneAngleOf(point), 100, COP_COLOR, 'cop', 'PATROL');
      cop.axis = point.horizontal ? 'h' : 'v';
      cop.lane = point.horizontal ? point.y : point.x;
      cop.dir = point.dir;
      world.cars.push(cop);
      state.cars.push(cop);
      return;
    }
  }
}

function updateHeli(state, focus, facing, dt) {
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

function hasMate(spikes, world, point) {
  const mate = world.lanePoints.find((other) =>
    other.horizontal === point.horizontal && other.dir !== point.dir
    && Math.abs((point.horizontal ? other.x - point.x : other.y - point.y)) < 1
    && Math.abs((point.horizontal ? other.y - point.y : other.x - point.x)) <= 40);
  if (!mate || nearCar(world, point.x, point.y) || nearCar(world, mate.x, mate.y)) return null;
  return mate;
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
    const mate = hasMate(state, world, point);
    if (!mate) continue;
    for (const spot of [point, mate]) {
      const car = makeCopCar(spot.x, spot.y, laneAngleOf(spot) + Math.PI / 2, 0, BLOCK_COLOR, 'cop', 'BLOCK');
      world.cars.push(car);
      state.blocks.push(car);
    }
    return;
  }
}

function assignRoles(state, focus, facing) {
  const fx = Math.cos(facing), fy = Math.sin(facing);
  let blocker = null, pitter = null, blockScore = -Infinity, pitScore = -Infinity;
  for (const cop of state.cars) {
    if (cop.state !== 'CHASE') continue;
    cop.role = 'CHASE';
    const proj = (cop.x - focus.x) * fx + (cop.y - focus.y) * fy;
    if (proj > 50 && proj > blockScore) { blockScore = proj; blocker = cop; }
    if (proj < -30 && proj < pitScore) { pitScore = proj; pitter = cop; }
  }
  if (blocker) blocker.role = 'BLOCK';
  if (pitter && pitter !== blocker) pitter.role = 'PIT';
}

function updateSpikes(state, world, player, dt) {
  const focus = focusOf(player);
  const car = player.car;
  for (let i = state.spikes.length - 1; i >= 0; i--) {
    state.spikes[i].life -= dt;
    if (state.spikes[i].life <= 0 || Math.hypot(state.spikes[i].x - focus.x, state.spikes[i].y - focus.y) > DESPAWN_RANGE) {
      state.spikes.splice(i, 1);
    }
  }
  if (!car) { state.spikes.length = 0; return; }
  if (state.stars < 3) return;

  if (state.spikes.length < SPIKE_MAX) {
    const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    const along = SPIKE_AHEAD_MIN + Math.random() * (SPIKE_AHEAD_MAX - SPIKE_AHEAD_MIN);
    const sx = car.x + fx * along, sy = car.y + fy * along;
    const ground = tileAt(world, sx, sy);
    const clear = !state.spikes.some((s) => Math.hypot(s.x - sx, s.y - sy) < SPIKE_CLEAR);
    if ((ground === T.ROAD || ground === T.SIDEWALK) && clear) {
      state.spikes.push({ x: sx, y: sy, angle: car.angle, life: SPIKE_LIFE, hit: false });
    }
  }
  for (const s of state.spikes) {
    if (!s.hit && distanceOf(s, car) < 24) {
      s.hit = true;
      car.flatT = 3 + Math.random() * 2;
      addHeat(world, 10, 'spike');
    }
  }
}

// --- Alur kecil: polisi berjalan kaki ---

function updateOfficers(state, focus, dt) {
  const carArrived = state.cars.some((cop) => distanceOf(cop, focus) < FOOT_ARRIVE);
  const chasing = state.stars > 0 && !carArrived;
  for (const o of state.officers) {
    o.running = chasing;
    const [tx, ty] = chasing ? [focus.x, focus.y] : LOOP[o.target];
    const dx = tx - o.x, dy = ty - o.y, dist = Math.hypot(dx, dy);
    const step = (chasing ? FOOT_RUN : FOOT_WALK) * dt;
    if (dist > 0.001) {
      o.angle = Math.atan2(dy, dx);
      if (chasing && dist < 14) continue;
      const move = Math.min(step, dist);
      o.x += dx / dist * move;
      o.y += dy / dist * move;
    }
    if (!chasing && dist <= step) o.target = (o.target + 1) % 4;
  }
}

// --- API publik ---

export function createPolice(world) {
  const state = makeState();
  world.police = state;
  return state;
}

export function addHeat(world, amount, reason) {
  const state = world.police;
  state.heat = clamp(state.heat + amount, 0, MAX_HEAT);
  state.lastReason = reason;
  const stars = starsFromHeat(state.heat);
  if (stars !== state.stars) { state.stars = stars; state.evading = false; state.evadeTimer = 0; }
}

export function updateWanted(state, player, dt) {
  if (state.heat <= 0) { state.stars = 0; state.evadeTimer = 0; state.evading = false; return; }

  const focus = focusOf(player);
  const near = state.cars.some((cop) => distanceOf(cop, focus) < NEAR_COP_RANGE);
  if (near) { state.evadeTimer = 0; state.evading = false; return; }

  state.heat = Math.max(0, state.heat - HEAT_DECAY * dt);
  const decayedStars = starsFromHeat(state.heat);
  if (decayedStars !== state.stars) { state.stars = decayedStars; state.evading = false; state.evadeTimer = 0; }
  if (state.stars === 0) return;

  if (!state.evading) { state.evading = true; state.evadeTimer = EVADE_SECONDS[state.stars - 1]; return; }
  state.evadeTimer -= state.shield ? dt * 2 : dt;
  if (state.evadeTimer > 0) return;

  const lowered = state.stars - 1;
  state.heat = lowered > 0 ? (lowered - 1) * 100 + 50 : 0;
  state.stars = lowered;
  state.evading = false;
  state.evadeTimer = 0;
}

export function updatePolice(state, world, player, dt) {
  const focus = focusOf(player);
  const facing = facingOf(player);
  state.spawnTimer -= dt;
  state.pitCooldown = Math.max(0, state.pitCooldown - dt);

  if (state.cars.length < COP_COUNT[state.stars] && state.spawnTimer <= 0) {
    state.spawnTimer = SPAWN_INTERVAL;
    trySpawn(state, world, focus, facing);
  }
  if (state.stars > 0) assignRoles(state, focus, facing);

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
      if (cop.role === 'PIT') pitManeuver(cop, state, world, player, dt);
      else if (cop.role === 'BLOCK') blockAhead(cop, world, focus, facing, dt);
      else chase(cop, world, player.car || player, state.stars, dt);
      if (hasLineOfSight(world, cop.x, cop.y, focus.x, focus.y) && Math.hypot(cop.x - focus.x, cop.y - focus.y) < 600) seen = true;
    } else {
      if (cop.state !== 'PATROL') { cop.state = 'PATROL'; assignLane(cop); }
      patrol(cop, world, dt);
    }
  }
  updateOfficers(state, focus, dt);
  updateSpikes(state, world, player, dt);
  updateHeli(state, focus, facing, dt);
  updateRoadblock(state, world, focus, facing);
  if (seen) state.lastSeen = { x: focus.x, y: focus.y, time: world.time };
  else if (state.stars === 0) state.lastSeen = null;
}