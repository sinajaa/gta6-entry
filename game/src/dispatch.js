// dispatch.js — pekerjaan darurat lewat telepon umum untuk SUNNY CITY (ambil panggilan → lari ke lokasi).
// Pemain mendekati telepon umum (titik lane), menekan G, lalu menerima satu dari tiga tugas darurat:
//   AMBULANCE — jemput sederet pasien dalam batas waktu, lalu antar ke rumah sakit.
//   FIRE — api melahap satu tile dan menjalar ke tile tetangga; padamkan semuanya sebelum merambat liar.
//   TOW — derek mobil rusak dari lokasi ke bengkel/penampungan.
// Setiap tugas punya bayaran yang naik seiring kesulitan (difficulty ramp), hitungan mundur, dan HUD
// digambar lewat gfx.hud. Ditulis sendiri; memakai ui/audio/world yang dibaca lebih dulu.
import { T, TILE, COLS, ROWS, tileAt } from './world.js';

// ——— KONSTANTA PENALAAN ———
const PAYPHONE_RANGE = 60;      // jarak (m) untuk menjawab telepon umum
const AMB_TIMER = 75;           // batas waktu antar pasien sebelum gagal (detik)
const FIRE_TIMER = 90;          // batas waktu pemadaman kebakaran (detik)
const TOW_TIMER = 70;           // batas waktu derek sebelum gagal (detik)
const AMB_PATIENTS = 4;         // jumlah pasien per panggilan ambulans
const FIRE_START = 3;           // jumlah tile api awal
const FIRE_ROWS_MAX = 7;        // ambang rambat maksimal sebelum dianggap gagal
const FIRE_SPREAD_TIME = 7;     // jeda (detik) antar rambatan api
const PATIENT_RANGE = 34;       // jarak pemicu "jemput pasien"
const FIRE_RANGE = 40;          // jarak pemicu "padamkan tile"
const DROP_RANGE = 44;          // jarak pemicu antar/derek selesai
const TOW_ATTACH_RANGE = 40;    // jarak pemicu "kaitkan mobil rusak"
const PAY_PER_PATIENT = 55;     // bayaran dasar per pasien
const PAY_PER_FIRE = 40;        // bayaran per tile api dipadamkan
const TOW_PAY = 220;            // bayaran dasar derek
const RAMP = 10;                // persen naik bayaran per panggilan sukses
const MIN_SPACING = 180;        // jarak minimum antar titik agar tersebar
const MAX_SPACING = 420;        // jarak maksimum antar titik agar tidak terlalu jauh

// ——— HELPER MURNI ———
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Pilih titik jalur (lanePoint) dalam rentang [min,max] dari `from`; mundur ke semua lanePoints.
function spotIn(world, from, min, max) {
  const pool = world.lanePoints.filter((p) => {
    const d = dist(p, from);
    return d >= min && d <= max;
  });
  const src = pool.length ? pool : world.lanePoints;
  return src.length ? src[Math.floor(Math.random() * src.length)] : { x: world.width / 2, y: world.height / 2 };
}

// Pilih tile api awal: tile jalan/trotoar yang belum terbakar, dekat `from`.
function burnTile(world, from, min, max) {
  const tries = 400;
  for (let i = 0; i < tries; i++) {
    const tx = Math.floor(Math.random() * COLS), ty = Math.floor(Math.random() * ROWS);
    if (tileAt(world, tx * TILE + TILE / 2, ty * TILE + TILE / 2) === T.BUILDING) continue;
    const px = tx * TILE + TILE / 2, py = ty * TILE + TILE / 2;
    if (dist({ x: px, y: py }, from) < min || dist({ x: px, y: py }, from) > max) continue;
    return { tx, ty };
  }
  const fall = spotIn(world, from, min, max);
  return { tx: Math.floor(fall.x / TILE), ty: Math.floor(fall.y / TILE) };
}

