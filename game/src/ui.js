// ui.js — state MENU/PLAYING/PAUSED, HUD uang, toast, dan save/load localStorage
// Menu, HUD, dan penyimpanan lokal ditulis sendiri untuk game ini.
import { normalizeStanding } from './standing.js';
import { T, COLS, ROWS, WORLD_W, WORLD_H, districtOfBlock } from './world.js';

const SAVE_KEY = 'sunnycity.save.v1';
const SETTINGS_KEY = 'sunnycity.settings.v1';
const W = 960, H = 540, TOAST_SECONDS = 2;
export const GARAGE_ROWS = { x: 330, w: 300, top: 205, step: 52, h: 44 };
const TOUCH_CONTROLS = ['Joystick kiri: gerak · E: masuk mobil · F: tembak', 'LARI: sprint · PAUSE: jeda'];
const CONTROLS = ['WASD / Panah — jalan & kemudi', 'E — masuk / keluar mobil', 'F / Klik kiri — tembak', 'Mouse — bidik', '1-4 — ganti senjata · tahan Q — roda senjata', 'M — peta · Tab — log misi · P — mode foto', 'ESC — pause'];

const QUALITY_LABEL = { low: 'RENDAH', medium: 'SEDANG', high: 'TINGGI' };

const DEFAULT_SETTINGS = { quality: 'high', shadows: true, sensitivity: 0.5, volume: 0.7 };

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const data = JSON.parse(raw);
    const out = { ...DEFAULT_SETTINGS };
    if (data && typeof data === 'object') {
      if (QUALITY_LABEL[data.quality]) out.quality = data.quality;
      if (typeof data.shadows === 'boolean') out.shadows = data.shadows;
      if (Number.isFinite(data.sensitivity)) out.sensitivity = Math.max(0, Math.min(1, data.sensitivity));
      if (Number.isFinite(data.volume)) out.volume = Math.max(0, Math.min(1, data.volume));
    }
    return out;
  } catch (e) { return { ...DEFAULT_SETTINGS }; }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.money !== 'number' || !isFinite(data.money)) return null;
    return data;
  } catch (e) { return null; }
}

const MAP_VIEW_W = 820, MAP_VIEW_H = 456;
function districtFill(district) { return ['#5a7fa8', '#7a8a56', '#8a6b4f'][district] || '#666'; }
let mapCache = null;
function buildMapCanvas(world) {
  const c = document.createElement('canvas');
  c.width = MAP_VIEW_W; c.height = MAP_VIEW_H;
  const ctx = c.getContext('2d');
  const sx = MAP_VIEW_W / WORLD_W, sy = MAP_VIEW_H / WORLD_H;
  // ocean / base underlay
  ctx.fillStyle = '#1b3948';
  ctx.fillRect(0, 0, MAP_VIEW_W, MAP_VIEW_H);
  // districts as coloured blocks (10x10 tiles each)
  const BLOCKS = COLS / 10;
  const tileW = MAP_VIEW_W / COLS, tileH = MAP_VIEW_H / ROWS;
  for (let by = 0; by < BLOCKS; by++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      ctx.fillStyle = districtFill(districtOfBlock(bx, by));
      ctx.fillRect(bx * 10 * tileW, by * 10 * tileH, 10 * tileW, 10 * tileH);
    }
  }
  // roads (tile type 0) — draw as dark strokes
  ctx.fillStyle = '#2c2f36';
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (world.tiles[y * COLS + x] === T.ROAD) ctx.fillRect(x * tileW, y * tileH, tileW + 0.4, tileH + 0.4);
    }
  }
  // parks
  ctx.fillStyle = '#4f9a4f';
  for (const p of world.parks) ctx.fillRect(p.x * sx, p.y * sy, p.w * sx, p.h * sy);
  // district labels
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const names = ['PUSAT', 'TENGAH', 'PINGGIR'];
  const centers = [[0, 0], [0, 0], [0, 0]];
  const counts = [0, 0, 0];
  for (let by = 0; by < BLOCKS; by++) for (let bx = 0; bx < BLOCKS; bx++) {
    const d = districtOfBlock(bx, by);
    centers[d][0] += (bx + 0.5) * 10 * tileW; centers[d][1] += (by + 0.5) * 10 * tileH; counts[d]++;
  }
  names.forEach((n, d) => {
    if (!counts[d]) return;
    const cx = centers[d][0] / counts[d], cy = centers[d][1] / counts[d];
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(cx - 40, cy - 11, 80, 20);
    ctx.fillStyle = '#fff'; ctx.fillText(n, cx, cy + 4);
  });
  return c;
}

