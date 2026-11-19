// combat.js — bidik, tembak (hitscan), drive-by, kesehatan, WASTED/BUSTED, dan polisi menembak
// Modul tempur hasil rakitan sendiri, dari bidikan sampai layar WASTED.
import * as THREE from '../vendor/three.module.min.js';
import { TILE, T, tileAt, WORLD_W, WORLD_H } from './world.js';
import { hasLineOfSight, addHeat } from './police.js';
import { alarmPeds } from './peds.js';

export const TRACER_MAX = 32, FLASH_MAX = 8, SPARK_MAX = 48, SHELL_MAX = 40, DEBRIS_MAX = 48, SMOKE_MAX = 64, FIREBALL_MAX = 6;
import { WEAPONS, WEAPON_ORDER, createAmmo, refill, createPickups, updatePickups } from './weapons.js';
const RANGE = 600, PED_RADIUS = 14, CAR_HALF_L = 28, CAR_HALF_W = 11, DRIVEBY_SPREAD = 0.10;
const CAR_HP = 100, PED_HP = 50;
const MAX_HEALTH = 100, REGEN_DELAY = 6, REGEN_RATE = 2;
const VIGNETTE_TIME = 0.35, SHAKE_TIME = 0.15, SHAKE_MAG = 4, HIT_TIME = 0.12;
const BUST_RADIUS = 70, BUST_SPEED = 20, BUST_SECONDS = 3;
const DEAD_SECONDS = 3, MONEY_LOSS = 0.1;
const COP_MIN_STARS = 3, COP_RANGE = 320, COP_CYCLE = 1.4, COP_TELEGRAPH = 0.4, COP_BURST = 3, COP_BURST_GAP = 0.1;
const COP_DAMAGE = 6, HELI_DAMAGE = 4, HELI_INTERVAL = 0.5, COP_CAR_FACTOR = 0.5;
const PLAYER_COLOR = [1, 0.85, 0.45], COP_COLOR = [1, 0.3, 0.12];
const SHAKE_TIME_EXPL = 0.5, SHAKE_MAG_EXPL = 14, EXPL_RADIUS = 200, MUZZLE_H = 13;

function wallDistance(world, ox, oy, dx, dy, range) {
  let tx = Math.floor(ox / TILE), ty = Math.floor(oy / TILE);
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const ddx = dx ? TILE / Math.abs(dx) : Infinity, ddy = dy ? TILE / Math.abs(dy) : Infinity;
  let mx = dx > 0 ? ((tx + 1) * TILE - ox) / dx : dx < 0 ? (tx * TILE - ox) / dx : Infinity;
  let my = dy > 0 ? ((ty + 1) * TILE - oy) / dy : dy < 0 ? (ty * TILE - oy) / dy : Infinity;
  for (let guard = 0; guard < 64; guard++) {
    const t = Math.min(mx, my);
    if (t >= range) return range;
    if (mx < my) { tx += sx; mx += ddx; } else { ty += sy; my += ddy; }
    if (tileAt(world, tx * TILE + 1, ty * TILE + 1) === T.BUILDING) return t;
  }
  return range;
}

