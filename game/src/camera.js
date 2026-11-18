export function createCamera(viewW, viewH) {
  return { x: 0, y: 0, viewW, viewH };
}

export function updateCamera(cam, target, world, dt) {
  const k = 1 - Math.exp(-6 * dt);
  const tx = target.x + target.vx * 0.25 - cam.viewW / 2;
  const ty = target.y + target.vy * 0.25 - cam.viewH / 2;
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  cam.x = Math.max(0, Math.min(world.width - cam.viewW, cam.x));
  cam.y = Math.max(0, Math.min(world.height - cam.viewH, cam.y));
}
