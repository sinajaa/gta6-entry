// extras.js — garasi, paket collectible, dan cuaca (hujan, jalan basah, petir)
// Dirombak menjadi kumpulan helper kecil + tabel data + konstanta bernama,
// dengan perilaku eksternal (ekspor, tujuan, reward, string HUD) yang identik.
import * as THREE from '../vendor/three.module.min.js';
import { TILE, T, tileAt, districtAt, WORLD_W, WORLD_H } from './world.js';
import { GARAGE_ROWS } from './ui.js';
import { isFlyoverActive, skipFlyover } from './camera.js';

// ----------------------------------------------------------------------------
// Konstanta dan tabel data bernama — setiap angka ajaib diberi nama.
// ----------------------------------------------------------------------------

export const PACKAGE_COUNT = 12;
export const TOKEN_COUNT = 6;

const PACKAGE_REWARD = 100;
const TOKEN_REWARD = 250;

// Posisi dan jangkauan garasi (dan harga layanannya).
const GARAGE = { x: 1312, y: 1450, r: 38 };

const PRICE = { repair: 150, paint: 100, nitro: 400 };

// Jarak ambil paket/token: lebih jauh saat berkendara daripada berjalan kaki.
const PICK_FOOT = 26, PICK_CAR = 36;

// Parameter hujan (partikel + kotak di sekitar kamera + panjang/kecepatan jatuh).
const RAIN_N = 1400, RAIN_BOX = 230, RAIN_TOP = 210, RAIN_LEN = 15, RAIN_FALL = 640;
const RAIN_GREY = new THREE.Color('#4a525c');

// Sumber penempatan: titik spawn pemain dihitung relatif terhadap dunia.
const SPAWN = [1360, 1360];

// Jarak aman penempatan agar paket/token tidak menumpuk di titik penting.
const GARAGE_CLEAR = 120, GARAGE_TOKEN_CLEAR = 140, SPAWN_TOKEN_CLEAR = 140;
const PACKAGE_SPREAD = 200, TOKEN_SPREAD = 260, TOKEN_PACKAGE_CLEAR = 120;

// Sifat visual dari menara cahaya garasi dan label.
const RING_COLOR = 0xffb300;
const BEAM_COLOR = 0xffa000;

// ----------------------------------------------------------------------------
// Helper kecil yang tak bergantung pada state.
// ----------------------------------------------------------------------------

// PRNG deterministik berbasis LCG agar penempatan tetap stabil antar muat.
const makeRng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Konversi koordinat dunia (pusat) ke ruang 3D berpusat pada asal.
const toX = (x) => x - WORLD_W / 2;
const toZ = (y) => y - WORLD_H / 2;

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ----------------------------------------------------------------------------
// Penempatan paket dan token.
// ----------------------------------------------------------------------------

// Dua belas paket tersebar merata dalam kisi 4×3, hanya di jalan/trotoar,
// dengan jarak aman dari garasi, spawn, dan satu sama lain.
function placePackages(world) {
  const rand = makeRng(777);
  const out = [];
  const cols = 4, rows = 3;
  const cellW = world.width / cols, cellH = world.height / rows;
  const candidates = [];

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const x = (gx + rand()) * cellW;
        const y = (gy + rand()) * cellH;
        const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
        const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
        if (tileAt(world, cx, cy) !== T.ROAD && tileAt(world, cx, cy) !== T.SIDEWALK) continue;
        const tooCloseToKey = dist2({ x: cx, y: cy }, GARAGE) < GARAGE_CLEAR
          || Math.hypot(cx - SPAWN[0], cy - SPAWN[1]) < GARAGE_CLEAR;
        const tooCloseToPeer = candidates.some((p) => dist2(p, { x: cx, y: cy }) < PACKAGE_SPREAD);
        if (tooCloseToKey || tooCloseToPeer) continue;
        candidates.push({ x: cx, y: cy });
        placed = true;
      }
    }
  }

  // Isi hasil setelah semua sel diproses (urutan tetap sel-major).
  for (const c of candidates) out.push({ x: c.x, y: c.y, got: false });
  return out;
}

