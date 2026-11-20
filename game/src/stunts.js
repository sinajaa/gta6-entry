// stunts.js — lompatan trik, kombo udara/drift, dan tiga tantangan waktu untuk SUNNY CITY.
// Ramps ditaruh di titik-titik jalur jalan (lanePoints) dan memberi bonus tunai bila mobil
// mendarat bersih. Ada meteran kombo yang bertambah dari waktu udara dan skor drift, lalu
// tiga tantangan waktu dengan kualifikasi perunggu/perak/emas. Hasil digambar di HUD 2D.
import { T, tileAt } from './world.js';

// ——— KONSTANTA BERNAMA ———
const RAMP_COUNT = 14;            // jumlah ramp yang ditebar ke penjuru kota
const RAMP_ACTIVATE = 55;         // jarak (m) dari ramp untuk "menyentuh" peluncuran
const RAMP_AIR_BASELINE = 0.32;   // detik udara minimum agar lompatan dinilai
const LAND_CLEAN_TILE = T.ROAD;   // mendarat di jalan = mendarat bersih
const CLEAN_BONUS = 125;          // bonus tunai mendarat bersih
const AIR_CASH_RATE = 6;          // $ per detik waktu udara
const COMBO_MAX = 100;            // meteran kombo penuh
const COMBO_DRAIN = 26;           // pengurangan kombo per detik tanpa trik
const COMBO_AIR_PER_SEC = 55;     // kombo per detik udara
const COMBO_DRIFT_PER_PT = 0.5;   // kombo per poin drift
const COMBO_CASH_RATE = 1.5;      // $ per poin kombo saat diberi hadiah
const COMBO_PAYOFF_MIN = 12;      // poin kombo minimum untuk dibayar

// Tiga tantangan waktu (detik) dengan ambang perunggu/perak/emas.
const CHALLENGES = [
  { id: 'air', name: 'RAJA UDARA',          goal: 'Capai 20 detik total waktu udara', metric: 'airtime', bronze: 20, silver: 35, gold: 50 },
  { id: 'drift', name: 'SULTAN SLIDE',      goal: 'Kumpulkan 400 skor drift',      metric: 'drift',   bronze: 400, silver: 700, gold: 1000 },
  { id: 'jumps', name: 'PENGUASA RAMP',     goal: 'Tuntaskan 10 lompatan bersih',  metric: 'jumps',   bronze: 10, silver: 20, gold: 30 },
];

const CASH_BY_MEDAL = { bronze: 300, silver: 600, gold: 1200 };

// ——— HELPER MURNI ———
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function medalFor(ch, value) {
  if (value >= ch.gold) return 'gold';
  if (value >= ch.silver) return 'silver';
  if (value >= ch.bronze) return 'bronze';
  return null;
}

const MEDAL_LABEL = { bronze: 'PERUNGGU', silver: 'PERAK', gold: 'EMAS' };
const MEDAL_COLOR = { bronze: '#cd7f32', silver: '#c0c8d0', gold: '#ffd21f' };

// Tebar ramp ke titik jalur jalan yang saling berjauhan.
function placeRamps(world) {
  const ramps = [];
  const pool = world.lanePoints || [];
  let guard = 0;
  while (ramps.length < RAMP_COUNT && guard++ < pool.length * 2) {
    const p = pool[Math.floor(Math.random() * pool.length)];
    if (!p) continue;
    if (ramps.some((r) => Math.hypot(r.x - p.x, r.y - p.y) < 260)) continue;
    const angle = p.horizontal ? 0 : Math.PI / 2;
    ramps.push({ x: p.x, y: p.y, angle, taken: false, cooldown: 0 });
  }
  return ramps;
}

