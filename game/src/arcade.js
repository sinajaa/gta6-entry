// arcade.js — aula arcade SUNNY CITY: tiga mini-game playable di dalam HUD
// Mini-game yang bisa dimainkan lewat tombol: reflex tester (tangkap lampu hijau),
// dodge top-down (hindari blok yang jatuh), dan sequence memori (ulangi urutan).
// Setiap game punya skor sendiri, bayaran uang (cc addMoney), dan high score yang
// disimpan ke localStorage. Digambar ke gfx.hud memakai ui/audio yang dibaca dulu.
// Ditulis sendiri; tidak mengubah exposure, tone mapping, maupun framing.

// —— KONSTANTA PENALAAN —— //
const W = 960, H = 540;
const SCORE_KEY = 'sunnycity.arcade.v1';
const MENU_KEY = 'l';                 // tombol buka/tutup aula arcade
const EXIT_KEYS = ['escape', MENU_KEY];

// reflex tester
const REFLEX_WAIT_MIN = 0.6, REFLEX_WAIT_MAX = 2.2;   // jeda acak sebelum lampu hijau
const REFLEX_TIMEOUT = 3.0;                            // batas waktu reaksi
const REFLEX_PAY_PER_MS = 0.02;                        // bayaran turun seiring reaksi lambat

// dodge top-down
const DODGE_W = 360, DODGE_H = 320;                    // ukuran arena
const DODGE_PLAYER_R = 9;
const DODGE_SPAWN_MIN = 0.5, DODGE_SPAWN_MAX = 1.2;    // jeda antar blok
const DODGE_FALL_SPEED_MIN = 60, DODGE_FALL_SPEED_MAX = 170;
const DODGE_LIVES = 3;

