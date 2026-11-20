// nightlife.js — kelab & bar SUNNY CITY yang buka malam hari
// v8: tempat hiburan malam — daftar venue (kelab/bar) yang hanya buka malam hari,
// satu interaksi dansa mini (tekan tombol ritme), harga minuman yang menambah efek
// mabuk (goyang layar pelan) pada pemain, dan masalah penjaga pintu (bouncer) yang
// bisa memicu pertarungan. Panel venue digambar ke gfx.hud memakai api ui/audio/police
// yang dibaca lebih dulu. Ditulis sendiri; tidak mengubah exposure, tone mapping,
// maupun framing kamera.

import { addHeat } from './police.js';

// —— KONSTANTA PENALAAN —— //
const W = 960, H = 540;
const MENU_KEY = 'n';                  // tombol buka/tutup daftar tempat hiburan malam
const EXIT_KEYS = ['escape', MENU_KEY];

// Jam buka: venue aktif hanya saat gfx.hour berada di rentang malam.
const NIGHT_OPEN = 20;                 // buka jam 20:00
const NIGHT_CLOSE = 5;                 // tutup jam 05:00 (lintas tengah malam)

// Daftar venue (kelab & bar) dengan harga minum + tingkat risiko bouncer.
const VENUES = [
  { name: 'NEON PALM CLUB', kind: 'club', drink: 35, risk: 0.5,  hours: '20:00–05:00' },
  { name: 'BAY MOTEL BAR',  kind: 'bar',  drink: 18, risk: 0.25, hours: '20:00–05:00' },
  { name: 'DOWNTOWN LOUNGE', kind: 'club', drink: 55, risk: 0.75, hours: '20:00–05:00' },
  { name: 'PIER DIVE BAR',   kind: 'bar',  drink: 12, risk: 0.6,  hours: '20:00–05:00' },
  { name: 'VICE BASEMENT',   kind: 'club', drink: 80, risk: 0.9,  hours: '20:00–05:00' },
];

const DRINK_NAMES = ['BIR', 'WHISKY', 'MOJITO', 'SHOT', 'RUM'];
const DRUNK_MAX = 1.0;                 // kekuatan goyang maksimum
const DRUNK_DECAY = 0.05;              // sadar pelan-pelan per detik
const DRUNK_PER_DRINK = 0.22;          // kenaikan mabuk tiap minuman

// Dansa mini: irama berirama; menekan tombol pada detak jantung menambah skor.
const DANCE_BEATS = ['q', 'w', 'e', 'r'];   // tombol 4 arah irama
const DANCE_STEP = 0.5;                 // jeda antar detak (irama)
const DANCE_PAY_PER_BEAT = 6;           // bayaran per detak tepat
const DANCE_LENGTH = 24;                // jumlah detak sampai lagu selesai

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function isNight(hour) {
  return hour >= NIGHT_OPEN || hour < NIGHT_CLOSE;
}

