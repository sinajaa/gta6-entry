// camera.js — kamera chase 3D dan zoom saat mengemudi
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

const WALK = { up: 250, back: 360, fov: 46, lookY: 80 };
const DRIVE = { up: 310, back: 490, fov: 52, lookY: 80 };
const DOLLY_MAX = 90, SPEED_MAX = 320, EDGE_MARGIN = 200;

export function updateCamera3D(cam3d, actor, mode, dt) {
  const driving = mode === 'drive';
  const o = driving ? DRIVE : WALK;
  const dolly = driving ? DOLLY_MAX * Math.min(1, Math.abs(actor.speed) / SPEED_MAX) : 0;
  const backX = driving ? -Math.cos(actor.angle) : 0;
  const backZ = driving ? -Math.sin(actor.angle) : 1;
  const tx = actor.x - WORLD_W_HALF, tz = actor.y - WORLD_H_HALF;
  const limX = WORLD_W_HALF + EDGE_MARGIN, limZ = WORLD_H_HALF + EDGE_MARGIN;
  const wantX = Math.max(-limX, Math.min(limX, tx + backX * (o.back + dolly)));
  const wantY = o.up;
  const wantZ = Math.max(-limZ, Math.min(limZ, tz + backZ * (o.back + dolly)));

  const state = cam3d.userData;
  if (!state.look) {
    state.look = cam3d.position.clone().set(tx, o.lookY, tz);
    cam3d.position.set(wantX, wantY, wantZ);
    cam3d.fov = o.fov;
    cam3d.updateProjectionMatrix();
  }
  const k = 1 - Math.pow(0.0015, dt);
  cam3d.position.x += (wantX - cam3d.position.x) * k;
  cam3d.position.y += (wantY - cam3d.position.y) * k;
  cam3d.position.z += (wantZ - cam3d.position.z) * k;
  state.look.x += (tx - state.look.x) * 0.25;
  state.look.y += (o.lookY - state.look.y) * 0.25;
  state.look.z += (tz - state.look.z) * 0.25;
  cam3d.lookAt(state.look);
  if (Math.abs(cam3d.fov - o.fov) > 0.01) {
    cam3d.fov += (o.fov - cam3d.fov) * 0.15;
    cam3d.updateProjectionMatrix();
  }
}
