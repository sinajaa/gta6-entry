import { createWorld } from './world.js';
import { createPlayer, updatePlayer } from './player.js';
import { createCamera, updateCamera } from './camera.js';
import { render } from './render.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const world = createWorld();
const player = createPlayer(10 * 32, 10 * 32 + 16);
const camera = createCamera(canvas.width, canvas.height);
const keys = new Set();

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
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
  updatePlayer(player, keys, world, dt);
  updateCamera(camera, player, world, dt);
  render(ctx, world, player, camera, fps);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
