// taxi.js — pekerjaan sampingan taksi untuk SUNNY CITY (ambil penumpang → antar ke tujuan).
// Sopir menjemput penumpang dari antrean, mengantar ke tujuan sebelum waktu habis, lalu dibayar
// berdasarkan jarak tempuh + tip yang menyusut setiap kali mengemudi buruk. Penumpang mengeluh
// saat tabrakan/keluar jalur, antrean penumpang terus diisi ulang, dan HUD menunjukkan rute aktif.
// Ditulis sendiri; memakai ui/audio/world/vehicle yang dibaca lebih dulu.
import { addHeat } from './police.js';
import { T, tileAt } from './world.js';

// ——— KONSTANTA BERNALA ———
const PICKUP_RANGE = 48;        // jarak (m) untuk memicu penjemputan penumpang
const DROPOFF_RANGE = 44;       // jarak (m) dianggap "sampai" ke tujuan
const TIME_LIMIT = 90;          // batas waktu antar penumpang sebelum gagal (detik)
const FARE_PER_METER = 0.9;     // bayaran per meter jarak lurus penjemputan→tujuan ($)
const BASE_TIP = 12;            // tip penuh bila mengemudi mulus
const COMPLAINT_TIP = 3;        // tip terpotong per keluhan penumpang
const TIP_MIN = 2;              // tip minimal yang masih dibayarkan
const CRASH_SPEED = 130;        // kecepatan (abs) yang dianggap "menabrak" untuk keluhan
const CRASH_DROP = 60;          // penurunan kecepatan mendadak yang memicu keluhan
const COOLDOWN = 1.2;           // jeda minimum antar keluhan (detik)
const QUEUE_SIZE = 4;           // jumlah penumpang dalam antrean
const QUEUE_MIN_SPACING = 200;  // jarak minimum antar titik jemput antrean agar tersebar

// ——— DATA NAMA PENUMPANG & TUJUAN ———
const PASSENGER_NAMES = ['PAK RADEN', 'IBU SARI', 'RINA', 'BUDE', 'OM TONO', 'TEH DEWI', 'MAS JOKO', 'KAK VINA'];
const DEST_NAMES = ['PASAR SENEN', 'PELABUHAN', 'PUSAT KOTA', 'TAMAN KOTA', 'STASIUN', 'KAMPUS', 'PANTAI', 'MALL'];

// ——— HELPER MURNI ———
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Pilih titik jalur masif (lanePoint) dalam rentang [min,max] dari `from`; mundur ke semua lanePoints.
function spotIn(world, from, min, max) {
  const pool = world.lanePoints.filter((p) => {
    const d = dist(p, from);
    return d >= min && d <= max;
  });
  const src = pool.length ? pool : world.lanePoints;
  return src.length ? src[Math.floor(Math.random() * src.length)] : { x: world.width / 2, y: world.height / 2 };
}

// Bayaran jarak + tip efektif (tip menyusut per keluhan, minimal tetap dibayar).
function fareFor(trip) {
  const meters = trip.distance;
  const tip = clamp(trip.tip - trip.complaints * COMPLAINT_TIP, TIP_MIN, BASE_TIP);
  return { base: Math.round(meters * FARE_PER_METER), tip };
}

// ——— PANEL HUD: rute aktif, penumpang, sisa waktu, antrean, dan keluhan ———
function drawTaxiPanel(t) {
  const ctx2 = t.gfx && t.gfx.hud ? t.gfx.hud : null;
  if (!ctx2 || t.ui.state !== 'PLAYING' || !t.active) return;

  const x = 16, y = 120, w = 250;
  const rows = [];
  if (t.phase === 'pickup') {
    rows.push(['JEMPUT ' + t.trip.name, '#ffd21f']);
    rows.push([Math.round(t.trip.pickupDist) + ' m ke penumpang', '#ffffff']);
    rows.push(['TAKSI ' + (t.queue.length - 1) + ' antre', '#7fe3ff']);
  } else if (t.phase === 'dropoff') {
    rows.push(['ANTAR ' + t.trip.name + ' → ' + t.trip.destName, '#7fe3ff']);
    rows.push([Math.round(t.trip.dropoffDist) + ' m ke tujuan', '#ffffff']);
    rows.push(['WAKTU ' + Math.max(0, Math.ceil(t.trip.remaining)) + ' s — TIP $' + (t.trip.tip - t.trip.complaints * COMPLAINT_TIP), '#7bd66b']);
  } else if (t.phase === 'dropped') {
    rows.push(['SELESAI +$' + t.lastPayout, '#7bd66b']);
    rows.push(['TEKAN T UNTUK TAKSI LAGI', '#ffd21f']);
  } else if (t.phase === 'failed') {
    rows.push(['FAIRE GAGAL — PENUMPANG KABUR', '#ff6a5a']);
    rows.push(['TEKAN T UNTUK ULANG', '#ffd21f']);
  }

  const lineH = 20;
  const boxH = 14 + rows.length * lineH + 12;
  ctx2.save();
  ctx2.fillStyle = 'rgba(8,8,14,0.72)';
  ctx2.fillRect(x, y, w, boxH);
  ctx2.strokeStyle = '#ffd21f';
  ctx2.lineWidth = 1.5;
  ctx2.strokeRect(x + 1.5, y + 1.5, w - 3, boxH - 3);
  ctx2.textAlign = 'left';
  ctx2.textBaseline = 'alphabetic';
  ctx2.font = 'bold 14px sans-serif';
  ctx2.fillStyle = '#ffd21f';
  ctx2.fillText('TAKSI', x + 12, y + 18);
  rows.forEach(([label, color], i) => {
    ctx2.font = 'bold 13px sans-serif';
    ctx2.fillStyle = color;
    ctx2.fillText(label, x + 12, y + 38 + i * lineH);
  });
  ctx2.restore();
}