export function createUI(hud) {
  const saved = loadSave();
  const ui = {
    state: 'MENU',
    touch: false,
    money: saved ? saved.money : 0,
    missionsDone: saved && Number.isFinite(saved.missionsDone) ? saved.missionsDone : 0,
    pkMask: saved && Number.isFinite(saved.pkMask) ? saved.pkMask : 0,
    pkCount: 0, pkTotal: 12, station: null, stationT: 0, garageMenu: null,
    standing: normalizeStanding(saved && saved.standing),
    standingHud: null,
    wanted: 0,
    hasSave: !!saved,
    settings: loadSettings(),
    navMenu: false, navIdx: 0, navScreen: 'main',
    logOpen: false, logIdx: 0,
    mapCanvas: null, world: null, missions: null, player: null,
    photoHint: 0, photoFilter: 0,
    driftBest: saved && Number.isFinite(saved.driftBest) ? saved.driftBest : 0,
    sideDone: saved && Number.isFinite(saved.sideDone) ? saved.sideDone : 0,
    toasts: [],
    toast(text, secs = TOAST_SECONDS) {
      const act = ui.missions && ui.missions.active;
      if (act && act.def && act.def.kind === 'side' && /^MISI SELESAI/.test(text)) ui.sideDone++;
      ui.toasts.push({ text, t: secs, max: secs }); if (ui.toasts.length > 5) ui.toasts.shift(); },
    addMoney(n) { ui.money += n; ui.toast((n >= 0 ? '+ $' : '- $') + Math.abs(n)); },
    saveSettings() {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(ui.settings)); } catch (e) { /* storage tidak tersedia */ }
    },
    link(world, missions, player) { ui.world = world; ui.missions = missions; ui.player = player; if (world && !mapCache) mapCache = buildMapCanvas(world); ui.mapCanvas = mapCache; },
    setWorld(world) { ui.world = world; if (world && !mapCache) mapCache = buildMapCanvas(world); ui.mapCanvas = mapCache; },
    isPaused() { return ui.state === 'PAUSED' || ui.state === 'MAP' || ui.state === 'PHOTO'; },
    save() {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({ money: ui.money, missionsDone: ui.missionsDone, pkMask: ui.pkMask, standing: ui.standing, wanted: ui.wanted, driftBest: ui.driftBest, sideDone: ui.sideDone, savedAt: Date.now() }));
      } catch (e) { /* storage tidak tersedia */ }
    },
    openMap() { if (ui.state !== 'PLAYING') return; ui.state = 'MAP'; },
    closeMap() { if (ui.state === 'MAP') ui.state = 'PLAYING'; },
    openPhoto() { if (ui.state !== 'PLAYING') return; ui.state = 'PHOTO'; ui.photoHint = 4; },
    closePhoto() { if (ui.state === 'PHOTO') ui.state = 'PLAYING'; },
    toggleLog() {
      if (ui.state !== 'PLAYING') return;
      ui.logOpen = !ui.logOpen;
    },
    // Navigasi & mulai pekerjaan sampingan dari Log Misi.
    logSelect(delta) {
      if (!ui.logOpen || !ui.missions || !ui.missions.list) return;
      const n = ui.missions.list.length;
      ui.logIdx = ((ui.logIdx + delta) % n + n) % n;
    },
    logStartSelected() {
      if (!ui.logOpen || !ui.missions || !ui.missions.list) return;
      const def = ui.missions.list[ui.logIdx];
      if (!def) return;
      if (def.kind === 'side') {
        ui.missions.startSide(def.id);
        ui.logOpen = false;
        ui.toast(def.title + ' — DIMULAI');
      }
    },
    logClick(x, y) {
      if (!ui.logOpen || !ui.missions || !ui.missions.list) return;
      // Area baris log: panel 640..940, baris mulai y=157 dengan tinggi 42.
      if (x < 656 || x > 924) return;
      const first = 157, step = 42, n = ui.missions.list.length;
      const idx = Math.floor((y - first) / step);
      if (idx < 0 || idx >= n) return;
      ui.logIdx = idx;
      ui.logStartSelected();
    },
    openPause() {
      ui.state = 'PAUSED'; ui.navScreen = 'main'; ui.navIdx = 0; ui.navMenu = true; ui.save(); if (ui.onSave) ui.onSave();
    },
    handleKey(e) {
      if (e.repeat) return null;
      if (e.key === 'Enter' && ui.state === 'MENU') { ui.state = 'PLAYING'; return 'start'; }
      if (ui.logOpen && ui.state === 'PLAYING') {
        if (e.key === 'Escape' || e.key === 'Tab') { ui.logOpen = false; ui.logIdx = 0; return null; }
        if (e.key === 'ArrowUp') { ui.logSelect(-1); return 'log-nav'; }
        if (e.key === 'ArrowDown') { ui.logSelect(1); return 'log-nav'; }
        if (e.key === 'Enter') { ui.logStartSelected(); return 'log-nav'; }
        return null;
      }
      if (ui.state === 'MAP') {
        if (e.key === 'm' || e.key === 'Escape' || e.key === 'Enter') { ui.closeMap(); return 'map-close'; }
        return 'map';
      }
      if (ui.state === 'PHOTO') {
        if (e.key === 'p' || e.key === 'Escape') { ui.closePhoto(); return 'photo-close'; }
        if (e.key === 'Enter') return 'photo-shot';
        if (e.key.toLowerCase() === 'f') { ui.photoFilter = ((ui.photoFilter || 0) + 1) % PHOTO_FILTERS.length; return 'photo'; }
        return 'photo';
      }
      if (ui.state === 'PAUSED') {
        if (!ui.navMenu) { ui.navMenu = true; ui.navIdx = 0; }
        if (ui.navScreen === 'settings') {
          if (e.key === 'Escape' || e.key === 'Backspace') { ui.navScreen = 'main'; ui.navIdx = 0; return null; }
          if (e.key.startsWith('Arrow')) {
            if (e.key === 'ArrowUp') ui.navIdx = Math.max(0, ui.navIdx - 1);
            else if (e.key === 'ArrowDown') ui.navIdx = Math.min(3, ui.navIdx + 1);
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') ui.adjustSetting(e.key === 'ArrowRight');
            return 'settings-nav';
          }
          if (e.key === 'Enter' && ui.navIdx === 3) { ui.navScreen = 'main'; ui.navIdx = 0; }
          if (e.key === 'Enter') { ui.saveSettings(); return 'settings-nav'; }
          return 'settings';
        }
        if (e.key === 'Escape') { ui.navMenu = false; ui.state = 'PLAYING'; return 'resume'; }
        if (e.key.startsWith('Arrow')) {
          if (e.key === 'ArrowUp') ui.navIdx = Math.max(0, ui.navIdx - 1);
          else if (e.key === 'ArrowDown') ui.navIdx = Math.min(3, ui.navIdx + 1);
          return 'pause-nav';
        }
        if (e.key === 'Enter') {
          const sel = ['resume', 'settings', 'save', 'quit'][ui.navIdx];
          if (sel === 'resume') { ui.navMenu = false; ui.state = 'PLAYING'; return 'resume'; }
          if (sel === 'settings') { ui.navScreen = 'settings'; ui.navIdx = 0; return 'settings-nav'; }
          if (sel === 'save') { ui.save(); ui.toast('PERMAINAN DISIMPAN'); return 'pause-nav'; }
          if (sel === 'quit') { ui.navMenu = false; ui.state = 'MENU'; return 'quit'; }
        }
        if (e.key.toLowerCase() !== 'escape') return 'pause-nav';
        return null;
      }
      if (e.key === 'Escape') {
        if (ui.state === 'PLAYING') { ui.openPause(); return 'pause'; }
      }
      return null;
    },
    adjustSetting(right) {
      const s = ui.settings;
      if (ui.navIdx === 0) {
        const order = ['low', 'medium', 'high'];
        const i = (order.indexOf(s.quality) + (right ? 1 : -1) + order.length) % order.length;
        s.quality = order[i];
      } else if (ui.navIdx === 1) s.shadows = right ? true : false;
      else if (ui.navIdx === 2) s.sensitivity = Math.max(0, Math.min(1, Math.round((s.sensitivity + (right ? 0.1 : -0.1)) * 10) / 10));
      else if (ui.navIdx === 3) s.volume = Math.max(0, Math.min(1, Math.round((s.volume + (right ? 0.1 : -0.1)) * 10) / 10));
      ui.saveSettings();
      if (ui.onSettings) ui.onSettings(ui.settings);
    },
    click() {
      if (ui.state === 'MENU') { ui.state = 'PLAYING'; return 'start'; }
      return null;
    },
    update(dt, ctx) {
      for (const t of ui.toasts) t.t -= dt;
      if (ui.stationT > 0) ui.stationT -= dt;
      if (ui.photoHint > 0) ui.photoHint -= dt;
      const dc = ui.player && ui.player.car;
      if (dc && dc.driftTotal > ui.driftBest) ui.driftBest = dc.driftTotal;
      ui.toasts = ui.toasts.filter((t) => t.t > 0);
      ctx = ctx || (hud && hud.getContext && hud.getContext('2d'));
      if (!ctx) return;
      if (ui.state === 'PLAYING') { drawPlaying(ctx, ui); if (ui.logOpen) drawMissionLog(ctx, ui); }
      else if (ui.state === 'DEAD') drawDead(ctx, ui);
      else if (ui.state === 'MAP') drawMap(ctx, ui);
      else if (ui.state === 'PHOTO') drawPhotoHint(ctx, ui);
      else drawOverlay(ctx, ui);
    },
  };
  return ui;
}