// Enam token emas tersembunyi, balans merata di tiga distrik; diletakkan di
// trotoar/rumput (bukan jalan), jauh dari garasi/spawn/paket dan satu sama lain.
function placeTokens(world) {
  const rand = makeRng(606);
  const out = [];
  const perDistrict = [0, 0, 0];
  const perDistrictCap = Math.ceil(TOKEN_COUNT / 3);
  const span = 79; // 80×80 tile (dunia 80 tile) dikurangi 1 margin.

  while (out.length < TOKEN_COUNT) {
    const tx = 0.5 + rand() * (span - 1);
    const ty = 0.5 + rand() * (span - 1);
    const x = tx * TILE, y = ty * TILE;
    const d = districtAt(x, y);
    if (perDistrict[d] >= perDistrictCap) continue;
    const t = tileAt(world, x, y);
    if (t !== T.SIDEWALK && t !== T.GRASS) continue;
    if (Math.hypot(x - GARAGE.x, y - GARAGE.y) < GARAGE_TOKEN_CLEAR) continue;
    if (Math.hypot(x - SPAWN[0], y - SPAWN[1]) < SPAWN_TOKEN_CLEAR) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.y - y) < TOKEN_SPREAD)) continue;
    if (world.packages.some((p) => Math.hypot(p.x - x, p.y - y) < TOKEN_PACKAGE_CLEAR)) continue;
    out.push({ x, y, got: false });
    perDistrict[d]++;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Tekstur kanvas.
// ----------------------------------------------------------------------------

