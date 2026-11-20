// photo.js — mode foto: dunia beku, kamera orbit/zoom mengelilingi pemain,
// filter warna CSS pada canvas, grid rule-of-thirds, simpan PNG.
// Kontrak: createPhoto(ctx) -> state; updatePhoto(photo, dt, input) dipanggil tiap frame saat mode foto aktif.
// ctx = { gfx, canvas, world, ui, focus: () => actor, render: () => void }

const ORBIT_SPEED = 1.6;          // rad/detik
const PITCH_SPEED = 0.9;          // rad/detik
const ZOOM_SPEED = 70;            // unit/detik
const PITCH_MIN = 0.02, PITCH_MAX = 1.3;
const DIST_MIN = 25, DIST_MAX = 260;
const LOOK_Y = 12;
const CAM_FLOOR = 3;              // kamera tidak boleh masuk ke tanah
const GRID_ID = 'photo-grid';

// Urutan sama dengan ui.photoFilter (tombol F di ui.js): indeks 0 = normal.
export const PHOTO_CSS_FILTERS = [
  { name: 'NORMAL', css: '' },
  { name: 'NOIR', css: 'grayscale(1) contrast(1.25) brightness(0.95)' },
  { name: 'WARM', css: 'sepia(0.45) saturate(1.3) hue-rotate(-12deg)' },
  { name: 'COOL', css: 'saturate(1.1) hue-rotate(18deg) brightness(1.02)' },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function makeGrid(canvas) {
  const grid = document.createElement('div');
  grid.id = GRID_ID;
  const line = 'rgba(255,255,255,0.55)';
  Object.assign(grid.style, {
    position: 'absolute', pointerEvents: 'none', display: 'none', zIndex: '5',
    backgroundImage:
      `linear-gradient(to right, transparent calc(33.333% - 0.5px), ${line} calc(33.333% - 0.5px), ${line} calc(33.333% + 0.5px), transparent calc(33.333% + 0.5px)),` +
      `linear-gradient(to right, transparent calc(66.666% - 0.5px), ${line} calc(66.666% - 0.5px), ${line} calc(66.666% + 0.5px), transparent calc(66.666% + 0.5px)),` +
      `linear-gradient(to bottom, transparent calc(33.333% - 0.5px), ${line} calc(33.333% - 0.5px), ${line} calc(33.333% + 0.5px), transparent calc(33.333% + 0.5px)),` +
      `linear-gradient(to bottom, transparent calc(66.666% - 0.5px), ${line} calc(66.666% - 0.5px), ${line} calc(66.666% + 0.5px), transparent calc(66.666% + 0.5px))`,
  });
  (canvas.parentNode || document.body).appendChild(grid);
  return grid;
}

function placeGrid(photo) {
  const r = photo.canvas.getBoundingClientRect();
  const parent = photo.grid.offsetParent;
  const pr = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
  const s = photo.grid.style;
  s.left = r.left - pr.left + 'px'; s.top = r.top - pr.top + 'px';
  s.width = r.width + 'px'; s.height = r.height + 'px';
}

export function createPhoto(ctx) {
  const photo = {
    gfx: ctx.gfx, canvas: ctx.canvas, world: ctx.world, ui: ctx.ui,
    focus: ctx.focus, render: ctx.render,
    yaw: -Math.PI / 2, pitch: 0.35, dist: 90,
    showGrid: true, active: false, held: new Set(),
    grid: makeGrid(ctx.canvas),
    toggleGrid() { photo.showGrid = !photo.showGrid; },
    save() { return savePhoto(photo); },
    reset() { photo.yaw = -Math.PI / 2; photo.pitch = 0.35; photo.dist = 90; },
  };
  addEventListener('keydown', (e) => {
    if (!photo.active) return;
    const k = e.key.toLowerCase();
    if (k === 'g' && !e.repeat) { photo.toggleGrid(); return; }
    photo.held.add(k);
    if (k.startsWith('arrow')) e.preventDefault();
  });
  addEventListener('keyup', (e) => photo.held.delete(e.key.toLowerCase()));
  addEventListener('blur', () => photo.held.clear());
  return photo;
}

function applyCamera(photo) {
  const f = photo.focus();
  const w = photo.world;
  const cx = f.x - w.width / 2, cz = f.y - w.height / 2;
  const cp = Math.cos(photo.pitch);
  const cam = photo.gfx.camera;
  cam.position.set(
    cx + Math.cos(photo.yaw) * cp * photo.dist,
    Math.max(CAM_FLOOR, LOOK_Y + Math.sin(photo.pitch) * photo.dist),
    cz + Math.sin(photo.yaw) * cp * photo.dist,
  );
  cam.lookAt(cx, LOOK_Y, cz);
  if (cam.userData.ghost) cam.userData.ghost.length = 0;
}

function setVisuals(photo, on) {
  const idx = (photo.ui.photoFilter || 0) % PHOTO_CSS_FILTERS.length;
  photo.canvas.style.filter = on ? PHOTO_CSS_FILTERS[idx].css : '';
  photo.grid.style.display = on && photo.showGrid ? 'block' : 'none';
  if (on && photo.showGrid) placeGrid(photo);
}

export function updatePhoto(photo, dt, input = photo.held) {
  const on = photo.ui.state === 'PHOTO';
  if (!on) {
    if (photo.active) { photo.active = false; photo.held.clear(); setVisuals(photo, false); }
    return;
  }
  photo.active = true;
  const left = input.has('arrowleft') || input.has('a');
  const right = input.has('arrowright') || input.has('d');
  const up = input.has('arrowup'), down = input.has('arrowdown');
  photo.yaw += ((left ? 1 : 0) - (right ? 1 : 0)) * ORBIT_SPEED * dt;
  photo.pitch = clamp(photo.pitch + ((up ? 1 : 0) - (down ? 1 : 0)) * PITCH_SPEED * dt, PITCH_MIN, PITCH_MAX);
  const zoom = (input.has('s') || input.has('-') ? 1 : 0) - (input.has('w') || input.has('=') || input.has('+') ? 1 : 0);
  photo.dist = clamp(photo.dist + zoom * ZOOM_SPEED * dt, DIST_MIN, DIST_MAX);
  applyCamera(photo);
  setVisuals(photo, true);
}

// Render ulang lalu salin canvas WebGL segera (buffer tidak dipertahankan), dengan filter dipanggang.
export function savePhoto(photo) {
  try {
    photo.render();
    const src = photo.canvas;
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const g = out.getContext('2d');
    g.filter = PHOTO_CSS_FILTERS[(photo.ui.photoFilter || 0) % PHOTO_CSS_FILTERS.length].css || 'none';
    g.drawImage(src, 0, 0);
    const a = document.createElement('a');
    a.download = `sunnycity-photo-${Date.now()}.png`;
    a.href = out.toDataURL('image/png');
    a.click();
    photo.ui.toast('FOTO DISIMPAN');
    return true;
  } catch (err) { console.warn('foto gagal disimpan:', err); return false; }
}
