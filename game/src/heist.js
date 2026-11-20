// heist.js — rantai perampokan tiga tahap untuk SUNNY CITY (kasus bank → rombak → kabur).
// Punya state machine sendiri: idle → casing → robbery → getaway, dengan "alarm heat" (tekanan
// polisi naik), gagal/ulang, pembayaran per tahap, dan panel bantuan kecil. Penanda waypoint
// ditampilkan lewat kontrak yang sama dengan missions (`markers`/`target`/`objectiveText`) lalu
// diumpankan ke render3d lewat pandangan gabungan di main.js, jadi renderer tidak perlu disentuh.
import { addHeat } from './police.js';

// ——— KONSTANTA BERNAMA ———
const ARRIVE = 40;             // jarak (m) dianggap "sampai" pada titik tujuan
const SCOPE_SECONDS = 2.5;     // lama mengamati bank saat casing
const CRACK_SECONDS = 10;      // lama menjebol brankas saat robbery
const VAULT_RADIUS = 48;       // radius (m) pemain dianggap menempel di brankas
const ALARM_RATE = 0.055;      // laju alarm naik/detik saat menempel (dasar)
const ALARM_DECAY = 0.08;      // laju alarm turun/detik saat menjauh dari brankas
const CRACK_BACKOFF = 1.6;     // crack mundur/detik saat keluar dari brankas
const HEAT_PULSE = 1.5;        // jeda antar penambahan heat saat robbery
const HEAT_PER_PULSE = 110;    // heat ditambahkan per pulsa alarm
const GETAWAY_PERIOD = 4;      // jeda tambahan heat saat kabur
const GETAWAY_HEAT = 60;       // heat disuntik per jeda saat kabur
const ROBBERY_HEAT = 150;      // heat langsung saat alarm robbery pertama kali menyala
const TOTAL_LIMIT = 300;       // batas total waktu seluruh rantai (detik)

// Tekanan alarm melonjak bila polisi sudah dekat (bintang lebih tinggi).
const PRESSURE_4 = 2.5, PRESSURE_3 = 1.6;

// ——— TABEL DATA TAHAP ———
const STAGE_LABEL = ['KASUS BANK', 'PERAMPOKAN', 'KABUR'];
const STAGE_PAYOUT = [300, 1800, 2500];   // bayaran tiap tahap selesai

// String panel bantuan (digambar langsung ke HUD 2D).
const HELP_TITLE = 'PERAMPOKAN BERANTAI';
const HELP_LINES = [
  '[H] mulai / ulang perampokan',
  '1. KASUS   — parkir dekat bank, amati sebentar.',
  '2. ROMPOK  — tahan di brankas, waspadai alarm.',
  '3. KABUR   — naik mobil, melaju ke titik aman.',
];

// ——— HELPER MURNI ———
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Pilih satu titik jalur dalam rentang jarak [min,max] dari `from`; mundur ke seluruh
// lanePoints bila rentang kosong, lalu pusat dunia bila tak ada titik sama sekali.
function pickSpot(world, from, min, max) {
  const ring = world.lanePoints.filter((p) => {
    const d = distance(p, from);
    return d >= min && d <= max;
  });
  const pool = ring.length ? ring : world.lanePoints;
  const p = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  return p ? { x: p.x, y: p.y } : { x: world.width / 2, y: world.height / 2 };
}

// ——— AKSESORIS MODUL (semua menerima `h` agar dipakai bersama createHeists & updateHeists) ———

function say(h, who, text) {
  h.ui.toast(who + ': ' + text, 4.5);
}

function pay(h, amount, label) {
  h.ui.addMoney(amount);
  h.earned += amount;
  h.ui.toast(label + ' +$' + amount);
}

// Matikan level buruan sepenuhnya (dipakai saat berhasil/gagal agar ulang bersih).
function clearWanted(h) {
  const pol = h.world.police;
  if (!pol) return;
  pol.heat = 0;
  pol.stars = 0;
  pol.evading = false;
  pol.evadeTimer = 0;
}

// Perbarui penanda/teks objektif sesuai tahap aktif.
function refresh(h) {
  if (h.status !== 'running') return;
  const bank = h.bank, safe = h.safe;
  if (h.stage === 0) {
    h.markers = [{ x: bank.x, y: bank.y, scale: 1 }];
    h.target = bank;
    h.objectiveText = 'KASUS ' + Math.round(distance(h.focus, bank)) + 'm — amati bank';
  } else if (h.stage === 1) {
    h.markers = [{ x: bank.x, y: bank.y, scale: 0.8 }];
    h.target = bank;
    const pct = Math.round(clamp(h.crack / CRACK_SECONDS, 0, 1) * 100);
    h.objectiveText = 'ROMPOK ' + pct + '% — alarm ' + Math.round(h.alarm * 100) + '%';
  } else {
    h.markers = [{ x: safe.x, y: safe.y, scale: 1 }];
    h.target = safe;
    h.objectiveText = 'KABUR ' + Math.round(distance(h.focus, safe)) + 'm — pakai mobil';
  }
}