// ——— API PUBLIK ———
export function createTaxi(ctx) {
  const { world, ui, audio, gfx, player } = ctx;

  const t = {
    world, ui, audio, gfx,
    root: player,
    phase: 'idle',          // 'idle' | 'pickup' | 'dropoff' | 'dropped' | 'failed'
    trip: null,             // perjalanan aktif: nama, tujuan, jarak, tip, sisa waktu, keluhan
    queue: [],              // daftar antrean penumpang ({x, y, name})
    lastPayout: 0,
    complaints: 0,          // jumlah keluhan untuk penumpang saat ini
    cooldown: 0,            // jeda antar keluhan
    prevSpeed: 0,           // kecepatan frame sebelumnya untuk deteksi tabrakan
    markers: [],
    target: null,
    objectiveText: '',

    get active() { return t.phase === 'pickup' || t.phase === 'dropoff'; },

    // Satu tombol T: mulai antrean, ulang setelah selesai/gagal, batal saat aktif.
    onKey() {
      if (ui.state !== 'PLAYING') return false;
      if (t.phase === 'idle' || t.phase === 'dropped' || t.phase === 'failed') {
        t.start();
        audio.click();
        return true;
      }
      if (t.active) {
        t.cancel();
        audio.click();
        return true;
      }
      return false;
    },

    // Isi antrean penumpang tersebar, lalu jadikan penumpang pertama sebagai perjalanan aktif.
    start() {
      t.queue = [];
      const from = (player && player.car) ? { x: player.car.x, y: player.car.y }
        : player ? { x: player.x, y: player.y } : { x: world.width / 2, y: world.height / 2 };
      let cursor = from;
      for (let i = 0; i < QUEUE_SIZE; i++) {
        const p = spotIn(world, cursor, QUEUE_MIN_SPACING, QUEUE_MIN_SPACING * 4);
        t.queue.push({ x: p.x, y: p.y, name: pick(PASSENGER_NAMES) });
        cursor = { x: p.x, y: p.y };
      }
      t.trip = null;
      t.nextPassenger();
      if (!t.trip) {
        // Bila tidak ada penumpang tersisa, tetap buka antrean baru.
        t.start();
        return;
      }
      ui.prompt = null;
      ui.toast('TAKSI — AMBIL PENUMPANG PERTAMA', 3);
      t.refresh();
    },

    // Jadikan penumpang antrean berikutnya sebagai perjalanan pickup aktif.
    nextPassenger() {
      if (!t.queue.length) { t.trip = null; t.phase = 'idle'; t.refresh(); return; }
      const pax = t.queue.shift();
      const dest = spotIn(world, pax, QUEUE_MIN_SPACING * 3, QUEUE_MIN_SPACING * 8);
      t.trip = {
        name: pax.name,
        destName: pick(DEST_NAMES),
        pickup: { x: pax.x, y: pax.y },
        dropoff: { x: dest.x, y: dest.y },
        distance: dist(pax, dest),
        remaining: TIME_LIMIT,
        tip: BASE_TIP,
        complaints: 0,
        pickupDist: 0,
        dropoffDist: 0,
        prevSpeed: 0,
      };
      t.complaints = 0;
      t.cooldown = 0;
      t.phase = 'pickup';
      t.refresh();
    },

    cancel() {
      t.phase = 'idle';
      t.trip = null;
      t.queue = [];
      t.markers = [];
      t.target = null;
      t.objectiveText = '';
      ui.prompt = null;
    },

    fail() {
      ui.toast('PENUMPANG KABUR — FAIRE GAGAL', 4);
      audio.crash(0.5);
      t.phase = 'failed';
      t.markers = [];
      t.target = null;
      t.objectiveText = '';
      ui.prompt = 'Tekan T untuk taksi lagi';
    },

    // Penumpang turun: bayar jarak + tip, lalu lanjut ke penumpang antrean berikutnya.
    dropoff() {
      const { base, tip } = fareFor(t.trip);
      const payout = base + tip;
      t.lastPayout = payout;
      ui.addMoney(payout);
      audio.complete();
      ui.toast('FAIRE SELESAI — ' + t.trip.name + ' → ' + t.trip.destName + ' +$' + payout, 4);
      t.trip = null;
      if (t.queue.length) {
        t.nextPassenger();
        ui.toast('PENUMPANG BERIKUTNYA: ' + t.trip.name, 2);
      } else {
        t.phase = 'dropped';
        t.markers = [];
        t.target = null;
        t.objectiveText = '';
        ui.prompt = 'Tekan T untuk taksi lagi';
        ui.save();
      }
      t.refresh();
    },

    // Catat keluhan penumpang (kelewat waktu/keluar jalur/tabrakan) dan kurangi tip.
    complain(reason) {
      if (t.cooldown > 0 || !t.trip || t.phase !== 'dropoff') return;
      t.cooldown = COOLDOWN;
      t.trip.complaints++;
      t.complaints++;
      ui.toast(t.trip.name + ': ' + reason, 2);
      audio.crash(0.3);
    },

    // Perbarui penanda & teks objektif mengikuti fase perjalanan.
    refresh() {
      if (!t.active) { t.markers = []; t.target = null; return; }
      const focus = t.focus || t.root;
      if (t.phase === 'pickup') {
        t.markers = [{ x: t.trip.pickup.x, y: t.trip.pickup.y, scale: 1.0 }];
        t.target = t.trip.pickup;
        t.objectiveText = 'JEMPUT ' + t.trip.name + ' — ' + Math.round(t.trip.pickupDist) + 'm';
      } else if (t.phase === 'dropoff') {
        t.markers = [{ x: t.trip.dropoff.x, y: t.trip.dropoff.y, scale: 1.0 }];
        t.target = t.trip.dropoff;
        t.objectiveText = 'ANTAR ' + t.trip.name + ' → ' + t.trip.destName + ' — ' + Math.round(t.trip.dropoffDist)
          + 'm — ' + Math.max(0, Math.ceil(t.trip.remaining)) + 's';
      }
    },
  };

  // Bungkus ui.update agar panel taksi ikut tergambar (tanpa mengubah perilaku ui lain).
  const prevUpdate = ui.update.bind(ui);
  ui.update = (dt, c) => { prevUpdate(dt, c); drawTaxiPanel(t); };

  return t;
}

