// races.js — balapan jalanan untuk SUNNY CITY (titik start → rantai checkpoint → finish).
// Balapan memakai mobil, punya stopwatch, waktu terbaik per rute, hadiah tunai yang menyusut
// seiring waktu, dan gagal bila timer habis. Penanda HUD ditarik lewat tiga saluran yang sama
// seperti heist/missions (markers/target/objectiveText) plus panel timer kecil di kanvas 2D HUD.
import { addHeat } from './police.js';
import { T, tileAt } from './world.js';

// ——— KONSTANTA BERNAMA ———
const ARRIVE = 40;               // jarak (m) dianggap "sampai" pada titik tujuan
const CHECKPOINT_COUNT = 5;      // jumlah checkpoint antar start dan finish
const CHECKPOINT_SPACING_MIN = 140;  // jarak minimum antar checkpoint berturut-turut
const CHECKPOINT_SPACING_MAX = 320;  // jarak maksimum antar checkpoint berturut-turut
const TIME_LIMIT = 90;           // batas waktu habis sebelum gagal (detik)
const BASE_PAYOUT = 1500;        // hadiah penuh bila finish secepat mungkin
const PAYOUT_RATE = 10;          // pengurangan hadiah ($) per detik yang terpakai
const PULSE_HEAT = 12;           // heat ringan per detik saat keluar jalur jalan
const START_SIGNAL_SECONDS = 3;  // jeda "3, 2, 1, GO" sebelum stopwatch dihitung

// ——— DATA RUTE ———
// Lima rute dengan kepribadian berbeda; checkpoint dihasilkan dari lanePoints (grid jalan).
// `ghost` adalah waktu lap terbaik pabrikan (detik) yang jadi patokan rekor "ghost".
const ROUTE_DEFS = [
  { id: 'coast', name: 'PANTAI SPRINT', checkpoints: CHECKPOINT_COUNT, limit: TIME_LIMIT, ghost: 52 },
  { id: 'grid', name: 'LOOP PUSAT KOTA', checkpoints: CHECKPOINT_COUNT + 1, limit: TIME_LIMIT + 20, ghost: 64 },
  { id: 'harbor', name: 'KELILING PELABUHAN', checkpoints: CHECKPOINT_COUNT + 2, limit: TIME_LIMIT + 40, ghost: 78 },
  { id: 'mountain', name: 'PUNCAK BUKIT', checkpoints: CHECKPOINT_COUNT + 3, limit: TIME_LIMIT + 50, ghost: 88 },
  { id: 'industrial', name: 'KABUPIN INDUSTRI', checkpoints: CHECKPOINT_COUNT + 1, limit: TIME_LIMIT + 30, ghost: 70 },
];

// ——— HELPER MURNI ———
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

// Selisih waktu terpaksa singkat: "+N detik" ketika tertinggal dari ghost, "UNGGUL" bila unggul.
function dtGhost(elapsed, ghost) {
  const d = Math.max(0, Math.round(elapsed - ghost));
  return d > 0 ? '+' + d + 's' : 'UNGGUL';
}

// Pilih satu titik jalur masif dalam rentang [min,max] dari `from`; mundur ke semua lanePoints.
function ringSpot(world, from, min, max) {
  const ring = world.lanePoints.filter((p) => {
    const d = distance(p, from);
    return d >= min && d <= max;
  });
  const pool = ring.length ? ring : world.lanePoints;
  const p = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  return p ? { x: p.x, y: p.y } : { x: world.width / 2, y: world.height / 2 };
}

