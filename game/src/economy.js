// economy.js — toko & layanan: ammo, armor, kesehatan, cat ulang, perbaikan, dan stan hot dog
// Satu motor ekonomi: tabel harga, patokan stok yang diisi ulang seiring waktu, prompt jarak dekat,
// konfirmasi pembelian, dan buku catatan transaksi. Ditulis sendiri untuk SUNNY CITY.
import * as THREE from '../vendor/three.module.min.js';
import { TILE, tileAt } from './world.js';
import { refill } from './weapons.js';

// ---- konstanta penalaan -----------------------------------------------------
const RANGE = 46;               // jarak maksimum pemain untuk memicu prompt toko
const STOCK_RESTOCK_TIME = 30;  // detik untuk mengisi ulang satu unit stok
const LEDGER_MAX = 12;          // batas jumlah baris di buku catatan
const PLAYER_HP_MAX = 100;      // asumsi kesehatan maksimum pemain

// ---- data toko (tabel harga & stok) ----------------------------------------
const SHOP_KINDS = [
  { id: 'ammo',    name: 'AMUNISI',      color: 0xff4a4a, stockMax: 3, items: [{ id: 'ammo',     label: 'Isi ulang ammo',   price: 200 }] },
  { id: 'armor',   name: 'PELINDUNG',    color: 0x4aa8ff, stockMax: 2, items: [{ id: 'armor',    label: 'Pelindung tubuh',  price: 350 }] },
  { id: 'food',    name: 'KESEHATAN',    color: 0x4affd8, stockMax: 4, items: [{ id: 'health',   label: 'Pulihkan HP',      price: 50 }] },
  { id: 'respray', name: 'CAT ULANG',    color: 0xf5d547, stockMax: 2, items: [{ id: 'respray',  label: 'Cat ulang mobil',  price: 100 }] },
  { id: 'repair',  name: 'BENGKEL',      color: 0xff9a3c, stockMax: 2, items: [{ id: 'repair',   label: 'Perbaiki mobil',   price: 150 }] },
  { id: 'hotdog',  name: 'HOT DOG',      color: 0xff6b8a, stockMax: 6, items: [{ id: 'hotdog',   label: 'Hot dog (+10 HP)', price: 20 }] },
];

// ---- penempatan toko di jalan (jauh dari bangunan, tersebar di peta) -------
function placeShops(world) {
  const rng = (seed) => { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  const rand = rng(20262026);
  const placed = [];
  for (const kind of SHOP_KINDS) {
    for (let tries = 0; tries < 400; tries++) {
      const x = (1.5 + rand() * 77) * TILE;
      const y = (1.5 + rand() * 77) * TILE;
      // Hanya di trotoar (T.SIDEWALK === 1), bukan bangunan/rumput, dan tidak menindih toko lain.
      if (tileAt(world, x, y) !== 1) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < 900)) continue;
      placed.push({ kind, x, y });
      break;
    }
  }
  // Jika ada jenis toko yang gagal menempatkan, isi posisi cadangan agar keenam toko ada.
  let fallback = placed.length;
  while (placed.length < SHOP_KINDS.length) {
    const kind = SHOP_KINDS[placed.length];
    const x = (5 + fallback * 7) * TILE, y = (5 + fallback * 7) * TILE;
    placed.push({ kind, x: Math.min(x, world.width - TILE * 2), y: Math.min(y, world.height - TILE * 2) });
    fallback++;
  }
  return placed.slice(0, SHOP_KINDS.length);
}

