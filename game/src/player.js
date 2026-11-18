// player.js — gerak dan kontrol pemain berjalan kaki
const WALK = 150, SPRINT = 260, ACCEL = 1400;

export function createPlayer(x, y) {
  return { x, y, vx: 0, vy: 0, radius: 8, facing: 0, sprinting: false };
}

export function updatePlayer(p, keys, world, dt) {
  let ix = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  let iy = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  const len = Math.hypot(ix, iy);
  if (len) { ix /= len; iy /= len; }
  p.sprinting = keys.has('shift') && len > 0;
  const speed = p.sprinting ? SPRINT : WALK;
  const step = ACCEL * dt;
  p.vx += Math.max(-step, Math.min(step, ix * speed - p.vx));
  p.vy += Math.max(-step, Math.min(step, iy * speed - p.vy));
  if (len) p.facing = Math.atan2(iy, ix);

  p.x = clamp(p.x + p.vx * dt, p.radius, world.width - p.radius);
  resolveBuildings(p, world, 'x');
  p.y = clamp(p.y + p.vy * dt, p.radius, world.height - p.radius);
  resolveBuildings(p, world, 'y');
}

function resolveBuildings(p, world, axis) {
  for (const b of world.buildings) {
    const nx = clamp(p.x, b.x, b.x + b.w), ny = clamp(p.y, b.y, b.y + b.h);
    const dx = p.x - nx, dy = p.y - ny;
    if (dx * dx + dy * dy >= p.radius * p.radius) continue;
    if (axis === 'x') {
      p.x = p.x < b.x + b.w / 2 ? b.x - p.radius : b.x + b.w + p.radius;
      p.vx = 0;
    } else {
      p.y = p.y < b.y + b.h / 2 ? b.y - p.radius : b.y + b.h + p.radius;
      p.vy = 0;
    }
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
