// ui.js — state MENU/PLAYING/PAUSED, HUD uang, toast, dan save/load localStorage
const SAVE_KEY = 'sunnycity.save.v1';
const W = 960, H = 540, TOAST_SECONDS = 2;
const TOUCH_CONTROLS = ['Joystick kiri: gerak · E: masuk mobil · F: tembak', 'LARI: sprint · PAUSE: jeda'];
const CONTROLS = ['WASD / Panah — jalan & kemudi', 'E — masuk / keluar mobil', 'F / Klik kiri — tembak', 'Mouse — bidik', '1 / 2 — pistol / SMG', 'ESC — pause'];

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
    wanted: 0,
    hasSave: !!saved,
    toasts: [],
    toast(text) { ui.toasts.push({ text, t: TOAST_SECONDS }); if (ui.toasts.length > 4) ui.toasts.shift(); },
    addMoney(n) { ui.money += n; ui.toast((n >= 0 ? '+ $' : '- $') + Math.abs(n)); },
    save() {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({ money: ui.money, missionsDone: ui.missionsDone, wanted: ui.wanted, savedAt: Date.now() }));
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
  ctx.font = 'bold 20px sans-serif';
  ui.toasts.forEach((t, i) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, t.t / (TOAST_SECONDS * 0.5)));
    ctx.fillStyle = '#ffe27a';
    ctx.strokeText(t.text, W - 20, 126 + i * 26); ctx.fillText(t.text, W - 20, 126 + i * 26);
  });
  ctx.restore();
  drawWeapon(ctx, ui);
  drawHitmarker(ctx, ui);
}

const WEAPON_LABEL = { pistol: 'PISTOL', smg: 'SMG' };
function drawWeapon(ctx, ui) {
  if (!ui.weapon) return;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(W - 150, H - 70, 130, 36);
  ctx.fillStyle = '#fff';
  if (ui.weapon === 'pistol') { ctx.fillRect(W - 140, H - 58, 22, 6); ctx.fillRect(W - 140, H - 54, 7, 12); }
  else { ctx.fillRect(W - 142, H - 58, 30, 6); ctx.fillRect(W - 136, H - 54, 6, 12); ctx.fillRect(W - 124, H - 54, 5, 8); }
  ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText(WEAPON_LABEL[ui.weapon] + ' [' + (ui.weapon === 'pistol' ? 1 : 2) + ']', W - 28, H - 46);
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