// sequence memori
const SEQ_START_LEN = 3;
const SEQ_MAX_LEN = 20;
const SEQ_FLASH = 0.5;                                 // lama tiap langkah menyala
const SEQ_PAUSE = 0.3;                                 // jeda antar langkah
const SEQ_PADS = 6;                                    // jumlah tombol pad

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// —— MUAT/TULIS HIGH SCORE —— //
function loadScores() {
  try {
    const raw = localStorage.getItem(SCORE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    const out = {};
    for (const k of ['reflex', 'dodge', 'sequence']) {
      out[k] = data && Number.isFinite(data[k]) ? Math.max(0, Math.floor(data[k])) : 0;
    }
    return out;
  } catch (e) { return { reflex: 0, dodge: 0, sequence: 0 }; }
}

function persistScores(scores) {
  try { localStorage.setItem(SCORE_KEY, JSON.stringify(scores)); } catch (e) { /* storage tak tersedia */ }
}

// —— API PUBLIK —— //
export function createArcade(ctx) {
  const { ui, audio, gfx, keys } = ctx;
  const arcade = {
    ui, audio, gfx, keys,
    scores: loadScores(),
    open: false,
    menuIdx: 0,              // indeks game yang dipilih di menu aula
    game: null,              // 'reflex' | 'dodge' | 'sequence' | null (menu)

    // —— reflex tester —— //
    reflex: {
      state: 'idle',         // 'idle' | 'wait' | 'ready' | 'hit' | 'tooSoon'
      timer: 0, score: 0, best: 0, streak: 0,
    },

    // —— dodge top-down —— //
    dodge: {
      state: 'idle',         // 'idle' | 'run' | 'over'
      x: DODGE_W / 2, y: DODGE_H - 30,
      blocks: [], spawnT: 0, time: 0, score: 0, best: 0, lives: DODGE_LIVES,
    },

    // —— sequence memori —— //
    seq: {
      state: 'idle',         // 'idle' | 'show' | 'input' | 'over'
      length: SEQ_START_LEN, showIdx: 0, timer: 0,
      steps: [], inputIdx: 0, score: 0, best: 0,
    },

    // Buka/tutup aula; kembali ke menu bila sedang di dalam suatu game.
    toggle() {
      if (this.open) {
        if (this.game) { this.game = null; return true; }
        this.open = false; this.game = null;
        return true;
      }
      this.open = true; this.game = null; this.menuIdx = 0;
      return true;
    },

    // Terima satu tombol (bukan state held): menu & kendali kombinasi per game.
    onKey(k) {
      if (k === MENU_KEY) return this.toggle();
      if (!this.open) return false;
      if (EXIT_KEYS.includes(k)) { this.open = false; this.game = null; return true; }

      if (!this.game) {
        // navigasi menu aula
        if (k === 'arrowup' || k === 'w') this.menuIdx = (this.menuIdx + 2) % 3;
        else if (k === 'arrowdown' || k === 's') this.menuIdx = (this.menuIdx + 1) % 3;
        else if (k === 'enter' || k === 'e') this.startGame(this.menuIdx);
        else return false;
        return true;
      }

      if (this.game === 'reflex') return this.reflexKey(k);
      if (this.game === 'dodge') return this.dodgeKey(k);
      if (this.game === 'sequence') return this.seqKey(k);
      return false;
    },

    // Mulai game berdasarkan urutan menu (0=reflex, 1=dodge, 2=sequence).
    startGame(i) {
      if (i === 0) {
        this.game = 'reflex';
        const r = this.reflex;
        r.state = 'wait'; r.timer = this.waitTime(); r.score = 0; r.streak = 0;
      } else if (i === 1) {
        this.game = 'dodge';
        const dgd = this.dodge;
        dgd.state = 'run'; dgd.x = DODGE_W / 2; dgd.y = DODGE_H - 30;
        dgd.blocks = []; dgd.spawnT = DODGE_SPAWN_MIN; dgd.time = 0; dgd.score = 0; dgd.lives = DODGE_LIVES;
      } else {
        this.game = 'sequence';
        const s = this.seq;
        s.length = SEQ_START_LEN; s.steps = []; s.timer = 0; s.score = 0; s.inputIdx = 0;
        this.seqBegin();
      }
    },

    // —— reflex tester —— //
    waitTime() { return REFLEX_WAIT_MIN + Math.random() * (REFLEX_WAIT_MAX - REFLEX_WAIT_MIN); },
    reflexKey(k) {
      const r = this.reflex;
      if (r.state === 'idle') return false;
      if (k !== ' ' && k !== 'enter') return false;
      if (r.state === 'wait') {
        r.state = 'tooSoon'; r.timer = 0.9;        // ditekan terlalu cepat
        this.audio.crash(0.2);
        return true;
      }
      if (r.state === 'ready') {
        const ms = clamp(r.timer * 1000, 0, 10000);
        const pts = Math.max(0, Math.round(1000 - ms * REFLEX_PAY_PER_MS));
        r.score += pts; r.streak = (r.streak || 0) + 1;
        this.audio.pickup();
        r.state = 'hit'; r.timer = 0.6;
        if (r.score > r.best) r.best = r.score;
        return true;
      }
      return false;
    },
    // Satu ronde reflex selesai (reaksi dicatat atau terlalu cepat): bayar & lanjut.
    reflexSettle(r) {
      if (r.state === 'tooSoon') {
        const loss = Math.min(r.score, 40);
        r.score -= loss; r.streak = 0;
        this.ui.toast('TERLALU CEPAT! -$' + loss, 1.5);
        r.state = 'wait'; r.timer = this.waitTime();
        return;
      }
      if (r.state === 'hit') {
        const pay = Math.round(r.score / 10) * 5;
        if (pay > 0) { this.ui.addMoney(pay); this.ui.toast('REFLEKS $' + pay, 1.5); }
        if (r.score > this.scores.reflex) { this.scores.reflex = r.score; persistScores(this.scores); }
        r.state = 'wait'; r.timer = this.waitTime();
      }
    },

    // —— dodge top-down —— //
    dodgeKey(k) {
      const dgd = this.dodge;
      if (dgd.state !== 'run') {
        if (dgd.state === 'over' && (k === 'enter' || k === ' ')) { this.startGame(1); }
        return false;
      }
      // gerak hanya saat fase berjalan (dibaca tiap frame oleh update)
      return false;
    },
    dodgeSpawn(dgd) {
      const r = Math.random();
      return {
        x: r * DODGE_W,
        y: -10,
        v: DODGE_FALL_SPEED_MIN + Math.random() * (DODGE_FALL_SPEED_MAX - DODGE_FALL_SPEED_MIN),
        w: 14 + Math.random() * 22,
        h: 14 + Math.random() * 18,
      };
    },
    dodgeHit(dgd) {
      dgd.lives--;
      this.audio.crash(0.35);
      dgd.blocks = [];
      if (dgd.lives <= 0) {
        dgd.state = 'over';
        const pay = Math.round(dgd.score / 10) * 5;
        if (pay > 0) { this.ui.addMoney(pay); this.ui.toast('DODGE SKOR ' + Math.floor(dgd.score) + ' · $' + pay, 2); }
        if (Math.floor(dgd.score) > this.scores.dodge) { this.scores.dodge = Math.floor(dgd.score); persistScores(this.scores); }
        if (Math.floor(dgd.score) > dgd.best) dgd.best = Math.floor(dgd.score);
      }
    },

    // —— sequence memori —— //
    seqBegin() {
      const s = this.seq;
      // bangun urutan acak sepanjang `length` dan mulai menunjukkannya
      s.steps = [];
      for (let i = 0; i < s.length; i++) s.steps.push(Math.floor(Math.random() * SEQ_PADS));
      s.showIdx = 0; s.timer = SEQ_FLASH;
      s.state = 'show';
    },
    seqKey(k) {
      const s = this.seq;
      if (s.state === 'over' && (k === 'enter' || k === ' ')) { this.startGame(2); return true; }
      if (s.state !== 'input') return false;
      const pad = this.seqPadFromKey(k);
      if (pad == null) return false;
      this.flashPad(pad);
      if (pad === s.steps[s.inputIdx]) {
        s.inputIdx++;
        this.audio.pickup();
        if (s.inputIdx >= s.length) {
          // urutan benar: naikkan panjang & skor, lalu tunjukkan urutan baru
          s.score += s.length * 10;
          s.length = Math.min(SEQ_MAX_LEN, s.length + 1);
          this.seqBegin();
        }
      } else {
        // salah: bayar & simpan high score
        s.state = 'over';
        this.audio.crash(0.3);
        const pay = Math.round(s.score / 10) * 5;
        if (pay > 0) { this.ui.addMoney(pay); this.ui.toast('SEQUENCE SKOR ' + s.score + ' · $' + pay, 2); }
        if (s.score > this.scores.sequence) { this.scores.sequence = s.score; persistScores(this.scores); }
        if (s.score > s.best) s.best = s.score;
      }
      return true;
    },
    seqPadFromKey(k) {
      const map = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5 };
      return map[k] != null ? map[k] : null;
    },
    flashPad(pad) { this.seq.flash = pad; this.seq.flashT = 0.25; },
  };
  return arcade;
}

