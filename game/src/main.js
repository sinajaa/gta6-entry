import { createWorld } from './world.js';
import { createPlayer, updatePlayer } from './player.js';
import { createCamera, updateCamera } from './camera.js';
import { render } from './render.js';
import { createCars, updateDrivenCar, updateTraffic, toggleVehicle, carFocus } from './vehicle.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const world = createWorld();
const player = createPlayer(10 * 32, 10 * 32 + 16);
player.car = null;
createCars(world, player.x, player.y);
const camera = createCamera(canvas.width, canvas.height);
const keys = new Set();

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'e' && !e.repeat) toggleVehicle(world, player);
  keys.add(k);
  if (k.startsWith('arrow') || k === ' ') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

camera.x = player.x - camera.viewW / 2;
camera.y = player.y - camera.viewH / 2;

let last = performance.now(), fps = 0, frames = 0, fpsTimer = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frames++; fpsTimer += dt;
  if (fpsTimer >= 0.5) { fps = Math.round(frames / fpsTimer); frames = 0; fpsTimer = 0; }
  const car = player.car;
  if (car) updateDrivenCar(car, keys, world, dt);
  else updatePlayer(player, keys, world, dt);
  updateTraffic(world, dt);
  updateCamera(camera, car ? carFocus(car) : player, world, dt, !!car);
  render(ctx, world, player, camera, fps);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
