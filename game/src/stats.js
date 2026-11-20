// stats.js — pelacak statistik & prestasi (pencapaian) untuk SUNNY CITY.
// Menghitung jarak berjalan/berkendara, musuh ditewaskan, penangkapan polisi, misi
// selesai, paket ditemukan, balapan dimenangkan, dan perampokan berhasil. Sekitar 20
// prestasi dengan syarat buka yang dibaca dari tabel data, notifikasi toast memakai
// ui + audio yang sudah dibaca, plus layar "total" yang ditumpuk ke HUD lewat ui.update.

const SAVE_KEY = 'suncity.stats.v1';
const PERSIST_EVERY = 5;     // detik antar penyimpanan periodik
const TOAST_SECONDS = 4;

// ——— TABEL DATA PRESTASI (20) ———
const ACHIEVEMENTS = [
  { id: 'walk100',    name: 'LANGKAH PERTAMA',   desc: 'Berjalan 100 m',           metric: 'walk',       at: 100 },
  { id: 'walk1500',   name: 'PEJALAN',           desc: 'Berjalan 1.5 km',          metric: 'walk',       at: 1500 },
  { id: 'walk5000',   name: 'MARATON',           desc: 'Berjalan 5 km',            metric: 'walk',       at: 5000 },
  { id: 'drive1000',  name: 'MOBILIS',           desc: 'Mengemudi 1 km',           metric: 'drive',      at: 1000 },
  { id: 'drive10000', name: 'PENGEMUDI',         desc: 'Mengemudi 10 km',          metric: 'drive',      at: 10000 },
  { id: 'drive50000', name: 'RAJA JALAN',        desc: 'Mengemudi 50 km',          metric: 'drive',      at: 50000 },
  { id: 'kill1',      name: 'DARAH PERTAMA',     desc: 'Tewaskan 1 musuh',         metric: 'kills',      at: 1 },
  { id: 'kill10',     name: 'EKSEKUTOR',         desc: 'Tewaskan 10 musuh',        metric: 'kills',      at: 10 },
  { id: 'kill25',     name: 'HITMAN',            desc: 'Tewaskan 25 musuh',        metric: 'kills',      at: 25 },
  { id: 'arrest1',    name: 'KRIMINAL RESMI',    desc: 'Ditangkap polisi 1x',      metric: 'arrests',    at: 1 },
  { id: 'arrest5',    name: 'RESIDIVIS',         desc: 'Ditangkap polisi 5x',      metric: 'arrests',    at: 5 },
  { id: 'miss1',      name: 'SI PENGIRIM',       desc: 'Selesaikan 1 misi',        metric: 'missions',   at: 1 },
  { id: 'miss4',      name: 'SETENGAH JALAN',    desc: 'Selesaikan 4 misi',        metric: 'missions',   at: 4 },
  { id: 'miss8',      name: 'RAJA KOTA',         desc: 'Selesaikan 8 misi cerita', metric: 'missions',   at: 8 },
  { id: 'pkg3',       name: 'PEMBURU PAKET',     desc: 'Temukan 3 paket',          metric: 'packages',   at: 3 },
  { id: 'pkg12',      name: 'KOLEKTOR SEMPURNA', desc: 'Temukan semua 12 paket',   metric: 'packages',   at: 12 },
  { id: 'race1',      name: 'JUARA PERTAMA',     desc: 'Menangkan 1 balapan',      metric: 'racesWon',   at: 1 },
  { id: 'race3',      name: 'PEMBALAP HANDAL',   desc: 'Menangkan 3 balapan',      metric: 'racesWon',   at: 3 },
  { id: 'heist1',     name: 'PERAMPOK',          desc: 'Tuntaskan 1 perampokan',   metric: 'heistsDone', at: 1 },
  { id: 'heist3',     name: 'MASTER PERAMPOK',   desc: 'Tuntaskan 3 perampokan',   metric: 'heistsDone', at: 3 },
];

function formatDistance(m) {
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
}