function rayCar(car, ox, oy, dx, dy) {
  const c = Math.cos(car.angle), s = Math.sin(car.angle);
  const px = ox - car.x, py = oy - car.y;
  const lx = px * c + py * s, ly = -px * s + py * c;
  const ldx = dx * c + dy * s, ldy = -dx * s + dy * c;
  let t0 = 0, t1 = Infinity;
  for (const [p, d, h] of [[lx, ldx, CAR_HALF_L], [ly, ldy, CAR_HALF_W]]) {
    if (Math.abs(d) < 1e-9) { if (Math.abs(p) > h) return null; continue; }
    let a = (-h - p) / d, b = (h - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

function rayCircle(px, py, r, ox, oy, dx, dy) {
  const vx = px - ox, vy = py - oy;
  const along = vx * dx + vy * dy;
  const perp2 = vx * vx + vy * vy - along * along;
  if (perp2 > r * r) return null;
  const t = along - Math.sqrt(r * r - perp2);
  return t >= 0 ? t : (along >= 0 ? 0 : null);
}

const AIM_MAX = 600;
function makePool(n, make) { return Array.from({ length: n }, make); }

export function createCombat({ gfx, world, player, police, peds, ui, missions }) {
  player.health = MAX_HEALTH;
  player.maxHealth = MAX_HEALTH;

  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -14);
  const ndc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();
  const proj = new THREE.Vector3();
  const shakeOff = new THREE.Vector3();

  const c = {
    mouse: { x: 480, y: 270 },
    mouseDown: false,
    aim: { x: player.x + 100, y: player.y },
    weapon: 'pistol',
    ammo: createAmmo(),
    pickups: createPickups(),
    wheelOpen: false,
    cool: 0,
    sinceHit: REGEN_DELAY,
    bustProgress: 0,
    vignette: 0,
    shake: 0,
    explShake: 0,
    hit: { t: 0, kill: false, x: 0, y: 0 },
    bust: 0,
    dead: null,
    tracers: makePool(TRACER_MAX, () => ({ t: 0, max: 1, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, w: 1, color: PLAYER_COLOR, dim: 1 })),
    flashes: makePool(FLASH_MAX, () => ({ t: 0, max: 1, x: 0, y: 0, z: 0, angle: 0, size: 14, color: PLAYER_COLOR })),
    sparks: makePool(SPARK_MAX, () => ({ t: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hot: 0 })),
    shells: makePool(SHELL_MAX, () => ({ t: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, vr: 0 })),
    debris: makePool(DEBRIS_MAX, () => ({ t: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, hot: 0 })),
    smoke: makePool(SMOKE_MAX, () => ({ t: 0, max: 1, x: 0, y: 0, z: 0, size: 1, life: 1 })),
    fireballs: makePool(FIREBALL_MAX, () => ({ t: 0, max: 1, x: 0, y: 0, z: 0, size: 1, color: [1, 0.5, 0.2] })),
    tracerCursor: 0, flashCursor: 0, sparkCursor: 0, shellCursor: 0, debrisCursor: 0, smokeCursor: 0, fireballCursor: 0,
    recoil: 0, kick: 0, _kickApplied: 0,

    setMouse(clientX, clientY, rect) {
      c.mouse.x = Math.max(0, Math.min(960, (clientX - rect.left) / rect.width * 960));
      c.mouse.y = Math.max(0, Math.min(540, (clientY - rect.top) / rect.height * 540));
    },

    applyShake(camera) {
      let m = 0;
      if (c.shake > 0) m = SHAKE_MAG * (c.shake / SHAKE_TIME);
      if (c.explShake > 0) m = Math.max(m, SHAKE_MAG_EXPL * (c.explShake / SHAKE_TIME_EXPL));
      if (m > 0) {
        shakeOff.set((Math.random() - 0.5) * 2 * m, (Math.random() - 0.5) * m, (Math.random() - 0.5) * 2 * m);
        camera.position.add(shakeOff);
      }
      if (c.kick > 0) { camera.rotateX(c.kick); c._kickApplied = c.kick; }
    },
    clearShake(camera) {
      if (c._kickApplied) { camera.rotateX(-c._kickApplied); c._kickApplied = 0; }
      if (shakeOff.x || shakeOff.y || shakeOff.z) camera.position.sub(shakeOff);
      shakeOff.set(0, 0, 0);
    },

    hitscan(origin, angle, opts = {}) {
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const range = opts.range || RANGE;
      const wall = wallDistance(world, origin.x, origin.y, dx, dy, range);
      let best = { t: wall, kind: wall < range ? 'wall' : 'none', target: null };
      for (const car of world.cars) {
        if (car === opts.exclude) continue;
        if ((car.x - origin.x) ** 2 + (car.y - origin.y) ** 2 > (range + 40) ** 2) continue;
        const t = rayCar(car, origin.x, origin.y, dx, dy);
        if (t !== null && t < best.t) best = { t, kind: 'car', target: car };
      }
      for (const ped of peds) {
        if ((ped.x - origin.x) ** 2 + (ped.y - origin.y) ** 2 > (range + 20) ** 2) continue;
        const t = rayCircle(ped.x, ped.y, PED_RADIUS, origin.x, origin.y, dx, dy);
        if (t !== null && t < best.t) best = { t, kind: 'ped', target: ped };
      }
      best.x = origin.x + dx * best.t;
      best.y = origin.y + dy * best.t;
      return best;
    },

    forceCopFire(life = 0.6) {
      const target = player.car || player;
      const acc = copAccuracy();
      let n = 0;
      for (const cop of police.cars) {
        if (Math.hypot(cop.x - target.x, cop.y - target.y) > 600) continue;
        for (let i = 0; i < COP_BURST; i++) copBullet(cop.x, cop.y, 14, 0, acc, life);
        n++;
      }
      if (police.heli) copBullet(police.heli.x, police.heli.y, 80, 0, acc, life);
      if (!n) {
        const back = (player.car ? player.car.angle : player.facing) + Math.PI;
        for (let i = 0; i < COP_BURST; i++) copBullet(target.x + Math.cos(back) * 150, target.y + Math.sin(back) * 150, 14, 0, acc, life);
        n = 1;
      }
      return n;
    },

    update(dt, keys, rawDt = dt) {
      c.vignette = Math.max(0, c.vignette - dt);
      c.shake = Math.max(0, c.shake - dt);
      c.explShake = Math.max(0, c.explShake - dt);
      c.kick = Math.max(0, c.kick - dt * 6);
      c.recoil = Math.max(0, c.recoil - dt * 0.12);
      c.hit.t = Math.max(0, c.hit.t - dt);
      c.cool = Math.max(0, c.cool - dt);
      tickFx(dt);
      updateCarFx(dt);
      updateAim();
      WEAPON_ORDER.forEach((id, i) => { if (keys.has(String(i + 1)) && !prevKeys.has(String(i + 1))) c.weapon = id; });
      const q = keys.has('q') && !c.dead;
      if (q) {
        const dx = c.mouse.x - 480, dy = c.mouse.y - 270;
        if (Math.hypot(dx, dy) > 25) {
          const a = Math.atan2(dy, dx);
          c.wheelSel = Math.round((a + Math.PI / 2) / (Math.PI / 2) + 8) % 4;
        }
      } else if (c.wheelOpen && c.wheelSel != null) { c.weapon = WEAPON_ORDER[c.wheelSel]; c.wheelSel = null; }
      c.wheelOpen = q;
      prevKeys = new Set(keys);
      const wd = WEAPONS[c.weapon];
      ui.weapon = c.weapon;
      ui.weaponName = wd.name;
      ui.weaponIndex = WEAPON_ORDER.indexOf(c.weapon) + 1;
      ui.ammo = c.ammo[c.weapon];
      ui.wheel = q ? { sel: c.wheelSel, ammo: c.ammo } : null;
      ui.hit = c.hit;
      if (c.dead) { tickDead(rawDt); return; }
      updateAmmoPickups(dt);

      if ((c.mouseDown || keys.has('f')) && !q && c.cool <= 0) fire();
      c.sinceHit += dt;
      if (c.sinceHit >= REGEN_DELAY && player.health < MAX_HEALTH) player.health = Math.min(MAX_HEALTH, player.health + REGEN_RATE * dt);
      updateCops(dt);
      updateBust(dt);
      if (!c.dead && player.health <= 0) die('WASTED');
    },
  };

  let prevKeys = new Set();
  function updateAmmoPickups(dt) {
    const focus = player.car || player;
    updatePickups(c.pickups, world, focus, dt, () => { refill(c.ammo); ui.toast('AMMO +'); });
    ui.pickups = c.pickups.list.map((p) => {
      proj.set(p.x - WORLD_W / 2, 10, p.y - WORLD_H / 2).project(gfx.camera);
      if (proj.z >= 1 || Math.abs(proj.x) > 1.1 || Math.abs(proj.y) > 1.1) return null;
      return { x: (proj.x + 1) / 2 * 960, y: (1 - proj.y) / 2 * 540, d: Math.hypot(p.x - focus.x, p.y - focus.y) };
    }).filter(Boolean);
  }

  function updateAim() {
    const camera = gfx.camera;
    camera.updateMatrixWorld(true);
    ndc.set(c.mouse.x / 960 * 2 - 1, -(c.mouse.y / 540 * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(plane, hitPoint)) {
      let ax = hitPoint.x + WORLD_W / 2, ay = hitPoint.z + WORLD_H / 2;
      const d = Math.hypot(ax - player.x, ay - player.y);
      if (d > AIM_MAX) { ax = player.x + (ax - player.x) * AIM_MAX / d; ay = player.y + (ay - player.y) * AIM_MAX / d; }
      c.aim.x = ax; c.aim.y = ay;
    }
  }

  function addTracer(x0, y0, z0, x1, y1, z1, w, color, life, dim = 1) {
    const t = c.tracers[c.tracerCursor++ % TRACER_MAX];
    Object.assign(t, { t: life, max: life, x0, y0, z0, x1, y1, z1, w, color, dim });
  }

  function addFlash(x, y, z, angle, size, color, life) {
    const f = c.flashes[c.flashCursor++ % FLASH_MAX];
    Object.assign(f, { t: life, max: life, x, y, z, angle, size, color });
  }

  function addSparks(x, y, n, z = 6) {
    for (let i = 0; i < n; i++) {
      const s = c.sparks[c.sparkCursor++ % SPARK_MAX];
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 90;
      Object.assign(s, { t: 0.35 + Math.random() * 0.25, max: 0.6, x, y, z: z + Math.random() * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 60 + Math.random() * 90, hot: Math.random() < 0.5 ? 0 : 1 });
    }
  }

  function addShell(x, y, z, angle, spread) {
    const s = c.shells[c.shellCursor++ % SHELL_MAX];
    const a = angle + Math.PI / 2 + (Math.random() - 0.5) * spread;
    const sp = 60 + Math.random() * 90;
    Object.assign(s, { t: 1.6 + Math.random() * 0.6, max: 2.2, x, y, z: z + 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 140 + Math.random() * 130, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 20 });
  }

  function addDebris(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      const d = c.debris[c.debrisCursor++ % DEBRIS_MAX];
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 260;
      Object.assign(d, { t: 1.2 + Math.random() * 0.8, max: 2, x, y, z: z + Math.random() * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 120 + Math.random() * 260, size: 2 + Math.random() * 4, hot: Math.random() < 0.8 ? 0 : 1 });
    }
  }

  function addSmoke(x, y, z, size, life) {
    const s = c.smoke[c.smokeCursor++ % SMOKE_MAX];
    Object.assign(s, { t: life, max: life, x, y, z, size, life });
  }

  function addFireball(x, y, z, size) {
    const f = c.fireballs[c.fireballCursor++ % FIREBALL_MAX];
    Object.assign(f, { t: 0.7, max: 0.7, x, y, z, size, color: [1, 0.55, 0.22] });
  }

  function explodeCar(car) {
    addFireball(car.x, car.y, 14, 70);
    addFireball(car.x + (Math.random() - 0.5) * 24, car.y + (Math.random() - 0.5) * 24, 20, 34);
    addDebris(car.x, car.y, 16, 16);
    for (let i = 0; i < 10; i++) addSmoke(car.x + (Math.random() - 0.5) * 30, car.y + (Math.random() - 0.5) * 20, 10 + i * 5, 14 + Math.random() * 14, 1.4 + Math.random() * 0.8);
    for (let i = 0; i < 24; i++) addSparks(car.x, car.y, 1, 20);
    const d = Math.hypot(car.x - player.x, car.y - player.y);
    c.explShake = Math.max(c.explShake, SHAKE_TIME_EXPL * Math.max(0, 1 - d / EXPL_RADIUS));
    alarmPeds(peds, car.x, car.y, 320);
    addHeat(world, 20, 'explosion');
  }

  function tickFx(dt) {
    for (const t of c.tracers) if (t.t > 0) t.t -= dt;
    for (const f of c.flashes) if (f.t > 0) f.t -= dt;
    for (const s of c.sparks) {
      if (s.t <= 0) continue;
      s.t -= dt;
      s.vz -= 380 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.z < 0) s.t = 0;
    }
    for (const s of c.shells) {
      if (s.t <= 0) continue;
      s.t -= dt;
      s.vz -= 700 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      s.rot += s.vr * dt;
      if (s.z <= 0) { s.z = 0; s.vz = -s.vz * 0.35; s.vx *= 0.6; s.vy *= 0.6; if (Math.abs(s.vz) < 30) { s.vz = 0; s.vx = 0; s.vy = 0; } }
    }
    for (const d of c.debris) {
      if (d.t <= 0) continue;
      d.t -= dt;
      d.vz -= 700 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.z < 0) { d.z = 0; d.vz = -d.vz * 0.4; d.vx *= 0.6; d.vy *= 0.6; }
    }
    for (const s of c.smoke) {
      if (s.t <= 0) continue;
      s.t -= dt;
      s.z += 30 * dt;
      s.size += 18 * dt;
    }
    for (const f of c.fireballs) if (f.t > 0) f.t -= dt;
  }

  function updateCarFx(dt) {
    for (const car of world.cars) {
      const hp = car.hp ?? CAR_HP;
      if (hp > 0 && hp <= CAR_HP * 0.5) {
        car.smokeT = (car.smokeT ?? 0) - dt;
        if (car.smokeT <= 0) {
          car.smokeT = 0.06 + Math.random() * 0.12;
          const cs = Math.cos(car.angle), sn = Math.sin(car.angle);
          addSmoke(car.x - cs * 14, car.y - sn * 14, 16, 8 + Math.random() * 6, 1.4 + Math.random() * 0.6);
        }
      }
    }
  }

  function removeCar(car) {
    for (const list of [world.cars, police.cars, police.blocks]) {
      const i = list.indexOf(car);
      if (i >= 0) list.splice(i, 1);
    }
  }

  function markHit(x, y, kill) {
    Object.assign(c.hit, { t: HIT_TIME, kill, x: c.mouse.x, y: c.mouse.y });
  }

  function damage(hit, dmg) {
    const target = hit.target;
    if (hit.kind === 'car') {
      if (target === player.car) return;
      const cop = target.driver === 'cop', mission = target.driver === 'target';
      if (target.driver === 'ally') { target.hp = (target.hp ?? CAR_HP) - dmg; markHit(hit.x, hit.y, false); return; }
      target.hp = (target.hp ?? CAR_HP) - dmg;
      let kill = false;
      if (target.hp <= 0) {
        if (mission) target.hp = 1;
        else { kill = true; explodeCar(target); removeCar(target); }
      }
      const heat = cop ? (kill ? 80 : 30) : target.driver === 'npc' || mission ? (kill ? 40 : 15) : 5;
      addHeat(world, heat, cop ? 'shoot cop' : 'shoot car');
      if (cop && kill && ui.rep) ui.rep.add(target.x, target.y, 4);
      markHit(hit.x, hit.y, kill);
    } else if (hit.kind === 'ped') {
      target.hp = (target.hp ?? PED_HP) - dmg;
      const kill = target.hp <= 0;
      alarmPeds(peds, hit.x, hit.y, 200);
      addHeat(world, kill ? 35 : 15, 'shoot ped');
      if (ui.rep) ui.rep.add(target.x, target.y, kill ? -5 : -1);
      if (kill) {
        target.hp = PED_HP;
        target.state = 'DOWN';
        target.timer = 1.2;
        target.tumble = { dx: hit.x - target.x, dy: hit.y - target.y, t: 0 };
      }
      addSparks(hit.x, hit.y, 3);
      markHit(hit.x, hit.y, kill);
    }
  }

  function fire() {
    const w = WEAPONS[c.weapon];
    if (c.ammo[c.weapon] <= 0) {
      c.cool = 0.35;
      if (!c.dryT || c.dryT < performance.now() - 1500) { ui.toast(w.name + ' KOSONG'); c.dryT = performance.now(); }
      return;
    }
    c.ammo[c.weapon]--;
    const car = player.car, src = car || player;
    let base, spread;
    if (car) { base = car.angle; spread = Math.max(DRIVEBY_SPREAD, w.spread); }
    else { base = Math.atan2(c.aim.y - src.y, c.aim.x - src.x); spread = w.spread; player.facing = base; }
    c.cool = w.cooldown;
    // Per-weapon recoil: camera pitch kick (visual) + aim drift upward while firing fast.
    c.kick = Math.min(0.5, c.kick + w.kick);
    c.recoil = Math.min(0.03, c.recoil + w.recoil);
    base += c.recoil;
    if (!car) player.facing = base;
    const reach = car ? 30 : 16;
    const mz = car ? 14 : MUZZLE_H;
    const mxx = src.x + Math.cos(base) * reach, myy = src.y + Math.sin(base) * reach;
    const hits = new Map();
    for (let i = 0; i < w.pellets; i++) {
      const angle = base + (Math.random() * 2 - 1) * spread;
      const hit = c.hitscan(src, angle, { exclude: car, range: w.range });
      const mx = src.x + Math.cos(angle) * reach, my = src.y + Math.sin(angle) * reach;
      addTracer(mx, my, mz, hit.x, hit.y, 12, 1.4, PLAYER_COLOR, 0.1);
      if (i === 0) addFlash(mx, my, mz, angle, w.pellets > 1 ? 26 : 18, PLAYER_COLOR, 0.06);
      if (hit.kind !== 'none' && (i < 2 || w.pellets === 1)) addSparks(hit.x, hit.y, hit.kind === 'wall' ? 3 : 2);
      if (hit.target) {
        const e = hits.get(hit.target);
        if (e) e.dmg += w.damage; else hits.set(hit.target, { hit, dmg: w.damage });
      }
    }
    addShell(mxx, myy, mz, base, 0.5);
    alarmPeds(peds, src.x, src.y, 150);
    for (const { hit, dmg } of hits.values()) damage(hit, dmg);
  }

  function hurtPlayer(dmg) {
    if (c.dead) return;
    player.health -= dmg;
    c.sinceHit = 0;
    c.vignette = VIGNETTE_TIME;
    c.shake = SHAKE_TIME;
  }

  function copAccuracy() {
    const speed = player.car ? Math.abs(player.car.speed) : Math.hypot(player.vx || 0, player.vy || 0);
    return Math.max(0.05, 0.25 + 0.05 * police.stars - 0.25 * Math.min(1, speed / 250));
  }

  function copBullet(sx, sy, z0, dmg, acc, life = 0.18) {
    const target = player.car || player;
    const dist = Math.hypot(target.x - sx, target.y - sy);
    let angle = Math.atan2(target.y - sy, target.x - sx);
    const hits = Math.random() < acc;
    if (!hits) angle += (Math.random() < 0.5 ? -1 : 1) * (0.08 + Math.random() * 0.12);
    const len = hits ? dist : dist + 30;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const wall = wallDistance(world, sx, sy, dx, dy, len);
    addTracer(sx, sy, z0, sx + dx * wall, sy + dy * wall, 12, 3, COP_COLOR, life);
    addFlash(sx + dx * 14, sy + dy * 14, z0, angle, 18, COP_COLOR, 0.08);
    if (hits && wall >= len) {
      if (dmg > 0) {
        hurtPlayer(dmg);
        if (player.car) player.car.hp = (player.car.hp ?? CAR_HP) - dmg * COP_CAR_FACTOR;
      }
      addSparks(target.x, target.y, 3);
    }
  }

  function onScreen(x, y, h) {
    proj.set(x - WORLD_W / 2, h, y - WORLD_H / 2).project(gfx.camera);
    return Math.abs(proj.x) <= 1 && Math.abs(proj.y) <= 1 && proj.z < 1;
  }

  function updateCops(dt) {
    const stars = police.stars;
    const target = player.car || player;
    const acc = copAccuracy();
    for (const cop of police.cars) {
      if (stars < COP_MIN_STARS) { cop.fire = null; continue; }
      if (cop.fireCool > 0) cop.fireCool -= dt;
      const dist = Math.hypot(cop.x - target.x, cop.y - target.y);
      const ok = dist < COP_RANGE && onScreen(cop.x, cop.y, 10) && hasLineOfSight(world, cop.x, cop.y, target.x, target.y);
      if (!cop.fire) {
        if (ok && !(cop.fireCool > 0)) {
          cop.fire = { t: 0, shots: 0 };
          addFlash(cop.x, cop.y, 10, 0, 9, COP_COLOR, COP_TELEGRAPH);
        }
        continue;
      }
      const f = cop.fire;
      if (!ok && f.shots === 0 && f.t < COP_TELEGRAPH) { cop.fire = null; cop.fireCool = 0.5; continue; }
      f.t += dt;
      while (f.shots < COP_BURST && f.t >= COP_TELEGRAPH + f.shots * COP_BURST_GAP) {
        copBullet(cop.x, cop.y, 14, COP_DAMAGE, acc);
        f.shots++;
      }
      if (f.t >= COP_CYCLE) cop.fire = null;
    }
    const heli = police.heli;
    if (!heli || stars < 5) return;
    heli.fireT = (heli.fireT ?? 0) - dt;
    const dist = Math.hypot(heli.x - target.x, heli.y - target.y);
    if (heli.fireT <= 0 && dist < COP_RANGE && onScreen(heli.x, heli.y, 80)) {
      heli.fireT = HELI_INTERVAL;
      copBullet(heli.x, heli.y, 80, HELI_DAMAGE, acc);
    }
  }

  function updateBust(dt) {
    const f = player.car || player;
    const speed = player.car ? Math.abs(player.car.speed) : Math.hypot(player.vx || 0, player.vy || 0);
    const caught = police.stars >= 1 && speed < BUST_SPEED && police.cars.some((cop) => Math.hypot(cop.x - f.x, cop.y - f.y) < BUST_RADIUS);
    c.bust = caught ? c.bust + dt : Math.max(0, c.bust - dt * 2);
    c.bustProgress = c.bust / BUST_SECONDS;
    if (!c.dead && c.bust >= BUST_SECONDS) die('BUSTED');
  }

  function die(kind) {
    c.dead = { kind, t: 0 };
    ui.dead = c.dead;
    ui.state = 'DEAD';
    c.mouseDown = false;
    const loss = Math.floor(ui.money * MONEY_LOSS);
    if (loss > 0) ui.addMoney(-loss);
    missions.abort();
  }

  function tickDead(rawDt) {
    c.dead.t += rawDt;
    if (c.dead.t >= DEAD_SECONDS) respawn();
  }

  function respawn() {
    const car = player.car;
    const from = car || player;
    if (car) { car.driver = null; car.speed = 0; player.car = null; }
    for (const cop of [...police.cars, ...police.blocks]) removeCar(cop);
    police.cars.length = 0; police.blocks.length = 0; police.heli = null;
    police.heat = 0; police.stars = 0; police.evading = false; police.evadeTimer = 0; police.lastSeen = null;

    let best = null, bestD = Infinity;
    for (const p of world.lanePoints) {
      const d = Math.hypot(p.x - from.x, p.y - from.y);
      if (d < bestD && !world.cars.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < 40)) { best = p; bestD = d; }
    }
    if (best) { player.x = best.x; player.y = best.y; }
    player.vx = 0; player.vy = 0;
    player.health = MAX_HEALTH;
    c.sinceHit = REGEN_DELAY; c.bust = 0; c.bustProgress = 0; c.vignette = 0; c.shake = 0; c.explShake = 0; c.kick = 0; c.recoil = 0;
    for (const t of c.tracers) t.t = 0;
    for (const f of c.flashes) f.t = 0;
    for (const s of c.shells) s.t = 0;
    for (const d of c.debris) d.t = 0;
    for (const s of c.smoke) s.t = 0;
    for (const f of c.fireballs) f.t = 0;
    c.dead = null; ui.dead = null; ui.state = 'PLAYING';
    ui.save();
  }

  return c;
}