function drawPlaying(ctx, ui) {
  ctx.save();
  ctx.textAlign = 'right';
  ctx.font = 'bold 26px sans-serif';
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.fillStyle = '#7bd66b';
  const label = '$' + ui.money;
  ctx.strokeText(label, W - 20, 98); ctx.fillText(label, W - 20, 98);
  ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = '#ffd21f';
  const pk = 'PAKET ' + ui.pkCount + '/' + ui.pkTotal;
  ctx.strokeText(pk, W - 20, 118); ctx.fillText(pk, W - 20, 118);
  ctx.font = 'bold 26px sans-serif';
  ctx.font = 'bold 15px sans-serif';
  ui.toasts.forEach((t, i) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, t.t / ((t.max || TOAST_SECONDS) * 0.4)));
    let s = t.text;
    while (s.length > 1 && ctx.measureText(s).width > 392) s = s.slice(0, -2).trimEnd() + '\u2026';
    const tw = Math.min(420, ctx.measureText(s).width + 24), y = 144 + i * 28;
    ctx.fillStyle = 'rgba(8,8,14,0.6)'; ctx.fillRect(W - 20 - tw + 8, y - 17, tw, 24);
    ctx.fillStyle = '#ffe27a';
    ctx.fillText(s, W - 20 - 4, y);
  });
  if (ui.prompt) {
    ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.font = 'bold 18px sans-serif';
    const tw = ctx.measureText(ui.prompt).width + 28;
    ctx.fillStyle = 'rgba(8,8,14,0.72)'; ctx.fillRect(W / 2 - tw / 2, H - 112, tw, 32);
    ctx.fillStyle = '#ffffff'; ctx.fillText(ui.prompt, W / 2, H - 90);
  }
  if (ui.stationT > 0 && ui.station) {
    ctx.globalAlpha = Math.min(1, ui.stationT / 0.5);
    ctx.textAlign = 'center'; ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = '#7fe3ff';
    const t = '\u266A ' + ui.station;
    ctx.strokeText(t, W / 2, 60); ctx.fillText(t, W / 2, 60);
  }
  ctx.restore();
  drawWeapon(ctx, ui);
  drawHitmarker(ctx, ui);
  drawMinimapLegend(ctx);
  drawStanding(ctx, ui);
  drawGarage(ctx, ui);
}

