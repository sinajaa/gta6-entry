// main.js — titik masuk game, loop utama, dan input
// Alur utama game dirangkai dan dirapikan langsung oleh penulis entry.
import { createWorld, T, tileAt } from './world.js';
import { createPlayer, updatePlayer } from './player.js';
import { updateCamera3D } from './camera.js';
import { initRenderer, renderFrame } from './render3d.js';
import { createPolice, addHeat, updateWanted, updatePolice } from './police.js';
import { createUI } from './ui.js';
import { createPeds, updatePeds, alarmPeds } from './peds.js';
import { createAudio } from './audio.js';
import { createMissions } from './missions.js';
import { createCombat } from './combat.js';
import { createTouch } from './touch.js';
import { createCars, updateDrivenCar, updateTraffic, toggleVehicle } from './vehicle.js';
import { createShot } from './shots.js';
import { createExtras } from './extras.js';
import { createInteriors } from './interiors.js';

const canvas = document.getElementById('game');
const world = createWorld();
const player = createPlayer(42 * 32 + 16, 42 * 32 + 16);
player.car = null;
createCars(world, player.x, player.y);
const startCar = world.cars.find((c) => c.driver === null);
const SPAWN_SIDE = 30;
const spawnSpot = [[SPAWN_SIDE, 0], [-SPAWN_SIDE, 0], [0, SPAWN_SIDE], [0, -SPAWN_SIDE]]
  .map(([dx, dy]) => [startCar.x + dx, startCar.y + dy])
  .find(([x, y]) => tileAt(world, x, y) !== T.BUILDING && Math.hypot(x - startCar.x, y - startCar.y) < 60);
if (!spawnSpot) throw new Error('spawn: tidak ada sisi mobil yang bebas');
[player.x, player.y] = spawnSpot;
const police = createPolice(world);
const peds = createPeds(world, player.x, player.y, 120);
const CRASH_SPEED_DROP = 50, CRASH_MIN_SPEED = 100, CRASH_COOLDOWN = 1.5;
let crashCooldown = 0;
const gfx = initRenderer(canvas, document.getElementById('hud'), world);
const keys = new Set();
const ui = createUI(document.getElementById('hud'));
const audio = createAudio();
const missions = createMissions(world, ui, audio);
const SIREN_RANGE = 600;
const combat = createCombat({ gfx, world, player, police, peds, ui, missions });
const shot = createShot({ world, player, police, peds, gfx, combat, keys, ui });
const extras = createExtras({ world, player, ui, audio, gfx });
const interiors = createInteriors({ world, player, ui, gfx, combat });
gfx.interiorBefore = interiors.beforeDraw; gfx.interiorAfter = interiors.afterDraw;
updateCamera3D(gfx.camera, player, 'walk', 1, world);
renderFrame(gfx, world, player, 0, police, peds, undefined, combat);

function startGame() { audio.start(); audio.click(); if (!missions.active) missions.next(); }
const touchTarget = (e) => !!(e.target && e.target.closest && e.target.closest('#touch'));
addEventListener('pointerdown', (e) => {
  if (ui.state === 'PLAYING' && extras.click(e.clientX * 960 / innerWidth, e.clientY * 540 / innerHeight)) return;
  if (ui.click() === 'start') startGame();
  else if (e.button === 0 && ui.state === 'PLAYING' && !touchTarget(e)) combat.mouseDown = true;
});
addEventListener('pointerup', (e) => { if (!touchTarget(e)) combat.mouseDown = false; });
addEventListener('pointermove', (e) => { if (!touchTarget(e)) combat.setMouse(e.clientX, e.clientY, canvas.getBoundingClientRect()); });
addEventListener('beforeunload', () => ui.save());

function enterExit() {
  if (extras.garage.open) return;
  if (interiors.tryInteract()) return;
  const wasOnFoot = !player.car;
  toggleVehicle(world, player);
  if (wasOnFoot && player.car) addHeat(world, 60, 'carjack');
}
function pressKey(e) {
  const action = ui.handleKey(e);
  if (action === 'start') startGame();
  if (action === 'pause') { keys.clear(); touch.reset && touch.reset(); combat.mouseDown = false; audio.click(); }
  if (action === 'resume') audio.click();
  return action;
}

