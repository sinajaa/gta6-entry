// camera.js — kamera chase 3D dan zoom saat mengemudi
// Logika kamera chase ini ditulis khusus untuk entry SUNNY CITY.
import { WORLD_W, WORLD_H, TILE, COLS, ROWS } from "./world.js";
const WORLD_W_HALF = WORLD_W / 2, WORLD_H_HALF = WORLD_H / 2;
const DRIVE_ZOOM = 0.75;

export function createCamera(viewW, viewH) {
  return { x: 0, y: 0, viewW, viewH, zoom: 1, visW: viewW, visH: viewH };
}

export function updateCamera(cam, target, world, dt, driving = false) {
  const k = 1 - Math.exp(-6 * dt);
  cam.zoom += ((driving ? DRIVE_ZOOM : 1) - cam.zoom) * (1 - Math.exp(-3 * dt));
  cam.visW = cam.viewW / cam.zoom;
  cam.visH = cam.viewH / cam.zoom;
  const lookAhead = driving ? 0.7 : 0.25;
  const tx = target.x + target.vx * lookAhead - cam.visW / 2;
  const ty = target.y + target.vy * lookAhead - cam.visH / 2;
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  cam.x = Math.max(0, Math.min(world.width - cam.visW, cam.x));
  cam.y = Math.max(0, Math.min(world.height - cam.visH, cam.y));
}

const WALK = { up: 58, back: 178, fov: 62, lookY: 22 };
const DRIVE = { up: 72, back: 226, fov: 66, lookY: 18 };
const FOV_KICK = 6, KICK_SPEED = 0.8 * 320, PULL_DIST = 120, GHOST_MAX = 8, CAM_NEAR = 2, CAM_FAR = 2400;
const MIN_DIST = 14, RAY_STEP = 8, RAY_SIDE = 10, RAY_MARGIN = 4;

let heightGrid = null, idGrid = null, hitId = -1;
function buildHeightGrid(world) {
  heightGrid = new Uint16Array(COLS * ROWS);
  idGrid = new Int32Array(COLS * ROWS).fill(-1);
  world.buildings.forEach((b, i) => {
    for (let y = b.y / TILE; y < (b.y + b.h) / TILE; y++) for (let x = b.x / TILE; x < (b.x + b.w) / TILE; x++) { heightGrid[y * COLS + x] = b.height; idGrid[y * COLS + x] = i; }
  });
}
function blockedAt(x, z, y) {
  const gx = Math.floor((x + WORLD_W_HALF) / TILE), gz = Math.floor((z + WORLD_H_HALF) / TILE);
  if (gx < 0 || gz < 0 || gx >= COLS || gz >= ROWS) return false;
  if (heightGrid[gz * COLS + gx] > y - RAY_MARGIN) { hitId = idGrid[gz * COLS + gx]; return true; }
  return false;
}
// jarak dari titik look sepanjang arah (dx,dz) sampai kena bangunan; Infinity bila bebas
function firstHit(lx, ly, lz, dx, dz, len, camY, offset) {
  const px = -dz * offset, pz = dx * offset;
  for (let s = RAY_STEP; s <= len; s += RAY_STEP) {
    const y = ly + (camY - ly) * (s / len);
    if (blockedAt(lx + px + dx * s, lz + pz + dz * s, y)) return s;
  }
  return Infinity;
}
const DOLLY_MAX = 90, SPEED_MAX = 320, EDGE_MARGIN = 200;

export function updateCamera3D(cam3d, actor, mode, dt, world) {
  const driving = mode === 'drive';
  const o = driving ? DRIVE : WALK;
  const dolly = driving ? DOLLY_MAX * Math.min(1, Math.abs(actor.speed) / SPEED_MAX) : 0;
  const backX = driving ? -Math.cos(actor.angle) : 0;
  const backZ = driving ? -Math.sin(actor.angle) : 1;
  const tx = actor.x - WORLD_W_HALF, tz = actor.y - WORLD_H_HALF;
  const limX = WORLD_W_HALF + EDGE_MARGIN, limZ = WORLD_H_HALF + EDGE_MARGIN;
  const wantX = Math.max(-limX, Math.min(limX, tx + backX * (o.back + dolly)));
  const kick = driving && Math.abs(actor.speed) > KICK_SPEED ? FOV_KICK : 0;
  const wantFov = o.fov + kick;
  const wantY = o.up;
  const wantZ = Math.max(-limZ, Math.min(limZ, tz + backZ * (o.back + dolly)));

  const state = cam3d.userData;
  if (!state.look) {
    state.look = cam3d.position.clone().set(tx, o.lookY, tz);
    cam3d.position.set(wantX, wantY, wantZ);
    cam3d.fov = wantFov;
    cam3d.near = CAM_NEAR; cam3d.far = CAM_FAR;
    cam3d.updateProjectionMatrix();
  }
  const k = 1 - Math.pow(0.0015, dt);
  cam3d.position.x += (wantX - cam3d.position.x) * k;
  cam3d.position.y += (wantY - cam3d.position.y) * k;
  cam3d.position.z += (wantZ - cam3d.position.z) * k;
  state.look.x += (tx - state.look.x) * 0.25;
  state.look.y += (o.lookY - state.look.y) * 0.25;
  state.look.z += (tz - state.look.z) * 0.25;

  let hx = cam3d.position.x - state.look.x, hz = cam3d.position.z - state.look.z;
  const len = Math.hypot(hx, hz) || 1;
  hx /= len; hz /= len;
  if (world) {
    if (!heightGrid) buildHeightGrid(world);
    let hit = Infinity;
    const ghost = state.ghost || (state.ghost = []);
    ghost.length = 0;
    for (const off of [0, RAY_SIDE, -RAY_SIDE]) {
      const s = firstHit(state.look.x, state.look.y, state.look.z, hx, hz, len, cam3d.position.y, off);
      if (s === Infinity) continue;
      if (ghost.length < GHOST_MAX && !ghost.includes(hitId)) ghost.push(hitId);
      if (s < PULL_DIST) hit = Math.min(hit, s);
    }
    if (hit !== Infinity) {
      const dist = Math.max(MIN_DIST, hit - RAY_STEP);
      const shortfall = Math.max(0, MIN_DIST - (hit - RAY_STEP));
      cam3d.position.x = state.look.x + hx * dist;
      cam3d.position.z = state.look.z + hz * dist;
      cam3d.position.y += shortfall * 0.3;
    }
  }
  const px = cam3d.position.x - tx, pz = cam3d.position.z - tz, pd = Math.hypot(px, pz);
  if (pd < MIN_DIST) {
    const f = pd > 0.001 ? MIN_DIST / pd : 0;
    cam3d.position.x = tx + (pd > 0.001 ? px * f : hx * MIN_DIST);
    cam3d.position.z = tz + (pd > 0.001 ? pz * f : hz * MIN_DIST);
  }
  cam3d.lookAt(state.look);
  if (Math.abs(cam3d.fov - wantFov) > 0.01) {
    cam3d.fov += (wantFov - cam3d.fov) * 0.15;
    cam3d.updateProjectionMatrix();
  }
}
