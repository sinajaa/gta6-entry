// ui.js — state MENU/PLAYING/PAUSED, HUD uang, toast, dan save/load localStorage
// Menu, HUD, dan penyimpanan lokal ditulis sendiri untuk game ini.
const SAVE_KEY = 'sunnycity.save.v1';
const W = 960, H = 540, TOAST_SECONDS = 2;
export const GARAGE_ROWS = { x: 330, w: 300, top: 205, step: 52, h: 44 };
const TOUCH_CONTROLS = ['Joystick kiri: gerak · E: masuk mobil · F: tembak', 'LARI: sprint · PAUSE: jeda'];
const CONTROLS = ['WASD / Panah — jalan & kemudi', 'E — masuk / keluar mobil', 'F / Klik kiri — tembak', 'Mouse — bidik', '1-4 — ganti senjata · tahan Q — roda senjata', 'ESC — pause'];

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.money !== 'number' || !isFinite(data.money)) return null;
    return data;
  } catch (e) { return null; }
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
    wanted: 0,
    hasSave: !!saved,
    toasts: [],
    toast(text, secs = TOAST_SECONDS) { ui.toasts.push({ text, t: secs, max: secs }); if (ui.toasts.length > 5) ui.toasts.shift(); },
    addMoney(n) { ui.money += n; ui.toast((n >= 0 ? '+ $' : '- $') + Math.abs(n)); },
    save() {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({ money: ui.money, missionsDone: ui.missionsDone, pkMask: ui.pkMask, wanted: ui.wanted, savedAt: Date.now() }));
      } catch (e) { /* storage tidak tersedia */ }
    },
    handleKey(e) {
      if (e.repeat) return null;
      if (e.key === 'Enter' && ui.state === 'MENU') { ui.state = 'PLAYING'; return 'start'; }
      if (e.key === 'Escape') {
        if (ui.state === 'PLAYING') { ui.state = 'PAUSED'; ui.save(); return 'pause'; }
        if (ui.state === 'PAUSED') { ui.state = 'PLAYING'; return 'resume'; }
      }
      return null;
    },
    click() {
      if (ui.state === 'MENU') { ui.state = 'PLAYING'; return 'start'; }
      return null;
    },
    update(dt, ctx) {
      for (const t of ui.toasts) t.t -= dt;
      if (ui.stationT > 0) ui.stationT -= dt;
      ui.toasts = ui.toasts.filter((t) => t.t > 0);
      ctx = ctx || (hud && hud.getContext && hud.getContext('2d'));
      if (!ctx) return;
      if (ui.state === 'PLAYING') drawPlaying(ctx, ui);
      else if (ui.state === 'DEAD') drawDead(ctx, ui);
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
  ctx.font = 'bold 20px sans-serif';
  ui.toasts.forEach((t, i) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, t.t / ((t.max || TOAST_SECONDS) * 0.4)));
    ctx.fillStyle = '#ffe27a';
    ctx.strokeText(t.text, W - 20, 144 + i * 26); ctx.fillText(t.text, W - 20, 144 + i * 26);
  });
  if (ui.stationT > 0 && ui.station) {
    ctx.globalAlpha = Math.min(1, ui.stationT / 0.5);
    ctx.textAlign = 'center'; ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = '#7fe3ff';
    const t = '\u266A ' + ui.station;
    ctx.strokeText(t, W / 2, 60); ctx.fillText(t, W / 2, 60);
  }
  ctx.restore();
  drawWeapon(ctx, ui);
  drawHitmarker(ctx, ui);
  drawGarage(ctx, ui);
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

const WEAPON_IDS = ['pistol', 'smg', 'shotgun', 'rifle'];
const WEAPON_LABEL = { pistol: 'PISTOL', smg: 'SMG', shotgun: 'SHOTGUN', rifle: 'RIFLE' };
function drawWeapon(ctx, ui) {
  if (!ui.weapon) return;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(W - 170, H - 70, 150, 36);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText((ui.weaponName || WEAPON_LABEL[ui.weapon]) + ' [' + (ui.weaponIndex || 1) + ']', W - 162, H - 47);
  ctx.textAlign = 'right';
  ctx.fillStyle = ui.ammo > 0 ? '#ffe27a' : '#ff4a4a';
  ctx.fillText(ui.ammo > 0 ? String(ui.ammo) : 'KOSONG', W - 28, H - 47);
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
  const pos = [[0, -r], [r, 0], [0, r], [-r, 0]];
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

function drawOverlay(ctx, ui) {
  const menu = ui.state === 'MENU';
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = menu ? 'rgba(8,8,14,0.82)' : 'rgba(8,8,14,0.65)';
  ctx.fillRect(0, 0, W, H);
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