const STICK_DEAD = 0.3;
const touch = createTouch({
  onStick(x, y) {
    for (const [k, on] of [['a', x < -STICK_DEAD], ['d', x > STICK_DEAD], ['w', y < -STICK_DEAD], ['s', y > STICK_DEAD]]) {
      if (on && ui.state === 'PLAYING') keys.add(k); else keys.delete(k);
    }
  },
  onButton(k, down) {
    if (k === 'Escape') { if (down) pressKey({ key: 'Escape', repeat: false }); return; }
    if (ui.state !== 'PLAYING') return;
    if (k === 'e') { if (down) enterExit(); }
    else if (k === 'f') combat.mouseDown = down;
    else if (down) keys.add(k); else keys.delete(k);
  },
});
if (touch.isTouch) {
  ui.touch = true;
  addEventListener('pointerdown', () => { if (ui.state === 'PLAYING' && !ui.touchHinted) { ui.touchHinted = true; ui.toast('Joystick kiri: gerak · E: masuk mobil · F: tembak'); } }, { once: false });
}

function setRadioKey() {
  const on = !!player.car && ui.state === 'PLAYING';
  audio.setRadio(on);
}
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (ui.state === 'PLAYING' && extras.handleKey(k, e.repeat)) { e.preventDefault(); return; }
  if (k === 'r' && !e.repeat && ui.state === 'PLAYING' && player.car) {
    ui.station = audio.nextStation(); ui.stationT = 2.5; setRadioKey();
  }
  pressKey(e);
  if (ui.state !== 'PLAYING') { if (k === ' ' || k.startsWith('arrow')) e.preventDefault(); return; }
  if (k === 'e' && !e.repeat) enterExit();
  keys.add(k);
  if (k.startsWith('arrow') || k === ' ') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

let last = performance.now(), fps = 0, frames = 0, fpsTimer = 0;
function frame(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000);
  let dt = rawDt;
  last = now;
  frames++; fpsTimer += rawDt;
  if (fpsTimer >= 0.5) { fps = Math.round(frames / fpsTimer); frames = 0; fpsTimer = 0; }
  ui.update(rawDt);
  canvas.style.filter = ui.state === 'DEAD' ? 'grayscale(0.85) contrast(1.1)' : '';
  if (ui.state !== 'PLAYING' && ui.state !== 'DEAD') { requestAnimationFrame(frame); return; }
  const dead = ui.state === 'DEAD';
  if (dead) dt *= 0.3;
  const input = dead ? new Set() : keys;
  if (shot) shot.tick(dt);
  const car = player.car;
  crashCooldown = Math.max(0, crashCooldown - dt);
  if (car) ui.prompt = null;
  if (car) {
    const speedBefore = Math.abs(car.speed);
    updateDrivenCar(car, input, world, dt);
    if (speedBefore > CRASH_MIN_SPEED && speedBefore - Math.abs(car.speed) > CRASH_SPEED_DROP && crashCooldown === 0) {
      addHeat(world, 25, 'crash');
      car.hp = Math.max(10, (car.hp ?? 100) - (speedBefore - Math.abs(car.speed)) * 0.2);
      audio.crash((speedBefore - Math.abs(car.speed)) / 200);
      alarmPeds(peds, car.x, car.y, 300);
      crashCooldown = CRASH_COOLDOWN;
    }
  }
  else if (!interiors.update(dt, input)) updatePlayer(player, input, world, dt);
  extras.update(dt);
  setRadioKey();
  updateTraffic(world, dt);
  updateWanted(police, player, dt);
  updatePolice(police, world, player, dt);
  if (police.stars >= 3) {
    for (const cop of police.cars) if (Math.hypot(cop.x - (car || player).x, cop.y - (car || player).y) < 250) alarmPeds(peds, cop.x, cop.y, 200);
  }
  updatePeds(world, player, peds, dt);
  missions.update(dt, player, world);
  combat.update(dt, keys, rawDt);
  if (!interiors.active) updateCamera3D(gfx.camera, player.car || player, player.car ? 'drive' : 'walk', dt, world);
  if (shot) shot.camera(gfx.camera);
  renderFrame(gfx, world, player, fps, police, peds, missions, combat);
  const focus = car || player;
  let nearest = Infinity;
  for (const cop of police.cars) nearest = Math.min(nearest, Math.hypot(cop.x - focus.x, cop.y - focus.y));
  const proximity = Math.max(0, 1 - nearest / SIREN_RANGE);
  audio.setSiren(police.stars > 0 ? proximity * (0.5 + 0.1 * police.stars) : 0);
  ui.wanted = police.stars;
  ui.update(0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__game = { interiors, combat, ui, audio, world, player, police, peds, missions, keys, gfx, cars: world.cars };
