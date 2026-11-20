// mechanic.js — bengkel tuning: beli tier mesin, rem, ban, suspensi, dan nitro per mobil
// Efek dipasang di atas fisika vehicle.js lewat field mobil dan koreksi kecil per frame.
import { T, tileAt } from './world.js';

const GARAGE_KEY = 'sunnycity.garage.v1';
const W = 960, H = 540;
const MAX_TIER = 3, MENU_KEY = 'u', MAX_SERVICE_SPEED = 25;
const BASE_PRICE = 250, TIER_PRICE_STEP = 1.8;
const BRAKE_FORCE = 420, ENGINE_BOOST = 0.07, BRAKE_BOOST = 0.12;
const GRIP_BOOST = 0.07, TURN_RATE = 2.4, TOP_SPEED = 320;
const FLAT_RECOVERY = 0.5, CRASH_ABSORB = 0.12, NITRO_REGEN = 0.04;

const PARTS = [
  { id: 'engine', label: 'Mesin', base: 1.0, info: '+7% kecepatan / tier' },
  { id: 'brake', label: 'Rem', base: 0.6, info: 'pengereman lebih kuat' },
  { id: 'tyre', label: 'Ban', base: 0.7, info: 'cengkeraman, ban bocor pulih cepat' },
  { id: 'suspension', label: 'Suspensi', base: 0.8, info: 'kurangi kerusakan tabrakan' },
  { id: 'nitro', label: 'Nitro', base: 1.2, info: 'tangki isi ulang lebih cepat' },
];

const emptyRecord = () => Object.fromEntries(PARTS.map((p) => [p.id, 0]));
const clampTier = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(MAX_TIER, Math.floor(v))) : 0);

function loadGarage() {
  try {
    const data = JSON.parse(localStorage.getItem(GARAGE_KEY) || '{}');
    const out = {};
    if (data && typeof data === 'object') {
      for (const [key, rec] of Object.entries(data)) {
        out[key] = emptyRecord();
        for (const p of PARTS) out[key][p.id] = clampTier(rec && rec[p.id]);
      }
    }
    return out;
  } catch (e) { return {}; }
}

function persist(mechanic) {
  try { localStorage.setItem(GARAGE_KEY, JSON.stringify(mechanic.garage)); } catch (e) { /* storage tidak tersedia */ }
}

export function tierPrice(part, tier) {
  return Math.round(BASE_PRICE * part.base * Math.pow(TIER_PRICE_STEP, tier) / 10) * 10;
}

function carKey(mechanic, car) {
  const i = mechanic.world.cars.indexOf(car);
  return i >= 0 ? 'car' + i : null;
}

function recordFor(mechanic, car) {
  const key = carKey(mechanic, car);
  if (!key) return null;
  if (!mechanic.garage[key]) mechanic.garage[key] = emptyRecord();
  return mechanic.garage[key];
}

export function createMechanic(ctx) {
  const { world, ui, gfx, keys } = ctx;
  return {
    world, ui, gfx, keys,
    garage: loadGarage(),
    open: false,
    idx: 0,
    lastHp: null,
    lastCar: null,
    toggle(player) {
      if (this.open) { this.open = false; return true; }
      const car = player.car;
      if (!car) { ui.toast('Masuk mobil dulu untuk tuning'); return true; }
      if (Math.abs(car.speed) > MAX_SERVICE_SPEED) { ui.toast('Hentikan mobil untuk tuning'); return true; }
      this.open = true; this.idx = 0;
      return true;
    },
    buy(player) {
      const car = player.car, rec = car && recordFor(this, car);
      if (!rec) return false;
      const part = PARTS[this.idx], tier = rec[part.id];
      if (tier >= MAX_TIER) { ui.toast(part.label + ' sudah maksimal'); return false; }
      const price = tierPrice(part, tier);
      if (ui.money < price) { ui.toast('Uang kurang untuk ' + part.label); return false; }
      ui.addMoney(-price);
      rec[part.id] = tier + 1;
      persist(this);
      ui.toast(part.label + ' naik ke tier ' + (tier + 1));
      return true;
    },
    // Mengembalikan true bila tombol dipakai menu (supaya main.js tidak meneruskannya).
    onKey(k, player) {
      if (k === MENU_KEY) return this.toggle(player);
      if (!this.open) return false;
      if (k === 'escape') this.open = false;
      else if (k === 'arrowup' || k === 'w') this.idx = (this.idx + PARTS.length - 1) % PARTS.length;
      else if (k === 'arrowdown' || k === 's') this.idx = (this.idx + 1) % PARTS.length;
      else if (k === 'enter' || k === 'e') this.buy(player);
      return true;
    },
  };
}

