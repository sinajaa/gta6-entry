// interiors.js — tiga interior sederhana (restoran, toko senjata, bank): masuk/keluar dengan E
import * as THREE from '../vendor/three.module.min.js';
import { T, tileAt, WORLD_W, WORLD_H } from './world.js';
import { refill } from './weapons.js';
import { addHeat } from './police.js';

const HALF_W = 120, HALF_D = 90, WALL_H = 44, WALK = 150, DOOR_RANGE = 30, PLAYER_R = 8;
const KINDS = [
  { name: 'RESTORAN', color: 0xff9a3c, floor: 0x8a5a3a, wall: 0xd9b48a },
  { name: 'TOKO SENJATA', color: 0xff4a4a, floor: 0x4a4f57, wall: 0x7d8590 },
  { name: 'BANK', color: 0x4aa8ff, floor: 0xb9b3a4, wall: 0xdcd6c6 },
  { name: 'DINER', color: 0xff6b8a, floor: 0x4a3b32, wall: 0xe8c9a8 },
];
const SIDES = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const USE_RANGE = 34, VAULT_CASH = 2500, AMMO_PRICE = 200, MEAL_PRICE = 50, HEIST_HEAT = 390;
const SPOTS = [
  [[-70, -40], [0, -40], [70, -40], [-70, 20], [70, 20]].map(([x, z]) => ({ x, z, id: 'meal', label: 'E: makan (pulihkan HP) $' + MEAL_PRICE })),
  [{ x: 0, z: -14, id: 'ammo', label: 'E: beli ammo $' + AMMO_PRICE }],
  [{ x: 0, z: -50, id: 'vault', label: 'E: buka vault' }],
  [[-70, -40], [0, -40], [70, -40], [-70, 20], [70, 20]].map(([x, z]) => ({ x, z, id: 'meal', label: 'E: makan (pulihkan HP) $' + MEAL_PRICE })),
];

function pickDoors(world, player) {
  const doors = [];
  const cands = world.buildings
    .map((b) => ({ b, d: Math.hypot(b.x + b.w / 2 - player.x, b.y + b.h / 2 - player.y) }))
    .filter((c) => c.d > 90 && c.d < 700 && c.b.w >= 64 && c.b.h >= 64)
    .sort((a, b) => a.d - b.d);
  for (const { b } of cands) {
    if (doors.length === KINDS.length) break;
    for (const [sx, sy] of SIDES) {
      const x = b.x + b.w / 2 + sx * (b.w / 2 + 14), y = b.y + b.h / 2 + sy * (b.h / 2 + 14);
      if (tileAt(world, x, y) !== T.SIDEWALK) continue;
      if (doors.some((d) => Math.hypot(d.x - x, d.y - y) < 150)) continue;
      doors.push({ x, y, kind: doors.length });
      break;
    }
  }
  return doors;
}

const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
function box(group, w, h, d, x, y, z, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

function buildRoom(kind) {
  const g = new THREE.Group();
  g.visible = false;
  const plane = (w, d, y, c) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(c));
    m.rotation.x = -Math.PI / 2; m.position.y = y; g.add(m);
  };
  plane(900, 700, -0.5, 0x15171c);
  plane(HALF_W * 2, HALF_D * 2, 0, kind.floor);
  box(g, HALF_W * 2 + 8, WALL_H, 4, 0, WALL_H / 2, -HALF_D - 2, kind.wall);
  box(g, 4, WALL_H, HALF_D * 2, -HALF_W - 2, WALL_H / 2, 0, kind.wall);
  box(g, 4, WALL_H, HALF_D * 2, HALF_W + 2, WALL_H / 2, 0, kind.wall);
  box(g, HALF_W * 2 + 8, 12, 4, 0, 6, HALF_D + 2, kind.wall);
  box(g, 36, 1.5, 14, 0, 0.8, HALF_D - 8, kind.color);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(40, 3, 14), new THREE.MeshBasicMaterial({ color: 0xfff1c8 }));
  lamp.position.set(0, 110, -10); g.add(lamp);
  box(g, 1.5, 40, 1.5, 0, 130, -10, 0x333333);
  return g;
}

