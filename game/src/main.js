// main.js — titik masuk game, loop utama, dan input
// Alur utama game dirangkai dan dirapikan langsung oleh penulis entry.
import { createWorld, T, tileAt, districtAt } from './world.js';
import { createPlayer, updatePlayer } from './player.js';
import { updateCamera3D, createMenuCamera, updateMenuCamera, beginMenuBlend, blendCameraStart, blendCameraEnd } from './camera.js';
import { initRenderer, renderFrame } from './render3d.js';
import { createPolice, addHeat, updateWanted, updatePolice } from './police.js';
import { createUI } from './ui.js';
import { createStanding, DISTRICT_NAMES } from './standing.js';
import { createPeds, updatePeds, alarmPeds } from './peds.js';
import { createAudio } from './audio.js';
import { createMissions } from './missions.js';
import { createCombat } from './combat.js';
import { createTouch } from './touch.js';
import { createCars, updateDrivenCar, updateTraffic, toggleVehicle } from './vehicle.js';
import { createShot } from './shots.js';
import { createExtras } from './extras.js';
import { createInteriors } from './interiors.js';
import { createHeists, updateHeists } from './heist.js';
import { createRaces, updateRaces } from './races.js';
import { createEconomy, updateEconomy } from './economy.js';
import { createStats, updateStats } from './stats.js';
import { createTaxi, updateTaxi } from './taxi.js';

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
const CRASH_SPEED_DROP = 50, CRASH_MIN_SPEED = 100, CRASH_COOLDOWN = 1.5, CRASH_DAMAGE_FACTOR = 0.2;
let crashCooldown = 0;

// Penyimpanan counter SAVE (money, missionsDone, carsStolen) — key suncity.save.
const SAVE_COUNT_KEY = 'suncity.save';
function loadSaveCounters() {
  try {
    const raw = localStorage.getItem(SAVE_COUNT_KEY);
    if (!raw) return { money: 0, missionsDone: 0, carsStolen: 0 };
    const data = JSON.parse(raw);
    return {
      money: Number.isFinite(data.money) ? data.money : 0,
      missionsDone: Number.isFinite(data.missionsDone) ? data.missionsDone : 0,
      carsStolen: Number.isFinite(data.carsStolen) ? data.carsStolen : 0,
    };
  } catch (e) { return { money: 0, missionsDone: 0, carsStolen: 0 }; }
}
const saveCounters = loadSaveCounters();
function persistSaveCounters() {
  try {
    localStorage.setItem(SAVE_COUNT_KEY, JSON.stringify({
      money: ui.money,
      missionsDone: ui.missionsDone,
      carsStolen: saveCounters.carsStolen,
    }));
  } catch (e) { /* storage tidak tersedia */ }
}
const gfx = initRenderer(canvas, document.getElementById('hud'), world);
const keys = new Set();
const ui = createUI(document.getElementById('hud'));
ui.rep = createStanding(ui);
const audio = createAudio();
const missions = createMissions(world, ui, audio);
ui.link(world, missions, player);
const heists = createHeists({ world, ui, audio, gfx, player });
const races = createRaces({ world, ui, audio, gfx, player });
const taxi = createTaxi({ world, ui, audio, gfx, player });
const objectiveView = {
  get markers() { return heists.active ? heists.markers : races.active ? races.markers : taxi.active ? taxi.markers : missions.markers; },
  get target() { return heists.active ? heists.target : races.active ? races.target : taxi.active ? taxi.target : missions.target; },
  get objectiveText() { return heists.active ? heists.objectiveText : races.active ? races.objectiveText : taxi.active ? taxi.objectiveText : missions.objectiveText; },
};
const SIREN_RANGE = 600;
const combat = createCombat({ gfx, world, player, police, peds, ui, missions, audio });
const shot = createShot({ world, player, police, peds, gfx, combat, keys, ui });
const extras = createExtras({ world, player, ui, audio, gfx });
const interiors = createInteriors({ world, player, ui, gfx, combat });
const economy = createEconomy({ world, player, ui, audio, gfx, combat });
const stats = createStats({ world, player, ui, audio, combat, missions, heists, races, gfx });
gfx.interiorBefore = interiors.beforeDraw; gfx.interiorAfter = interiors.afterDraw;