// Transisi casing → robbery: alarm menyala, polisi datang.
function toRobbery(h) {
  h.stage = 1;
  h.scope = 0;
  h.crack = 0;
  h.alarm = 0;
  h.pulse = 0;
  addHeat(h.world, ROBBERY_HEAT, 'heist');
  h.ui.toast('BRANKAS DITEMUKAN — ALARM MENYALA!', 4);
  say(h, 'Nico', 'Jebol brankasnya! Polisi pasti datang.');
  refresh(h);
}

// Transisi robbery → getaway: uang aman, harus kabur pakai mobil.
function toGetaway(h) {
  h.stage = 2;
  h.crack = 0;
  h.alarm = 0;
  h.travelTimer = 0;
  pay(h, STAGE_PAYOUT[1], 'BRANKAS JEBOL');
  h.audio.pickup();
  h.ui.toast('UANG AMAN — KABUR PAKAI MOBIL!', 4);
  say(h, 'Nico', 'Lari ke titik aman, jangan sampai tertangkap!');
  refresh(h);
}

// Rantai selesai: bayar tahap akhir + total, catat reputasi, bersihkan buruan.
function completeHeist(h) {
  pay(h, STAGE_PAYOUT[2], 'KABUR BERSIH');
  const total = STAGE_PAYOUT[0] + STAGE_PAYOUT[1] + STAGE_PAYOUT[2];
  h.audio.complete();
  h.ui.toast('PERAMPOKAN BERHASIL +$' + total + ' TOTAL', 4);
  say(h, 'Nico', 'Gila... kita kaya! Ini bagianmu.');
  if (h.ui.rep) {
    h.ui.rep.add(h.focus.x, h.focus.y, 8);
    const bonus = h.ui.rep.job(h.focus.x, h.focus.y);
    if (bonus) { h.ui.addMoney(bonus); h.ui.toast('REP DISTRIK +$' + bonus); }
  }
  clearWanted(h);
  h.status = 'idle';
  h.markers = [];
  h.target = null;
  h.objectiveText = '';
  h.ui.save();
}

// Rantai gagal: kirim alasan, bersihkan buruan, tawarkan ulang lewat H.
function failHeist(h, reason) {
  const why = reason === 'alarm' ? 'ALARM PENUH — KETAHUAN'
    : reason === 'time' ? 'WAKTU HABIS'
      : 'TERTANGKAP';
  h.ui.toast('PERAMPOKAN GAGAL — ' + why, 4);
  say(h, 'Nico', 'Batal. Mundur, kita coba lagi kalau sudah tenang.');
  clearWanted(h);
  h.status = 'failed';
  h.stage = 0;
  h.markers = [];
  h.target = null;
  h.objectiveText = 'PERAMPOKAN GAGAL — TEKAN H UNTUK ULANG';
  h.ui.prompt = 'Tekan H untuk ulang perampokan';
  h.audio.crash(0.6);
}

// Panel bantuan kecil digambar ke HUD 2D; ditumpuk setelah ui.update seperti counter token di extras.
function drawHelp(h) {
  if (h.ui.state !== 'PLAYING') return;
  if (!h.help && h.status !== 'running') return;
  const ctx2 = h.gfx && h.gfx.hud && h.gfx.hud.getContext ? h.gfx.hud.getContext('2d') : null;
  if (!ctx2) return;

  const x = 16, y = 60, w = 300;
  const lineH = 18;
  const boxH = 24 + HELP_LINES.length * lineH + 18;

  ctx2.save();
  ctx2.fillStyle = 'rgba(8,8,14,0.72)';
  ctx2.fillRect(x, y, w, boxH);
  ctx2.strokeStyle = '#ffb300';
  ctx2.lineWidth = 1.5;
  ctx2.strokeRect(x + 1.5, y + 1.5, w - 3, boxH - 3);

  ctx2.textAlign = 'left';
  ctx2.textBaseline = 'alphabetic';
  ctx2.font = 'bold 15px sans-serif';
  ctx2.fillStyle = '#ffb300';
  ctx2.fillText(HELP_TITLE, x + 12, y + 20);
  ctx2.font = '12px sans-serif';
  ctx2.fillStyle = '#dcdcdc';
  HELP_LINES.forEach((line, i) => ctx2.fillText(line, x + 12, y + 40 + i * lineH));

  if (h.status === 'running') {
    const total = STAGE_PAYOUT[0] + STAGE_PAYOUT[1] + STAGE_PAYOUT[2];
    ctx2.fillStyle = '#7bd66b';
    ctx2.font = 'bold 12px sans-serif';
    ctx2.fillText(STAGE_LABEL[h.stage] + ' — sudah +$' + h.earned + ' / total +$' + total, x + 12, y + boxH - 8);
  }
  ctx2.restore();
}