// Bangun rantai checkpoint yang mengetat menjauhi titik awal, lalu finish jauh dari yang terakhir.
function buildRoute(world, from, count) {
  const checkpoints = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const p = ringSpot(world, cursor, CHECKPOINT_SPACING_MIN, CHECKPOINT_SPACING_MAX);
    // Hindari titik baru yang menempel posisi yang baru dipakai (menjaga arah maju).
    if (i > 0 && distance(p, checkpoints[i - 1]) < CHECKPOINT_SPACING_MIN * 0.6) {
      cursor = { x: p.x, y: p.y };
      continue;
    }
    checkpoints.push(p);
    cursor = p;
  }
  // Pastikan minimal sebanyak could; bila buntu, tambah dari titik jauh acak.
  while (checkpoints.length < count) {
    const p = ringSpot(world, cursor, CHECKPOINT_SPACING_MIN, CHECKPOINT_SPACING_MAX);
    checkpoints.push(p);
    cursor = p;
  }
  return checkpoints;
}

// Bayaran tunai menyusut secara linear dari BASE_PAYOUT terhadap waktu yang dipakai.
function payoutFor(elapsed) {
  return clamp(Math.round(BASE_PAYOUT - PAYOUT_RATE * elapsed), 100, BASE_PAYOUT);
}

// ——— PANEL HUD: stopwatch, hadiah, checkpoint, dan waktu terbaik ———
function drawRacePanel(r) {
  const ctx2 = r.gfx && r.gfx.hud && r.gfx.hud.getContext ? r.gfx.hud.getContext('2d') : null;
  if (!ctx2 || r.ui.state !== 'PLAYING') return;

  const x = 16, y = 200, w = 250;
  const rows = [];
  // Baris status dibedakan per fase.
  if (r.phase === 'countdown') {
    rows.push(['BALAPAN MULAI —', '#ffb300']);
    rows.push([Math.ceil(r.countdown) + '...', '#ffffff']);
  } else if (r.phase === 'running') {
    rows.push(['WAKTU  ' + fmtTime(r.elapsed), '#7fe3ff']);
    rows.push(['CHECKPOINT ' + Math.min(r.checkpoint + 1, r.route.checkpoints.length) + '/' + r.route.checkpoints.length, '#ffd21f']);
    rows.push(['HADIAH  $' + payoutFor(r.elapsed), '#7bd66b']);
    if (r.ghost != null) rows.push(['GHOST  ' + fmtTime(r.ghost) + ' (' + (r.elapsed <= r.ghost ? 'UNGGUL' : dtGhost(r.elapsed, r.ghost)) + ')', '#b48cff']);
  } else if (r.phase === 'finished') {
    rows.push(['SELESAI — ' + fmtTime(r.elapsed), '#7bd66b']);
    rows.push(['HADIAH +$' + r.lastReward, '#7bd66b']);
    if (r.routeBest != null) rows.push(['TERBAIK ' + fmtTime(r.routeBest), '#e0e0e0']);
    if (r.ghost != null) rows.push(['GHOST ' + fmtTime(r.ghost) + (r.beatGhost ? ' — KALAHKAN!' : ''), '#b48cff']);
  } else if (r.phase === 'failed') {
    rows.push(['BALAPAN GAGAL', '#ff6a5a']);
    rows.push(['TEKAN K UNTUK ULANG', '#ffd21f']);
  }

  const lineH = 20;
  const boxH = 14 + rows.length * lineH + 12;
  ctx2.save();
  ctx2.fillStyle = 'rgba(8,8,14,0.72)';
  ctx2.fillRect(x, y, w, boxH);
  ctx2.strokeStyle = '#ffb300';
  ctx2.lineWidth = 1.5;
  ctx2.strokeRect(x + 1.5, y + 1.5, w - 3, boxH - 3);
  ctx2.textAlign = 'left';
  ctx2.textBaseline = 'alphabetic';
  ctx2.font = 'bold 14px sans-serif';
  ctx2.fillStyle = '#ffb300';
  ctx2.fillText(r.routeName, x + 12, y + 18);
  rows.forEach(([label, color], i) => {
    ctx2.font = 'bold 13px sans-serif';
    ctx2.fillStyle = color;
    ctx2.fillText(label, x + 12, y + 38 + i * lineH);
  });
  ctx2.restore();
}