// ---- material penanda toko (batang cahaya + label) -------------------------
function makeLabelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(18,18,24,0.85)'; ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#ffb300'; ctx.lineWidth = 4; ctx.strokeRect(4, 4, 248, 56);
  ctx.fillStyle = '#ffb300'; ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createEconomy(ctx) {
  const { world, player, ui, audio, gfx, combat } = ctx;

  // Inisialisasi status toko: stok mulai penuh, ledger kosong.
  const shops = placeShops(world);
  const ledger = [];
  const state = { target: null, menu: null };

  const toX = (v) => v - world.width / 2;
  const toZ = (v) => v - world.height / 2;

  // Marker toko: batang cahaya statis + label menghadap kamera.
  const scene = gfx.scene;
  const labelMats = new Map();
  for (const s of shops) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 80, 12, 1, true), new THREE.MeshBasicMaterial({ color: s.kind.color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, fog: false }));
    beam.position.set(toX(s.x), 40, toZ(s.y));
    scene.add(beam);
    const tex = labelMats.get(s.kind.name) || makeLabelTexture(s.kind.name);
    labelMats.set(s.kind.name, tex);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(64, 16), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false, side: THREE.DoubleSide }));
    label.position.set(toX(s.x), 100, toZ(s.y));
    s.label = label;
    scene.add(label);
    s.stock = s.kind.stockMax;
    s.restockTimer = 0;
  }

  // ---- buku catatan (ledger) ----------------------------------------------
  function logPurchase(kindName, itemLabel, price) {
    ledger.unshift({ t: performance.now(), shop: kindName, item: itemLabel, price });
    if (ledger.length > LEDGER_MAX) ledger.length = LEDGER_MAX;
  }

  // ---- harga efektif dengan diskon reputasi ---------------------------------
  function priceOf(base, s) {
    const rep = ui.rep;
    return rep ? (s.kind.id === 'repair' ? rep.repairPrice : rep.price)(base, s.x, s.y) : base;
  }

  // ---- cek stok dan transaksi ----------------------------------------------
  function spend(s, item) {
    const price = priceOf(item.price, s);
    if (ui.money < price) { ui.toast('Uang tidak cukup ($' + price + ')'); return false; }
    if (s.stock <= 0) { ui.toast('Stok habis — tunggu isi ulang'); return false; }
    s.stock--;
    if (s.stock === 0) s.restockTimer = STOCK_RESTOCK_TIME;
    ui.addMoney(-price);
    if (ui.rep) ui.rep.add(s.x, s.y, 2);
    logPurchase(s.kind.name, item.label.replace(' $' + item.price, ''), price);
    ui.save();
    return true;
  }

  // ---- kelayakan efek (tanpa mengubah keadaan) ----------------------------
  function canApply(itemId, s) {
    if (itemId === 'health' || itemId === 'hotdog') {
      if (player.health >= (player.maxHealth ?? PLAYER_HP_MAX)) { ui.toast('HP sudah penuh'); return false; }
      return true;
    }
    if (itemId === 'respray' || itemId === 'repair') {
      const car = player.car;
      const max = car && (car.maxHp || 100);
      if (!car) { ui.toast('Butuh mobil (' + s.kind.name + ')'); return false; }
      if (itemId === 'repair' && (car.hp ?? max) >= max) { ui.toast('Mobil sudah prima'); return false; }
      return true;
    }
    return true; // ammo & armor selalu layak
  }

  // ---- efek per barang ------------------------------------------------------
  function apply(itemId, s) {
    if (itemId === 'ammo') {
      if (combat) refill(combat.ammo);
      ui.toast('AMMO +');
      return;
    }
    if (itemId === 'armor') {
      player.armor = Math.max(player.armor ?? 0, 100);
      ui.toast('PELINDUNG DIPASANG');
      return;
    }
    if (itemId === 'health') {
      player.health = player.maxHealth ?? PLAYER_HP_MAX;
      ui.toast('HP pulih');
      return;
    }
    if (itemId === 'respray') {
      player.car.color = '#' + new THREE.Color().setHSL(Math.random(), 0.7 + Math.random() * 0.25, 0.45 + Math.random() * 0.15).getHexString();
      ui.toast('Cat baru');
      return;
    }
    if (itemId === 'repair') {
      const car = player.car;
      car.hp = car.maxHp || 100;
      ui.toast('Mobil diperbaiki');
      return;
    }
    if (itemId === 'hotdog') {
      player.health = Math.min(player.maxHealth ?? PLAYER_HP_MAX, (player.health ?? PLAYER_HP_MAX) + 10);
      ui.toast('Hot dog enak! +10 HP');
      return;
    }
  }

  // ---- pilah beli (konfirmasi dulu, baru terapkan) -------------------------
  function confirm(s) {
    state.menu = { shop: s, item: s.kind.items[0] };
    audio.click();
  }

  function tryBuy(s) {
    const item = s.kind.items[0];
    // Cek kelayakan efek dulu (misal HP penuh) tanpa mengubah apa pun.
    if (!canApply(item.id, s)) { state.menu = null; state.target = null; return; }
    // Transaksi dulu (uang + stok + catat), baru terapkan efek.
    if (!spend(s, item)) return;
    apply(item.id, s);
    audio.pickup();
    state.menu = null;
    state.target = null;
  }

  // ---- dekat toko ----------------------------------------------------------
  function nearShop() {
    const focus = player.car || player;
    let best = null, bestD = RANGE;
    for (const s of shops) {
      const d = Math.hypot(s.x - focus.x, s.y - focus.y);
      if (d < bestD) { best = s; bestD = d; }
    }
    return best || null;
  }

  // ---- menu konfirmasi di HUD ---------------------------------------------
  function drawMenu() {
    const m = state.menu;
    if (!m) return;
    const ctx = gfx.hud;
    if (!ctx) return;
    const cx = 480, top = 210;
    const shop = m.shop, item = m.item;
    const price = priceOf(item.price, shop);
    const W = 460, boxH = 150;
    ctx.save();
    ctx.fillStyle = 'rgba(8,8,14,0.82)'; ctx.fillRect(cx - W / 2, top, W, boxH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffb300'; ctx.font = 'bold 26px sans-serif';
    ctx.fillText(shop.kind.name, cx, top + 36);
    ctx.fillStyle = '#ddd'; ctx.font = '16px sans-serif';
    ctx.fillText(item.label, cx, top + 64);
    ctx.fillStyle = ui.money >= price ? '#7bd66b' : '#ff6a5a'; ctx.font = 'bold 20px sans-serif';
    ctx.fillText('$' + price + (shop.stock > 0 ? '' : ' (stok habis)'), cx, top + 92);
    ctx.fillStyle = '#aaa'; ctx.font = '13px sans-serif';
    ctx.fillText('E / Enter — beli \u00B7 ESC — batal \u00B7 stok ' + shop.stock + '/' + shop.kind.stockMax, cx, top + 122);
    ctx.restore();
  }

  // ---- API publik ----------------------------------------------------------
  return {
    shops,
    ledger: () => ledger.slice(),
    get active() { return !!state.menu; },

    // Dipanggil dari main.js saat tombol E; mengembalikan true bila dikonsumsi.
    tryInteract() {
      if (state.menu) { tryBuy(state.menu.shop); return true; }
      const s = nearShop();
      if (s) { confirm(s); state.target = s; return true; }
      return false;
    },

    // Konfirmasi pembelian dari tombol Enter / klik.
    confirm() {
      if (state.menu) tryBuy(state.menu.shop);
    },

    cancel() {
      if (state.menu) { state.menu = null; state.target = null; audio.click(); }
    },

    // Menampilkan menu konfirmasi & prompt jarak dekat ke HUD.
    draw(dt) {
      // Isi ulang stok seiring waktu.
      for (const s of shops) {
        if (s.stock < s.kind.stockMax) {
          s.restockTimer -= dt;
          if (s.restockTimer <= 0) { s.stock++; s.restockTimer = s.stock < s.kind.stockMax ? STOCK_RESTOCK_TIME : 0; }
        }
      }
      // Label menghadap kamera.
      for (const s of shops) if (s.label) s.label.quaternion.copy(gfx.camera.quaternion);
      // Prompt jarak dekat.
      if (!state.menu && ui.state === 'PLAYING') {
        const s = nearShop();
        if (s) {
          const item = s.kind.items[0];
          const price = priceOf(item.price, s);
          ui.prompt = `E: ${item.label} $${price}${s.stock <= 0 ? ' (stok habis)' : ''}`;
        }
      }
      // Tutup menu bila pemain menjauh.
      if (state.menu && (!nearShop() || ui.state !== 'PLAYING')) state.menu = null;
    },

    drawMenu,
  };
}

// ---- loop waktu ekonomi ---------------------------------------------------
export function updateEconomy(economy, dt, player) {
  economy.draw(dt);
  void player;
}