// ——— PANEL HUD: tugas aktif, status, sisa waktu, dan bayaran ———
function drawDispatchPanel(d) {
  const ctx2 = d.gfx && d.gfx.hud ? d.gfx.hud : null;
  if (!ctx2 || d.ui.state !== 'PLAYING' || !d.active) return;

  const x = 16, y = 216, w = 270;
  const rows = [];
  let color = '#ffd21f';
  if (d.job === 'ambulance') {
    color = '#7fe3ff';
    rows.push(['AMBULANS — ' + d.done + '/' + AMB_PATIENTS + ' PASIEN', '#7fe3ff']);
    if (d.patient) rows.push(['JEMPUT ' + Math.round(dist(d.focus, d.patient)) + ' m', '#ffffff']);
    else rows.push(['ANTAR KE RS ' + Math.round(dist(d.focus, d.hospital)) + ' m', '#ffffff']);
    rows.push(['WAKTU ' + Math.max(0, Math.ceil(d.timeLeft)) + ' s', '#7bd66b']);
  } else if (d.job === 'fire') {
    color = '#ff8a3d';
    rows.push(['KEBAKARAN — ' + d.fires.length + ' TITIK API', '#ff8a3d']);
    rows.push(['PADAMKAN ' + Math.round(d.nearFire) + ' m', '#ffffff']);
    rows.push(['RAMBAT ' + d.fires.length + '/' + FIRE_ROWS_MAX + ' · WAKTU ' + Math.max(0, Math.ceil(d.timeLeft)) + ' s', '#7bd66b']);
  } else if (d.job === 'tow') {
    color = '#ffd21f';
    rows.push(['DEREK MOBIL RUSAK', '#ffd21f']);
    if (!d.attached) rows.push(['KE LOKASI ' + Math.round(dist(d.focus, d.wreck)) + ' m', '#ffffff']);
    else rows.push(['KE BENGKEL ' + Math.round(dist(d.focus, d.garage)) + ' m', '#ffffff']);
    rows.push(['WAKTU ' + Math.max(0, Math.ceil(d.timeLeft)) + ' s', '#7bd66b']);
  }

  const lineH = 20;
  const boxH = 14 + rows.length * lineH + 12;
  ctx2.save();
  ctx2.fillStyle = 'rgba(8,8,14,0.72)';
  ctx2.fillRect(x, y, w, boxH);
  ctx2.strokeStyle = color;
  ctx2.lineWidth = 1.5;
  ctx2.strokeRect(x + 1.5, y + 1.5, w - 3, boxH - 3);
  ctx2.textAlign = 'left';
  ctx2.textBaseline = 'alphabetic';
  ctx2.font = 'bold 14px sans-serif';
  ctx2.fillStyle = color;
  ctx2.fillText('DISPATCH', x + 12, y + 18);
  rows.forEach(([label, c], i) => {
    ctx2.font = 'bold 13px sans-serif';
    ctx2.fillStyle = c;
    ctx2.fillText(label, x + 12, y + 38 + i * lineH);
  });
  ctx2.restore();
}

