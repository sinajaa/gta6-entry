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