function drawStanding(ctx, ui) {
  const s = ui.standingHud;
  if (!s) return;
  const x = 20, y = 523;
  ctx.save();
  ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  const label = s.name + ' ' + Math.round(s.value);
  ctx.strokeText(label, x, y + 9); ctx.fillStyle = s.shield ? '#7fe3ff' : '#e8e8e8'; ctx.fillText(label, x, y + 9);
  const bx = x + 90, bw = 38;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, y + 2, bw, 8);
  ctx.fillStyle = s.shield ? '#4fd0ff' : '#ffb347'; ctx.fillRect(bx + 1, y + 3, (bw - 2) * Math.min(100, s.value) / 100, 6);
  ctx.restore();
}

function drawGarage(ctx, ui) {
  const g = ui.garageMenu;
  if (!g) return;
  const R = GARAGE_ROWS;
  ctx.save();
  ctx.fillStyle = 'rgba(8,8,14,0.78)'; ctx.fillRect(R.x - 20, R.top - 70, R.w + 40, 3 * R.step + 110);
  ctx.textAlign = 'center'; ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = '#ffb300';
  ctx.fillText('GARASI', W / 2, R.top - 38);
  ctx.font = '15px sans-serif'; ctx.fillStyle = '#ddd';
  ctx.fillText('Kondisi ' + g.hp + '%  \u00B7  Saldo $' + ui.money, W / 2, R.top - 14);
  g.items.forEach((it, i) => {
    const y = R.top + i * R.step;
    ctx.fillStyle = 'rgba(40,40,56,0.95)'; ctx.fillRect(R.x, y, R.w, R.h);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = 'bold 17px sans-serif';
    ctx.fillText(it.key + '  ' + it.label, R.x + 12, y + 28);
    ctx.textAlign = 'right'; ctx.fillStyle = ui.money >= it.price ? '#7bd66b' : '#ff6a5a';
    ctx.fillText('$' + it.price, R.x + R.w - 12, y + 28);
  });
  ctx.textAlign = 'center'; ctx.font = '14px sans-serif'; ctx.fillStyle = '#aaa';
  ctx.fillText('ESC / E untuk keluar', W / 2, R.top + 3 * R.step + 14);
  ctx.restore();
}