// —— API PUBLIK —— //
export function createNightlife(ctx) {
  const { ui, audio, gfx, world } = ctx;
  const nf = {
    ui, audio, gfx, world,
    open: false,
    venueIdx: 0,
    mode: 'menu',            // 'menu' | 'inside' | 'dance' | 'fight'
    drunk: 0,                // 0..1 kekuatan mabuk
    wobbleT: 0,              // fase goyang layar untuk efek mabuk
    coins: 0,                // uang menang dari dansa
    // state dansa mini
    dance: {
      state: 'idle',         // 'idle' | 'run'
      beat: 0,               // indeks detak saat ini
      timer: 0,              // sisa waktu ke detak berikutnya
      key: 0,                // tombol yang diminta (indeks DANCE_BEATS)
      score: 0,
      streak: 0, best: 0,
    },
    // state pertarungan bouncer
    fight: {
      state: 'idle',         // 'idle' | 'run' | 'won'
      hp: 0,
    },

    toggle() {
      if (this.open) {
        this.open = false; this.mode = 'menu';
        this.ui.prompt = null;
        return true;
      }
      if (!isNight(this.gfx.hour)) { this.ui.toast('TEMPAT HIBURAN TUTUP — BUKA 20:00', 2); return false; }
      this.open = true; this.mode = 'menu'; this.venueIdx = 0;
      return true;
    },

    // Terima satu tombol (bukan state held).
    onKey(k) {
      if (k === MENU_KEY) return this.toggle();
      if (!this.open) return false;
      if (EXIT_KEYS.includes(k)) {
        this.open = false; this.mode = 'menu'; this.dance.state = 'idle';
        this.fight.state = 'idle'; this.ui.prompt = null;
        return true;
      }

      if (this.mode === 'fight') return this.fightKey(k);
      if (this.mode === 'dance') return this.danceKey(k);

      if (this.mode === 'menu') {
        if (k === 'arrowup' || k === 'w') this.venueIdx = (this.venueIdx + VENUES.length - 1) % VENUES.length;
        else if (k === 'arrowdown' || k === 's') this.venueIdx = (this.venueIdx + 1) % VENUES.length;
        else if (k === 'enter' || k === 'e') this.enterVenue();
        else return false;
        return true;
      }

      // mode 'inside' — menu kegiatan dalam venue
      if (k === '1') this.buyDrink();
      else if (k === '2') this.startDance();
      else if (k === '3') this.startTrouble();
      else if (k === 'enter' || k === 'e' || k === 'escape') { this.mode = 'menu'; this.ui.prompt = null; }
      else return false;
      return true;
    },

    enterVenue() {
      this.mode = 'inside';
      this.coins = 0;
      this.dance.state = 'idle';
      this.fight.state = 'idle';
      this.ui.prompt = '1: minum · 2: dansa · 3: cari masalah · ESC: keluar';
      this.audio.click();
    },

    // —— minuman & efek mabuk —— //
    buyDrink() {
      const v = VENUES[this.venueIdx];
      if (this.drunk >= DRUNK_MAX && this.ui.money < v.drink) {
        this.ui.toast('UANG TIDAK CUKUP UNTUK ' + this.drinkName(), 1.5);
        return;
      }
      if (this.ui.money < v.drink) { this.ui.toast('UANG TIDAK CUKUP', 1.5); return; }
      this.ui.money -= v.drink;
      this.drunk = clamp(this.drunk + DRUNK_PER_DRINK, 0, DRUNK_MAX);
      this.audio.pickup();
      const name = DRINK_NAMES[Math.floor(Math.random() * DRINK_NAMES.length)];
      this.ui.toast('MINUM ' + name + ' -$' + v.drink + ' (MABUK ' + Math.round(this.drunk * 100) + '%)', 1.5);
      this.coins = 0;
    },
    drinkName() { return DRINK_NAMES[Math.floor(Math.random() * DRINK_NAMES.length)]; },

    // —— dansa mini —— //
    startDance() {
      const d = this.dance;
      if (d.state === 'run') return;
      d.state = 'run'; d.beat = 0; d.timer = DANCE_STEP;
      d.key = Math.floor(Math.random() * DANCE_BEATS.length);
      d.score = 0; d.streak = 0;
      this.mode = 'dance';
      this.ui.prompt = null;
      this.audio.click();
    },
    danceKey(k) {
      const d = this.dance;
      if (d.state !== 'run') {
        if (k === 'enter' || k === 'escape' || k === 'e') { this.mode = 'inside'; this.dance.state = 'idle'; this.payDance(); return true; }
        return false;
      }
      if (!DANCE_BEATS.includes(k)) return false;
      const want = DANCE_BEATS[d.key];
      if (k === want) {
        d.score += 10 + d.streak * 2;
        d.streak++;
        if (d.streak > 5) d.streak = 5;
        this.audio.pickup();
      } else {
        d.streak = 0;
        this.audio.crash(0.3);
      }
      this.nextBeat();
      return true;
    },
    nextBeat() {
      const d = this.dance;
      d.beat++;
      d.timer = DANCE_STEP;
      d.key = Math.floor(Math.random() * DANCE_BEATS.length);
      if (d.score > d.best) d.best = d.score;
      if (d.beat >= DANCE_LENGTH) { // lagu selesai
        this.mode = 'inside'; this.payDance();
      }
    },
    payDance() {
      const d = this.dance;
      const pay = Math.round(d.score / DANCE_PAY_PER_BEAT);
      if (pay > 0) { this.coins += pay; this.ui.addMoney(pay); this.ui.toast('DANSA $' + pay + ' SCOR ' + d.score, 2); }
      else this.ui.toast('DANSA SELESAI', 1.2);
      d.state = 'idle';
      this.ui.prompt = '1: minum · 2: dansa · 3: cari masalah · ESC: keluar';
    },

    // —— masalah bouncer (pertarungan) —— //
    startTrouble() {
      const v = VENUES[this.venueIdx];
      if (this.fight.state === 'run') return;
      // risiko bouncer: makin mabuk makin mungkin memicu masalah.
      if (Math.random() > v.risk + this.drunk * 0.3) {
        this.ui.toast('PENJAGA TIDAK MELAYANIMU — COBA LAGI', 1.5);
        this.audio.click();
        return;
      }
      this.fight.state = 'run';
      this.fight.hp = 3 + Math.round(this.drunk * 2); // bouncer makin kuat kalau pemain mabuk
      this.mode = 'fight';
      this.ui.prompt = null;
      addHeat(this.world, 40, 'brawl');
      this.audio.crash(0.5);
    },
    fightKey(k) {
      const f = this.fight;
      if (f.state !== 'run') {
        if (k === 'enter' || k === 'escape' || k === 'e') { this.mode = 'inside'; this.fight.state = 'idle'; this.ui.prompt = '1: minum · 2: dansa · 3: cari masalah · ESC: keluar'; return true; }
        return false;
      }
      if (k !== ' ' && k !== 'enter' && k !== 'f') return false;
      f.hp--;
      this.audio.crash(0.4);
      if (f.hp <= 0) {
        // pertarungan menang
        const loot = 30 + Math.round(Math.random() * 40);
        this.coins += loot; this.ui.addMoney(loot);
        this.ui.toast('BOUNCER TUMBANG! $' + loot, 2);
        f.state = 'won';
        this.mode = 'inside';
        this.ui.prompt = '1: minum · 2: dansa · 3: cari masalah · ESC: keluar';
      }
      return true;
    },
  };
  return nf;
}

