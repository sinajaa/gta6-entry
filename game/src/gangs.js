// gangs.js — tiga geng menguasai distrik, agresi rival memunculkan gerombolan
// musuh, penangkapan wilayah saat area dibersihkan, perubahan reputasi, dan panel
// peta wilayah yang digambar lewat api ui. Sistem geng ditulis dari nol untuk SUNNY CITY.
import { TILE, COLS, ROWS, T, tileAt } from './world.js';
import { addHeat } from './police.js';

// --- Identitas tiga geng: nama, warna seragam (shirt), dan palet peta. ---
export const GANGS = [
  { id: 0, name: 'MERAH SELATAN', short: 'MERAH', shirt: 2, mapColor: '#d84a4a' },
  { id: 1, name: 'BIRU PELABUHAN', short: 'BIRU', shirt: 1, mapColor: '#4a6fd8' },
  { id: 2, name: 'HIJAU TIMUR', short: 'HIJAU', shirt: 4, mapColor: '#4a9a5f' },
];

// --- Konstanta permainan geng. ---
const DEFENDERS = 3;        // gerombolan penjaga di tiap blok
const SPAWN_MIN = 200, SPAWN_MAX = 420;   // jarak penjaga dari pusat blok
const AGGRESSION_INTERVAL = 7;  // jeda antar gelombang bala bantuan
const ATTACK_RANGE = 220;   // mulai menembak pada jarak ini
const MOVE_SPEED = 105;     // kecepatan berjalan musuh
const GANG_HP = 60;         // nyawa musuh geng
const DAMAGE = 6;           // kerusakan tembakan musuh per peluru
const FIRE_GAP = 1.0;       // jeda antar letusan musuh
const HIT_CHANCE = 0.4;     // peluang peluru musuh mengenai
const CAPTURE_REWARD = 250; // uang untuk menaklukkan sebuah blok
const REP_CAPTURE = 6;      // perubahan reputasi saat menaklukkan blok
const NETRAL = 0;           // nilai blok tanpa geng (netral)

// --- Mesin bilangan acak deterministik untuk klaim awal blok. ---
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Blok wilayah berukuran 10 tile (sesuai PERIOD di world.js); 8x8 = 64 blok.
const BLOCKS = 8;
const PERIOD = 10;

function blockOf(x, y) {
  return {
    bx: Math.max(0, Math.min(BLOCKS - 1, Math.floor(x / (PERIOD * TILE)))),
    by: Math.max(0, Math.min(BLOCKS - 1, Math.floor(y / (PERIOD * TILE)))),
  };
}

function blockIndex(bx, by) { return by * BLOCKS + bx; }

// Klaim awal: blok pusat (distrik 0) netral, sisanya diundi ke salah satu geng.
function seedTerritory() {
  const rand = mulberry32(20261120);
  const map = new Uint8Array(BLOCKS * BLOCKS);
  for (let by = 0; by < BLOCKS; by++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      const cx = Math.abs(bx - (BLOCKS - 1) / 2);
      const cy = Math.abs(by - (BLOCKS - 1) / 2);
      const central = cx < 1.5 && cy < 1.5; // inti kota tetap netral
      if (central) { map[blockIndex(bx, by)] = NETRAL; continue; }
      const r = rand();
      map[blockIndex(bx, by)] = (r < 0.33 ? 0 : r < 0.66 ? 1 : 2) + 1;
    }
  }
  return map;
}

// Titik trotoar (aman) di seluruh kota untuk penempatan musuh.
function sidewalkPoints(world) {
  if (world._gangSidewalks) return world._gangSidewalks;
  const pts = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (world.tiles[y * COLS + x] === T.SIDEWALK) pts.push([x * TILE + TILE / 2, y * TILE + TILE / 2]);
    }
  }
  world._gangSidewalks = pts;
  return pts;
}

// Tempatkan musuh di trotoar dalam rentang jarak dari titik pusat.
function placeMember(member, world, cx, cy, minD, maxD) {
  const pts = sidewalkPoints(world);
  let best = null;
  for (let attempt = 0; attempt < 80 && !best; attempt++) {
    const c = pts[Math.floor(Math.random() * pts.length)];
    const d = Math.hypot(c[0] - cx, c[1] - cy);
    if (d >= minD && d <= maxD) best = c;
  }
  if (!best) {
    let bd = Infinity;
    for (let i = 0; i < 200; i++) {
      const c = pts[Math.floor(Math.random() * pts.length)];
      const e = Math.abs(Math.hypot(c[0] - cx, c[1] - cy) - (minD + maxD) / 2);
      if (e < bd) { bd = e; best = c; }
    }
  }
  member.x = best ? best[0] : cx;
  member.y = best ? best[1] : cy;
}

