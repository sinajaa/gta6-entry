// extras.js — garasi, paket collectible, dan cuaca (hujan, jalan basah, petir)
// v8: garasi, paket collectible, dan cuaca termasuk hujan dan petir untuk SUNNY CITY.
// Garasi, paket, dan cuaca di sini dikerjakan sebagai tambahan kedalaman gameplay.
import * as THREE from '../vendor/three.module.min.js';
import { TILE, T, tileAt, districtAt, WORLD_W, WORLD_H } from './world.js';
import { GARAGE_ROWS } from './ui.js';
import { isFlyoverActive, skipFlyover } from './camera.js';

export const PACKAGE_COUNT = 12;
const PACKAGE_REWARD = 100;
export const TOKEN_COUNT = 6;
const TOKEN_REWARD = 250;
const GARAGE = { x: 1312, y: 1450, r: 38 };
const PRICE = { repair: 150, paint: 100, nitro: 400 };
const PICK_FOOT = 26, PICK_CAR = 36;
const RAIN_N = 1400, RAIN_BOX = 230, RAIN_TOP = 210, RAIN_LEN = 15, RAIN_FALL = 640;
const RAIN_GREY = new THREE.Color('#4a525c');
const SPAWN = [1360, 1360];

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const toX = (x) => x - WORLD_W / 2, toZ = (y) => y - WORLD_H / 2;

function placePackages(world) {
  const rand = rng(777), out = [];
  const cw = world.width / 4, ch = world.height / 3;
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      for (let tries = 0; tries < 200; tries++) {
        const tx = Math.floor(((gx + rand()) * cw) / TILE), ty = Math.floor(((gy + rand()) * ch) / TILE);
        const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
        const t = tileAt(world, x, y);
        if (t !== T.ROAD && t !== T.SIDEWALK) continue;
        if (Math.hypot(x - GARAGE.x, y - GARAGE.y) < 120 || Math.hypot(x - SPAWN[0], y - SPAWN[1]) < 120) continue;
        if (out.some((p) => Math.hypot(p.x - x, p.y - y) < 200)) continue;
        out.push({ x, y, got: false });
        break;
      }
    }
  }
  return out;
}

// Token tersembunyi: enam keping tersebar merata di tiga distrik, terselip di trotoar/halaman
// (tidak di jalan), jauh dari garasi/spawn/paket. Memberi uang dan dihitung di HUD.
function placeTokens(world) {
  const rand = rng(606), out = [];
  const perDistrict = [0, 0, 0], want = TOKEN_COUNT / 3;
  while (out.length < TOKEN_COUNT) {
    const x = (0.5 + rand() * 79) * TILE, y = (0.5 + rand() * 79) * TILE;
    const d = districtAt(x, y);
    if (perDistrict[d] >= want + 1) continue;
    const t = tileAt(world, x, y);
    if (t !== T.SIDEWALK && t !== T.GRASS) continue;
    if (Math.hypot(x - GARAGE.x, y - GARAGE.y) < 140) continue;
    if (Math.hypot(x - SPAWN[0], y - SPAWN[1]) < 140) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.y - y) < 260)) continue;
    if (world.packages.some((p) => Math.hypot(p.x - x, p.y - y) < 120)) continue;
    out.push({ x, y, got: false });
    perDistrict[d]++;
  }
  return out;
}

