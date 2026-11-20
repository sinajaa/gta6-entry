// safehouse.js — properti yang bisa dibeli, lemari pakaian, titik simpan, dan slot garasi
// Modul properti SUNNY CITY: rumah aman tersebar di tiga distrik dengan harga sendiri,
// lemari tiga outfit yang mengubah warna karakter, titik simpan yang menyimpan uang dan
// progres ke localStorage, slot garasi untuk menyimpan mobil saat ini, dan panel properti
// yang digambar memakai API ui/world yang sudah ada.
import { TILE } from './world.js';

const W = 960;
const SAVE_KEY = 'sunnycity.safehouse.v1';
const RANGE = 60;               // jarak maksimum untuk memicu panel properti
const MENU_KEY = 'o';           // tombol buka/tutup panel properti

const DISTRICT_LABEL = ['PUSAT', 'TENGAH', 'PINGGIR'];

// ---- daftar safehouse: satu per distrik, tersebar agar mudah dijangkau ---------------------
const SAFEHOUSES = [
  { id: 'downtown', district: 0, label: 'PENTHOUSE PUSAT',  price: 5000, x: 24 * TILE, y: 24 * TILE },
  { id: 'midtown',  district: 1, label: 'APARTEMEN TENGAH', price: 3000, x: 37 * TILE, y: 37 * TILE },
  { id: 'suburb',   district: 2, label: 'RUMAH PINGGIR',    price: 1500, x: 54 * TILE, y: 54 * TILE },
];

// ---- tiga outfit yang mengubah warna badan + aksen karakter -------------------------------
const OUTFITS = [
  { id: 'street', label: 'JALANAN', body: '#2b4a8b', accent: '#ffd21f' },
  { id: 'suit',   label: 'SETELAN', body: '#1c1c1c', accent: '#e8e8e8' },
  { id: 'vice',   label: 'SINDEN',  body: '#c0392b', accent: '#ffd21f' },
];

function outfitDef(id) { return OUTFITS.find((o) => o.id === id) || OUTFITS[0]; }

// ---- baca simpanan (daftar properti dimiliki, outfit, mobil garasi, uang) -----------------
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (e) { return null; }
}

function persist(state, ui) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      own: Array.from(state.own),
      outfit: state.outfit,
      car: state.garageCar,
      money: ui.money,
      savedAt: Date.now(),
    }));
  } catch (e) { /* storage tidak tersedia */ }
}