function applyTuning(mechanic, car, rec, dt) {
  const keys = mechanic.keys;
  const throttle = keys.has('w') || keys.has('arrowup');
  const reverse = keys.has('s') || keys.has('arrowdown');
  const steer = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);

  if (rec.engine > 0 && throttle && car.speed > 0) {
    const dist = car.speed * ENGINE_BOOST * rec.engine * dt;
    const nx = car.x + Math.cos(car.angle) * dist, ny = car.y + Math.sin(car.angle) * dist;
    if (tileAt(mechanic.world, nx, ny) !== T.BUILDING) { car.x = nx; car.y = ny; }
  }
  if (rec.brake > 0 && reverse && car.speed > 0) {
    car.speed = Math.max(0, car.speed - BRAKE_FORCE * BRAKE_BOOST * rec.brake * dt);
  }
  if (rec.tyre > 0) {
    car.angle += steer * TURN_RATE * GRIP_BOOST * rec.tyre * dt * (car.speed / TOP_SPEED) * Math.sign(car.speed);
    if (car.flatT > 0) car.flatT -= FLAT_RECOVERY * rec.tyre * dt;
  }
  if (rec.suspension > 0 && mechanic.lastCar === car && mechanic.lastHp != null && (car.hp ?? 100) < mechanic.lastHp) {
    const lost = mechanic.lastHp - car.hp;
    car.hp = Math.min(mechanic.lastHp, car.hp + lost * CRASH_ABSORB * rec.suspension);
  }
  if (rec.nitro > 0) {
    car.nitro = true;
    if (!Number.isFinite(car.nitroFuel)) car.nitroFuel = 1;
    if (!(keys.has('shift') && throttle)) car.nitroFuel = Math.min(1, car.nitroFuel + NITRO_REGEN * rec.nitro * dt);
  }
}

function drawMenu(mechanic, car, rec) {
  const g = mechanic.gfx.hud, ui = mechanic.ui;
  if (!g) return;
  const x = W / 2 - 230, y = 110, w = 460, rowH = 54;
  g.save();
  g.fillStyle = 'rgba(8,8,14,0.85)'; g.fillRect(x, y, w, 80 + PARTS.length * rowH + 30);
  g.textAlign = 'center'; g.font = 'bold 26px sans-serif'; g.fillStyle = '#ffb300';
  g.fillText('BENGKEL TUNING', W / 2, y + 36);
  g.font = '15px sans-serif'; g.fillStyle = '#ddd';
  g.fillText('Saldo $' + ui.money + '  \u00B7  Kondisi ' + Math.round(car.hp ?? 100) + '%', W / 2, y + 60);
  PARTS.forEach((p, i) => {
    const ry = y + 80 + i * rowH, tier = rec[p.id], maxed = tier >= MAX_TIER;
    g.fillStyle = i === mechanic.idx ? 'rgba(255,179,0,0.35)' : 'rgba(40,40,56,0.95)';
    g.fillRect(x + 12, ry, w - 24, rowH - 6);
    g.textAlign = 'left'; g.font = 'bold 17px sans-serif'; g.fillStyle = '#fff';
    g.fillText(p.label + '  ' + '\u25A0'.repeat(tier) + '\u25A1'.repeat(MAX_TIER - tier), x + 24, ry + 22);
    g.font = '12px sans-serif'; g.fillStyle = '#aaa'; g.fillText(p.info, x + 24, ry + 40);
    g.textAlign = 'right'; g.font = 'bold 17px sans-serif';
    const price = tierPrice(p, tier);
    g.fillStyle = maxed ? '#7fe3ff' : ui.money >= price ? '#7bd66b' : '#ff6a5a';
    g.fillText(maxed ? 'MAKS' : '$' + price, x + w - 24, ry + 30);
  });
  g.textAlign = 'center'; g.font = '13px sans-serif'; g.fillStyle = '#aaa';
  g.fillText('Panah: pilih \u00B7 Enter/E: beli \u00B7 ESC/U: tutup', W / 2, y + 80 + PARTS.length * rowH + 16);
  g.restore();
}

export function updateMechanic(mechanic, dt, player) {
  const car = player.car;
  if (!car) {
    mechanic.open = false; mechanic.lastCar = null; mechanic.lastHp = null;
    return;
  }
  const rec = recordFor(mechanic, car);
  if (rec) applyTuning(mechanic, car, rec, dt);
  mechanic.lastCar = car;
  mechanic.lastHp = car.hp ?? 100;
  if (mechanic.open && rec) {
    if (Math.abs(car.speed) > MAX_SERVICE_SPEED) mechanic.open = false;
    else drawMenu(mechanic, car, rec);
  }
}
