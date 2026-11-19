// shots.js — adegan screenshot deterministik: ?shot=street|chase|firefight|driving (&seed=N)
// SUNNY CITY — authored pass 2026-11-19 (recording 03)
import * as THREE from '../vendor/three.module.min.js';
import { WORLD_W, WORLD_H } from './world.js';
import { addHeat } from './police.js';

const query = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const NAME = query.get('shot');
const SEED = parseInt(query.get('seed'), 10) || 20261119;
const HX = WORLD_W / 2, HY = WORLD_H / 2;
const COP_COLOR = '#2456c4';
const HALF_PI = Math.PI / 2;

if (NAME) {
  let s = SEED;
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function put(car, x, y, angle, speed) {
  car.x = x; car.y = y; car.angle = angle; car.speed = speed;
}

function setLane(car, axis, lane, dir) {
  car.axis = axis; car.lane = lane; car.dir = dir;
}

function addCop(c, x, y, angle, speed) {
  const horizontal = Math.abs(Math.cos(angle)) > 0.7;
  const cop = { x, y, angle, speed, color: COP_COLOR, driver: 'cop', state: c.police.stars > 0 ? 'CHASE' : 'PATROL', backoff: 0 };
  setLane(cop, horizontal ? 'h' : 'v', horizontal ? y : x, (horizontal ? Math.cos(angle) : Math.sin(angle)) >= 0 ? 1 : -1);
  c.world.cars.push(cop);
  c.police.cars.push(cop);
  return cop;
}

function wanted3(c) {
  addHeat(c.world, 200, 'shot');
  c.pinWanted = true;
}

function setHour(gfx, hour) {
  gfx.hour = hour; gfx.frozenHour = true; gfx.dayKey = null; gfx.skyHour = -1;
}

function lookFrom(cam, [x, h, y], [tx, th, ty], fov) {
  cam.position.set(x - HX, h, y - HY);
  cam.lookAt(tx - HX, th, ty - HY);
  if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
}

function freeCars(c) { return c.world.cars.filter((car) => car.driver === null); }
function npcCars(c) { return c.world.cars.filter((car) => car.driver === 'npc'); }

function enterCar(c, car, x, y, angle, speed) {
  c.player.car = car;
  car.driver = 'player';
  put(car, x, y, angle, speed);
  c.player.x = x; c.player.y = y; c.player.vx = 0; c.player.vy = 0;
}

function placePeds(c, spots) {
  spots.forEach(([x, y, angle], i) => {
    const p = c.peds[i];
    p.x = x; p.y = y; p.angle = angle; p.state = 'WALK'; p.speed = 55; p.timer = 6 + Math.random() * 4;
  });
}

const SHOTS = {
  street: {
    light: { hemi: 1.3, ambient: 0.5, sun: 4.2, exposure: 1.9 },
    hour: 17.5,
    setup(c) {
      const { player, world, police } = c;
      player.car = null;
      player.x = 1360; player.y = 1700; player.vx = 0; player.vy = 0; player.facing = -HALF_PI;
      world.time = 6.5;
      const cars = npcCars(c);
      const lineup = [
        [1328, 1470, -HALF_PI, 'v', 1328, -1], [1328, 1560, -HALF_PI, 'v', 1328, -1], [1328, 1730, -HALF_PI, 'v', 1328, -1],
        [1296, 1500, HALF_PI, 'v', 1296, 1], [1296, 1700, HALF_PI, 'v', 1296, 1],
      ];
      lineup.forEach(([x, y, a, axis, lane, dir], i) => { put(cars[i], x, y, a, 130); setLane(cars[i], axis, lane, dir); });
      const cop = addCop(c, 1296, 1420, HALF_PI, 130);
      setLane(cop, 'v', 1296, 1);
      police.stars = 0;
      const spots = [];
      for (let i = 0; i < 8; i++) spots.push([1360, 1400 + i * 24, i % 2 ? HALF_PI : -HALF_PI]);
      for (let i = 0; i < 6; i++) spots.push([1264, 1380 + i * 38, i % 2 ? -HALF_PI : HALF_PI]);
      for (let i = 0; i < 3; i++) spots.push([1360, 1690 + i * 28, -HALF_PI]);
      placePeds(c, spots);
    },
    camera(c, cam) {
      lookFrom(cam, [1372, 26, 1810], [1322, 62, 1380], 72);
    },
  },

  chase: {
    light: { hemi: 1.0, ambient: 0.45, sun: 1.2, exposure: 1.7 },
    hour: 21,
    setup(c) {
      const car = freeCars(c)[0];
      enterCar(c, car, 780, 1328, 0, 230);
      c.world.time = 0;
      wanted3(c);
      addCop(c, 690, 1328, 0, 240);
      addCop(c, 640, 1296, 0, 240);
    },
    tick(c) {
      const car = c.player.car;
      c.keys.add('w');
      car.y = 1328; car.angle = 0;
      c.player.x = car.x; c.player.y = car.y;
      if (car.x > 2100) car.x -= 1400;
    },
    camera(c, cam) {
      const car = c.player.car;
      const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
      lookFrom(cam, [car.x - fx * 96 - fy * 14, 40, car.y - fy * 96 + fx * 14], [car.x + fx * 120, 18, car.y + fy * 120], 74);
    },
  },

  firefight: {
    light: { hemi: 1.3, ambient: 0.5, sun: 4.2, exposure: 1.9 },
    hour: 17.2,
    setup(c) {
      const { player, combat, world } = c;
      player.car = null;
      world.time = 0;
      const cover = freeCars(c)[0];
      put(cover, 1100, 1296, HALF_PI, 0);
      cover.hp = 1e9;
      player.x = 1078; player.y = 1336; player.vx = 0; player.vy = 0;
      c.cover = cover;
      wanted3(c);
      c.cops = [
        addCop(c, 1262, 1322, Math.PI, 0),
        addCop(c, 1304, 1298, Math.PI, 0),
        addCop(c, 1290, 1334, Math.PI + 0.25, 0),
      ];
      combat.weapon = 'smg';
      c.sinceVolley = 0;
    },
    tick(c, dt) {
      const { player, combat, keys, gfx } = c;
      const spots = [[1262, 1322], [1304, 1298], [1290, 1334]];
      c.cops.forEach((cop, i) => { put(cop, spots[i][0], spots[i][1], Math.PI + (i === 2 ? 0.25 : 0), 0); cop.hp = 1e9; });
      player.facing = Math.atan2(1322 - player.y, 1262 - player.x);
      keys.add('f');
      const v = new THREE.Vector3(1262 - HX, 12, 1322 - HY);
      gfx.camera.updateMatrixWorld(true);
      v.project(gfx.camera);
      combat.mouse.x = (v.x + 1) / 2 * 960; combat.mouse.y = (1 - v.y) / 2 * 540;
      c.sinceVolley += dt;
      if (c.sinceVolley > 0.4) { combat.forceCopFire(0.4); c.sinceVolley = 0; }
      combat.bust = 0;
    },
    camera(c, cam) {
      lookFrom(cam, [1046, 34, 1352], [1230, 14, 1316], 66);
    },
  },

  driving: {
    light: { hemi: 1.1, ambient: 0.4, sun: 4.0, exposure: 1.3 },
    hour: 17.7,
    setup(c) {
      const car = freeCars(c)[0];
      enterCar(c, car, 336, 1650, HALF_PI, 230);
      c.world.time = 0;
    },
    tick(c) {
      const car = c.player.car;
      c.keys.add('w');
      car.x = 336; car.angle = HALF_PI;
      c.player.x = car.x; c.player.y = car.y;
      if (car.y > 2100) car.y -= 700;
    },
    camera(c, cam) {
      const car = c.player.car;
      lookFrom(cam, [car.x + 62, 12, car.y + 120], [car.x - 6, 42, car.y - 150], 70);
    },
  },
};

export function createShot({ world, player, police, peds, gfx, combat, keys, ui }) {
  const def = SHOTS[NAME];
  if (!def) return null;
  const c = { world, player, police, peds, gfx, combat, keys, ui, pinWanted: false };
  let ready = false, lit = false;
  return {
    name: NAME,
    tick(dt) {
      if (ui.state !== 'PLAYING') return;
      if (!ready) { ready = true; setHour(gfx, def.hour); def.setup(c); }
      if (player.health < 100) player.health = 100;
      if (c.pinWanted) { police.heat = 250; police.stars = 3; }
      if (def.light && gfx.dayKey === gfx.hour && !lit) {
        lit = true;
        const L = def.light;
        gfx.hemi.intensity = L.hemi; gfx.ambient.intensity = L.ambient;
        gfx.sun.intensity = L.sun; gfx.renderer.toneMappingExposure = L.exposure;
      }
      if (def.tick) def.tick(c, dt);
    },
    camera(cam) {
      if (!ready || !def.camera) return;
      def.camera(c, cam);
      if (cam.userData.ghost) cam.userData.ghost.length = 0;
    },
  };
}