function makeSheenTexture(world) {
  const size = 1024, k = size / WORLD_W;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(k, k);
  const rand = rng(4242);
  const cols = world.width / TILE;
  ctx.fillStyle = 'rgba(70,95,130,0.30)';
  for (let ty = 0; ty < cols; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (world.tiles[ty * cols + tx] !== T.ROAD) continue;
      ctx.fillRect(tx * TILE, ty * TILE, TILE + 0.5, TILE + 0.5);
    }
  }
  for (let ty = 0; ty < cols; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (world.tiles[ty * cols + tx] !== T.ROAD) continue;
      const vertical = tx % 10 < 2 && ty % 10 >= 2, horizontal = ty % 10 < 2 && tx % 10 >= 2;
      for (let i = 0; i < 3; i++) {
        const x = tx * TILE + rand() * TILE, y = ty * TILE + rand() * TILE;
        const len = 10 + rand() * 22, a = 0.25 + rand() * 0.45;
        ctx.strokeStyle = `rgba(210,230,255,${a.toFixed(2)})`;
        ctx.lineWidth = 1.2 + rand() * 1.6;
        ctx.beginPath();
        if (vertical || (!horizontal && rand() < 0.5)) { ctx.moveTo(x, y); ctx.lineTo(x, y + len); }
        else { ctx.moveTo(x, y); ctx.lineTo(x + len, y); }
        ctx.stroke();
      }
      if (rand() < 0.1) {
        const x = tx * TILE + rand() * TILE, y = ty * TILE + rand() * TILE;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
        g.addColorStop(0, 'rgba(190,215,255,0.55)'); g.addColorStop(1, 'rgba(190,215,255,0)');
        ctx.fillStyle = g; ctx.fillRect(x - 16, y - 16, 32, 32);
        ctx.fillStyle = 'rgba(70,95,130,0.30)';
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLabelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(20,20,26,0.8)'; ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#ffb300'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 250, 58);
  ctx.fillStyle = '#ffb300'; ctx.font = 'bold 38px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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
  const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false };

  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb300, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(GARAGE.r - 7, GARAGE.r, 40), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.set(toX(GARAGE.x), 1.4, toZ(GARAGE.y));
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffa000, opacity: 0.2, side: THREE.DoubleSide, ...add });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(GARAGE.r - 3, GARAGE.r - 3, 110, 24, 1, true), beamMat);
  beam.position.set(toX(GARAGE.x), 55, toZ(GARAGE.y));
  const label = new THREE.Mesh(new THREE.PlaneGeometry(64, 16), new THREE.MeshBasicMaterial({ map: makeLabelTexture('GARASI'), toneMapped: false, fog: false, side: THREE.DoubleSide }));
  label.position.set(toX(GARAGE.x), 128, toZ(GARAGE.y));
  scene.add(ring, beam, label);

  const pkBox = new THREE.InstancedMesh(new THREE.BoxGeometry(11, 11, 11), new THREE.MeshBasicMaterial({ color: 0xffd21f, toneMapped: false, fog: false }), PACKAGE_COUNT);
  const pkBeam = new THREE.InstancedMesh(new THREE.CylinderGeometry(3.5, 3.5, 70, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe066, opacity: 0.35, side: THREE.DoubleSide, ...add }), PACKAGE_COUNT);
  for (const m of [pkBox, pkBeam]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }

  const tkMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(6, 0), new THREE.MeshBasicMaterial({ color: 0xe8b32a, toneMapped: false, fog: false, transparent: true, opacity: 0.9 }), TOKEN_COUNT);
  tkMesh.frustumCulled = false; tkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(tkMesh);

  const rainPos = new Float32Array(RAIN_N * 6);
  const dropX = new Float32Array(RAIN_N), dropZ = new Float32Array(RAIN_N), dropY = new Float32Array(RAIN_N), dropV = new Float32Array(RAIN_N);
  for (let i = 0; i < RAIN_N; i++) {
    dropX[i] = (Math.random() * 2 - 1) * RAIN_BOX; dropZ[i] = (Math.random() * 2 - 1) * RAIN_BOX;
    dropY[i] = Math.random() * RAIN_TOP; dropV[i] = RAIN_FALL * (0.8 + Math.random() * 0.4);
  }
  const rainGeo = new THREE.BufferGeometry();
  const rainAttr = new THREE.BufferAttribute(rainPos, 3);
  rainAttr.setUsage(THREE.DynamicDrawUsage);
  rainGeo.setAttribute('position', rainAttr);
  const rainMat = new THREE.LineBasicMaterial({ color: 0xc4d8f0, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, fog: false });
  const rainMesh = new THREE.LineSegments(rainGeo, rainMat);
  rainMesh.frustumCulled = false; rainMesh.visible = false;
  scene.add(rainMesh);

  const sheenMat = new THREE.MeshBasicMaterial({ map: makeSheenTexture(world), opacity: 0, side: THREE.FrontSide, ...add });
  sheenMat.polygonOffset = true; sheenMat.polygonOffsetFactor = -2;
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, WORLD_H), sheenMat);
  sheen.rotation.x = -Math.PI / 2; sheen.position.y = 0.6; sheen.visible = false; sheen.renderOrder = 1;
  scene.add(sheen);

  const garage = { open: false };
  let armed = true;
  let clock = 0;
  let raining = fixedRain, rain = fixedRain ? 1 : 0, wet = fixedRain ? 1 : 0, flash = 0, flashT = -1;
  let weatherTimer = fixedRain ? Infinity : 28 + Math.random() * 14, lightningTimer = 4 + Math.random() * 6;
  let wasActive = false, lastRainSent = -1;

  function setGarage(open) {
    garage.open = open;
    if (!open) { ui.garageMenu = null; armed = false; }
  }

  const priceOf = (base) => (ui.rep ? (base === PRICE.repair ? ui.rep.repairPrice : ui.rep.price)(base, GARAGE.x, GARAGE.y) : base);
  function spend(base) {
    const price = priceOf(base);
    if (ui.money < price) { ui.toast('Uang tidak cukup'); return false; }
    ui.addMoney(-price);
    if (ui.rep) ui.rep.add(GARAGE.x, GARAGE.y, 2);
    ui.save();
    return true;
  }
  const choose = {
    1() {
      const car = player.car;
      const max = car.maxHp || 100;
      if ((car.hp ?? max) >= max) { ui.toast('Mobil sudah prima'); return; }
      if (spend(PRICE.repair)) { car.hp = max; audio.click(); ui.toast('Mobil diperbaiki'); }
    },
    2() {
      if (spend(PRICE.paint)) {
        player.car.color = `#${new THREE.Color().setHSL(Math.random(), 0.7 + Math.random() * 0.25, 0.45 + Math.random() * 0.15).getHexString()}`;
        audio.click(); ui.toast('Cat baru');
      }
    },
    3() {
      const car = player.car;
      if (car.nitro) { ui.toast('Nitro sudah terpasang'); return; }
      if (spend(PRICE.nitro)) { car.nitro = true; car.nitroFuel = 1; audio.click(); ui.toast('Nitro terpasang — tahan SHIFT'); }
    },
  };

  function updatePackages(dt) {
    const focus = player.car || player;
    const reach = player.car ? PICK_CAR : PICK_FOOT;
    world.packages.forEach((p, i) => {
      if (!p.got && Math.hypot(p.x - focus.x, p.y - focus.y) < reach) {
        p.got = true;
        ui.pkMask |= 1 << i;
        ui.pkCount = countGot();
        ui.addMoney(PACKAGE_REWARD);
        ui.save();
        audio.pickup();
        if (ui.pkCount === PACKAGE_COUNT) ui.toast('SEMUA PAKET TERKUMPUL!', 3);
      }
      const bob = 12 + Math.sin(clock * 2.4 + i) * 3, vis = p.got ? 0 : 1;
      dummy.position.set(toX(p.x), bob, toZ(p.y));
      dummy.rotation.set(0.3, clock * 1.8 + i, 0.2); dummy.scale.setScalar(vis);
      dummy.updateMatrix(); pkBox.setMatrixAt(i, dummy.matrix);
      dummy.position.set(toX(p.x), 35, toZ(p.y));
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix(); pkBeam.setMatrixAt(i, dummy.matrix);
    });
    pkBox.instanceMatrix.needsUpdate = true; pkBeam.instanceMatrix.needsUpdate = true;
  }

  function updateTokens(dt) {
    const focus = player.car || player;
    const reach = player.car ? PICK_CAR : PICK_FOOT;
    world.tokens.forEach((tok, i) => {
      if (!tok.got && Math.hypot(tok.x - focus.x, tok.y - focus.y) < reach) {
        tok.got = true;
        ui.tkCount++;
        ui.addMoney(TOKEN_REWARD);
        ui.save();
        audio.pickup();
        ui.toast(ui.tkCount === TOKEN_COUNT ? 'SEMUA TOKEN TERKUMPUL!' : `Token ditemukan! +$${TOKEN_REWARD}`);
      }
      const bob = 10 + Math.sin(clock * 2.0 + i * 1.7) * 2.5, vis = tok.got ? 0 : 1;
      dummy.position.set(toX(tok.x), bob, toZ(tok.y));
      dummy.rotation.set(clock * 2.2 + i, clock * 1.4 + i, 0); dummy.scale.setScalar(vis);
      dummy.updateMatrix(); tkMesh.setMatrixAt(i, dummy.matrix);
    });
    tkMesh.instanceMatrix.needsUpdate = true;
  }

  // Penggambaran counter token di HUD (kiri-atas), ditambahkan setelah drawPlaying agar tidak
  // tertimpa; hanya muncul saat bermain.
  function drawTokenHud(ctx) {
    if (ui.state !== 'PLAYING') return;
    ctx.save();
    ctx.textAlign = 'left'; ctx.font = 'bold 15px sans-serif';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.fillStyle = '#e8b32a';
    const t = 'TOKEN ' + ui.tkCount + '/' + ui.tkTotal;
    ctx.strokeText(t, 30, 44); ctx.fillText(t, 30, 44);
    ctx.restore();
  }
  const uiUpdate = ui.update.bind(ui);
  ui.update = (dt, ctx) => { uiUpdate(dt, ctx); drawTokenHud(gfx.hud); };

  function updateGarage() {
    const car = player.car;
    const d = car ? Math.hypot(car.x - GARAGE.x, car.y - GARAGE.y) : Infinity;
    if (d > GARAGE.r * 2) armed = true;
    if (!garage.open && !shotMode && car && armed && d < GARAGE.r && ui.state === 'PLAYING') {
      garage.open = true; car.speed = 0;
    }
    if (garage.open && (!car || ui.state !== 'PLAYING')) setGarage(false);
    const pulse = 0.65 + 0.25 * Math.sin(clock * 3);
    ringMat.opacity = pulse; beamMat.opacity = 0.14 + 0.08 * Math.sin(clock * 3);
    label.quaternion.copy(gfx.camera.quaternion);
    if (garage.open) {
      car.speed = 0;
      const max = car.maxHp || 100;
      ui.garageMenu = {
        hp: Math.round(clamp(((car.hp ?? max) / max) * 100, 0, 100)),
        color: car.color, nitro: !!car.nitro,
        items: [
          { key: '1', label: 'Perbaiki mobil', price: priceOf(PRICE.repair) },
          { key: '2', label: 'Cat ulang acak', price: priceOf(PRICE.paint) },
          { key: '3', label: 'Pasang nitro', price: priceOf(PRICE.nitro) },
        ],
      };
    }
  }

  function updateWeather(dt) {
    if (weatherOn) {
      if (!fixedRain) {
        weatherTimer -= dt;
        if (weatherTimer <= 0) {
          raining = !raining;
          weatherTimer = raining ? 35 + Math.random() * 25 : 55 + Math.random() * 40;
          lightningTimer = 4 + Math.random() * 6;
        }
      }
      rain = clamp(rain + clamp((raining ? 1 : 0) - rain, -dt / 6, dt / 5), 0, 1);
      wet = clamp(wet + clamp((raining ? 1 : 0) - wet, -dt / 30, dt / 5), 0, 1);
      if (rain > 0.7) {
        lightningTimer -= dt;
        if (lightningTimer <= 0) {
          flashT = 0; lightningTimer = 7 + Math.random() * 12;
          setTimeout(() => audio.thunder(), 300 + Math.random() * 1400);
        }
      }
    }
    if (flashT >= 0) {
      flashT += dt;
      const t = flashT;
      flash = t < 0.06 ? t / 0.06 : t < 0.12 ? 0.3 : t < 0.18 ? 0.3 + ((t - 0.12) / 0.06) * 0.7 : Math.max(0, 1 - (t - 0.18) / 0.3);
      if (t > 0.5) { flashT = -1; flash = 0; }
    }
    if (Math.abs(rain - lastRainSent) > 0.01) { lastRainSent = rain; audio.setRain(rain); }

    const showRain = rain > 0.02;
    rainMesh.visible = showRain;
    if (showRain) {
      const cam = gfx.camera.position;
      const cx = cam.x, cz = cam.z;
      for (let i = 0; i < RAIN_N; i++) {
        dropY[i] -= dropV[i] * dt;
        if (dropY[i] < 0) { dropY[i] += RAIN_TOP; dropX[i] = cx + (Math.random() * 2 - 1) * RAIN_BOX; dropZ[i] = cz + (Math.random() * 2 - 1) * RAIN_BOX; }
        dropX[i] = ((dropX[i] - cx + RAIN_BOX * 3) % (RAIN_BOX * 2)) - RAIN_BOX + cx;
        dropZ[i] = ((dropZ[i] - cz + RAIN_BOX * 3) % (RAIN_BOX * 2)) - RAIN_BOX + cz;
        const o = i * 6;
        rainPos[o] = dropX[i]; rainPos[o + 1] = dropY[i]; rainPos[o + 2] = dropZ[i];
        rainPos[o + 3] = dropX[i] + 2.6; rainPos[o + 4] = dropY[i] + RAIN_LEN; rainPos[o + 5] = dropZ[i] + 1.2;
      }
      rainAttr.needsUpdate = true;
      rainGeo.setDrawRange(0, Math.floor(RAIN_N * rain) * 2);
      rainMat.opacity = 0.18 + 0.42 * rain;
    }
    gfx.wetAmount = wet;
    sheen.visible = wet > 0.02;
    sheenMat.opacity = clamp(wet * (0.6 + 0.4 * gfx.night) + flash * 0.3, 0, 1);
    if (gfx.ground) gfx.ground.material.color.setScalar(1 - 0.32 * wet);
  }

  const lum = new THREE.Color();
  gfx.beforeDraw = () => {
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

  return {
    garage,
    handleKey(key, repeat) {
      if (isFlyoverActive()) { skipFlyover(); return true; }
      if (!garage.open) return false;
      if (repeat) return true;
      if (choose[key]) choose[key]();
      else if (key === 'escape' || key === 'e' || key === 'enter') setGarage(false);
      return true;
    },
    click(x, y) {
      if (isFlyoverActive()) { skipFlyover(); return true; }
      if (!garage.open) return false;
      const R = GARAGE_ROWS;
      for (let i = 0; i < 3; i++) {
        const top = R.top + i * R.step;
        if (x >= R.x && x <= R.x + R.w && y >= top && y <= top + R.h) { choose[i + 1](); return true; }
      }
      setGarage(false);
      return true;
    },
    update(dt) {
      clock += dt;
      updateGarage();
      updatePackages(dt);
      updateTokens(dt);
      updateWeather(dt);
    },
    weather: () => ({ rain, wet, flash, raining }),
  };
}