// Terapkan pengaturan (kualitas render, bayangan, sensitivitas mouse, volume) ke sistem.
function applySettings(s) {
  const q = s.quality === 'low' ? 1 : s.quality === 'medium' ? 1.5 : 2;
  const ratio = Math.min(window.devicePixelRatio || 1, q);
  gfx.renderer.setPixelRatio(ratio);
  // The render-quality tier now gates the costly passes: low drops bloom and shadows entirely,
  // medium/high run both. The dedicated shadows toggle still overrides the shadow map on top.
  const fast = s.quality === 'low';
  gfx.bloomEnabled = !fast && !gfx.software;
  gfx.renderer.shadowMap.enabled = !!s.shadows && !fast && !gfx.software;
  gfx.renderer.shadowMap.needsUpdate = true;
  combat.sens = s.sensitivity * 2;
  audio.setVolume(s.volume * 0.7);
}
applySettings(ui.settings);
ui.onSettings = applySettings;
ui.onSave = persistSaveCounters;
ui.saveCounters = saveCounters;

// Mode foto: orbit kamera mengelilingi pemain.
const photo = { yaw: -Math.PI / 2, pitch: 0.35, dist: 90, hintT: 0 };

updateCamera3D(gfx.camera, player, 'walk', 1, world);
renderFrame(gfx, world, player, 0, police, peds, undefined, combat);

const MENU_HOUR = 17.6;
const menuCam = new URLSearchParams(location.search).has('shot') ? null : createMenuCamera(gfx.camera);
const menuHour = { hour: gfx.hour, frozen: gfx.frozenHour };
if (menuCam) {
  gfx.frozenHour = true; gfx.hour = MENU_HOUR;
  const MENU_LIGHT = { exp: 4.2, sun: 2.4, hemi: 5 };
  const prevBefore = gfx.beforeDraw;
  let lifted = false;
  gfx.beforeDraw = () => {
    if (prevBefore) prevBefore();
    const b = gfx.base, w = menuCam.phase === 'menu' ? 1 : menuCam.phase === 'blend' ? 1 - menuCam.s : 0;
    if (!b || (w === 0 && !lifted)) return;
    gfx.renderer.toneMappingExposure = b.exp * (1 + (MENU_LIGHT.exp - 1) * w);
    gfx.sun.intensity = b.sun * (1 + (MENU_LIGHT.sun - 1) * w);
    gfx.hemi.intensity = b.hemi * (1 + (MENU_LIGHT.hemi - 1) * w);
    lifted = w > 0;
  };
}

function startGame() { audio.start(); audio.click(); if (!missions.active) missions.next(); }
const touchTarget = (e) => !!(e.target && e.target.closest && e.target.closest('#touch'));
addEventListener('pointerdown', (e) => {
  if (ui.state === 'PLAYING' && extras.click(e.clientX * 960 / innerWidth, e.clientY * 540 / innerHeight)) return;
  if (ui.click() === 'start') startGame();
  else if (e.button === 0 && ui.state === 'PLAYING') {
    if (ui.logOpen) { ui.logClick(e.clientX * 960 / innerWidth, e.clientY * 540 / innerHeight); return; }
    if (!touchTarget(e)) combat.mouseDown = true;
  }
});
addEventListener('pointerup', (e) => { if (!touchTarget(e)) combat.mouseDown = false; });
addEventListener('pointermove', (e) => { if (!touchTarget(e)) combat.setMouse(e.clientX, e.clientY, canvas.getBoundingClientRect()); });
addEventListener('beforeunload', () => { ui.save(); persistSaveCounters(); });