// ——— API PUBLIK ———
export function createHeists(ctx) {
  const { world, ui, audio, gfx } = ctx;
  const root = ctx.player;   // referensi live; posisi dibaca saat start() dipanggil

  const h = {
    world, ui, audio, gfx,
    status: 'idle',          // 'idle' | 'running' | 'failed'
    stage: 0,                // 0 casing, 1 robbery, 2 getaway
    t: 0,                    // total waktu rantai
    scope: 0,                // progres pengamatan casing
    crack: 0,                // progres jebol brankas
    alarm: 0,                // tekanan alarm (0..1); 1 = gagal
    pulse: 0,                // jeda penambahan heat robbery
    travelTimer: 0,          // jeda heat saat kabur
    earned: 0,               // total yang sudah dibayarkan
    bank: { x: 0, y: 0 },    // titik bank == brankas (dirompak di tempat yang dikasasi)
    safe: { x: 0, y: 0 },    // titik aman getaway
    markers: [],
    target: null,
    objectiveText: '',
    focus: { x: 0, y: 0 },
    help: false,

    get active() {
      return this.status !== 'idle';
    },

    // Satu tombol mengatur semuanya: mulai / ulang / buka-tutup bantuan.
    onKey() {
      if (ui.state !== 'PLAYING') return false;
      if (h.status === 'idle') { h.start(); h.help = true; return true; }
      if (h.status === 'failed') { h.retry(); return true; }
      h.help = !h.help;
      audio.click();
      return true;
    },

    start() {
      const from = root || { x: world.width / 2, y: world.height / 2 };
      h.bank = pickSpot(world, from, 200, 420);
      h.safe = pickSpot(world, h.bank, 500, 800);
      h.status = 'running';
      h.stage = 0;
      h.t = 0;
      h.scope = 0;
      h.crack = 0;
      h.alarm = 0;
      h.pulse = 0;
      h.travelTimer = 0;
      h.earned = 0;
      h.focus = from;
      h.markers = [];
      h.target = null;
      ui.prompt = null;
      audio.click();
      ui.toast('PERAMPOKAN DIMULAI — KASUSI BANK', 4);
      say(h, 'Nico', 'Kita garap bank. Amati dulu, jangan mencolok.');
      refresh(h);
    },

    retry() {
      clearWanted(h);
      ui.prompt = null;
      ui.toast('COBA LAGI — KASUSI BANK', 3);
      h.start();
    },
  };

  // Bungkus ui.update agar panel bantuan ikut digambar (tanpa mengubah perilaku ui lain).
  const prevUpdate = ui.update.bind(ui);
  ui.update = (dt, c) => { prevUpdate(dt, c); drawHelp(h); };

  return h;
}

// ——— UPDATE PER-FRAME (dipanggil bersebelahan dengan missions.update) ———
export function updateHeists(heists, dt, player) {
  const h = heists;
  if (h.status === 'idle' || h.status === 'failed') return;

  const focus = player.car || player;
  h.focus = focus;

  // Mati / tertangkap membatalkan rantai.
  if (h.ui.state === 'DEAD' || (player.health != null && player.health <= 0)) {
    failHeist(h, 'caught');
    return;
  }

  h.t += dt;
  if (h.t > TOTAL_LIMIT) { failHeist(h, 'time'); return; }

  if (h.stage === 0) {
    // KASUS: tiba di bank lalu amati beberapa saat (progres reset bila menjauh).
    if (distance(focus, h.bank) < ARRIVE) {
      h.scope += dt;
      if (h.scope >= SCOPE_SECONDS) {
        pay(h, STAGE_PAYOUT[0], 'KASUS BERHASIL');
        toRobbery(h);
      }
    } else {
      h.scope = 0;
    }
  } else if (h.stage === 1) {
    // ROMPOK: tahan dekat brankas; alarm naik, keluar brankas menghentikan crack.
    const near = distance(focus, h.bank) < VAULT_RADIUS;
    if (near) {
      h.crack += dt;
      h.pulse -= dt;
      if (h.pulse <= 0) { h.pulse = HEAT_PULSE; addHeat(h.world, HEAT_PER_PULSE, 'heist'); }
      const pol = h.world.police;
      const pressure = pol && pol.stars >= 4 ? PRESSURE_4 : pol && pol.stars >= 3 ? PRESSURE_3 : 1;
      h.alarm = clamp(h.alarm + dt * ALARM_RATE * pressure, 0, 1);
      if (h.alarm >= 1) { failHeist(h, 'alarm'); return; }
      if (h.crack >= CRACK_SECONDS) { toGetaway(h); return; }
    } else {
      h.alarm = clamp(h.alarm - dt * ALARM_DECAY, 0, 1);
      h.crack = Math.max(0, h.crack - dt * CRACK_BACKOFF);
    }
  } else if (h.stage === 2) {
    // KABUR: butuh mobil; heat disuntik perlahan agar pengejaran tetap hidup.
    h.travelTimer -= dt;
    if (h.travelTimer <= 0) { h.travelTimer = GETAWAY_PERIOD; addHeat(h.world, GETAWAY_HEAT, 'heist'); }
    if (distance(focus, h.safe) < ARRIVE) {
      if (player.car) { completeHeist(h); return; }
      h.ui.toast('NAIK MOBIL DULU!', 1.2);
    }
  }

  refresh(h);
}