// —— PEMBARUAN PER FRAME —— //
export function updateArcade(arcade, dt, player) {
  if (!arcade.open) return;
  if (arcade.game === 'reflex') updateReflex(arcade, dt);
  else if (arcade.game === 'dodge') updateDodge(arcade, dt);
  else if (arcade.game === 'sequence') updateSequence(arcade, dt);
  drawArcade(arcade);
}

function updateReflex(arcade, dt) {
  const r = arcade.reflex;
  if (r.state === 'wait') {
    r.timer -= dt;
    if (r.timer <= 0) { r.state = 'ready'; r.timer = 0; }
  } else if (r.state === 'ready') {
    r.timer += dt;
    if (r.timer >= REFLEX_TIMEOUT) arcade.reflexSettle(r); // timeout: ronde gagal, lanjut ronde baru
  } else if (r.state === 'hit') {
    r.timer -= dt;
    if (r.timer <= 0) arcade.reflexSettle(r);
  } else if (r.state === 'tooSoon') {
    r.timer -= dt;
    if (r.timer <= 0) arcade.reflexSettle(r);
  }
}

function updateDodge(arcade, dt) {
  const dgd = arcade.dodge;
  if (dgd.state !== 'run') return;
  dgd.time += dt;
  dgd.score += dt * 10;
  const keys = arcade.keys;
  const dx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const dy = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  const spd = 190;
  dgd.x = clamp(dgd.x + dx * spd * dt, DODGE_PLAYER_R, DODGE_W - DODGE_PLAYER_R);
  dgd.y = clamp(dgd.y + dy * spd * dt, DODGE_PLAYER_R, DODGE_H - DODGE_PLAYER_R);

  dgd.spawnT -= dt;
  if (dgd.spawnT <= 0) {
    dgd.blocks.push(arcade.dodgeSpawn(dgd));
    dgd.spawnT = DODGE_SPAWN_MIN + Math.random() * (DODGE_SPAWN_MAX - DODGE_SPAWN_MIN);
  }
  for (const b of dgd.blocks) b.y += b.v * dt;
  dgd.blocks = dgd.blocks.filter((b) => b.y < DODGE_H + 24);
  // tabrakan (kotak sederhana)
  for (const b of dgd.blocks) {
    const px = dgd.x, py = dgd.y, r = DODGE_PLAYER_R;
    if (px + r > b.x && px - r < b.x + b.w && py + r > b.y && py - r < b.y + b.h) {
      arcade.dodgeHit(dgd);
      break;
    }
  }
}

