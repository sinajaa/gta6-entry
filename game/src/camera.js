import { WORLD_W, WORLD_H } from "./world.js";
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

const WALK_OFFSET = { up: 190, back: 230, fov: 55 };
const DRIVE_OFFSET = { up: 260, back: 340, fov: 65 };
const DOLLY_MAX = 80, SPEED_MAX = 320;

export function updateCamera3D(cam3d, actor, mode, dt) {
  const driving = mode === 'drive';
  const o = driving ? DRIVE_OFFSET : WALK_OFFSET;
  const half = { x: WORLD_W_HALF, z: WORLD_H_HALF };
  const dolly = driving ? DOLLY_MAX * Math.min(1, Math.abs(actor.speed) / SPEED_MAX) : 0;
  const backX = driving ? -Math.cos(actor.angle) : 0;
  const backZ = driving ? -Math.sin(actor.angle) : 1;
  const tx = actor.x - half.x, tz = actor.y - half.z;
  const wantX = tx + backX * (o.back + dolly);
  const wantY = o.up;
  const wantZ = tz + backZ * (o.back + dolly);

  const state = cam3d.userData;
  if (!state.look) {
    state.look = cam3d.position.clone().set(tx, 0, tz);
    cam3d.position.set(wantX, wantY, wantZ);
    cam3d.fov = o.fov;
  }
  const k = 1 - Math.pow(0.001, dt);
  cam3d.position.x += (wantX - cam3d.position.x) * k;
  cam3d.position.y += (wantY - cam3d.position.y) * k;
  cam3d.position.z += (wantZ - cam3d.position.z) * k;
  state.look.x += (tx - state.look.x) * k;
  state.look.z += (tz - state.look.z) * k;
  cam3d.lookAt(state.look);
  if (Math.abs(cam3d.fov - o.fov) > 0.01) {
    cam3d.fov += (o.fov - cam3d.fov) * k;
    cam3d.updateProjectionMatrix();
  }
}