// ——— UPDATE PER-FRAME (dipanggil berdampingan dengan updateRaces) ———
export function updateTaxi(taxi, dt, player) {
  const t = taxi;
  if (t.phase === 'idle' || t.phase === 'dropped' || t.phase === 'failed') return;

  const focus = player.car || player;
  t.focus = focus;
  t.cooldown = Math.max(0, t.cooldown - dt);

  // Mati / tertangkap membatalkan perjalanan diam-diam.
  if (t.ui.state === 'DEAD' || (player.health != null && player.health <= 0)) {
    t.cancel();
    return;
  }

  if (t.phase === 'pickup') {
    t.trip.pickupDist = dist(focus, t.trip.pickup);
    t.objectiveText = 'JEMPUT ' + t.trip.name + ' — ' + Math.round(t.trip.pickupDist) + 'm';
    // Pemain berjalan/mengemudi cukup dekat dengan penumpang memicu penjemputan.
    if (t.trip.pickupDist < PICKUP_RANGE) {
      t.phase = 'dropoff';
      t.trip.prevSpeed = 0;
      audio.pickup();
      ui.toast(t.trip.name + ' NAIK — ' + t.trip.destName, 2);
      ui.prompt = null;
      t.refresh();
    }
    t.refresh();
    return;
  }

  // ——— DROPOFF ———
  const car = player.car;
  t.trip.remaining -= dt;
  if (t.trip.remaining <= 0) { t.fail(); return; }

  t.trip.dropoffDist = dist(focus, t.trip.dropoff);

  // Deteksi mengemudi buruk: keluar jalur, atau tabrakan mendadak saat melaju kencang.
  if (car) {
    const speed = Math.abs(car.speed || 0);
    const onRoad = tileAt(t.world, focus.x, focus.y) === T.ROAD;
    if (!onRoad) t.complain('AWAS! JALAN BESAR DONG!');
    else if (t.trip.prevSpeed > CRASH_SPEED && t.trip.prevSpeed - speed > CRASH_DROP) t.complain('HEY! KECEPATAN DIJAGA!');
    t.trip.prevSpeed = speed;
  }

  if (t.trip.dropoffDist < DROPOFF_RANGE) {
    t.dropoff();
    return;
  }

  t.refresh();
}