// ——— API PUBLIK ———
export function createRaces(ctx) {
  const { world, ui, audio, gfx, player } = ctx;

  const r = {
    world, ui, audio, gfx,
    root: player,
    phase: 'idle',              // 'idle' | 'countdown' | 'running' | 'finished' | 'failed'
    route: null,                // definisi rute aktif + checkpoint + start/finish
    routeName: '',
    checkpoint: 0,              // checkpoint terakhir yang dilewati
    elapsed: 0,                 // stopwatch (detik) di fase running
    countdown: 0,               // hitung mundur 3..1 sebelum GO
    lastReward: 0,
    routeBest: null,            // waktu terbaik untuk rute ini (null = belum pernah)
    bestByRoute: {},            // cache waktu terbaik per id rute (dalam memori)
    ghost: null,                // waktu lap ghost pabrikan untuk rute aktif (detik)
    beatGhost: false,           // true bila finish lebih cepat dari ghost
    markers: [],
    target: null,
    objectiveText: '',
    pulse: 0,                   // jeda heat saat keluar jalur jalan

    get active() { return r.phase === 'running' || r.phase === 'countdown'; },

    // Satu tombol mengatur semua: mulai dari idle, ulang dari finished/failed, batal saat berjalan.
    onKey() {
      if (ui.state !== 'PLAYING') return false;
      if (r.phase === 'idle' || r.phase === 'finished' || r.phase === 'failed') {
        r.start();
        audio.click();
        return true;
      }
      if (r.active) {
        r.cancel();
        audio.click();
        return true;
      }
      return false;
    },

    start() {
      const from = (player && player.car) ? { x: player.car.x, y: player.car.y }
        : player ? { x: player.x, y: player.y } : { x: world.width / 2, y: world.height / 2 };
      // Pilih rute acak, bangun checkpoint, lalu finish jauh dari checkpoint terakhir.
      const def = ROUTE_DEFS[Math.floor(Math.random() * ROUTE_DEFS.length)];
      const checkpoints = buildRoute(world, from, def.checkpoints);
      const finish = ringSpot(world, checkpoints[checkpoints.length - 1], CHECKPOINT_SPACING_MIN * 2, CHECKPOINT_SPACING_MAX * 2);
      r.route = { ...def, checkpoints, finish, start: { x: from.x, y: from.y } };
      r.routeName = def.name;
      r.routeBest = r.bestByRoute[def.id] != null ? r.bestByRoute[def.id] : null;
      r.ghost = def.ghost;
      r.beatGhost = false;
      r.checkpoint = 0;
      r.elapsed = 0;
      r.countdown = START_SIGNAL_SECONDS;
      r.lastReward = 0;
      r.pulse = 0;
      r.phase = 'countdown';
      r.markers = [];
      r.target = null;
      ui.prompt = null;
      ui.toast('BALAPAN ' + def.name + ' — ' + def.checkpoints + ' CHECKPOINT', 3);
      r.refresh();
    },

    cancel() {
      r.phase = 'idle';
      r.route = null;
      r.markers = [];
      r.target = null;
      r.objectiveText = '';
      ui.prompt = null;
    },

    finish() {
      const reward = payoutFor(r.elapsed);
      r.lastReward = reward;
      const id = r.route.id;
      const isBest = r.bestByRoute[id] == null || r.elapsed < r.bestByRoute[id];
      if (isBest) r.bestByRoute[id] = r.elapsed;
      r.routeBest = r.bestByRoute[id];
      r.beatGhost = r.ghost != null && r.elapsed < r.ghost;
      ui.addMoney(reward);
      audio.complete();
      ui.toast('BALAPAN SELESAI +$' + reward
        + (r.beatGhost ? ' — KALAHKAN GHOST!' : '')
        + (isBest ? ' — REKOR BARU!' : ''), 4);
      r.phase = 'finished';
      r.markers = [];
      r.target = null;
      r.objectiveText = '';
      ui.prompt = 'Tekan K untuk balapan lain';
      ui.save();
    },

    fail() {
      ui.toast('WAKTU HABIS — BALAPAN GAGAL', 4);
      audio.crash(0.5);
      r.phase = 'failed';
      r.markers = [];
      r.target = null;
      r.objectiveText = '';
      ui.prompt = 'Tekan K untuk ulang';
    },

    // Perbarui penanda & teks objektif mengikuti fase dan checkpoint aktif.
    refresh() {
      if (!r.active) { r.markers = []; r.target = null; return; }
      const route = r.route;
      if (r.phase === 'countdown') {
        r.markers = [{ x: route.start.x, y: route.start.y, scale: 1.1 }];
        r.target = route.start;
        r.objectiveText = 'KE GARIS START — ' + Math.round(distance(r.focus, route.start)) + 'm';
        return;
      }
      // Checkpoint aktif adalah yang pertama belum dilewati; finish terakhir.
      const next = r.checkpoint < route.checkpoints.length
        ? route.checkpoints[r.checkpoint]
        : route.finish;
      const isFinish = r.checkpoint >= route.checkpoints.length;
      r.markers = [{ x: next.x, y: next.y, scale: isFinish ? 1.1 : 0.9 }];
      r.target = next;
      const left = Math.max(0, Math.ceil(route.limit - r.elapsed));
      r.objectiveText = (isFinish ? 'GARIS FINISH' : 'CHECKPOINT ' + (r.checkpoint + 1) + '/' + route.checkpoints.length)
        + ' ' + Math.round(distance(r.focus, next)) + 'm — ' + fmtTime(r.elapsed) + '/' + left + 's';
    },
  };

  // Bungkus ui.update agar panel balapan ikut digambar (tanpa mengubah perilaku ui lain).
  const prevUpdate = ui.update.bind(ui);
  ui.update = (dt, c) => { prevUpdate(dt, c); drawRacePanel(r); };

  return r;
}