const WEAPON_IDS = ['pistol', 'smg', 'shotgun', 'rifle', 'compactsmg'];
const WEAPON_LABEL = { pistol: 'PISTOL', smg: 'SMG', shotgun: 'SHOTGUN', rifle: 'RIFLE', compactsmg: 'COMPACT SMG' };
function drawWeapon(ctx, ui) {
  if (!ui.weapon) return;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(W - 170, H - 70, 150, 36);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText((ui.weaponName || WEAPON_LABEL[ui.weapon]) + ' [' + (ui.weaponIndex || 1) + ']', W - 162, H - 47);
  ctx.textAlign = 'right';
  let ammoText;
  if (ui.reserve != null) {
    const mag = ui.reloading ? '< ' + (ui.ammo || 0) : String(ui.ammo || 0);
    ammoText = mag + '/' + ui.reserve;
    ctx.fillStyle = ui.reloading ? '#79c2ff' : (ui.ammo > 0 ? '#ffe27a' : '#ff4a4a');
  } else {
    ammoText = ui.ammo > 0 ? String(ui.ammo) : 'KOSONG';
    ctx.fillStyle = ui.ammo > 0 ? '#ffe27a' : '#ff4a4a';
  }
  ctx.fillText(ammoText, W - 28, H - 47);
  ctx.restore();
  drawPickups(ctx, ui);
  drawWheel(ctx, ui);
}