// —— PEMBARUAN PER FRAME —— //
export function updateNightlife(nf, dt, player) {
  if (!nf.open) return;
  // sadar pelan-pelan dari mabuk
  if (nf.drunk > 0) nf.drunk = clamp(nf.drunk - DRUNK_DECAY * dt, 0, DRUNK_MAX);

  // efek mabuk: goyang kecil progresif; tidak mengubah kamera 3D, hanya offset halus.
  if (nf.drunk > 0 && player && !player.car) {
    nf.wobbleT += dt * (4 + nf.drunk * 8);
    const amp = nf.drunk * 0.6;
    // Goyang pemain: dorongan acak berbasis fase; tetap lembut agar tidak mengubah framing.
    const ox = Math.sin(nf.wobbleT * 1.7) * amp;
    const oy = Math.cos(nf.wobbleT * 1.3) * amp;
    player.vx = clamp(player.vx + ox * 6 * dt, -60, 60);
    player.vy = clamp(player.vy + oy * 6 * dt, -60, 60);
  }

  if (nf.mode === 'dance' && nf.dance.state === 'run') {
    nf.dance.timer -= dt;
    if (nf.dance.timer <= 0) {
      nf.dance.streak = 0;          // detak terlewat
      nf.nextBeat();
    }
  }

  drawNightlife(nf);
}

// —— GAMBAR PANEL NIGHTLIFE KE gfx.hud —— //
function drawNightlife(nf) {
  const g = nf.gfx && nf.gfx.hud ? nf.gfx.hud : null;
  if (!g || nf.ui.state !== 'PLAYING') return;
  g.save();
  if (nf.mode === 'menu') drawVenueMenu(g, nf);
  else if (nf.mode === 'dance') drawDance(g, nf);
  else if (nf.mode === 'fight') drawFight(g, nf);
  else drawInside(g, nf);
  g.restore();
}

function panel(g, title, x, y, w, h, color) {
  g.fillStyle = 'rgba(10,6,18,0.86)';
  g.fillRect(x, y, w, h);
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  g.textAlign = 'center';
  g.font = 'bold 22px sans-serif';
  g.fillStyle = color;
  g.fillText(title, x + w / 2, y + 30);
}