// ——— memuat / menyimpan (pola localStorage yang sama dengan ui.js) ———
function loadStats() {
  const base = { walk: 0, drive: 0, kills: 0, arrests: 0, missions: 0, packages: 0, racesWon: 0, heistsDone: 0, unlocked: [] };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return base;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return base;
    for (const k of ['walk', 'drive', 'kills', 'arrests', 'missions', 'packages', 'racesWon', 'heistsDone']) {
      if (Number.isFinite(d[k])) base[k] = d[k];
    }
    if (Array.isArray(d.unlocked)) base.unlocked = d.unlocked.filter((id) => typeof id === 'string');
    return base;
  } catch (e) { return base; }
}

function persistStats(s) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      walk: s.walk, drive: s.drive, kills: s.kills, arrests: s.arrests,
      missions: s.missions, packages: s.packages, racesWon: s.racesWon, heistsDone: s.heistsDone,
      unlocked: [...s.unlocked],
    }));
  } catch (e) { /* storage tidak tersedia */ }
}

// ——— membuka prestasi (toast + bunyi + simpan) ———
function unlock(s, a) {
  s.unlocked.add(a.id);
  s.ui.toast('PRESTASI: ' + a.name + ' - ' + a.desc, TOAST_SECONDS);
  s.audio.pickup();
  persistStats(s);
}

function checkAchievements(s) {
  for (const a of ACHIEVEMENTS) {
    if (s.unlocked.has(a.id)) continue;
    if (s[a.metric] >= a.at) unlock(s, a);
  }
}

// ——— layar total statistik (ditumpuk ke HUD lewat ui.update) ———
function drawTotals(s) {
  const ctx = s.gfx && s.gfx.hud && s.gfx.hud.getContext ? s.gfx.hud.getContext('2d') : null;
  if (!ctx) return;
  const W = 960, H = 540;
  ctx.save();
  ctx.fillStyle = 'rgba(8,8,14,0.86)'; ctx.fillRect(60, 40, W - 120, H - 80);
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffb347'; ctx.font = 'bold 30px sans-serif';
  ctx.fillText('STATISTIK', W / 2, 82);

  const metrics = [
    ['Berjalan', formatDistance(s.walk)],
    ['Mengemudi', formatDistance(s.drive)],
    ['Musuh ditewaskan', String(s.kills)],
    ['Ditangkap', String(s.arrests)],
    ['Misi selesai', String(s.missions)],
    ['Paket ditemukan', s.packages + '/12'],
    ['Balapan menang', String(s.racesWon)],
    ['Perampokan berhasil', String(s.heistsDone)],
  ];
  ctx.textAlign = 'left'; ctx.font = 'bold 17px sans-serif'; ctx.fillStyle = '#fff';
  ctx.fillText('REKAMAN', 96, 92);
  let y = 120;
  metrics.forEach(([label, val]) => {
    ctx.font = '16px sans-serif'; ctx.fillStyle = '#ccc'; ctx.fillText(label, 108, y);
    ctx.textAlign = 'right'; ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = '#ffe27a'; ctx.fillText(val, 380, y);
    ctx.textAlign = 'left'; y += 30;
  });

  ctx.textAlign = 'left'; ctx.font = 'bold 17px sans-serif'; ctx.fillStyle = '#fff';
  ctx.fillText('PRESTASI ' + s.unlocked.size + '/' + ACHIEVEMENTS.length, 420, 92);
  y = 120;
  ACHIEVEMENTS.forEach((a) => {
    const done = s.unlocked.has(a.id);
    ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = done ? '#7bd66b' : '#666';
    ctx.fillText((done ? '[OK] ' : '[  ] ') + a.name, 420, y);
    ctx.font = '11px sans-serif'; ctx.fillStyle = done ? '#9be08a' : '#555';
    ctx.fillText(a.desc, 620, y);
    y += 19;
  });
  ctx.textAlign = 'center'; ctx.fillStyle = '#888'; ctx.font = 'bold 14px sans-serif';
  ctx.fillText('T — tutup statistik', W / 2, H - 34);
  ctx.restore();
}

