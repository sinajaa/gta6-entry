// main.js — titik masuk game, loop utama, dan input
import { createWorld, T, tileAt } from './world.js';
import { createPlayer, updatePlayer } from './player.js';
import { updateCamera3D } from './camera.js';
import { initRenderer, renderFrame } from './render3d.js';
import { createPolice, addHeat, updateWanted, updatePolice } from './police.js';
import { createCars, updateDrivenCar, updateTraffic, toggleVehicle } from './vehicle.js';

const canvas = document.getElementById('game');
const world = createWorld();
const player = createPlayer(42 * 32 + 16, 42 * 32 + 16);
player.car = null;
createCars(world, player.x, player.y);
const startCar = world.cars[0];
const START_OFFSET = 55;
const [startDx, startDy] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  .find(([dx, dy]) => tileAt(world, startCar.x + dx * START_OFFSET, startCar.y + dy * START_OFFSET) !== T.BUILDING) || [0, 0];
player.x = startCar.x + startDx * START_OFFSET;
player.y = startCar.y + startDy * START_OFFSET;
const police = createPolice(world);
const CRASH_SPEED_DROP = 50, CRASH_MIN_SPEED = 100, CRASH_COOLDOWN = 1.5;
let crashCooldown = 0;
const gfx = initRenderer(canvas, document.getElementById('hud'), world);
const keys = new Set();

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'e' && !e.repeat) {
    const wasOnFoot = !player.car;
    toggleVehicle(world, player);
    if (wasOnFoot && player.car) addHeat(world, 60, 'carjack');
  }
  keys.add(k);
  if (k.startsWith('arrow') || k === ' ') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

let last = performance.now(), fps = 0, frames = 0, fpsTimer = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frames++; fpsTimer += dt;
  if (fpsTimer >= 0.5) { fps = Math.round(frames / fpsTimer); frames = 0; fpsTimer = 0; }
  const car = player.car;
  crashCooldown = Math.max(0, crashCooldown - dt);
  if (car) {
    const speedBefore = Math.abs(car.speed);
    updateDrivenCar(car, keys, world, dt);
    if (speedBefore > CRASH_MIN_SPEED && speedBefore - Math.abs(car.speed) > CRASH_SPEED_DROP && crashCooldown === 0) {
      addHeat(world, 25, 'crash');
      crashCooldown = CRASH_COOLDOWN;
    }
  }
  else updatePlayer(player, keys, world, dt);
  updateTraffic(world, dt);
  updateWanted(police, player, dt);
  updatePolice(police, world, player, dt);
  updateCamera3D(gfx.camera, car || player, car ? 'drive' : 'walk', dt);
  renderFrame(gfx, world, player, fps, police);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__game = { world, player, police, keys, gfx, cars: world.cars };