function drawVenueMenu(g, nf) {
  const x = W / 2 - 250, y = 80, w = 500;
  panel(g, 'HIBURAN MALAM', x, y, w, 360, '#ff5fd7');
  const rows = VENUES;
  const grace = nf.drunk > 0 ? 'MABUK ' + Math.round(nf.drunk * 100) + '%' : 'SADAR';
  g.textAlign = 'left'; g.font = 'bold 15px sans-serif'; g.fillStyle = '#aaa';
  g.fillText('Buka ' + NIGHT_OPEN + ':00–0' + (NIGHT_CLOSE - 1) + ':00 · kamu ' + grace, x + 20, y + 50);
  rows.forEach((v, i) => {
    const ry = y + 64 + i * 56;
    const on = nf.venueIdx === i;
    g.fillStyle = on ? 'rgba(255,95,215,0.28)' : 'rgba(40,34,52,0.95)';
    g.fillRect(x + 14, ry, w - 28, 48);
    g.textAlign = 'left'; g.font = 'bold 18px sans-serif'; g.fillStyle = '#fff';
    g.fillText(v.name, x + 28, ry + 20);
    g.font = '13px sans-serif'; g.fillStyle = '#aaa';
    g.fillText(v.kind.toUpperCase() + ' · minum $' + v.drink, x + 28, ry + 38);
    g.textAlign = 'right'; g.font = 'bold 14px sans-serif'; g.fillStyle = '#7fe3ff';
    g.fillText(v.hours, x + w - 28, ry + 28);
  });
  g.textAlign = 'center'; g.font = '13px sans-serif'; g.fillStyle = '#aaa';
  g.fillText('Panah/W S: pilih · Enter/E: masuk · ESC/N: keluar', W / 2, y + 336);
}

function drawInside(g, nf) {
  const v = VENUES[nf.venueIdx];
  const x = W / 2 - 220, y = 120, w = 440;
  panel(g, v.name, x, y, w, 220, '#ff5fd7');
  const items = [
    ['1', 'MINUM -$' + v.drink, 'mabuk ' + Math.round(nf.drunk * 100) + '%'],
    ['2', 'DANSA (ritme)', 'skor ' + nf.dance.best],
    ['3', 'CARI MASALAH (bouncer)', nf.coins ? 'menang $' + nf.coins : ''],
  ];
  items.forEach(([key, label, sub], i) => {
    const ry = y + 52 + i * 48;
    g.fillStyle = 'rgba(60,48,72,0.95)';
    g.fillRect(x + 20, ry, w - 40, 40);
    g.textAlign = 'left'; g.font = 'bold 16px sans-serif'; g.fillStyle = '#fff';
    g.fillText(key + '. ' + label, x + 34, ry + 25);
    if (sub) { g.textAlign = 'right'; g.font = '13px sans-serif'; g.fillStyle = '#aaa'; g.fillText(sub, x + w - 34, ry + 25); }
  });
  g.textAlign = 'center'; g.font = '13px sans-serif'; g.fillStyle = '#aaa';
  g.fillText('ESC: kembali', W / 2, y + 200);
}

function drawDance(g, nf) {
  const d = nf.dance;
  const x = W / 2 - 240, y = 110, w = 480;
  panel(g, 'DANSA DI ' + VENUES[nf.venueIdx].name, x, y, w, 240, '#ffd21f');
  // tombol irama
  const pr = 30, gap = 28, total = DANCE_BEATS.length * (pr * 2 + gap) - gap;
  const px0 = W / 2 - total / 2 + pr, py = y + 120;
  const colors = ['#ff6a5a', '#7fe3ff', '#7bd66b', '#ffd21f'];
  for (let i = 0; i < DANCE_BEATS.length; i++) {
    const px = px0 + i * (pr * 2 + gap);
    const on = d.state === 'run' && i === d.key;
    g.fillStyle = on ? colors[i] : '#333';
    g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#000'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center';
    g.fillText(DANCE_BEATS[i].toUpperCase(), px, py + 6);
  }
  g.fillStyle = '#fff'; g.font = 'bold 17px sans-serif'; g.textAlign = 'center';
  g.fillText('SKOR ' + d.score + ' · STREAK ' + d.streak, W / 2, y + 190);
  g.font = '13px sans-serif'; g.fillStyle = '#aaa';
  g.fillText('tekan tombol yang menyala sesuai irama · ESC: selesai', W / 2, y + 216);
}

function drawFight(g, nf) {
  const f = nf.fight;
  const x = W / 2 - 240, y = 130, w = 480;
  panel(g, 'NGEBRAK GUNA BOUNCER', x, y, w, 220, '#ff4a4a');
  g.textAlign = 'center';
  g.font = 'bold 20px sans-serif'; g.fillStyle = '#fff';
  g.fillText('NYAWA BOUNCER ' + '█'.repeat(Math.max(0, f.hp)), W / 2, y + 78);
  g.fillText('NYAWA KAMU ' + '█'.repeat(3), W / 2, y + 108);
  g.font = 'bold 16px sans-serif'; g.fillStyle = '#ffd21f';
  g.fillText('SPACE/Enter/F: pukul sebanyak mungkin!', W / 2, y + 140);
  g.font = '13px sans-serif'; g.fillStyle = '#aaa';
  g.fillText('polisi diteguk · ESC: kabur', W / 2, y + 170);
}