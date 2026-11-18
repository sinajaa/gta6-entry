import { TILE, COLS, ROWS, T } from './world.js';
import { nearestEnterable } from './vehicle.js';

const COLORS = { [T.ROAD]: '#6b6e73', [T.SIDEWALK]: '#d9d2c3', [T.GRASS]: '#8fc16a', [T.BUILDING]: '#a89f91' };

export function render(ctx, world, player, cam, fps) {
  const { viewW, viewH } = cam;
  ctx.fillStyle = '#f3e3b5';
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.save();
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-Math.round(cam.x), -Math.round(cam.y));

  drawGround(ctx, world, cam);
  drawParks(ctx, world, cam);
  drawBuildings(ctx, world, cam);
  drawCars(ctx, world, cam);
  if (!player.car) drawPlayer(ctx, player);

  ctx.restore();
  drawHud(ctx, world, player, fps);
}

function drawGround(ctx, world, cam) {
  const x0 = Math.max(0, Math.floor(cam.x / TILE)), x1 = Math.min(COLS - 1, Math.floor((cam.x + cam.visW) / TILE));
  const y0 = Math.max(0, Math.floor(cam.y / TILE)), y1 = Math.min(ROWS - 1, Math.floor((cam.y + cam.visH) / TILE));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = world.tiles[y * COLS + x];
      ctx.fillStyle = COLORS[t];
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      if (t === T.SIDEWALK && (x + y) % 2 === 0) { ctx.fillStyle = 'rgba(0,0,0,0.04)'; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); }
    }
  }
  // lane markings on road centers
  ctx.fillStyle = '#f2c94c';
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (world.tiles[y * COLS + x] !== T.ROAD) continue;
      const vertical = x % 10 < 2 && y % 10 >= 2;
      const horizontal = y % 10 < 2 && x % 10 >= 2;
      if (vertical && x % 10 === 0 && y % 2 === 0) ctx.fillRect((x + 1) * TILE - 2, y * TILE + 4, 4, TILE - 8);
      if (horizontal && y % 10 === 0 && x % 2 === 0) ctx.fillRect(x * TILE + 4, (y + 1) * TILE - 2, TILE - 8, 4);
    }
  }
}

function drawParks(ctx, world, cam) {
  for (const p of world.parks) {
    if (!visible(p, cam)) continue;
    ctx.fillStyle = '#7ab25a';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#e6d9a8';
    ctx.fillRect(p.x + p.w / 2 - 6, p.y, 12, p.h);
    ctx.fillRect(p.x, p.y + p.h / 2 - 6, p.w, 12);
    for (let i = 0; i < 6; i++) {
      const tx = p.x + 20 + ((i * 53) % (p.w - 40)), ty = p.y + 20 + ((i * 97) % (p.h - 40));
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.ellipse(tx + 4, ty + 6, 12, 8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#3f8f4a'; ctx.beginPath(); ctx.arc(tx, ty, 12, 0, 7); ctx.fill();
      ctx.fillStyle = '#58a85c'; ctx.beginPath(); ctx.arc(tx - 3, ty - 3, 7, 0, 7); ctx.fill();
    }
  }
}

function drawBuildings(ctx, world, cam) {
  for (const b of world.buildings) {
    if (!visible({ x: b.x, y: b.y, w: b.w + 40, h: b.h + 40 }, cam)) continue;
    ctx.fillStyle = 'rgba(60,40,20,0.28)';
    ctx.fillRect(b.x + b.height * 0.6, b.y + b.height * 0.6, b.w, b.h);
    ctx.fillStyle = '#8c8173';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(b.x + 3, b.y + 3, b.w - 6, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(b.x + b.w / 2 - 14, b.y + b.h / 2 - 14, 28, 28);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.strokeRect(b.x + 10.5, b.y + 10.5, b.w - 21, b.h - 21);
  }
}

function drawPlayer(ctx, p) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(p.x + 2, p.y + 5, p.radius, p.radius * 0.6, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#2b4a8b';
  ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, 7); ctx.fill();
  ctx.fillStyle = '#f1c27d';
  ctx.beginPath(); ctx.arc(p.x + Math.cos(p.facing) * 2, p.y + Math.sin(p.facing) * 2, 5, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(p.x + Math.cos(p.facing) * 7, p.y + Math.sin(p.facing) * 7, 2, 0, 7); ctx.fill();
}

function drawCars(ctx, world, cam) {
  for (const car of world.cars) {
    if (!visible({ x: car.x - 24, y: car.y - 24, w: 48, h: 48 }, cam)) continue;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-16, -6, 38, 20);
    ctx.rotate(car.angle);
    ctx.fillStyle = car.color;
    ctx.fillRect(-18, -9, 36, 18);
    ctx.fillStyle = '#2a3340';
    ctx.fillRect(-4, -7, 9, 14);
    ctx.fillRect(10, -7, 4, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(-18, -9, 36, 3);
    ctx.fillStyle = '#fff6c8';
    ctx.fillRect(16, -8, 2, 4);
    ctx.fillRect(16, 4, 2, 4);
    ctx.restore();
  }
}

function drawHud(ctx, world, p, fps) {
  const car = p.car;
  ctx.fillStyle = 'rgba(20,20,20,0.6)';
  ctx.fillRect(8, 8, 170, car ? 56 : 40);
  ctx.fillStyle = '#fff';
  ctx.font = '12px monospace';
  const pos = car || p;
  ctx.fillText(`X ${pos.x.toFixed(0)}  Y ${pos.y.toFixed(0)}`, 16, 24);
  ctx.fillText(`FPS ${fps}${p.sprinting && !car ? '  SPRINT' : ''}`, 16, 40);
  if (car) {
    ctx.fillText(`${Math.round(Math.abs(car.speed) * 0.36)} km/j`, 16, 56);
    ctx.fillText('E: keluar mobil', 16, 530);
  } else if (nearestEnterable(world, p)) {
    ctx.fillStyle = 'rgba(20,20,20,0.7)';
    ctx.fillRect(380, 490, 200, 28);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('E: masuk/keluar mobil', 480, 508);
    ctx.textAlign = 'left';
  }
}

function visible(r, cam) {
  return r.x < cam.x + cam.visW && r.x + r.w > cam.x && r.y < cam.y + cam.visH && r.y + r.h > cam.y;
}