// Kilau jalan basah: timpa warna jalan dengan biru pudar, lalu gambar coretan
// tipis (vertikal/horisontal) dan bintik terang acak di atasnya.
function makeSheenTexture(world) {
  const size = 1024, scale = size / WORLD_W;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const rand = makeRng(4242);
  const cols = world.width / TILE;
  const baseFill = 'rgba(70,95,130,0.30)';

  for (let ty = 0; ty < cols; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (world.tiles[ty * cols + tx] !== T.ROAD) continue;
      ctx.fillStyle = baseFill;
      ctx.fillRect(tx * TILE, ty * TILE, TILE + 0.5, TILE + 0.5);
    }
  }

  for (let ty = 0; ty < cols; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (world.tiles[ty * cols + tx] !== T.ROAD) continue;

      // Pola miring: kolom pertama lebih sering vertikal, baris pertama horizontal.
      const vertical = tx % 10 < 2 && ty % 10 >= 2;
      const horizontal = ty % 10 < 2 && tx % 10 >= 2;

      for (let i = 0; i < 3; i++) {
        const x = tx * TILE + rand() * TILE, y = ty * TILE + rand() * TILE;
        const len = 10 + rand() * 22, alpha = 0.25 + rand() * 0.45;
        ctx.strokeStyle = `rgba(210,230,255,${alpha.toFixed(2)})`;
        ctx.lineWidth = 1.2 + rand() * 1.6;
        ctx.beginPath();
        if (vertical || (!horizontal && rand() < 0.5)) { ctx.moveTo(x, y); ctx.lineTo(x, y + len); }
        else { ctx.moveTo(x, y); ctx.lineTo(x + len, y); }
        ctx.stroke();
      }

      // Sesekali setitik cahaya terang memantul (genangan air).
      if (rand() < 0.1) {
        const x = tx * TILE + rand() * TILE, y = ty * TILE + rand() * TILE;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
        g.addColorStop(0, 'rgba(190,215,255,0.55)');
        g.addColorStop(1, 'rgba(190,215,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 16, y - 16, 32, 32);
        ctx.fillStyle = baseFill;
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Label teks transparan berbingkai kuning (dipakai untuk tulisan "GARASI").
function makeLabelTexture(text) {
  const W = 256, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(20,20,26,0.8)'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#ffb300'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.fillStyle = '#ffb300'; ctx.font = 'bold 38px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Material aditif umum untuk "pilar cahaya" (benar-benar menyala, tanpa fog).
const additiveFlags = () => ({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });

// ----------------------------------------------------------------------------
// Konstruksi scene garasi + paket + token + hujan + kilau basah.
// ----------------------------------------------------------------------------

// Bangun penanda visual garasi: cincin di tanah, pilar cahaya, dan label.
function buildGarageMarkers(scene) {
  const ringMat = new THREE.MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(GARAGE.r - 7, GARAGE.r, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(toX(GARAGE.x), 1.4, toZ(GARAGE.y));

  const beamMat = new THREE.MeshBasicMaterial({ color: BEAM_COLOR, opacity: 0.2, side: THREE.DoubleSide, ...additiveFlags() });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(GARAGE.r - 3, GARAGE.r - 3, 110, 24, 1, true), beamMat);
  beam.position.set(toX(GARAGE.x), 55, toZ(GARAGE.y));

  const label = new THREE.Mesh(new THREE.PlaneGeometry(64, 16), new THREE.MeshBasicMaterial({ map: makeLabelTexture('GARASI'), toneMapped: false, fog: false, side: THREE.DoubleSide }));
  label.position.set(toX(GARAGE.x), 128, toZ(GARAGE.y));

  scene.add(ring, beam, label);
  return { ring, ringMat, beamMat, label };
}

// Paket (kotak + pilar cahaya) sebagai InstancedMesh untuk hemat draw call.
function buildPackageMeshes(scene) {
  const pkBox = new THREE.InstancedMesh(new THREE.BoxGeometry(11, 11, 11), new THREE.MeshBasicMaterial({ color: 0xffd21f, toneMapped: false, fog: false }), PACKAGE_COUNT);
  const pkBeam = new THREE.InstancedMesh(new THREE.CylinderGeometry(3.5, 3.5, 70, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe066, opacity: 0.35, side: THREE.DoubleSide, ...additiveFlags() }), PACKAGE_COUNT);
  for (const m of [pkBox, pkBeam]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
  }
  return { pkBox, pkBeam };
}

function buildTokenMesh(scene) {
  const tkMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(6, 0), new THREE.MeshBasicMaterial({ color: 0xe8b32a, toneMapped: false, fog: false, transparent: true, opacity: 0.9 }), TOKEN_COUNT);
  tkMesh.frustumCulled = false;
  tkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(tkMesh);
  return tkMesh;
}

// Garis-garis hujan (LineSegments) dengan buffer posisi dinamis per droplet.
function buildRainMesh(scene) {
  const pos = new Float32Array(RAIN_N * 6);
  const dropX = new Float32Array(RAIN_N), dropZ = new Float32Array(RAIN_N), dropY = new Float32Array(RAIN_N), dropV = new Float32Array(RAIN_N);
  for (let i = 0; i < RAIN_N; i++) {
    dropX[i] = (Math.random() * 2 - 1) * RAIN_BOX;
    dropZ[i] = (Math.random() * 2 - 1) * RAIN_BOX;
    dropY[i] = Math.random() * RAIN_TOP;
    dropV[i] = RAIN_FALL * (0.8 + Math.random() * 0.4);
  }
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  const mat = new THREE.LineBasicMaterial({ color: 0xc4d8f0, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, fog: false });
  const mesh = new THREE.LineSegments(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, mat, geo, attr, pos, dropX, dropZ, dropY, dropV };
}

// Bidang datar besar berkilau di atas jalan saat basah.
function buildSheenPlane(scene, world) {
  const mat = new THREE.MeshBasicMaterial({ map: makeSheenTexture(world), opacity: 0, side: THREE.FrontSide, ...additiveFlags() });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, WORLD_H), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.6;
  mesh.visible = false;
  mesh.renderOrder = 1;
  scene.add(mesh);
  return { mesh, mat };
}

// ----------------------------------------------------------------------------
// Logika interaksi garasi (menu beli/perbaiki).
// ----------------------------------------------------------------------------

function buildGarageController({ player, ui, audio, shotMode }) {
  const garage = { open: false };
  let armed = true;

  const setGarage = (open) => {
    garage.open = open;
    if (!open) { ui.garageMenu = null; armed = false; }
  };

  // Harga layanan, disesuaikan oleh reputasi distrik bila ada.
  const priceOf = (base) => (ui.rep ? (base === PRICE.repair ? ui.rep.repairPrice : ui.rep.price)(base, GARAGE.x, GARAGE.y) : base);

  // Tarik uang dengan cek saldo; mendukung reputasi dan autosave.
  const spend = (base) => {
    const price = priceOf(base);
    if (ui.money < price) { ui.toast('Uang tidak cukup'); return false; }
    ui.addMoney(-price);
    if (ui.rep) ui.rep.add(GARAGE.x, GARAGE.y, 2);
    ui.save();
    return true;
  };

  const carHp = (car) => car.hp ?? (car.maxHp || 100);

  // Menu pilihan, dipetakan dari tombol 1–3.
  const repair = () => {
    const car = player.car;
    const max = car.maxHp || 100;
    if (carHp(car) >= max) { ui.toast('Mobil sudah prima'); return; }
    if (spend(PRICE.repair)) { car.hp = max; audio.click(); ui.toast('Mobil diperbaiki'); }
  };
  const paint = () => {
    if (spend(PRICE.paint)) {
      const hue = Math.random(), sat = 0.7 + Math.random() * 0.25, light = 0.45 + Math.random() * 0.15;
      player.car.color = `#${new THREE.Color().setHSL(hue, sat, light).getHexString()}`;
      audio.click(); ui.toast('Cat baru');
    }
  };
  const nitro = () => {
    const car = player.car;
    if (car.nitro) { ui.toast('Nitro sudah terpasang'); return; }
    if (spend(PRICE.nitro)) { car.nitro = true; car.nitroFuel = 1; audio.click(); ui.toast('Nitro terpasang — tahan SHIFT'); }
  };
  const choose = { 1: repair, 2: paint, 3: nitro };

  // Bangun objek menu untuk digambar oleh ui.js.
  const buildMenu = (car) => {
    const max = car.maxHp || 100;
    return {
      hp: Math.round(clamp((carHp(car) / max) * 100, 0, 100)),
      color: car.color, nitro: !!car.nitro,
      items: [
        { key: '1', label: 'Perbaiki mobil', price: priceOf(PRICE.repair) },
        { key: '2', label: 'Cat ulang acak', price: priceOf(PRICE.paint) },
        { key: '3', label: 'Pasang nitro', price: priceOf(PRICE.nitro) },
      ],
    };
  };

  // Diklik/di-keyboard; mengembalikan true bila input tertelan (garasi terbuka).
  const handleKey = (key, repeat) => {
    if (isFlyoverActive()) { skipFlyover(); return true; }
    if (!garage.open) return false;
    if (repeat) return true;
    if (choose[key]) choose[key]();
    else if (key === 'escape' || key === 'e' || key === 'enter') setGarage(false);
    return true;
  };

  const click = (x, y) => {
    if (isFlyoverActive()) { skipFlyover(); return true; }
    if (!garage.open) return false;
    const R = GARAGE_ROWS;
    for (let i = 0; i < 3; i++) {
      const top = R.top + i * R.step;
      if (x >= R.x && x <= R.x + R.w && y >= top && y <= top + R.h) { choose[i + 1](); return true; }
    }
    setGarage(false);
    return true;
  };

  // Buka garasi saat mobil memasuki lingkaran; tutup saat keluar/berhenti main.
  const updateGarage = (clock) => {
    const car = player.car;
    const d = car ? Math.hypot(car.x - GARAGE.x, car.y - GARAGE.y) : Infinity;
    if (d > GARAGE.r * 2) armed = true;
    if (!garage.open && !shotMode && car && armed && d < GARAGE.r && ui.state === 'PLAYING') {
      garage.open = true;
      car.speed = 0;
    }
    if (garage.open && (!car || ui.state !== 'PLAYING')) setGarage(false);
    if (garage.open) {
      car.speed = 0;
      ui.garageMenu = buildMenu(car);
    }
  };

  return { garage, updateGarage, handleKey, click };
}

// ----------------------------------------------------------------------------
// Pengumpulan paket dan token (jarak ambil + animasi instansi).
// ----------------------------------------------------------------------------

function collectPackages(world, player, ui, audio, clock, meshes, dummy) {
  const { x, y } = player.car || player;
  const reach = player.car ? PICK_CAR : PICK_FOOT;
  const { pkBox, pkBeam } = meshes;

  for (let i = 0; i < world.packages.length; i++) {
    const p = world.packages[i];
    if (!p.got && Math.hypot(p.x - x, p.y - y) < reach) {
      p.got = true;
      ui.pkMask |= 1 << i;
      ui.pkCount = world.packages.filter((q) => q.got).length;
      ui.addMoney(PACKAGE_REWARD);
      ui.save();
      audio.pickup();
      if (ui.pkCount === PACKAGE_COUNT) ui.toast('SEMUA PAKET TERKUMPUL!', 3);
    }

    const bob = 12 + Math.sin(clock * 2.4 + i) * 3, vis = p.got ? 0 : 1;
    dummy.position.set(toX(p.x), bob, toZ(p.y));
    dummy.rotation.set(0.3, clock * 1.8 + i, 0.2);
    dummy.scale.setScalar(vis);
    dummy.updateMatrix();
    pkBox.setMatrixAt(i, dummy.matrix);

    dummy.position.set(toX(p.x), 35, toZ(p.y));
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    pkBeam.setMatrixAt(i, dummy.matrix);
  }
  pkBox.instanceMatrix.needsUpdate = true;
  pkBeam.instanceMatrix.needsUpdate = true;
}

function collectTokens(world, player, ui, audio, clock, tkMesh, dummy) {
  const { x, y } = player.car || player;
  const reach = player.car ? PICK_CAR : PICK_FOOT;

  for (let i = 0; i < world.tokens.length; i++) {
    const tok = world.tokens[i];
    if (!tok.got && Math.hypot(tok.x - x, tok.y - y) < reach) {
      tok.got = true;
      ui.tkCount++;
      ui.addMoney(TOKEN_REWARD);
      ui.save();
      audio.pickup();
      ui.toast(ui.tkCount === TOKEN_COUNT ? 'SEMUA TOKEN TERKUMPUL!' : `Token ditemukan! +$${TOKEN_REWARD}`);
    }

    const bob = 10 + Math.sin(clock * 2.0 + i * 1.7) * 2.5, vis = tok.got ? 0 : 1;
    dummy.position.set(toX(tok.x), bob, toZ(tok.y));
    dummy.rotation.set(clock * 2.2 + i, clock * 1.4 + i, 0);
    dummy.scale.setScalar(vis);
    dummy.updateMatrix();
    tkMesh.setMatrixAt(i, dummy.matrix);
  }
  tkMesh.instanceMatrix.needsUpdate = true;
}

// ----------------------------------------------------------------------------
// Cuaca: hujan, petir, kilau basah, dan kilatan petir.
// ----------------------------------------------------------------------------

function buildWeatherController({ gfx, audio, sheen, sheenMat, rainMesh, fixedRain, weatherOn }) {
  const { mesh, geo, attr, pos, dropX, dropZ, dropY, dropV } = rainMesh;
  const rainMat = rainMesh.mat;

  let raining = fixedRain, rain = fixedRain ? 1 : 0, wet = fixedRain ? 1 : 0, flash = 0, flashT = -1;
  let weatherTimer = fixedRain ? Infinity : 28 + Math.random() * 14, lightningTimer = 4 + Math.random() * 6;
  let lastRainSent = -1;

  // Ambang untuk dianggap "sedang hujan" (kilat hanya saat deras).
  const RAIN_ON = 0.02, LIGHTNING_RAIN = 0.7;

  const updateWeather = (dt) => {
    if (weatherOn) {
      if (!fixedRain) {
        weatherTimer -= dt;
        if (weatherTimer <= 0) {
          raining = !raining;
          weatherTimer = raining ? 35 + Math.random() * 25 : 55 + Math.random() * 40;
          lightningTimer = 4 + Math.random() * 6;
        }
      }
      // Haluskan transisi hujan (cepat naik, lebih lambat surut) dan kebasahan.
      rain = clamp(rain + clamp((raining ? 1 : 0) - rain, -dt / 6, dt / 5), 0, 1);
      wet = clamp(wet + clamp((raining ? 1 : 0) - wet, -dt / 30, dt / 5), 0, 1);

      if (rain > LIGHTNING_RAIN) {
        lightningTimer -= dt;
        if (lightningTimer <= 0) {
          flashT = 0;
          lightningTimer = 7 + Math.random() * 12;
          setTimeout(() => audio.thunder(), 300 + Math.random() * 1400);
        }
      }
    }

    // Profil kilatan: naik cepat, tahan sebentar, lalu surut.
    if (flashT >= 0) {
      flashT += dt;
      const t = flashT;
      flash = t < 0.06 ? t / 0.06
        : t < 0.12 ? 0.3
        : t < 0.18 ? 0.3 + ((t - 0.12) / 0.06) * 0.7
        : Math.max(0, 1 - (t - 0.18) / 0.3);
      if (t > 0.5) { flashT = -1; flash = 0; }
    }

    if (Math.abs(rain - lastRainSent) > 0.01) { lastRainSent = rain; audio.setRain(rain); }

    const showRain = rain > RAIN_ON;
    mesh.visible = showRain;
    if (showRain) {
      const cam = gfx.camera.position;
      const cx = cam.x, cz = cam.z;
      for (let i = 0; i < RAIN_N; i++) {
        dropY[i] -= dropV[i] * dt;
        if (dropY[i] < 0) {
          dropY[i] += RAIN_TOP;
          dropX[i] = cx + (Math.random() * 2 - 1) * RAIN_BOX;
          dropZ[i] = cz + (Math.random() * 2 - 1) * RAIN_BOX;
        }
        dropX[i] = ((dropX[i] - cx + RAIN_BOX * 3) % (RAIN_BOX * 2)) - RAIN_BOX + cx;
        dropZ[i] = ((dropZ[i] - cz + RAIN_BOX * 3) % (RAIN_BOX * 2)) - RAIN_BOX + cz;
        const o = i * 6;
        pos[o] = dropX[i]; pos[o + 1] = dropY[i]; pos[o + 2] = dropZ[i];
        pos[o + 3] = dropX[i] + 2.6; pos[o + 4] = dropY[i] + RAIN_LEN; pos[o + 5] = dropZ[i] + 1.2;
      }
      attr.needsUpdate = true;
      geo.setDrawRange(0, Math.floor(RAIN_N * rain) * 2);
      rainMat.opacity = 0.18 + 0.42 * rain;
    }

    gfx.wetAmount = wet;
    sheen.visible = wet > RAIN_ON;
    sheenMat.opacity = clamp(wet * (0.6 + 0.4 * gfx.night) + flash * 0.3, 0, 1);
    if (gfx.ground) gfx.ground.material.color.setScalar(1 - 0.32 * wet);
  };

  return { updateWeather, getState: () => ({ rain, wet, flash, raining }) };
}

// ----------------------------------------------------------------------------
// Ayunan cahaya sebelum render: menggelapkan dunia saat hujan/kilat.
// ----------------------------------------------------------------------------

function buildLightAdjuster({ scene, gfx, getWeather }) {
  const lum = new THREE.Color();
  let wasActive = false;

  const adjustLight = () => {
    const { rain, flash } = getWeather();
    const active = rain > 0.005 || flash > 0.001;
    const b = gfx.base;
    if (active && b) {
      const bg = 1 - 0.58 * rain + flash * 1.3;
      gfx.renderer.toneMappingExposure = b.exp * (1 - 0.28 * rain) + flash * 1.1;
      gfx.sun.intensity = b.sun * (1 - 0.72 * rain) + flash * 1.2;
      gfx.hemi.intensity = b.hemi * (1 - 0.25 * rain) + flash * 1.4;
      scene.backgroundIntensity = bg;
      const fog = scene.fog;
      fog.color.copy(b.fog).multiplyScalar(clamp(bg, 0, 1.6));
      const l = fog.color.r * 0.3 + fog.color.g * 0.59 + fog.color.b * 0.11;
      fog.color.lerp(lum.setRGB(l, l, l * 1.05), 0.5 * rain);
      fog.density = b.fogDensity * (1 + 1.2 * rain);
      void RAIN_GREY;
    } else if (wasActive) {
      scene.backgroundIntensity = 1;
      gfx.dayKey = null;
    }
    wasActive = active;
  };

  return adjustLight;
}

// ----------------------------------------------------------------------------
// Titik masuk: rakit semua subsistem dan kembalikan antarmuka publik.
// ----------------------------------------------------------------------------

export function createExtras({ world, player, ui, audio, gfx }) {
  const params = new URLSearchParams(location.search);
  const shotMode = params.has('shot');
  const rainParam = params.get('rain');
  const fixedRain = rainParam === '1';
  const weatherOn = !shotMode && rainParam !== '0';

  world.garage = GARAGE;
  world.packages = placePackages(world);
  world.packages.forEach((p, i) => { p.got = !!(ui.pkMask & (1 << i)); });
  ui.pkTotal = PACKAGE_COUNT;
  const countGot = () => world.packages.filter((p) => p.got).length;
  ui.pkCount = countGot();

  world.tokens = placeTokens(world);
  ui.tkTotal = TOKEN_COUNT;
  ui.tkCount = 0;

  const scene = gfx.scene;
  const dummy = new THREE.Object3D();

  const garageMarkers = buildGarageMarkers(scene);
  const packageMeshes = buildPackageMeshes(scene);
  const tokenMesh = buildTokenMesh(scene);
  const rainMesh = buildRainMesh(scene);
  const { mesh: sheen, mat: sheenMat } = buildSheenPlane(scene, world);

  const garageController = buildGarageController({ player, ui, audio, shotMode });
  const { garage, updateGarage, handleKey, click } = garageController;

  const weatherController = buildWeatherController({ gfx, audio, sheen, sheenMat, rainMesh, fixedRain, weatherOn });
  const { updateWeather, getState } = weatherController;

  // Override HUD untuk menambahkan counter token di kiri-atas setelah update UI.
  const drawTokenHud = (ctx) => {
    if (ui.state !== 'PLAYING') return;
    ctx.save();
    ctx.textAlign = 'left'; ctx.font = 'bold 15px sans-serif';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.fillStyle = '#e8b32a';
    const t = 'TOKEN ' + ui.tkCount + '/' + ui.tkTotal;
    ctx.strokeText(t, 30, 44); ctx.fillText(t, 30, 44);
    ctx.restore();
  };
  const uiUpdate = ui.update.bind(ui);
  ui.update = (dt, ctx) => { uiUpdate(dt, ctx); drawTokenHud(gfx.hud); };

  // Ayunan cahaya sebagai hook beforeDraw milik renderer.
  const adjustLight = buildLightAdjuster({ scene, gfx, getWeather });
  gfx.beforeDraw = adjustLight;

  let clock = 0;

  const update = (dt) => {
    clock += dt;
    updateGarage(clock);

    collectPackages(world, player, ui, audio, clock, packageMeshes, dummy);
    collectTokens(world, player, ui, audio, clock, tokenMesh, dummy);
    updateWeather(dt);

    // Animasi denyut cincin garasi + label menghadap kamera.
    const pulse = 0.65 + 0.25 * Math.sin(clock * 3);
    garageMarkers.ringMat.opacity = pulse;
    garageMarkers.beamMat.opacity = 0.14 + 0.08 * Math.sin(clock * 3);
    garageMarkers.label.quaternion.copy(gfx.camera.quaternion);
  };

  return {
    garage,
    handleKey,
    click,
    update,
    weather: getState,
  };
}