// ——— API PUBLIK ———
export function createDispatch(ctx) {
  const { world, ui, audio, gfx, player } = ctx;

  const d = {
    world, ui, audio, gfx,
    root: player,
    phase: 'idle',          // 'idle' | 'active' | 'done' | 'failed'
    job: null,              // 'ambulance' | 'fire' | 'tow'
    callsDone: 0,           // penghitung ramp kesulitan
    payphone: null,         // posisi telepon umum aktif ({x, y})
    patient: null,          // pasien ambil saat ini ({x, y})
    hospital: null,         // target rumah sakit ({x, y})
    patients: [],           // daftar pasien tersisa
    done: 0,                // pasien terjadwal sudah dijemput
    fires: [],              // tile api aktif ({tx, ty})
    spreadTimer: 0,         // jeda antar rambatan api
    wreck: null,            // posisi mobil rusak ({x, y})
    garage: null,           // target bengkel derek ({x, y})
    attached: false,        // mobil rusak sudah terkait
    timeLeft: 0,
    focus: null,
    markers: [],
    target: null,
    objectiveText: '',
    nearFire: Infinity,

    get active() { return d.phase === 'active'; },

    // Satu tombol G: angkat telepon untuk memulai tugas, atau selesaikan bila mendekati telepon.
    onKey() {
      if (ui.state !== 'PLAYING') return false;
      if (d.phase === 'idle' || d.phase === 'done' || d.phase === 'failed') {
        d.start();
        audio.click();
        return true;
      }
      return false;
    },

    // Pilih telepon umum terdekat dari posisi pemain, jika cukup dekat.
    findPhone() {
      const p = player.car || player;
      let best = null, bd = Infinity;
      for (const lane of d.world.lanePoints) {
        const dd = dist(lane, p);
        if (dd < bd) { bd = dd; best = lane; }
      }
      d.payphone = best || { x: d.world.width / 2, y: d.world.height / 2 };
      return bd;
    },

    // Angkat panggilan: pilih jenis tugas acak, bangun target, naikkan ramp.
    start() {
      if (!d.payphone || dist(player.car || player, d.payphone) > PAYPHONE_RANGE) {
        // Bila tidak di dekat telepon, arahkan pemain ke telepon terdekat.
        const d2 = d.findPhone();
        d.markers = [{ x: d.payphone.x, y: d.payphone.y, scale: 1.0 }];
        d.target = d.payphone;
        d.objectiveText = 'TELEPON UMUM ' + Math.round(d2) + ' m — TEKAN G';
        ui.toast('DEKATI TELEPON UMUM, LALU TEKAN G', 3);
        d.phase = 'idle';
        return;
      }
      const from = player.car || player;
      const types = ['ambulance', 'fire', 'tow'];
      d.job = pick(types);
      d.phase = 'active';
      d.callsDone++;
      ui.prompt = null;

      const pay = Math.round((1 + d.callsDone * RAMP / 100) * 100) / 100;

      if (d.job === 'ambulance') {
        d.patients = [];
        let cursor = { x: from.x, y: from.y };
        for (let i = 0; i < AMB_PATIENTS; i++) {
          const p = spotIn(d.world, cursor, MIN_SPACING, MAX_SPACING);
          d.patients.push({ x: p.x, y: p.y });
          cursor = { x: p.x, y: p.y };
        }
        d.hospital = spotIn(d.world, d.patients[AMB_PATIENTS - 1], MIN_SPACING, MAX_SPACING);
        d.patient = d.patients[0];
        d.done = 0;
        d.timeLeft = AMB_TIMER;
        ui.toast('AMBULANS — JEMPUT ' + AMB_PATIENTS + ' PASIEN SEBELUM WAKTU HABIS', 4);
      } else if (d.job === 'fire') {
        d.fires = [];
        let cursor = { x: from.x, y: from.y };
        for (let i = 0; i < FIRE_START; i++) {
          const b = burnTile(d.world, cursor, MIN_SPACING, MAX_SPACING);
          d.fires.push(b);
          cursor = { x: b.tx * TILE + TILE / 2, y: b.ty * TILE + TILE / 2 };
        }
        d.spreadTimer = FIRE_SPREAD_TIME;
        d.timeLeft = FIRE_TIMER;
        ui.toast('KEBAKARAN — PADAMKAN ' + d.fires.length + ' TITIK SEBELUM MENJALAR', 4);
      } else {
        d.wreck = spotIn(d.world, from, MIN_SPACING, MAX_SPACING);
        d.garage = spotIn(d.world, d.wreck, MIN_SPACING, MAX_SPACING);
        d.attached = false;
        d.timeLeft = TOW_TIMER;
        ui.toast('DEREK — KENAIKAN MOBIL RUSAK LALU ANTAR KE BENGKEL', 4);
      }
      d.pay = pay;
      d.refresh();
    },

    // Perbarui penanda & teks objektif mengikuti jenis tugas.
    refresh() {
      if (!d.active) { d.markers = []; d.target = null; d.objectiveText = ''; return; }
      if (d.job === 'ambulance') {
        if (d.patient) {
          d.markers = [{ x: d.patient.x, y: d.patient.y, scale: 1.0 }];
          d.target = d.patient;
          d.objectiveText = 'JEMPUT PASIEN ' + (d.done + 1) + '/' + AMB_PATIENTS;
        } else {
          d.markers = [{ x: d.hospital.x, y: d.hospital.y, scale: 1.0 }];
          d.target = d.hospital;
          d.objectiveText = 'ANTAR PASIEN KE RS';
        }
      } else if (d.job === 'fire') {
        d.markers = d.fires.map((f) => ({ x: f.tx * TILE + TILE / 2, y: f.ty * TILE + TILE / 2, scale: 1.0 }));
        d.target = d.fires[0] ? { x: d.fires[0].tx * TILE + TILE / 2, y: d.fires[0].ty * TILE + TILE / 2 } : null;
        d.objectiveText = 'PADAMKAN ' + d.fires.length + ' TITIK API';
      } else {
        d.markers = [d.attached
          ? { x: d.garage.x, y: d.garage.y, scale: 1.0 }
          : { x: d.wreck.x, y: d.wreck.y, scale: 1.0 }];
        d.target = d.attached ? d.garage : d.wreck;
        d.objectiveText = d.attached ? 'ANTAR MOBIL KE BENGKEL' : 'KENAIKAN MOBIL RUSAK';
      }
    },

    // Selesaikan tugas aktif, bayar, dan tampilkan hasil.
    complete() {
      let payout = 0, label = '';
      if (d.job === 'ambulance') {
        payout = Math.round(AMB_PATIENTS * (PAY_PER_PATIENT * d.pay));
        label = 'AMBULANS SELESAI';
      } else if (d.job === 'fire') {
        payout = Math.round(d.extinguished * (PAY_PER_FIRE * d.pay));
        label = 'KEBAKARAN DIPADAMKAN';
      } else {
        payout = Math.round(TOW_PAY * d.pay);
        label = 'DEREK SELESAI';
      }
      d.ui.addMoney(payout);
      d.ui.toast(label + ' +$' + payout, 4);
      d.audio.complete();
      d.phase = 'done';
      d.markers = [];
      d.target = null;
      d.objectiveText = '';
      d.ui.prompt = 'Tekan G untuk telepon lagi';
      d.ui.save();
    },

    // Gagal: waktu habis atau api merambat terlalu jauh.
    fail(reason) {
      d.ui.toast(reason, 4);
      d.audio.crash(0.5);
      d.phase = 'failed';
      d.markers = [];
      d.target = null;
      d.objectiveText = '';
      d.ui.prompt = 'Tekan G untuk ulang';
    },

    cancel() {
      d.phase = 'idle';
      d.job = null;
      d.patient = null;
      d.patients = [];
      d.fires = [];
      d.wreck = null;
      d.attached = false;
      d.markers = [];
      d.target = null;
      d.objectiveText = '';
      d.ui.prompt = null;
    },
  };

  // Bungkus ui.update agar panel dispatch ikut tergambar (tanpa mengubah perilaku ui lain).
  const prevUpdate = ui.update.bind(ui);
  ui.update = (dt, c) => { prevUpdate(dt, c); drawDispatchPanel(d); };

  return d;
}