function furnish(g, i) {
  if (i === 0) {
    for (const [x, z] of [[-70, -40], [0, -40], [70, -40], [-70, 20], [70, 20]]) {
      box(g, 36, 3, 36, x, 20, z, 0xf2e6d0);
      box(g, 6, 20, 6, x, 10, z, 0x5a3a22);
      box(g, 14, 8, 14, x - 26, 8, z, 0xb03a2e);
      box(g, 14, 8, 14, x + 26, 8, z, 0xb03a2e);
    }
    box(g, 220, 24, 14, 0, 12, -HALF_D + 10, 0x6b4a2f);
    box(g, 10, 16, 10, 60, 8, 40, 0x6b4a2f); box(g, 14, 14, 14, 60, 15, 40, 0x2f6b4a);
  } else if (i === 1) {
    box(g, 200, 22, 16, 0, 11, -30, 0x2b2f36);
    for (const x of [-90, -45, 0, 45, 90]) {
      box(g, 30, 34, 6, x, 20, -HALF_D + 6, 0x1c1f24);
      box(g, 22, 3, 3, x, 28, -HALF_D + 10, 0x9aa3ad);
      box(g, 22, 3, 3, x, 18, -HALF_D + 10, 0x9aa3ad);
    }
    box(g, 14, 20, 40, -HALF_W + 10, 10, 20, 0x3a3f47);
    box(g, 14, 20, 40, HALF_W - 10, 10, 20, 0x3a3f47);
  } else {
    box(g, 200, 22, 12, 0, 11, -30, 0x6e5a3a);
    box(g, 200, 18, 2, 0, 31, -30, 0x9fd0e8).material.transparent = true;
    box(g, 54, 40, 24, 0, 20, -HALF_D + 14, 0x8c929a);
    g.userData.vaultDoor = box(g, 30, 30, 3, 0, 20, -HALF_D + 26, 0xc9a227);
    for (const x of [-80, 80]) box(g, 14, 14, 14, x, 7, 30, 0x2f6b4a);
  }
  if (i === 3) {
    // Diner: meja counter panjang dengan bangku tunggu di depan, plus beberapa meja samping.
    box(g, 260, 22, 12, 0, 11, -20, 0xc96a3a);          // counter utama
    box(g, 260, 3, 2, 0, 23, -20, 0x5a3a22);            // lis atas counter
    for (const x of [-110, -80, -50, -20, 10, 40, 70]) {
      box(g, 8, 16, 10, x, 8, 0, 0x8a4a2a);              // bangku tunggu
      box(g, 12, 3, 12, x, 18, 0, 0xb03a2e);             // dudukan bangku
    }
    for (const [x, z] of [[-80, 40], [80, 40]]) {        // meja samping
      box(g, 30, 3, 30, x, 15, z, 0xf2e6d0);
      box(g, 6, 15, 6, x, 7, z, 0x5a3a22);
    }
    box(g, 40, 6, 6, -HALF_W + 24, 16, -HALF_D + 10, 0xc9a227); // mesin kasir emas kecil
  }
}