// ——— PANEL HASIL: meteran kombo, tantangan beserta medalinya ———
function drawStuntPanel(s) {
  const ctx2 = s.gfx && s.gfx.hud && s.gfx.hud.getContext ? s.gfx.hud.getContext('2d') : null;
  if (!ctx2 || s.ui.state !== 'PLAYING') return;

  const x = 16, y = 200, w = 270;
  const rows = [];

  // Baris kombo + statistik cepat.
  rows.push(['KOMBO  ' + Math.round(s.combo), s.combo > COMBO_MAX * 0.6 ? '#ffd21f' : '#7fe3ff']);
  rows.push(['UDARA  ' + fmtTime(s.airtime) + '   SLIDE  ' + Math.round(s.drift), '#e0e0e0']);

  // Satu baris per tantangan dengan status medali.
  const metricLabels = { airtime: 's', drift: 'pt', jumps: 'x' };
  for (const ch of CHALLENGES) {
    const val = s.metrics[ch.metric];
    const medal = s.medals[ch.id] || medalFor(ch, val);
    const label = (MEDAL_LABEL[medal] || '—');
    rows.push([ch.name, MEDAL_COLOR[medal] || '#888']);
    rows.push(['  ' + label + ' ' + (metricLabels[ch.metric] || '') + ' (' + Math.round(val) + ')', '#bbb']);
  }

  const lineH = 18;
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
  ctx2.fillText('STUNT & TRICK', x + 12, y + 18);
  rows.forEach(([label, color], i) => {
    ctx2.font = 'bold 13px sans-serif';
    ctx2.fillStyle = color;
    ctx2.fillText(label, x + 12, y + 38 + i * lineH);
  });
  ctx2.restore();
}

// ——— API PUBLIK ———
export function createStunts(ctx) {
  const { world, ui, audio, gfx } = ctx;

  const s = {
    world, ui, audio, gfx,
    ramps: placeRamps(world),
    combo: 0,                // meteran kombo (0..COMBO_MAX)
    airtime: 0,              // total detik udara (kumulatif, stat + tantangan)
    drift: 0,                // total poin drift (kumulatif, stat + tantangan)
    jumps: 0,                // jumlah lompatan bersih
    metrics: { airtime: 0, drift: 0, jumps: 0 },
    medals: {},              // id tantangan -> medali terbaik yang sudah diraih
    prevDrift: 0,            // jejak driftTotal untuk menghitung delta per frame
    airborne: false,         // apakah mobil sedang di udara
    airTimer: 0,             // akumulasi detik udara dalam lompatan aktif
    airborneLinks: 0,        // jumlah detik udara sejak airborne mulai (untuk decay)
    groundTiles: 0,          // detik di luar jalan berturut-turut (pelacak udara)
    rampSource: null,        // ramp yang baru dilewati (untuk lompatan)

    get active() { return s.ui.state === 'PLAYING'; },

    // Satu tombol (S) membuka/tutup tidak perlu — panel selalu tampil; pertahankan agar API simetris.
    onKey() { return false; },
  };

  // Bungkus ui.update agar panel stunt ikut digambar (tanpa mengubah perilaku ui lain).
  const prevUpdate = ui.update.bind(ui);
  ui.update = (dt, c) => { prevUpdate(dt, c); drawStuntPanel(s); };

  // Cek medali: tiap tantangan yang ambangnya terlewati pertama kali membayar tunai sekali.
  function updateMedals() {
    for (const ch of CHALLENGES) {
      const val = s.metrics[ch.metric];
      const medal = medalFor(ch, val);
      if (!medal) continue;
      const rank = { bronze: 1, silver: 2, gold: 3 };
      const prev = s.medals[ch.id];
      const prevRank = prev ? rank[prev] : 0;
      if (rank[medal] > prevRank) {
        s.medals[ch.id] = medal;
        const cash = CASH_BY_MEDAL[medal];
        ui.addMoney(cash);
        audio.complete();
        ui.toast(ch.name + ' — ' + MEDAL_LABEL[medal] + ' +$' + cash, 4);
        ui.save();
      }
    }
  }

  // Bayar meteran kombo saat memuncak lalu turun (satu ledakan hadiah per siklus naik-turun).
  function settleCombo() {
    if (s.combo >= COMBO_PAYOFF_MIN) {
      const cash = Math.round(s.combo * COMBO_CASH_RATE);
      ui.addMoney(cash);
      audio.pickup();
      ui.toast('KOMBO +$' + cash, 2);
      s.combo = 0;
    } else {
      s.combo = 0;
    }
  }

  s.settleCombo = settleCombo;
  s.updateMedals = updateMedals;
  return s;
}

