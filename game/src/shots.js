// shots.js — adegan screenshot deterministik: ?shot=street|chase|firefight|driving (&seed=N)
// Adegan tangkapan layar deterministik ini dirancang sendiri untuk entry.
import * as THREE from '../vendor/three.module.min.js';
import { WORLD_W, WORLD_H } from './world.js';
import { addHeat } from './police.js';

const query = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const NAME = query.get('shot');
const SEED = parseInt(query.get('seed'), 10) || 20261119;
const HX = WORLD_W / 2, HY = WORLD_H / 2;
const COP_COLOR = '#2456c4';
const HALF_PI = Math.PI / 2;

const COP_QUIET_SECONDS = 0.5;
const GRADE_FILTER = 'contrast(1.40) saturate(1.22) brightness(1.02)';
const BLACK_FLOOR = 'rgb(22,22,26)';

function seedRandom() {
  let s = SEED;
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (NAME) seedRandom();

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

function lookFrom(cam, [x, h, y], [tx, th, ty], fov, roll = 0) {
  cam.position.set(x - HX, h, y - HY);
  cam.lookAt(tx - HX, th, ty - HY);
  if (roll) cam.rotateZ(roll);
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
    if (!p) return;
    p.x = x; p.y = y; p.angle = angle; p.state = 'WALK'; p.speed = 55; p.timer = 6 + Math.random() * 4;
    p.scale = 0.85 + Math.random() * 0.3;
  });
}

const SHOTS = {
  street: {
    light: { hemi: 0.12, ambient: 0.03, sun: 16, exposure: 2.75, sunColor: '#ffb066', sunDir: [-700, 140, -120], hemiSky: '#7f9cc8', hemiGnd: '#2a1c14' },
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
      lookFrom(cam, [1352, 22, 1780], [1322, 22, 1380], 72);
    },
  },

  chase: {
    light: { hemi: 0.15, ambient: 0.03, sun: 14, exposure: 1.2, sunColor: '#b8ccff', sunDir: [-500, 260, -200], hemiSky: '#6a7fb8', hemiGnd: '#1a1a24' },
    hour: 21,
    setup(c) {
      const car = freeCars(c)[0];
      enterCar(c, car, 780, 1328, 0, 230);
      c.world.time = 0;
      wanted3(c);
      c.cops = [addCop(c, 690, 1328, 0, 240), addCop(c, 640, 1296, 0, 240)];
    },
    tick(c) {
      const car = c.player.car;
      c.keys.add('w');
      put(car, 780, 1328, 0, 230);
      c.player.x = car.x; c.player.y = car.y;
      put(c.cops[0], 690, 1328, 0, 240); put(c.cops[1], 640, 1296, 0, 240);
    },
    camera(c, cam) {
      const car = c.player.car;
      const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
      lookFrom(cam, [car.x - fx * 66 - fy * 12, 28, car.y - fy * 66 + fx * 12], [car.x + fx * 120, 12, car.y + fy * 120], 74);
    },
  },

  firefight: {
    light: { hemi: 0.05, ambient: 0.0, sun: 40, exposure: 1.5, sunColor: '#ff9a5a', sunDir: [-650, 120, 250], hemiSky: '#8a72b0', hemiGnd: '#241418' },
    hour: 18.9,
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
      lookFrom(cam, [1090, 26, 1346], [1240, 10, 1316], 70);
    },
  },

  driving: {
    light: { hemi: 0.1, ambient: 0.03, sun: 14, exposure: 2.6, sunColor: '#ff7a4a', sunDir: [-700, 90, -300], hemiSky: '#8a6ab0', hemiGnd: '#1a1018' },
    hour: 18.3,
    setup(c) {
      const car = freeCars(c)[0];
      enterCar(c, car, 336, 1480, HALF_PI, 230);
      c.world.time = 0;
    },
    tick(c) {
      const car = c.player.car;
      c.keys.add('w');
      car.x = 336; car.y = 1480; car.angle = HALF_PI;
      c.player.x = car.x; c.player.y = car.y;
    },
    camera(c, cam) {
      const car = c.player.car;
      lookFrom(cam, [car.x + 34, 8, car.y + 84], [car.x - 6, 16, car.y - 150], 74, 0.12);
    },
  },
};

export function createShot({ world, player, police, peds, gfx, combat, keys, ui }) {
  const def = SHOTS[NAME];
  if (!def) return null;
  const c = { world, player, police, peds, gfx, combat, keys, ui, pinWanted: false };
  let ready = false, hooked = false, floorEl = null;
  setHour(gfx, def.hour);
  const applyLight = () => {
    const L = def.light;
    if (!L) return;
    gfx.hemi.intensity = L.hemi; gfx.ambient.intensity = L.ambient;
    gfx.sun.intensity = L.sun; gfx.renderer.toneMappingExposure = L.exposure;
    if (L.sunColor) gfx.sun.color.set(L.sunColor);
    if (L.hemiSky) gfx.hemi.color.set(L.hemiSky);
    if (L.hemiGnd) gfx.hemi.groundColor.set(L.hemiGnd);
    gfx.renderer.domElement.style.filter = def.filter || GRADE_FILTER;
    if (!floorEl) {
      floorEl = document.createElement('div');
      floorEl.style.cssText = `position:absolute;inset:0;pointer-events:none;mix-blend-mode:lighten;background:${BLACK_FLOOR}`;
      gfx.hud.canvas.parentNode.appendChild(floorEl);
    }
  };
  if (def.light && def.light.sunDir) gfx.sunDirOverride = new THREE.Vector3(...def.light.sunDir);
  let elapsed = 0;
  const immortal = () => {
    player.health = 100;
    if (player.armor !== undefined) player.armor = 100;
    combat.bust = 0;
    combat.vignette = 0; combat.shake = 0;
    if (combat.dead) { combat.dead = null; ui.dead = null; }
    if (ui.state !== 'PAUSED') ui.state = 'PLAYING';
  };
  const copsQuiet = () => {
    if (elapsed >= COP_QUIET_SECONDS) return;
    for (const cop of police.cars) { cop.fire = null; cop.fireCool = COP_QUIET_SECONDS - elapsed; }
  };
  const combatUpdate = combat.update;
  combat.update = (...args) => {
    immortal();
    copsQuiet();
    combatUpdate(...args);
    immortal();
  };
  return {
    name: NAME,
    tick(dt) {
      if (ui.state === 'PAUSED') return;
      immortal();
      if (!hooked) {
        hooked = true;
        const prev = gfx.beforeDraw;
        gfx.beforeDraw = () => {
          applyLight();
          if (gfx.base && def.light) { gfx.base.exp = def.light.exposure; gfx.base.sun = def.light.sun; gfx.base.hemi = def.light.hemi; }
          if (prev) prev();
        };
      }
      if (!ready) { ready = true; seedRandom(); setHour(gfx, def.hour); def.setup(c); elapsed = 0; copsQuiet(); }
      else elapsed += dt;
      if (gfx.hour !== def.hour) gfx.hour = def.hour;
      if (c.pinWanted) { police.heat = 250; police.stars = 3; }
      if (def.tick) def.tick(c, dt);
    },
    camera(cam) {
      if (!ready || !def.camera) return;
      def.camera(c, cam);
      if (cam.userData.ghost) cam.userData.ghost.length = 0;
    },
  };
}