function drawPickups(ctx, ui) {
  if (!ui.pickups || !ui.pickups.length) return;
  ctx.save();
  for (const p of ui.pickups) {
    const s = Math.max(0.5, Math.min(1.2, 300 / (p.d + 100)));
    ctx.fillStyle = '#ffd21f'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.fillRect(p.x - 9 * s, p.y - 14 * s - 14, 18 * s, 12 * s); ctx.strokeRect(p.x - 9 * s, p.y - 14 * s - 14, 18 * s, 12 * s);
    ctx.fillStyle = '#000'; ctx.font = `bold ${Math.round(9 * s + 2)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('AMMO', p.x, p.y - 14 * s - 4);
  }
  ctx.restore();
}

function drawWheel(ctx, ui) {
  const wh = ui.wheel;
  if (!wh) return;
  const cx = 480, cy = 270, r = 80;
  const n = WEAPON_IDS.length;
  const pos = WEAPON_IDS.map((_, i) => {
    const a = -Math.PI / 2 + i * (Math.PI * 2 / n);
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(cx, cy, r + 42, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = 'center'; ctx.font = 'bold 15px sans-serif';
  WEAPON_IDS.forEach((id, i) => {
    const [dx, dy] = pos[i], on = wh.sel === i || (wh.sel == null && ui.weapon === id);
    ctx.fillStyle = on ? 'rgba(255,210,31,0.9)' : 'rgba(30,30,40,0.85)';
    ctx.fillRect(cx + dx - 48, cy + dy - 22, 96, 44);
    ctx.fillStyle = on ? '#000' : '#fff';
    ctx.fillText(`${i + 1} ${WEAPON_LABEL[id]}`, cx + dx, cy + dy - 2);
    ctx.fillText(String(wh.ammo[id]), cx + dx, cy + dy + 15);
  });
  ctx.restore();
}

function drawHitmarker(ctx, ui) {
  const h = ui.hit;
  if (!h || h.t <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, h.t / 0.12);
  ctx.strokeStyle = h.kill ? '#ff2a2a' : '#fff'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(h.x - 10, h.y - 10); ctx.lineTo(h.x - 4, h.y - 4);
  ctx.moveTo(h.x + 10, h.y - 10); ctx.lineTo(h.x + 4, h.y - 4);
  ctx.moveTo(h.x - 10, h.y + 10); ctx.lineTo(h.x - 4, h.y + 4);
  ctx.moveTo(h.x + 10, h.y + 10); ctx.lineTo(h.x + 4, h.y + 4);
  ctx.stroke();
  ctx.restore();
}

function drawDead(ctx, ui) {
  const d = ui.dead;
  if (!d) return;
  const wasted = d.kind === 'WASTED';
  ctx.save();
  ctx.fillStyle = `rgba(30,30,30,${Math.min(0.55, d.t * 1.2).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = Math.min(1, d.t * 2);
  ctx.textAlign = 'center';
  ctx.font = 'bold 110px sans-serif';
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.fillStyle = wasted ? '#d11a1a' : '#fff';
  ctx.strokeText(d.kind, W / 2, H / 2 + 30); ctx.fillText(d.kind, W / 2, H / 2 + 30);
  ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = '#ddd';
  ctx.fillText(wasted ? 'Kamu tewas' : 'Kamu ditangkap polisi', W / 2, H / 2 + 70);
  ctx.restore();
  drawWeapon(ctx, ui);
}

const PHOTO_FILTERS = [
  { name: 'NORMAL', tint: null },
  { name: 'NOIR', tint: 'rgba(24,26,36,0.42)', vignette: 0.6 },
  { name: 'WARM', tint: 'rgba(255,150,60,0.2)', vignette: 0.2 },
  { name: 'COOL', tint: 'rgba(70,130,255,0.2)', vignette: 0.2 },
];

function drawPhotoHint(ctx, ui) {
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  const f = PHOTO_FILTERS[ui.photoFilter || 0];
  if (f.tint) { ctx.fillStyle = f.tint; ctx.fillRect(0, 0, W, H); }
  if (f.vignette) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.6);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + f.vignette + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(W / 2 - 300, 12, 600, 30);
  ctx.textAlign = 'center'; ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#fff';
  ctx.fillText('MODE FOTO — Panah: orbit · F: filter [' + f.name + '] · Enter: simpan · P/ESC: keluar', W / 2, 32);
  ctx.restore();
}

function drawMinimapLegend(ctx) {
  const items = [['#fff', 'kamu'], ['#ff2a2a', 'polisi'], ['#ffd21f', 'misi']];
  ctx.save();
  ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  let x = 150;
  const y = H - 16;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - 6, y - 12, 150, 18);
  for (const [c, label] of items) {
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + 4, y - 3, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ddd'; ctx.fillText(label, x + 12, y);
    x += 12 + ctx.measureText(label).width + 12;
  }
  ctx.restore();
}

function drawPauseStats(ctx, ui) {
  const x = W / 2 + 210, y = 212, w = 230;
  const rows = [
    ['Drift terbaik', Math.round(ui.driftBest || 0)],
    ['Koleksi', ui.pkCount + '/' + ui.pkTotal],
    ['Side job', ui.sideDone || 0],
  ];
  ctx.save();
  ctx.fillStyle = 'rgba(8,8,14,0.6)'; ctx.fillRect(x, y, w, 24 + rows.length * 26 + 8);
  ctx.textAlign = 'left'; ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#ffb347';
  ctx.fillText('STATISTIK', x + 12, y + 20);
  rows.forEach(([label, val], i) => {
    const ry = y + 46 + i * 26;
    ctx.font = '14px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#bbb'; ctx.fillText(label, x + 12, ry);
    ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText(String(val), x + w - 12, ry);
  });
  ctx.restore();
}

function drawMap(ctx, ui) {
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#08141c'; ctx.fillRect(0, 0, W, H);
  const cw = MAP_VIEW_W, ch = MAP_VIEW_H;
  const ox = (W - cw) / 2, oy = 64;
  if (!ui.world || !ui.mapCanvas) {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('PETA TIDAK TERSEDIA', W / 2, H / 2);
    ctx.restore(); return;
  }
  ctx.drawImage(ui.mapCanvas, ox, oy, cw, ch);
  // player arrow
  const p = ui.player && (ui.player.car || ui.player);
  if (p) {
    const sx = cw / WORLD_W, sy = ch / WORLD_H;
    const px = ox + p.x * sx, py = oy + p.y * sy;
    const angle = ui.player && ui.player.car ? ui.player.car.angle : (p.facing || 0);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-7, 7); ctx.lineTo(-3, 0); ctx.lineTo(-7, -7); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // mission markers
  if (ui.missions && ui.missions.markers) {
    const sx = cw / WORLD_W, sy = ch / WORLD_H;
    for (const m of ui.missions.markers) {
      const mx = ox + m.x * sx, my = oy + m.y * sy;
      ctx.fillStyle = '#ffd21f'; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, my, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  // title bar
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffb347'; ctx.font = 'bold 28px sans-serif';
  ctx.fillText('PETA SUNNY CITY', W / 2, 40);
  ctx.fillStyle = '#ccc'; ctx.font = '14px sans-serif';
  ctx.fillText('M / ESC / Enter — tutup peta', W / 2, 54);
  // legend
  ctx.textAlign = 'left'; ctx.font = '12px sans-serif';
  let lx = ox, ly = oy + ch + 22;
  ctx.fillStyle = '#ffd21f'; ctx.fillRect(lx, ly - 9, 10, 10); ctx.fillStyle = '#ddd'; ctx.fillText('penanda misi', lx + 16, ly);
  const labelW = ctx.measureText('penanda misi').width + 16;
  lx += labelW + 24;
  ctx.fillStyle = '#fff'; ctx.fillRect(lx, ly - 6, 10, 10); ctx.fillStyle = '#ddd'; ctx.fillText('posisi kamu', lx + 16, ly);
  ctx.restore();
}

function drawMissionLog(ctx, ui) {
  if (!ui.missions || !ui.missions.list) return;
  ctx.save();
  ctx.fillStyle = 'rgba(8,8,14,0.82)'; ctx.fillRect(640, 90, 300, 420);
  ctx.fillStyle = '#ffb347'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('LOG MISI', 662, 124);
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#aaa';
  const done = ui.missionsDone || 0;
  ctx.fillText('Selesai ' + done + ' / ' + ui.missions.list.length, 662, 148);
  const active = ui.missions.active;
  ui.missions.list.forEach((m, i) => {
    const y = 172 + i * 42;
    const isActive = active && active.id === m.id;
    const isSide = m.kind === 'side';
    const isDone = !isSide && i < done;
    const sel = ui.logOpen && ui.logIdx === i;
    ctx.fillStyle = sel ? 'rgba(255,210,31,0.32)' : isActive ? 'rgba(255,210,31,0.18)' : 'rgba(0,0,0,0.25)';
    ctx.fillRect(656, y - 15, 268, 34);
    if (sel) { ctx.strokeStyle = '#ffd21f'; ctx.lineWidth = 2; ctx.strokeRect(656, y - 15, 268, 34); }
    ctx.fillStyle = isActive ? '#ffd21f' : isDone ? '#7bd66b' : isSide ? '#7fd6ff' : '#999';
    ctx.font = 'bold 14px sans-serif';
    const title = `${i + 1}. ${m.title}`;
    let t = title; while (t.length > 1 && ctx.measureText(t).width > 240) t = t.slice(0, -2).trimEnd() + '\u2026';
    ctx.fillText(t, 666, y + 4);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = isActive ? '#ffe88a' : '#777';
    ctx.fillText(
      isActive ? 'BERJALAN'
        : isSide ? 'SIDE JOB — Enter untuk mulai'
        : isDone ? 'SELESAI — ' + m.who
        : '— ' + m.who,
      666, y + 16);
  });
  ctx.fillStyle = '#888'; ctx.font = '12px sans-serif';
  ctx.fillText('Panah: pilih · Enter: mulai · Tab untuk menutup', 662, 172 + ui.missions.list.length * 42 + 10);
  ctx.restore();
}

function drawOverlay(ctx, ui) {
  const menu = ui.state === 'MENU';
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  if (menu) {
    ctx.fillStyle = 'rgba(8,8,14,0.4)'; ctx.fillRect(210, 36, W - 420, H - 72);
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
  } else {
    ctx.fillStyle = 'rgba(8,8,14,0.65)'; ctx.fillRect(0, 0, W, H);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  let y = 120;
  if (menu) {
    ctx.font = 'bold 72px sans-serif'; ctx.fillStyle = '#ffb347';
    ctx.fillText('SUNNY CITY', W / 2, y);
    ctx.font = '22px sans-serif'; ctx.fillStyle = '#ddd';
    ctx.fillText('open-world crime', W / 2, y + 36);
    y += 100;
    ctx.font = 'bold 24px sans-serif'; ctx.fillStyle = '#fff';
    ctx.fillText((ui.touch ? 'TAP UNTUK MULAI' : 'TEKAN ENTER / KLIK UNTUK MULAI'), W / 2, y);
    y += 40;
  } else {
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText('PAUSED', W / 2, y + 20);
    y += 80;
    if (ui.navMenu) {
      if (ui.navScreen === 'settings') {
        drawSettingsMenu(ctx, ui);
        ctx.restore();
        return;
      }
      drawPauseMenu(ctx, ui);
      ctx.restore();
      return;
    }
  }
  ctx.font = '18px sans-serif'; ctx.fillStyle = '#ccc';
  for (const line of (ui.touch ? TOUCH_CONTROLS : CONTROLS)) { ctx.fillText(line, W / 2, y); y += 28; }
  y += 14;
  if (menu) {
    if (ui.hasSave) { ctx.fillStyle = '#7bd66b'; ctx.font = 'bold 20px sans-serif'; ctx.fillText('uang tersimpan: $' + ui.money, W / 2, y); }
  } else {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 20px sans-serif';
    ctx.fillText((ui.touch ? 'PAUSE untuk lanjut' : 'ESC untuk lanjut'), W / 2, y);
  }
  ctx.restore();
}

function drawPauseMenu(ctx, ui) {
  const items = ['LANJUTKAN', 'PENGATURAN', 'SIMPAN', 'KELUAR'];
  const startY = 240, step = 52;
  ctx.fillStyle = '#ffb347'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('PAUSED', W / 2, 180);
  ctx.font = 'bold 22px sans-serif';
  items.forEach((label, i) => {
    const y = startY + i * step;
    const on = ui.navIdx === i;
    if (on) {
      ctx.fillStyle = '#ffd21f';
      ctx.fillRect(W / 2 - 180, y - 28, 360, 44);
      ctx.fillStyle = '#000';
    } else {
      ctx.fillStyle = '#ccc';
    }
    ctx.fillText(label, W / 2, y + 3);
  });
  ctx.font = '14px sans-serif'; ctx.fillStyle = '#999';
  ctx.fillText('Panah: pilih · Enter: konfirmasi · ESC: tutup', W / 2, startY + items.length * step + 20);
  const sc = ui.saveCounters || {};
  ctx.fillStyle = '#7bd66b'; ctx.font = 'bold 14px sans-serif';
  ctx.fillText('SAVE: $' + ui.money + ', ' + (ui.missionsDone || 0) + ' misi, ' + (sc.carsStolen || 0) + ' mobil', W / 2, startY + items.length * step + 40);
  drawPauseStats(ctx, ui);
}

function drawSettingsMenu(ctx, ui) {
  const s = ui.settings;
  ctx.fillStyle = '#fff'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('PENGATURAN', W / 2, 150);
  const rows = [
    'KUALITAS RENDER       ' + QUALITY_LABEL[s.quality],
    'BAYANGAN              ' + (s.shadows ? 'AKTIF' : 'MATI'),
    'SENSITIVITAS MOUSE    ' + Math.round(s.sensitivity * 100) + '%',
    'VOLUME MASTER         ' + Math.round(s.volume * 100) + '%',
  ];
  const startY = 200, step = 50;
  rows.forEach((label, i) => {
    const y = startY + i * step;
    const on = ui.navIdx === i;
    if (on) {
      ctx.fillStyle = 'rgba(255,210,31,0.2)';
      ctx.fillRect(W / 2 - 300, y - 24, 600, 40);
      ctx.fillStyle = '#ffd21f';
    } else ctx.fillStyle = '#ddd';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(label, W / 2, y + 6);
  });
  ctx.fillStyle = '#999'; ctx.font = '14px sans-serif';
  ctx.fillText('Panah kiri/kanan: ubah · Enter: simpan & balik · ESC: balik', W / 2, startY + rows.length * step + 30);
}