function updateSequence(arcade, dt) {
  const s = arcade.seq;
  if (s.flashT != null) { s.flashT -= dt; if (s.flashT <= 0) s.flash = null; }
  if (s.state === 'show') {
    s.timer -= dt;
    if (s.timer <= 0) {
      s.showIdx++;
      if (s.showIdx >= s.length) { s.state = 'input'; s.inputIdx = 0; }
      else s.timer = SEQ_FLASH;
    }
  }
}

// —— GAMBAR PANEL ARCADE KE gfx.hud —— //
function drawArcade(arcade) {
  const g = arcade.gfx && arcade.gfx.hud ? arcade.gfx.hud : null;
  if (!g || arcade.ui.state !== 'PLAYING') return;
  g.save();
  if (!arcade.game) drawArcadeMenu(g, arcade);
  else if (arcade.game === 'reflex') drawReflex(g, arcade);
  else if (arcade.game === 'dodge') drawDodge(g, arcade);
  else drawSequence(g, arcade);
  g.restore();
}

function panel(g, title, x, y, w, h, color) {
  g.fillStyle = 'rgba(8,8,14,0.82)';
  g.fillRect(x, y, w, h);
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  g.textAlign = 'center';
  g.font = 'bold 22px sans-serif';
  g.fillStyle = color;
  g.fillText(title, x + w / 2, y + 30);
}

function drawArcadeMenu(g, a) {
  const x = W / 2 - 230, y = 90, w = 460;
  panel(g, 'AULA ARCADE', x, y, w, 360, '#ffb300');
  const games = [
    { name: 'REFLEKS', info: 'tekan saat lampu hijau', key: 'SPACE' },
    { name: 'DODGE', info: 'hindari blok jatuh', key: 'WASD' },
    { name: 'SEQUENCE', info: 'ulangi urutan nada', key: '1-6' },
  ];
  games.forEach((g2, i) => {
    const ry = y + 50 + i * 88;
    const on = a.menuIdx === i;
    g.fillStyle = on ? 'rgba(255,179,0,0.32)' : 'rgba(40,40,56,0.95)';
    g.fillRect(x + 14, ry, w - 28, 72);
    g.textAlign = 'left';
    g.font = 'bold 20px sans-serif';
    g.fillStyle = '#fff';
    g.fillText(g2.name, x + 28, ry + 28);
    g.font = '13px sans-serif';
    g.fillStyle = '#aaa';
    g.fillText(g2.info + ' · tombol ' + g2.key, x + 28, ry + 48);
    g.textAlign = 'right';
    g.font = 'bold 16px sans-serif';
    g.fillStyle = '#7fe3ff';
    const hi = a.scores[['reflex', 'dodge', 'sequence'][i]];
    g.fillText('HI ' + hi, x + w - 28, ry + 30);
  });
  g.textAlign = 'center';
  g.font = '13px sans-serif';
  g.fillStyle = '#aaa';
  g.fillText('Panah/W S: pilih · Enter/E: main · ESC/L: keluar', W / 2, y + 336);
}