export function createSafehouses(ctx) {
  const { world, ui, gfx } = ctx;
  const saved = loadSave();

  const state = {
    world, ui, gfx,
    playerRef: null,
    open: false,
    idx: 0,
    section: 'main',            // 'main' | 'wardrobe' | 'garage'
    own: saved && Array.isArray(saved.own) ? new Set(saved.own) : new Set(),
    outfit: saved && OUTFITS.some((o) => o.id === saved.outfit) ? saved.outfit : 'street',
    garageCar: saved && Number.isFinite(saved.car) ? saved.car : null,
  };

  function playerPosition() {
    const p = state.playerRef;
    return p && (p.car || p);
  }

  function current() {
    const focus = playerPosition();
    if (!focus) return null;
    let best = null, bestD = RANGE;
    for (const s of SAFEHOUSES) {
      const d = Math.hypot(s.x - focus.x, s.y - focus.y);
      if (d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  function applyOutfit() {
    const mesh = gfx.playerMesh;
    if (mesh && mesh.material && mesh.material.color) mesh.material.color.set(outfitDef(state.outfit).body);
  }

  // ---- aksi panel ----------------------------------------------------------------------
  function buy(s) {
    if (state.own.has(s.id)) { ui.toast(s.label + ' sudah kamu miliki'); return; }
    if (ui.money < s.price) { ui.toast('Uang kurang — butuh $' + s.price); return; }
    ui.addMoney(-s.price);
    state.own.add(s.id);
    ui.save();
    persist(state, ui);
    ui.toast(s.label + ' DIBELI');
  }

  function saveGame() {
    ui.save();                   // simpan uang + progres misi utama (jalur ui yang sudah ada)
    persist(state, ui);          // simpan properti + outfit + garasi
    ui.toast('PERMAINAN DISIMPAN');
  }

  function setOutfit(id) {
    state.outfit = id;
    applyOutfit();
    persist(state, ui);
    ui.toast('Outfit: ' + outfitDef(id).label);
  }

  function storeCar() {
    const p = state.playerRef;
    if (!p || !p.car) { ui.toast('Tidak ada mobil untuk disimpan'); return; }
    const car = p.car;
    const i = world.cars.indexOf(car);
    if (i < 0) { ui.toast('Mobil ini tidak bisa disimpan'); return; }
    state.garageCar = i;
    car.driver = null;
    p.car = null;
    persist(state, ui);
    ui.toast('Mobil disimpan di garasi');
  }

  function retrieveCar() {
    const p = state.playerRef;
    if (state.garageCar == null) { ui.toast('Garasi kosong'); return; }
    const car = world.cars[state.garageCar];
    if (!car) { state.garageCar = null; persist(state, ui); ui.toast('Mobil tersimpan sudah hilang'); return; }
    if (p.car) { ui.toast('Kamu masih di dalam mobil'); return; }
    car.x = p.x;
    car.y = p.y;
    car.speed = 0;
    car.driver = p;
    p.car = car;
    persist(state, ui);
    ui.toast('Mobil diambil dari garasi');
  }

  // ---- baris menu utama ------------------------------------------------------------------
  function mainRows(s) {
    const rows = [];
    if (s && !state.own.has(s.id)) rows.push(['BELI ' + s.label + '  $' + s.price, 'buy']);
    rows.push(['LEMARI PAKAIAN', 'wardrobe']);
    rows.push(['GARASI', 'garage']);
    rows.push(['SIMPAN PERMAINAN', 'save']);
    return rows;
  }

  function runMain(row, s) {
    const [, target] = row;
    if (target === 'buy') buy(s);
    else if (target === 'wardrobe') { state.section = 'wardrobe'; state.idx = OUTFITS.findIndex((o) => o.id === state.outfit); }
    else if (target === 'garage') { state.section = 'garage'; state.idx = 0; }
    else if (target === 'save') saveGame();
  }

  function toggle() {
    if (state.open) { state.open = false; return true; }
    if (!current()) { ui.toast('Dekati safehouse untuk membuka panel'); return false; }
    state.open = true;
    state.idx = 0;
    state.section = 'main';
    return true;
  }

  // ---- input panel: mengembalikan true bila tombol dikonsumsi panel -----------------------
  function onKey(k, player) {
    state.playerRef = player;
    if (k === MENU_KEY) return toggle();
    if (!state.open) return false;
    if (k === 'escape') { state.open = false; return true; }

    const s = current();
    if (state.section === 'main') {
      const rows = mainRows(s);
      if (k === 'arrowup' || k === 'w') state.idx = (state.idx + rows.length - 1) % rows.length;
      else if (k === 'arrowdown' || k === 's') state.idx = (state.idx + 1) % rows.length;
      else if (k === 'enter' || k === 'e') runMain(rows[state.idx], s);
      return true;
    }
    if (state.section === 'wardrobe') {
      if (k === 'arrowup' || k === 'w') state.idx = (state.idx + OUTFITS.length - 1) % OUTFITS.length;
      else if (k === 'arrowdown' || k === 's') state.idx = (state.idx + 1) % OUTFITS.length;
      else if (k === 'enter' || k === 'e') setOutfit(OUTFITS[state.idx].id);
      else if (k === 'backspace') { state.section = 'main'; state.idx = 0; }
      return true;
    }
    if (state.section === 'garage') {
      const rows = ['SIMKAN MOBIL', 'AMBIL MOBIL', 'KEMBALI'];
      if (k === 'arrowup' || k === 'w') state.idx = (state.idx + rows.length - 1) % rows.length;
      else if (k === 'arrowdown' || k === 's') state.idx = (state.idx + 1) % rows.length;
      else if (k === 'enter' || k === 'e') {
        if (state.idx === 0) storeCar();
        else if (state.idx === 1) retrieveCar();
        else { state.section = 'main'; state.idx = 0; }
      }
      return true;
    }
    return true;
  }

  applyOutfit();

  return {
    get open() { return state.open; },
    get active() { return state.open; },
    own: () => Array.from(state.own),
    outfit: () => state.outfit,
    garageCar: () => state.garageCar,
    current,
    onKey,
    toggle,
    persist: () => persist(state, ui),
  };
}

// ---- menggambar panel properti ke HUD -----------------------------------------------------
function drawPanel(st, s, ui) {
  const g = st.gfx.hud;
  if (!g) return;
  g.save();
  g.textAlign = 'center';
  g.fillStyle = 'rgba(8,8,14,0.85)';

  if (st.section === 'main') {
    g.fillRect(W / 2 - 230, 120, 460, 300);
    g.font = 'bold 26px sans-serif'; g.fillStyle = '#ffb300';
    g.fillText(st.own.has(s.id) ? s.label : 'SAFEHOUSE', W / 2, 160);
    g.font = '15px sans-serif'; g.fillStyle = '#ddd';
    g.fillText('Distrik ' + DISTRICT_LABEL[s.district] + '  \u00B7  Saldo $' + ui.money, W / 2, 184);
    const rows = mainRowsForDraw(st, s);
    rows.forEach((r, i) => {
      const y = 210 + i * 52;
      const on = i === st.idx;
      g.fillStyle = on ? 'rgba(255,179,0,0.35)' : 'rgba(40,40,56,0.95)';
      g.fillRect(W / 2 - 200, y - 30, 400, 44);
      g.fillStyle = '#fff'; g.font = 'bold 17px sans-serif';
      g.fillText(r, W / 2, y);
    });
    g.font = '13px sans-serif'; g.fillStyle = '#aaa';
    g.fillText('Panah: pilih \u00B7 Enter/E: pilih \u00B7 ESC/O: tutup', W / 2, 420);
  } else if (st.section === 'wardrobe') {
    g.fillRect(W / 2 - 230, 140, 460, 240);
    g.font = 'bold 26px sans-serif'; g.fillStyle = '#ffb300';
    g.fillText('LEMARI PAKAIAN', W / 2, 178);
    OUTFITS.forEach((o, i) => {
      const y = 210 + i * 52;
      const on = i === st.idx;
      g.fillStyle = on ? 'rgba(255,179,0,0.35)' : 'rgba(40,40,56,0.95)';
      g.fillRect(W / 2 - 200, y - 30, 400, 44);
      g.fillStyle = o.body; g.fillRect(W / 2 - 185, y - 22, 22, 22);
      g.fillStyle = '#fff'; g.font = 'bold 17px sans-serif'; g.textAlign = 'left';
      g.fillText(o.label + (o.id === st.outfit ? '  (DIPAKAI)' : ''), W / 2 - 155, y);
      g.textAlign = 'center';
    });
    g.fillStyle = '#aaa'; g.font = '13px sans-serif';
    g.fillText('Panah: pilih \u00B7 Enter/E: pakai \u00B7 Backspace: kembali', W / 2, 380);
  } else if (st.section === 'garage') {
    g.fillRect(W / 2 - 230, 140, 460, 240);
    g.font = 'bold 26px sans-serif'; g.fillStyle = '#ffb300';
    g.fillText('GARASI', W / 2, 178);
    const rows = ['SIMKAN MOBIL', 'AMBIL MOBIL', 'KEMBALI'];
    rows.forEach((r, i) => {
      const y = 210 + i * 52;
      const on = i === st.idx;
      g.fillStyle = on ? 'rgba(255,179,0,0.35)' : 'rgba(40,40,56,0.95)';
      g.fillRect(W / 2 - 200, y - 30, 400, 44);
      g.fillStyle = '#fff'; g.font = 'bold 17px sans-serif';
      g.fillText(r, W / 2, y);
    });
    g.fillStyle = '#aaa'; g.font = '13px sans-serif';
    g.fillText('Garasi: ' + (st.garageCar == null ? 'kosong' : 'mobil tersimpan'), W / 2, 380);
  }
  g.restore();
}

// komputasi baris menu utama untuk digambar (hanya label).
function mainRowsForDraw(st, s) {
  const rows = [];
  if (s && !st.own.has(s.id)) rows.push('BELI ' + s.label + '  $' + s.price);
  rows.push('LEMARI PAKAIAN');
  rows.push('GARASI');
  rows.push('SIMPAN PERMAINAN');
  return rows;
}

export function updateSafehouses(st, dt, player) {
  st.playerRef = player;
  const s = currentProxy(st);
  // prompt jarak dekat bila tidak sedang membuka panel dan status main.
  if (!st.open && st.ui.state === 'PLAYING' && s) {
    const owned = st.own.has(s.id);
    st.ui.prompt = 'O: ' + (owned ? s.label : 'Beli ' + s.label + ' $' + s.price);
  }
  // tutup panel bila menjauh atau keluar dari status main.
  if (st.open && (st.ui.state !== 'PLAYING' || !s)) st.open = false;

  // jaga warna karakter tetap sesuai outfit.
  const body = outfitDef(st.outfit).body;
  if (st._lastBody !== body) {
    const mesh = st.gfx.playerMesh;
    if (mesh && mesh.material && mesh.material.color) mesh.material.color.set(body);
    st._lastBody = body;
  }

  if (st.open && s) drawPanel(st, s, st.ui);
  void dt;
}

// akses aman ke st.current() (current() memakai playerRef, yang sudah diset di atas).
function currentProxy(st) {
  const focus = st.playerRef && (st.playerRef.car || st.playerRef);
  if (!focus) return null;
  let best = null, bestD = RANGE;
  for (const s of SAFEHOUSES) {
    const d = Math.hypot(s.x - focus.x, s.y - focus.y);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}