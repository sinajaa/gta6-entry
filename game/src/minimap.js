// minimap.js — pemilik peta SUNNY CITY: raster peta penuh, minimap, dan peta penuh.
//
// Kode gambar peta yang tadinya inline di ui.js (buildMapCanvas + drawMap) dipindah
// ke modul ini supaya ui.js tinggal mendelegasikan ke sini. Tampilan piksel, posisi,
// dan warna dijaga persis agar tidak ada perubahan visual.
//
// Kontrak publik:
//   buildMapCanvas(world) -> canvas raster dasar peta (di-cache oleh ui.js)
//   drawMinimap(ctx, ui)  -> gambar isi peta (raster + panah pemain + penanda misi)
//   drawFullMap(ctx, ui)  -> gambar lapisan peta penuh (judul + isi + legenda)
import { districtOfBlock, T, COLS, ROWS, WORLD_H, WORLD_W } from './world.js';

// Ukuran raster dasar peta yang dipakai minimap dan peta penuh.
const MAP_VIEW_W = 820;
const MAP_VIEW_H = 456;

// Ukuran kanvas HUD tempat peta digambar.
const HUD_W = 960;
const HUD_H = 540;

// Palet warna tetap — identik dengan versi lama agar tampilan tidak berubah.
const OCEAN = '#1b3948';
const ROAD = '#2c2f36';
const PARK = '#4f9a4f';
const PANEL_BG = '#08141c';
const TITLE_COLOUR = '#ffb347';
const HINT_COLOUR = '#ccc';
const PLAYER_COLOUR = '#fff';
const PLAYER_OUTLINE = 'rgba(0,0,0,0.8)';
const MARKER_COLOUR = '#ffd21f';
const DISTRICT_COLOURS = ['#5a7fa8', '#7a8a56', '#8a6b4f'];
const DISTRICT_FALLBACK = '#666';
const DISTRICT_NAMES = ['PUSAT', 'TENGAH', 'PINGGIR'];
const LABEL_FILL = 'rgba(255,255,255,0.75)';
const LABEL_BACK = 'rgba(0,0,0,0.4)';

// Jumlah blok distrik per sisi (tiap blok menampung 10×10 tile).
const BLOCKS = COLS / 10;

// Warna area tiap distrik, dengan warna cadangan bila indeks keluar dari tabel.
function districtFill(district) {
  return DISTRICT_COLOURS[district] || DISTRICT_FALLBACK;
}

// Titik pusat tiap distrik (rata-rata tiap bloknya) untuk menaruh label nama.
function districtCentres() {
  const tileW = MAP_VIEW_W / COLS;
  const tileH = MAP_VIEW_H / ROWS;
  const acc = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; // [sx, sy, jumlah blok]
  for (let by = 0; by < BLOCKS; by++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      const d = districtOfBlock(bx, by);
      acc[d][0] += (bx + 0.5) * 10 * tileW;
      acc[d][1] += (by + 0.5) * 10 * tileH;
      acc[d][2]++;
    }
  }
  return acc.map((c) => ({ x: c[0] / c[2], y: c[1] / c[2], count: c[2] }));
}

// Label nama tiga distrik digambar langsung ke raster dasar.
function drawDistrictLabels(g) {
  const centres = districtCentres();
  g.font = 'bold 13px sans-serif';
  g.textAlign = 'center';
  for (let d = 0; d < DISTRICT_NAMES.length; d++) {
    const c = centres[d];
    if (!c.count) continue;
    g.fillStyle = LABEL_BACK;
    g.fillRect(c.x - 40, c.y - 11, 80, 20);
    g.fillStyle = '#fff';
    g.fillText(DISTRICT_NAMES[d], c.x, c.y + 4);
  }
}

// Geometri peta: faktor skala dunia->kanvas dan offset kiri-atas di kanvas HUD.
function mapGeometry() {
  return {
    sx: MAP_VIEW_W / WORLD_W,
    sy: MAP_VIEW_H / WORLD_H,
    ox: (HUD_W - MAP_VIEW_W) / 2,
    oy: 64,
  };
}