// ——— UPDATE PER-FRAME (dipanggil berdampingan dengan modul lain) ———
export function updateStunts(stunts, dt, player) {
  const s = stunts;
  const car = player.car;
  const focus = car || player;
  s.focus = focus;

  // Tanpa mobil, kombo perlahan luruh tapi statistik tetap.
  if (!car) {
    s.combo = Math.max(0, s.combo - COMBO_DRAIN * 0.4 * dt);
    s.prevDrift = 0;
    s.airborne = false;
    return;
  }

  // Update cooldown ramp.
  for (const r of s.ramps) r.cooldown = Math.max(0, (r.cooldown || 0) - dt);

  // ——— Deteksi udara: mobil berhenti menyentuh ubin jalan/bangunan permukaan. ———
  const onRoad = tileAt(s.world, car.x, car.y) === T.ROAD || tileAt(s.world, car.x, car.y) === T.SIDEWALK;
  const onGround = onRoad || tileAt(s.world, car.x, car.y) === T.BUILDING;

  if (onGround) {
    // Baru mendarat dari udara pada permukaan padat.
    if (s.airborne) {
      const airSeconds = s.airTimer;
      if (airSeconds >= RAMP_AIR_BASELINE) {
        // Bersih = mendarat di jalan (bukan bangunan/trotoar keras).
        const clean = tileAt(s.world, car.x, car.y) === LAND_CLEAN_TILE;
        const cash = Math.round(airSeconds * AIR_CASH_RATE) + (clean ? CLEAN_BONUS : 0);
        if (cash > 0) {
          uiAddMoney(s, cash);
          s.jumps += clean ? 1 : 0;
          s.metrics.jumps = s.jumps;
          if (clean) {
            s.audio.pickup();
            s.ui.toast('LOMPATAN BERSIH +$' + cash + ' (' + airSeconds.toFixed(1) + 's)', 2.5);
          } else {
            s.audio.crash(0.4);
            s.ui.toast('MENDARAT KASAR +$' + Math.round(airSeconds * AIR_CASH_RATE), 2);
          }
        }
      }
    }
    s.airborne = false;
    s.airTimer = 0;
    s.groundTiles = 0;
  } else {
    // Di udara (melewati ubin kosong/rumput saat melayang).
    s.groundTiles += dt;
    if (!s.airborne && s.groundTiles > 0.06) {
      s.airborne = true;
      s.airTimer = 0;
      // Catat ramp terdekat yang baru dilewati sebagai sumber lompatan.
      let nearest = null, nd = RAMP_ACTIVATE;
      for (const r of s.ramps) {
        const d = Math.hypot(r.x - car.x, r.y - car.y);
        if (d < nd) { nearest = r; nd = d; }
      }
      if (nearest) { s.rampSource = nearest; nearest.taken = true; nearest.cooldown = 3; }
    }
    if (s.airborne) {
      s.airTimer += dt;
      s.airtime += dt;
      s.metrics.airtime = s.airtime;
      s.combo = clamp(s.combo + COMBO_AIR_PER_SEC * dt, 0, COMBO_MAX);
    }
  }

  // ——— Inkremen drift dari delta driftTotal mobil. ———
  const driftTotal = car.driftTotal || 0;
  const dDrift = Math.max(0, driftTotal - s.prevDrift);
  if (dDrift > 0) {
    s.drift += dDrift;
    s.metrics.drift = s.drift;
    s.combo = clamp(s.combo + dDrift * COMBO_DRIFT_PER_PT, 0, COMBO_MAX);
  }
  s.prevDrift = driftTotal;

  // Kombo luruh perlahan saat tidak ada trik aktif.
  if (!s.airborne) s.combo = Math.max(0, s.combo - COMBO_DRAIN * dt);

  // Putuskan kombo ketika pemain berhenti (kecepatan rendah, tidak drift) setelah peak.
  const speed = Math.abs(car.speed || 0);
  if (s.combo >= COMBO_PAYOFF_MIN && !s.airborne && dDrift <= 0 && speed < 60) {
    s.settleCombo();
  }

  s.updateMedals();
}

function uiAddMoney(s, n) {
  s.ui.addMoney(n);
  s.ui.save();
}