export function createInteriors({ world, player, ui, gfx, combat }) {
  const doors = pickDoors(world, player);
  const rooms = KINDS.map((k, i) => { const g = buildRoom(k); furnish(g, i); gfx.scene.add(g); return g; });
  const exitPos = { x: WORLD_W / 2, y: WORLD_H / 2 + HALF_D - 8 };
  const markers = doors.map((d) => {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5, 60, 10),
      new THREE.MeshBasicMaterial({ color: KINDS[d.kind].color, transparent: true, opacity: 0.55, fog: false }),
    );
    m.position.set(d.x - WORLD_W / 2, 30, d.y - WORLD_H / 2);
    gfx.scene.add(m);
    return m;
  });
  const it = { active: false, doors, current: -1, saved: null, vaultOpen: false, heistPending: false };

  const nearDoor = () => doors.find((d) => Math.hypot(d.x - player.x, d.y - player.y) < DOOR_RANGE);
  const nearSpot = () => {
    if (!it.active) return null;
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    return SPOTS[doors[it.current].kind].find((s) => Math.hypot(cx + s.x - player.x, cy + s.z - player.y) < USE_RANGE) || null;
  };
  const nearExit = () => Math.hypot(player.x - exitPos.x, player.y - exitPos.y) <= DOOR_RANGE;

  function useSpot(s) {
    if (s.id === 'vault') {
      if (it.vaultOpen) { ui.toast('Vault sudah kosong'); return; }
      it.vaultOpen = true; it.heistPending = true;
      const door = rooms[2].userData.vaultDoor;
      door.rotation.y = -1.2; door.position.x -= 14; door.position.z += 10;
      ui.addMoney(VAULT_CASH);
    } else if (s.id === 'ammo') {
      const door = doors[it.current], rep = ui.rep;
      const price = rep ? rep.price(AMMO_PRICE, door.x, door.y) : AMMO_PRICE;
      if (ui.money < price) { ui.toast('Uang kurang ($' + price + ')'); return; }
      ui.addMoney(-price);
      if (combat) refill(combat.ammo);
      if (rep) rep.add(door.x, door.y, 2);
      ui.toast('AMMO +');
    } else if (s.id === 'meal') {
      if (player.health >= player.maxHealth) { ui.toast('HP sudah penuh'); return; }
      if (ui.money < MEAL_PRICE) { ui.toast('Uang kurang ($' + MEAL_PRICE + ')'); return; }
      ui.addMoney(-MEAL_PRICE);
      if (ui.rep) ui.rep.add(doors[it.current].x, doors[it.current].y, 1);
      player.health = player.maxHealth;
      ui.toast('HP pulih');
    }
  }

  it.tryInteract = () => {
    if (it.active) {
      const s = nearSpot();
      if (s) { useSpot(s); return true; }
      if (!nearExit()) return true;
      const d = doors[it.current];
      rooms[d.kind].visible = false;
      player.x = d.x; player.y = d.y; player.vx = player.vy = 0;
      it.active = false; it.current = -1;
      gfx.camera.userData.look = null;
      if (it.heistPending) {
        it.heistPending = false;
        addHeat(world, Math.max(0, HEIST_HEAT - world.police.heat), 'heist');
        ui.toast('PERAMPOKAN BANK!', 3);
      }
      return true;
    }
    if (player.car) return false;
    const d = nearDoor();
    if (!d) return false;
    it.active = true; it.current = doors.indexOf(d);
    it.saved = { x: player.x, y: player.y };
    player.x = exitPos.x; player.y = exitPos.y - 30; player.vx = player.vy = 0;
    rooms[d.kind].visible = true;
    ui.toast(KINDS[d.kind].name, 2.5);
    return true;
  };

  it.update = (dt, keys) => {
    if (!it.active) {
      const d = player.car ? null : nearDoor();
      ui.prompt = d ? 'E: masuk ' + KINDS[d.kind].name : null;
      return false;
    }
    const s = nearSpot();
    const door = doors[it.current];
    ui.prompt = s ? (s.id === 'vault' && it.vaultOpen ? null : s.id === 'ammo' && ui.rep ? 'E: beli ammo $' + ui.rep.price(AMMO_PRICE, door.x, door.y) : s.label) : nearExit() ? 'E: keluar' : null;
    const k = (n) => keys.has(n);
    let ix = (k('d') || k('arrowright') ? 1 : 0) - (k('a') || k('arrowleft') ? 1 : 0);
    let iy = (k('s') || k('arrowdown') ? 1 : 0) - (k('w') || k('arrowup') ? 1 : 0);
    const len = Math.hypot(ix, iy);
    if (len) { ix /= len; iy /= len; player.facing = Math.atan2(iy, ix); }
    player.vx = ix * WALK; player.vy = iy * WALK;
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    player.x = Math.max(cx - HALF_W + PLAYER_R, Math.min(cx + HALF_W - PLAYER_R, player.x + player.vx * dt));
    player.y = Math.max(cy - HALF_D + PLAYER_R, Math.min(cy + HALF_D - PLAYER_R, player.y + player.vy * dt));
    const c = gfx.camera, px = player.x - cx, pz = player.y - cy;
    c.position.set(px * 0.7, 125, pz + 115);
    c.lookAt(px * 0.7, 0, pz - 15);
    return true;
  };

  const hidden = [];
  it.beforeDraw = () => {
    for (const m of markers) m.visible = !it.active;
    if (!it.active) return;
    hidden.length = 0;
    for (const o of gfx.scene.children) {
      if (o.isLight || o === gfx.playerMesh || rooms.includes(o) || !o.visible) continue;
      o.visible = false; hidden.push(o);
    }
  };
  it.afterDraw = () => { for (const o of hidden) o.visible = true; hidden.length = 0; };
  return it;
}