function enterExit() {
  if (extras.garage.open) return;
  if (economy.tryInteract()) return;
  if (interiors.tryInteract()) return;
  const wasOnFoot = !player.car;
  toggleVehicle(world, player);
  if (wasOnFoot && player.car) { addHeat(world, 60, 'carjack'); saveCounters.carsStolen++; }
}
function pressKey(e) {
  const action = ui.handleKey(e);
  if (action === 'start') startGame();
  if (action === 'pause') { keys.clear(); touch.reset && touch.reset(); combat.mouseDown = false; audio.click(); }
  if (action === 'resume') audio.click();
  if (action === 'quit') { keys.clear(); audio.click(); }
  if (action === 'photo-shot') saveScreenshot();
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
    if (k === 'Escape') {
      if (down && economy.active) { economy.cancel(); return; }
      if (down) pressKey({ key: 'Escape', repeat: false });
      return;
    }
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

function saveScreenshot() {
  try {
    const a = document.createElement('a');
    a.download = `sunnycity-${Date.now()}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    ui.toast('SCREENSHOT DISIMPAN');
  } catch (err) { console.warn('screenshot gagal:', err); }
}

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (ui.state === 'PLAYING' && extras.handleKey(k, e.repeat)) { e.preventDefault(); return; }
  // Menu konfirmasi pembelian: E/Enter = beli, ESC = batal.
  if (economy.active && ui.state === 'PLAYING') {
    if (k === 'escape') { economy.cancel(); e.preventDefault(); return; }
    if (k === 'e' || k === 'enter') { if (!e.repeat) economy.confirm(); e.preventDefault(); return; }
  }
  if (k === 'r' && !e.repeat && ui.state === 'PLAYING' && player.car) {
    ui.station = audio.nextStation(); ui.stationT = 2.5; setRadioKey();
  }
  // Buka/tutup peta dan mode foto, log misi.
  if (ui.state === 'PLAYING') {
    if (k === 'm' && !e.repeat) { ui.openMap(); e.preventDefault(); return; }
    if (k === 'p' && !e.repeat) { ui.openPhoto(); keys.clear(); combat.mouseDown = false; e.preventDefault(); return; }
    if (k === 'tab' && !e.repeat) { ui.toggleLog(); e.preventDefault(); return; }
    if (k === 'h' && !e.repeat) { if (heists.onKey()) { e.preventDefault(); return; } }
    if (k === 'k' && !e.repeat) { if (races.onKey()) { e.preventDefault(); return; } }
    if (k === 't' && !e.repeat) { if (taxi.onKey()) { e.preventDefault(); return; } }
    if (k === 't' && !e.repeat) { stats.toggle(); e.preventDefault(); return; }
  }
  // Navigasi mode foto (orbit + simpan).
  if (ui.state === 'PHOTO') {
    if (k === 'arrowleft') photo.yaw += 0.08;
    else if (k === 'arrowright') photo.yaw -= 0.08;
    else if (k === 'arrowup') photo.pitch = Math.min(0.9, photo.pitch + 0.06);
    else if (k === 'arrowdown') photo.pitch = Math.max(0.02, photo.pitch - 0.06);
    if (k.startsWith('arrow')) { e.preventDefault(); }
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
  if (menuCam && menuCam.phase === 'menu' && ui.state !== 'MENU') beginMenuBlend(menuCam, gfx.camera);
  if (menuCam && ui.state === 'MENU') {
    updateTraffic(world, rawDt);
    updatePeds(world, player, peds, rawDt);
    updateMenuCamera(menuCam, gfx.camera, rawDt);
    renderFrame(gfx, world, player, fps, police, peds, undefined, combat);
    ui.update(0);
    requestAnimationFrame(frame);
    return;
  }
  if (ui.state === 'PHOTO') {
    const focus = player.car || player;
    const cy = focus.x - world.width / 2, cz = focus.y - world.height / 2;
    const dist = photo.dist, yaw = photo.yaw, pitch = photo.pitch;
    const camX = cy + Math.cos(yaw) * Math.cos(pitch) * dist;
    const camZ = cz + Math.sin(yaw) * Math.cos(pitch) * dist;
    const camY = 12 + Math.sin(pitch) * dist;
    gfx.camera.position.set(camX, camY, camZ);
    gfx.camera.lookAt(cy, 12, cz);
    if (gfx.camera.userData.ghost) gfx.camera.userData.ghost.length = 0;
    renderFrame(gfx, world, player, fps, police, peds, missions, combat);
    gfx.hud.clearRect(0, 0, 960, 540);
    ui.update(0);
    requestAnimationFrame(frame);
    return;
  }
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
      car.hp = Math.max(10, (car.hp ?? 100) - (speedBefore - Math.abs(car.speed)) * CRASH_DAMAGE_FACTOR);
      audio.crash((speedBefore - Math.abs(car.speed)) / 200);
      alarmPeds(peds, car.x, car.y, 300);
      crashCooldown = CRASH_COOLDOWN;
    }
  }
  else if (!interiors.update(dt, input)) updatePlayer(player, input, world, dt);
  extras.update(dt);
  setRadioKey();
  updateTraffic(world, dt);
  const rep = ui.rep, there = player.car || player;
  rep.update(dt, there.x, there.y);
  police.shield = rep.shield(there.x, there.y);
  ui.standingHud = rep.visible && !interiors.active ? { name: DISTRICT_NAMES[rep.cur], value: ui.standing[rep.cur], shield: police.shield } : null;
  updateWanted(police, player, dt);
  updatePolice(police, world, player, dt);
  // Suara adaptif: music director (heat + distrik) dan engine/ban/camar per frame.
  const edgeD = Math.min(there.x, there.y, world.width - there.x, world.height - there.y);
  const water = Math.max(0, 1 - edgeD / 260);
  audio.update({
    car,
    heat: police.stars,
    district: districtAt(there.x, there.y),
    water,
  });
  if (police.stars >= 3) {
    for (const cop of police.cars) if (Math.hypot(cop.x - (car || player).x, cop.y - (car || player).y) < 250) alarmPeds(peds, cop.x, cop.y, 200);
  }
  updatePeds(world, player, peds, dt);
  missions.update(dt, player, world);
  updateHeists(heists, dt, player);
  updateRaces(races, dt, player);
  updateEconomy(economy, dt, player);
  updateTaxi(taxi, dt, player);
  combat.update(dt, keys, rawDt);
  updateStats(stats, dt, player);
  if (!interiors.active) updateCamera3D(gfx.camera, player.car || player, player.car ? 'drive' : 'walk', dt, world);
  if (shot) shot.camera(gfx.camera);
  const blending = menuCam && menuCam.phase === 'blend';
  if (blending) {
    blendCameraStart(menuCam, gfx.camera, rawDt);
    gfx.hour = MENU_HOUR + (menuHour.hour - MENU_HOUR) * menuCam.s;
    if (menuCam.phase === 'done') { gfx.hour = menuHour.hour; gfx.frozenHour = menuHour.frozen; gfx.lastClock = performance.now(); }
  }
  renderFrame(gfx, world, player, fps, police, peds, objectiveView, combat);
  if (blending) blendCameraEnd(menuCam, gfx.camera);
  const focus = car || player;
  let nearest = Infinity;
  for (const cop of police.cars) nearest = Math.min(nearest, Math.hypot(cop.x - focus.x, cop.y - focus.y));
  const proximity = Math.max(0, 1 - nearest / SIREN_RANGE);
  audio.setSiren(police.stars > 0 ? proximity * (0.5 + 0.1 * police.stars) : 0);
  ui.wanted = police.stars;
  ui.update(0);
  economy.drawMenu();
  requestAnimationFrame(frame);
}
if (new URLSearchParams(location.search).has('shot')) {
  ui.state = 'PLAYING';
  try { startGame(); } catch (err) { console.warn('shot autostart audio:', err); if (!missions.active) missions.next(); }
}
requestAnimationFrame(frame);
window.__game = { interiors, combat, ui, audio, world, player, police, peds, missions, keys, gfx, cars: world.cars, heists, races, economy, stats, taxi };
setInterval(persistSaveCounters, 20000);