function drawReflex(g, a) {
  const r = a.reflex;
  const x = W / 2 - 230, y = 110, w = 460;
  panel(g, 'REFLEKS TESTER', x, y, w, 260, '#7fe3ff');
  // lampu
  const cx = W / 2, cy = y + 130, rad = 44;
  let lamp = '#555';
  if (r.state === 'ready') lamp = '#7bd66b';
  else if (r.state === 'hit') lamp = '#ffd21f';
  else if (r.state === 'tooSoon') lamp = '#ff4a4a';
  g.fillStyle = '#222'; g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
  g.fillStyle = lamp; g.beginPath(); g.arc(cx, cy, rad - 10, 0, Math.PI * 2); g.fill();
  g.textAlign = 'center';
  g.font = 'bold 18px sans-serif';
  g.fillStyle = '#fff';
  g.fillText('SKOR ' + r.score + (r.streak ? ' · STREAK ' + r.streak : ''), W / 2, y + 200);
  g.font = '13px sans-serif';
  g.fillStyle = '#aaa';
  g.fillText('tekan SPACE saat hijau · ESC: keluar', W / 2, y + 232);
}

function drawDodge(g, a) {
  const dgd = a.dodge;
  const x = W / 2 - 230, y = 80, w = 460;
  panel(g, 'DODGE TOP-DOWN', x, y, w, 400, '#ff8a3d');
  const ax = W / 2 - DODGE_W / 2, ay = y + 46;
  g.fillStyle = 'rgba(20,22,30,0.95)';
  g.fillRect(ax, ay, DODGE_W, DODGE_H);
  g.strokeStyle = '#555'; g.lineWidth = 1.5; g.strokeRect(ax, ay, DODGE_W, DODGE_H);
  // blok
  for (const b of dgd.blocks) {
    g.fillStyle = '#ff6a5a';
    g.fillRect(ax + b.x, ay + b.y, b.w, b.h);
  }
  // pemain
  g.fillStyle = '#7fe3ff';
  g.beginPath(); g.arc(ax + dgd.x, ay + dgd.y, DODGE_PLAYER_R, 0, Math.PI * 2); g.fill();
  // info
  g.textAlign = 'left';
  g.font = 'bold 16px sans-serif';
  g.fillStyle = '#fff';
  g.fillText('SKOR ' + Math.floor(dgd.score) + ' · NYAWA ' + dgd.lives, x + 16, y + 46 + DODGE_H + 22);
  g.textAlign = 'center';
  g.font = '13px sans-serif';
  g.fillStyle = '#aaa';
  g.fillText('WASD: gerak · ESC: keluar', W / 2, y + 46 + DODGE_H + 44);
  if (dgd.state === 'over') {
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(ax, ay + DODGE_H / 2 - 40, DODGE_W, 80);
    g.textAlign = 'center'; g.font = 'bold 22px sans-serif'; g.fillStyle = '#ffd21f';
    g.fillText('GAME OVER', W / 2, ay + DODGE_H / 2);
    g.font = '13px sans-serif'; g.fillStyle = '#ddd';
    g.fillText('Enter: main lagi', W / 2, ay + DODGE_H / 2 + 24);
  }
}

function drawSequence(g, a) {
  const s = a.seq;
  const x = W / 2 - 230, y = 90, w = 460;
  panel(g, 'SEQUENCE MEMORI', x, y, w, 360, '#b77bff');
  // 6 pad
  const pr = 34, gap = 24, total = SEQ_PADS * (pr * 2 + gap) - gap;
  const px0 = W / 2 - total / 2 + pr, py = y + 130;
  const colors = ['#ff6a5a', '#ffd21f', '#7bd66b', '#7fe3ff', '#b77bff', '#ff8a3d'];
  for (let i = 0; i < SEQ_PADS; i++) {
    const px = px0 + i * (pr * 2 + gap);
    let lit = s.state === 'show' && i === s.steps[s.showIdx];
    if (s.flash === i) lit = true;
    g.fillStyle = lit ? colors[i] : '#333';
    g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#000'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center';
    g.fillText(String(i + 1), px, py + 6);
  }
  g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center';
  g.fillText('SKOR ' + s.score + ' · PANJANG ' + s.length, W / 2, y + 240);
  g.font = '13px sans-serif'; g.fillStyle = '#aaa';
  g.fillText('tekan 1-6 sesuai urutan · ESC: keluar', W / 2, y + 272);
  if (s.state === 'over') {
    g.fillStyle = '#ffd21f'; g.font = 'bold 20px sans-serif';
    g.fillText('SALAH — Enter: main lagi', W / 2, y + 306);
  }
}