// ——— UPDATE PER-FRAME (dipanggil berdampingan dengan updateHeists) ———
export function updateRaces(races, dt, player) {
  const r = races;
  if (r.phase === 'idle') return;

  const focus = player.car || player;
  r.focus = focus;

  // Mati / tertangkap membatalkan balapan diam-diam.
  if (r.ui.state === 'DEAD' || (player.health != null && player.health <= 0)) {
    r.cancel();
    return;
  }

  if (r.phase === 'countdown') {
    r.objectiveText = 'KE GARIS START — ' + Math.round(distance(focus, r.route.start)) + 'm';
    // Berdiri cukup dekat dengan garis start memicu hitung mundur; mundur membatalkan jeda.
    if (distance(focus, r.route.start) < ARRIVE) {
      r.countdown -= dt;
      if (r.countdown <= 0) {
        r.phase = 'running';
        r.elapsed = 0;
        audio.pickup();
        ui.toast('GO!', 1.2);
        r.refresh();
        return;
      }
    } else {
      r.countdown = START_SIGNAL_SECONDS;
    }
    r.refresh();
    return;
  }

  if (r.phase === 'finished' || r.phase === 'failed') return;

  // ——— RUNNING ———
  r.elapsed += dt;
  if (r.elapsed > r.route.limit) { r.fail(); return; }

  const route = r.route;
  const isFinish = r.checkpoint >= route.checkpoints.length;
  const cur = isFinish ? route.finish : route.checkpoints[r.checkpoint];

  if (distance(focus, cur) < ARRIVE) {
    if (isFinish) {
      r.finish();
      return;
    }
    r.checkpoint++;
    audio.pickup();
    ui.toast('CHECKPOINT ' + r.checkpoint + '/' + route.checkpoints.length, 1.5);
  }

  // Keluar dari jalur jalan (cutting lewat rumput/trotoar) menyuntik heat ringan agar balapan
  // tetap terasa "ilegal" tapi tidak membuat waktu terbaik jadi tak mungkin (bukan membatalkan).
  r.pulse -= dt;
  if (r.pulse <= 0 && tileAt(r.world, focus.x, focus.y) !== T.ROAD) {
    r.pulse = 1;
    addHeat(r.world, PULSE_HEAT, 'race');
  }

  r.refresh();
}