// Pusat piksel sebuah blok.
function blockCenter(bx, by) {
  return [bx * PERIOD * TILE + PERIOD * TILE / 2, by * PERIOD * TILE + PERIOD * TILE / 2];
}

// Spawn satu penjaga geng untuk blok tertentu ke dalam array peds bersama.
function spawnDefender(gangs, world, gangIdx, bx, by) {
  const gang = GANGS[gangIdx];
  const [cx, cy] = blockCenter(bx, by);
  const member = {
    x: 0, y: 0, angle: 0, speed: MOVE_SPEED, state: 'ANGER', timer: 0, fx: 0, fy: 0,
    shirt: gang.shirt, scale: 1, hp: GANG_HP, gang: gangIdx, home: blockIndex(bx, by), fireT: 0,
  };
  placeMember(member, world, cx, cy, SPAWN_MIN, SPAWN_MAX);
  gangs.peds.push(member);
  gangs.members.push(member);
  return member;
}

// Pindahkan musuh ke arah target sambil menghindari gedung; kembalikan jarak.
function moveMember(member, world, target, dt) {
  const dx = target.x - member.x, dy = target.y - member.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 0.001) member.angle = Math.atan2(dy, dx);
  const step = MOVE_SPEED * dt;
  const nx = member.x + Math.cos(member.angle) * step;
  const ny = member.y + Math.sin(member.angle) * step;
  if (tileAt(world, nx, ny) !== T.BUILDING) { member.x = nx; member.y = ny; }
  else if (tileAt(world, nx, member.y) !== T.BUILDING) member.x = nx;
  else if (tileAt(world, member.x, ny) !== T.BUILDING) member.y = ny;
  return dist;
}

export function createGangs(ctx) {
  const { world, ui, audio, combat, peds, gfx } = ctx;
  const gangs = {
    world, ui, audio, combat, peds,
    territory: seedTerritory(),
    members: [],        // semua musuh geng aktif (ped dengan .gang != null)
    aggroTimer: 0,      // jeda pemunculan bala bantuan
    open: false,        // panel peta wilayah terbuka/tidak
    hover: null,        // blok yang disorot pada panel
    ctx: gfx && gfx.hud ? gfx.hud : null,  // konteks kanvas HUD untuk panel peta
  };

  // Buka/tutup panel peta wilayah.
  gangs.toggle = function () {
    gangs.open = !gangs.open;
    if (audio) audio.click();
  };

  gangs.onKey = function (k) {
    if (k === 'j') { gangs.toggle(); return true; }
    return false;
  };

  // Konversi koordinat pointer kanvas ke blok peta untuk sorotan.
  gangs.screenToBlock = function (sx, sy) {
    const ox = 140, oy = 96, cellW = 680 / BLOCKS, cellH = 352 / BLOCKS;
    if (sx < ox || sx >= ox + BLOCKS * cellW || sy < oy || sy >= oy + BLOCKS * cellH) return null;
    const bx = Math.floor((sx - ox) / cellW), by = Math.floor((sy - oy) / cellH);
    return { bx, by };
  };

  gangs.pointerBlock = function (sx, sy) {
    gangs.hover = gangs.screenToBlock(sx, sy);
  };

  // Jumlah musuh hidup di sebuah blok.
  gangs.enemiesInBlock = function (bx, by) {
    const idx = blockIndex(bx, by);
    return gangs.members.filter((m) => m.home === idx).length;
  };

  // Bersihkan musuh mati; kembalikan blok yang habis penjaganya.
  gangs.reap = function () {
    for (let i = gangs.members.length - 1; i >= 0; i--) {
      const m = gangs.members[i];
      if (!gangs.peds.includes(m) || m.state === 'DOWN') {
        const pi = gangs.peds.indexOf(m);
        if (pi >= 0) gangs.peds.splice(pi, 1);
        gangs.members.splice(i, 1);
        const si = peds.indexOf(m);
        if (si >= 0) peds.splice(si, 1);
      }
    }
  };

  // Gambar panel peta wilayah ke HUD (dipanggil lewat updateGangs saat terbuka).
  gangs.drawPanel = function () {
    const c = gangs.ctx;
    if (!c) return;
    const W = 960, H = 540;
    c.save();
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(8,12,20,0.92)';
    c.fillRect(0, 0, W, H);
    c.textAlign = 'center';
    c.fillStyle = '#ffb347';
    c.font = 'bold 28px sans-serif';
    c.fillText('PETA WILAYAH GENG', W / 2, 42);
    c.font = '13px sans-serif';
    c.fillStyle = '#ccc';
    c.fillText('J untuk menutup · klik blok untuk sorot · kalahkan semua penjaga untuk merebut', W / 2, 66);

    const ox = 140, oy = 96, cellW = 680 / BLOCKS, cellH = 352 / BLOCKS;
    for (let by = 0; by < BLOCKS; by++) {
      for (let bx = 0; bx < BLOCKS; bx++) {
        const idx = blockIndex(bx, by);
        const g = gangs.territory[idx] - 1; // -1 = netral
        const col = g >= 0 ? GANGS[g].mapColor : '#4a5a68';
        c.fillStyle = col;
        c.fillRect(ox + bx * cellW, oy + by * cellH, cellW - 2, cellH - 2);
        if (gangs.hover && gangs.hover.bx === bx && gangs.hover.by === by) {
          c.strokeStyle = '#fff';
          c.lineWidth = 2;
          c.strokeRect(ox + bx * cellW + 1, oy + by * cellH + 1, cellW - 4, cellH - 4);
        }
      }
    }

    // Legenda tiga geng.
    let ly = oy + BLOCKS * cellH + 26;
    c.textAlign = 'left';
    c.font = 'bold 14px sans-serif';
    for (const g of GANGS) {
      c.fillStyle = g.mapColor;
      c.fillRect(40, ly - 11, 12, 12);
      c.fillStyle = '#ddd';
      c.fillText(g.name, 58, ly);
      ly += 24;
    }

    // Rincian blok tersorot.
    if (gangs.hover) {
      const b = gangs.hover;
      const idx = blockIndex(b.bx, b.by);
      const g = gangs.territory[idx] - 1;
      c.textAlign = 'center';
      c.fillStyle = '#7bd66b';
      c.font = 'bold 18px sans-serif';
      c.fillText('BLOK ' + (b.bx + 1) + 'x' + (b.by + 1) + ': ' + (g >= 0 ? GANGS[g].name : 'NETRAL / MILIKMU'), W / 2, 476);
      c.font = '13px sans-serif';
      c.fillStyle = '#ddd';
      c.fillText('Penjaga tersisa: ' + gangs.enemiesInBlock(b.bx, b.by), W / 2, 496);
    }
    c.restore();
  };

  return gangs;
}