// ——— API PUBLIK ———
export function createStats(ctx) {
  const { ui, audio, combat, heists, races, gfx } = ctx;
  const base = loadStats();
  const s = {
    ui, audio, combat, gfx, heists, races,
    walk: base.walk, drive: base.drive, kills: base.kills, arrests: base.arrests,
    missions: base.missions, packages: base.packages, racesWon: base.racesWon, heistsDone: base.heistsDone,
    unlocked: new Set(base.unlocked),
    open: false,
    // posisi referensi untuk menghitung jarak & melacak transisi status
    _px: null, _py: null, _cx: null, _cy: null, _car: null, _prevState: null,
    _hitT: 0, _wasKill: false, _wasDead: false,
    _racePhase: races.phase, _heistStatus: heists.status,
    _saveT: 0,

    toggle() { s.open = !s.open; audio.click(); },
    close() { s.open = false; },
  };
  const prev = ui.update.bind(ui);
  ui.update = (dt, c) => { prev(dt, c); if (s.open && s.ui.state === 'PLAYING') drawTotals(s); };
  return s;
}

// ——— UPDATE PER-FRAME (dipanggil berdampingan dengan updateEconomy) ———
export function updateStats(stats, dt, player) {
  const s = stats;

  // Bunuh & tangkap dipantau apa pun state-nya (mati menghentikan loop game, tapi
  // pembunuhan/tangkapan terakhir terjadi tepat saat transisi ke DEAD).
  const h = s.combat.hit;
  const jump = h && h.t > s._hitT + 0.001;      // hitmarker di-reset (tanda tabrakan tembak baru)
  const rising = h && h.kill && !s._wasKill;    // flag kill naik dari false ke true
  if (h && h.kill && (rising || jump)) s.kills++;
  s._wasKill = !!(h && h.kill);
  s._hitT = h ? h.t : 0;

  if (s.combat.dead && !s._wasDead && s.combat.dead.kind === 'BUSTED') s.arrests++;
  s._wasDead = !!s.combat.dead;

  if (s.ui.state !== 'PLAYING') { s._prevState = s.ui.state; return; }
  // Kembali ke PLAYING (mis. setelah mati/respawn): setel ulang jangkar posisi agar
  // teleportasi respawn tidak dihitung sebagai jarak.
  if (s._prevState !== 'PLAYING') {
    s._prevState = 'PLAYING';
    s._px = player.x; s._py = player.y;
    s._car = player.car || null;
    s._cx = player.car ? player.car.x : null; s._cy = player.car ? player.car.y : null;
    return;
  }

  // Jarak berjalan vs berkendara (delta posisi per frame).
  if (player.car) {
    if (player.car !== s._car) { s._car = player.car; s._cx = null; s._cy = null; }
    if (s._cx == null) { s._cx = player.car.x; s._cy = player.car.y; }
    else { s.drive += Math.hypot(player.car.x - s._cx, player.car.y - s._cy); s._cx = player.car.x; s._cy = player.car.y; }
    s._px = player.x; s._py = player.y;
  } else {
    s._car = null;
    if (s._px == null) { s._px = player.x; s._py = player.y; }
    else { s.walk += Math.hypot(player.x - s._px, player.y - s._py); s._px = player.x; s._py = player.y; }
  }

  // Pencacah monotonik yang dipantau langsung dari state modul lain.
  s.missions = Math.max(s.missions, s.ui.missionsDone || 0);
  s.packages = Math.max(s.packages, s.ui.pkCount || 0);
  if (s.races.phase === 'finished' && s._racePhase !== 'finished') s.racesWon++;
  s._racePhase = s.races.phase;
  if (s.heists.status === 'idle' && s._heistStatus === 'running') s.heistsDone++;
  s._heistStatus = s.heists.status;

  checkAchievements(s);

  s._saveT += dt;
  if (s._saveT >= PERSIST_EVERY) { s._saveT = 0; persistStats(s); }
}