// ——— UPDATE PER-FRAME (dipanggil berdampingan dengan updateTaxi) ———
export function updateDispatch(dispatch, dt, player) {
  const d = dispatch;
  if (d.phase === 'idle' || d.phase === 'done' || d.phase === 'failed') return;

  const focus = player.car || player;
  d.focus = focus;
  d.timeLeft -= dt;

  // Mati / tertangkap membatalkan tugas diam-diam.
  if (d.ui.state === 'DEAD' || (player.health != null && player.health <= 0)) {
    d.cancel();
    return;
  }

  if (d.timeLeft <= 0) { d.fail('WAKTU HABIS — TUGAS GAGAL'); return; }

  // ——— AMBULANS ———
  if (d.job === 'ambulance') {
    if (d.patient) {
      // Jemput pasien saat cukup dekat.
      if (dist(focus, d.patient) < PATIENT_RANGE) {
        d.done++;
        d.patients.shift();
        d.audio.pickup();
        d.ui.toast('PASIEN ' + d.done + ' DIJEMPUT', 2);
        d.patient = d.patients[0] || null;
        d.refresh();
        if (!d.patient) d.ui.toast('ANTAR SEMUA PASIEN KE RS', 2);
      }
    } else {
      // Antar ke rumah sakit.
      if (dist(focus, d.hospital) < DROP_RANGE) { d.complete(); return; }
    }
    d.refresh();
    return;
  }

  // ——— KEBAKARAN ———
  if (d.job === 'fire') {
    // Rambat api ke tile tetangga seiring waktu.
    d.spreadTimer -= dt;
    if (d.spreadTimer <= 0) {
      d.spreadTimer = FIRE_SPREAD_TIME;
      const src = d.fires[Math.floor(Math.random() * d.fires.length)];
      if (src) {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const cand = [];
        for (const [dx, dy] of dirs) {
          const tx = src.tx + dx, ty = src.ty + dy;
          if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) continue;
          if (tileAt(d.world, tx * TILE + TILE / 2, ty * TILE + TILE / 2) === T.BUILDING) continue;
          if (d.fires.some((f) => f.tx === tx && f.ty === ty)) continue;
          cand.push({ tx, ty });
        }
        if (cand.length) d.fires.push(pick(cand));
      }
      // Bila api merambat terlalu jauh, gagal.
      if (d.fires.length > FIRE_ROWS_MAX) { d.fail('API MERAMBAT LIAR — GAGAL'); return; }
    }

    // Padamkan tile api terdekat saat cukup dekat.
    d.nearFire = Infinity;
    let nearest = null;
    d.extinguished = d.extinguished || 0;
    for (const f of d.fires) {
      const dd = dist(focus, { x: f.tx * TILE + TILE / 2, y: f.ty * TILE + TILE / 2 });
      if (dd < d.nearFire) { d.nearFire = dd; nearest = f; }
    }
    if (nearest && d.nearFire < FIRE_RANGE) {
      d.fires = d.fires.filter((f) => f !== nearest);
      d.extinguished++;
      d.audio.click();
      d.ui.toast('API DIPADAMKAN', 1.5);
      if (d.fires.length === 0) { d.complete(); return; }
    }
    d.refresh();
    return;
  }

  // ——— DEREK ———
  if (d.job === 'tow') {
    if (!d.attached) {
      if (dist(focus, d.wreck) < TOW_ATTACH_RANGE) {
        d.attached = true;
        d.audio.pickup();
        d.ui.toast('MOBIL TERKAIT — ANTAR KE BENGKEL', 2);
        d.refresh();
      }
    } else {
      if (dist(focus, d.garage) < DROP_RANGE) { d.complete(); return; }
    }
    d.refresh();
    return;
  }
}