export function updateGangs(gangs, dt, player) {
  const { world, ui, audio, combat, peds } = gangs;
  const focus = player.car || player;

  // Bersihkan musuh yang sudah ditumbangkan.
  gangs.reap();

  // Agresi rival: pemain di wilayah geng memancing bala bantuan penjaga blok.
  gangs.aggroTimer -= dt;
  const b = blockOf(focus.x, focus.y);
  const idx = blockIndex(b.bx, b.by);
  const owner = gangs.territory[idx] - 1;

  if (owner >= 0 && gangs.aggroTimer <= 0 && gangs.members.length < 12) {
    gangs.aggroTimer = AGGRESSION_INTERVAL;
    const need = DEFENDERS - gangs.enemiesInBlock(b.bx, b.by);
    for (let i = 0; i < Math.max(0, need); i++) spawnDefender(gangs, world, owner, b.bx, b.by);
    if (need > 0) { if (audio) audio.click(); if (ui.toast) ui.toast('AGRESI ' + GANGS[owner].name + '!'); }
  }

  // Gerakkan & tembak semua penjaga.
  for (const member of gangs.members) {
    const dist = moveMember(member, world, focus, dt);
    member.fireT -= dt;

    if (dist < ATTACK_RANGE && member.fireT <= 0) {
      member.fireT = FIRE_GAP;
      if (Math.random() < HIT_CHANCE) {
        combat.vignette = Math.max(combat.vignette, 0.35);
        combat.shake = Math.max(combat.shake, 0.15);
        let dmg = DAMAGE;
        if (player.armor > 0) { const a = Math.min(player.armor, dmg); player.armor -= a; dmg -= a; }
        player.health -= dmg;
        combat.sinceHit = 0;
        if (combat.hit) { combat.hit.t = 0.12; combat.hit.kill = false; combat.hit.x = 480; combat.hit.y = 270; }
      }
      addHeat(world, 20, 'gang shoot');
    }
  }

  // Penaklukkan wilayah: blok dengan pemain di dalamnya dan penjaga habis jadi netral.
  if (owner >= 0 && gangs.enemiesInBlock(b.bx, b.by) === 0) {
    gangs.territory[idx] = NETRAL;
    if (ui.addMoney) ui.addMoney(CAPTURE_REWARD);
    if (ui.rep) ui.rep.add(focus.x, focus.y, REP_CAPTURE);
    ui.toast('WILAYAH DIREBUT! ' + GANGS[owner].name + ' mundur.');
    if (audio) audio.pickup && audio.pickup();
  }
}