// Bangun raster dasar peta penuh: samudra, distrik, jalan, taman, dan label.
export function buildMapCanvas(world) {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_VIEW_W;
  canvas.height = MAP_VIEW_H;
  const g = canvas.getContext('2d');
  const { sx, sy } = mapGeometry();
  const tileW = MAP_VIEW_W / COLS;
  const tileH = MAP_VIEW_H / ROWS;

  // Samudra / dasar di belakang semua lapisan.
  g.fillStyle = OCEAN;
  g.fillRect(0, 0, MAP_VIEW_W, MAP_VIEW_H);

  // Distrik sebagai blok berwarna 10×10 tile.
  for (let by = 0; by < BLOCKS; by++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      g.fillStyle = districtFill(districtOfBlock(bx, by));
      g.fillRect(bx * 10 * tileW, by * 10 * tileH, 10 * tileW, 10 * tileH);
    }
  }

  // Jalan sebagai coret gelap di atas blok distrik.
  g.fillStyle = ROAD;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (world.tiles[y * COLS + x] === T.ROAD) {
        g.fillRect(x * tileW, y * tileH, tileW + 0.4, tileH + 0.4);
      }
    }
  }

  // Taman.
  g.fillStyle = PARK;
  for (const p of world.parks) {
    g.fillRect(p.x * sx, p.y * sy, p.w * sx, p.h * sy);
  }

  drawDistrictLabels(g);
  return canvas;
}

// Gambar isi peta: raster dasar + panah pemain + penanda misi.
// Mengembalikan false bila tidak ada data peta (mis. world belum tertaut).
export function drawMinimap(ctx, ui) {
  if (!ui.world || !ui.mapCanvas) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PETA TIDAK TERSEDIA', HUD_W / 2, HUD_H / 2);
    return false;
  }
  const { sx, sy, ox, oy } = mapGeometry();
  ctx.drawImage(ui.mapCanvas, ox, oy, MAP_VIEW_W, MAP_VIEW_H);

  // Panah pemain — ikuti arah mobil atau arah hadap karakter.
  const p = ui.player && (ui.player.car || ui.player);
  if (p) {
    const px = ox + p.x * sx;
    const py = oy + p.y * sy;
    const angle = ui.player && ui.player.car ? ui.player.car.angle : (p.facing || 0);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = PLAYER_COLOUR;
    ctx.strokeStyle = PLAYER_OUTLINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-7, 7);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-7, -7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Penanda misi.
  if (ui.missions && ui.missions.markers) {
    for (const m of ui.missions.markers) {
      const mx = ox + m.x * sx;
      const my = oy + m.y * sy;
      ctx.fillStyle = MARKER_COLOUR;
      ctx.strokeStyle = PLAYER_OUTLINE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  return true;
}

// Lapisan peta penuh: latar gelap, judul, isi peta, lalu legenda.
export function drawFullMap(ctx, ui) {
  ctx.save();
  ctx.clearRect(0, 0, HUD_W, HUD_H);
  ctx.fillStyle = PANEL_BG;
  ctx.fillRect(0, 0, HUD_W, HUD_H);

  const ok = drawMinimap(ctx, ui);
  if (!ok) {
    ctx.restore();
    return;
  }

  // Judul dan petunjuk tutup.
  ctx.textAlign = 'center';
  ctx.fillStyle = TITLE_COLOUR;
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('PETA SUNNY CITY', HUD_W / 2, 40);
  ctx.fillStyle = HINT_COLOUR;
  ctx.font = '14px sans-serif';
  ctx.fillText('M / ESC / Enter — tutup peta', HUD_W / 2, 54);

  // Legenda di bawah raster peta.
  const { ox, oy } = mapGeometry();
  ctx.textAlign = 'left';
  ctx.font = '12px sans-serif';
  let lx = ox;
  const ly = oy + MAP_VIEW_H + 22;
  ctx.fillStyle = MARKER_COLOUR;
  ctx.fillRect(lx, ly - 9, 10, 10);
  ctx.fillStyle = '#ddd';
  ctx.fillText('penanda misi', lx + 16, ly);
  const labelW = ctx.measureText('penanda misi').width + 16;
  lx += labelW + 24;
  ctx.fillStyle = '#fff';
  ctx.fillRect(lx, ly - 6, 10, 10);
  ctx.fillStyle = '#ddd';
  ctx.fillText('posisi kamu', lx + 16, ly);

  ctx.restore();
}