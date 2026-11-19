// render3d.js — render kota 3D dengan three.js dan HUD overlay
// Kota 3D digambar oleh renderer yang disusun sendiri di atas three.js.
import * as THREE from '../vendor/three.module.min.js';
import { TILE, COLS, ROWS, T, WORLD_W, WORLD_H, districtOfBlock } from './world.js';
import { nearestEnterable } from './vehicle.js';

const GROUND_COLORS = { [T.ROAD]: '#565b60', [T.SIDEWALK]: '#d9d2c3', [T.GRASS]: '#8fc16a', [T.BUILDING]: '#8c8173' };
const HORIZON = 0xf0b88a;
const SHADOW_HALF = 560;
const SHADOW_MIN = 260, SHADOW_MAX = 660;
const SUN_OFFSET = new THREE.Vector3(-760, 460, -540);
const MOON_DIR = new THREE.Vector3(560, 520, 300);
const SKY_RADIUS = 1200;
const ROOF_BOOST = 1.25;
const CAR_SIZE = { length: 56, height: 18, width: 22 };
const PLAYER_HEIGHT = 28;
const MAX_CARS = 64;
const MAX_PEDS = 128, PED_DRAW_RADIUS = 700, PED_HEIGHT = 16;
const PED_SHIRTS = ['#ffffff', '#2a5aff', '#e0262b', '#f5c518', '#2fa84f', '#111111'];
const UMBRELLA_COLORS = ['#ff3b6b', '#18c8ff', '#ffd23a', '#9b5cff', '#2ee06a'];
const PED_TINTS = ['#ffffff', '#ffb6a0', '#a0e0ff', '#ffe08a', '#c0ffb0', '#d8b0ff', '#ff8a5c'];
const MAX_LIGHTS = 16, LIGHT_HZ = 6;
const LIGHT_SIZE = { length: 6, height: 3, width: 8 };
const EVADE_MAX = [10, 14, 18, 24, 30];
const HELI_SPOT_RADIUS = 140;
const STAR_COLOR = '#f5c518';

function makeSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#2f5f9e');
  g.addColorStop(0.18, '#7fa6c9');
  g.addColorStop(0.27, '#f0b88a');
  g.addColorStop(1, '#f0b88a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Sky dome: a large inverted sphere drawn with a gradient shader so the sky blends from
// zenith to horizon like the old canvas backdrop, with a soft sun disc, a moon disc, stars
// and a horizon glow — all driven from the same day/night palette as the fog and hemi light.
const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const skyFrag = /* glsl */ `
varying vec3 vDir;
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uStarAmt;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  float t = pow(clamp(1.0 - h, 0.0, 1.0), 0.62);
  vec3 col = mix(uTop, uMid, smoothstep(0.0, 0.32, t));
  col = mix(col, uHor, smoothstep(0.3, 0.62, t));
  // stars in the upper dome
  float star = 0.0;
  if (uStarAmt > 0.02) {
    vec2 sp = d.xz / max(0.0001, d.y + 1.2);
    float g = hash21(floor(sp * 14.0));
    star = step(0.985, g) * smoothstep(0.02, 0.05, uStarAmt);
    col += vec3(0.8, 0.85, 1.0) * star * (0.4 + 0.6 * hash21(floor(sp * 14.0) + 7.0));
  }
  // horizon glow band
  col += uHor * pow(1.0 - abs(h), 14.0) * 0.35;
  // sun disc + halo
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  float disc = smoothstep(0.9992, 0.9999, sd);
  float halo = pow(sd, 120.0);
  col += uSunColor * (disc * 1.0 + halo * 0.8);
  // moon disc + halo
  float md = max(dot(d, normalize(-uSunDir)), 0.0);
  float mdisc = smoothstep(0.9994, 1.0, md) * (1.0 - uNight);
  float mhalo = pow(md, 60.0) * (1.0 - uNight) * 0.4;
  col += vec3(0.7, 0.75, 0.95) * (mdisc + mhalo);
  gl_FragColor = vec4(col, 1.0);
}`;

function makeSkyDome(software) {
  if (software) {
    const texture = makeSkyTexture();
    return { dome: null, background: texture };
  }
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const mat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    uniforms: {
      uTop: { value: new THREE.Color('#2f5f9e') },
      uMid: { value: new THREE.Color('#7fa6c9') },
      uHor: { value: new THREE.Color(HORIZON) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color('#fff1dc') },
      uNight: { value: 0 },
      uStarAmt: { value: 0 },
    },
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  return { dome, mat, background: null };
}

const DAY_SECONDS = 300;
const START_HOUR = 10;
const C = (s) => new THREE.Color(s);
// [hour, skyTop, skyMid, horizon, hemiSky, hemiGround, hemiI, ambientI, sunColor, exposure]
const KEYS = [
  [0,    '#050a1a', '#0c1630', '#16213d', '#3a4f80', '#1a1a24', 0.55, 0.14, '#9fb4ff', 1.15],
  [5,    '#0a1230', '#1c2848', '#2a3550', '#3a4f80', '#1a1a24', 0.55, 0.14, '#9fb4ff', 1.15],
  [6.5,  '#2f4f86', '#8a8fb0', '#f08a6a', '#8fa0c8', '#4a3a2a', 0.5,  0.08, '#ff9a5a', 1.0],
  [9,    '#2f5f9e', '#7fa6c9', '#e8c4a0', '#8fb4e8', '#4a3a2a', 0.55, 0.08, '#ffd2a0', 0.92],
  [12,   '#2f5f9e', '#7fa6c9', '#d9d2c0', '#8fb4e8', '#4a3a2a', 0.55, 0.08, '#fff1dc', 0.92],
  [16.5, '#2f5f9e', '#7fa6c9', '#f0b88a', '#8fb4e8', '#4a3a2a', 0.55, 0.08, '#ffc48a', 0.92],
  [18.5, '#2c3f78', '#a0709a', '#ff7a45', '#9a8fb8', '#4a3a2a', 0.5,  0.08, '#ff8a4a', 0.98],
  [20,   '#0f1a3c', '#2a2f5a', '#3a3355', '#4a5a90', '#1f1c26', 0.5,  0.12, '#9fb4ff', 1.1],
  [21.5, '#050a1a', '#0c1630', '#16213d', '#3a4f80', '#1a1a24', 0.55, 0.14, '#9fb4ff', 1.15],
  [24,   '#050a1a', '#0c1630', '#16213d', '#3a4f80', '#1a1a24', 0.55, 0.14, '#9fb4ff', 1.15],
].map((k) => [k[0], C(k[1]), C(k[2]), C(k[3]), C(k[4]), C(k[5]), k[6], k[7], C(k[8]), k[9]]);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const MOON_COLOR = C('#9fb4ff');
const SKY_REDRAW_STEP = 0.05;

function skyRng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawSky(gfx, top, mid, hor) {
  const ctx = gfx.skyCtx;
  const W = 512, H = 256;
  const night = gfx.night || 0;
  const hex = (c) => `#${c.getHexString()}`;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, hex(top));
  g.addColorStop(0.1, hex(top.clone().lerp(mid, 0.45)));
  g.addColorStop(0.2, hex(mid));
  g.addColorStop(0.3, hex(mid.clone().lerp(hor, 0.7)));
  g.addColorStop(0.38, hex(hor));
  g.addColorStop(1, hex(hor));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const rnd = skyRng(7);
  const lum = 0.3 * hor.r + 0.59 * hor.g + 0.11 * hor.b;
  const starAmt = Math.min(1, Math.max(0, (0.3 - lum) / 0.18));
  gfx.starAmt = starAmt;
  if (starAmt > 0.02) {
    ctx.globalAlpha = starAmt;
    for (let i = 0; i < 140; i++) {
      const y = rnd() * H * 0.3, b = 0.4 + rnd() * 0.6;
      ctx.fillStyle = `rgba(255,255,${220 + Math.floor(rnd() * 35)},${b})`;
      ctx.fillRect(Math.floor(rnd() * W), Math.floor(y), rnd() > 0.85 ? 2 : 1, 1);
    }
    const mg = ctx.createRadialGradient(390, 38, 2, 390, 38, 34);
    mg.addColorStop(0, 'rgba(240,244,255,0.5)');
    mg.addColorStop(1, 'rgba(240,244,255,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(350, 0, 80, 80);
    ctx.fillStyle = '#e8eeff';
    ctx.beginPath(); ctx.arc(390, 38, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hex(top);
    ctx.beginPath(); ctx.arc(394, 35, 8, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (night < 0.7) {
    const warm = hor.r > hor.b + 0.15;
    ctx.globalAlpha = 0.5 * (1 - night / 0.7);
    for (let i = 0; i < 14; i++) {
      const cx = rnd() * W, cy = 18 + rnd() * 52, w = 40 + rnd() * 70;
      for (let k = 0; k < 6; k++) {
        const px = cx + (rnd() - 0.5) * w, py = cy + (rnd() - 0.5) * 7;
        const cg = ctx.createRadialGradient(px, py, 1, px, py, 14 + rnd() * 12);
        cg.addColorStop(0, warm ? 'rgba(255,214,184,0.55)' : 'rgba(255,255,255,0.5)');
        cg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = cg;
        ctx.fillRect(px - 30, py - 20, 60, 40);
      }
    }
    ctx.globalAlpha = 1;
  }
  const hg = ctx.createLinearGradient(0, H * 0.2, 0, H * 0.5);
  hg.addColorStop(0, 'rgba(255,255,255,0)');
  hg.addColorStop(0.7, `rgba(${Math.round(hor.r * 255)},${Math.round(hor.g * 255)},${Math.round(hor.b * 255)},0.7)`);
  hg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, H * 0.2, W, H * 0.3);
  const sil = hor.clone().multiplyScalar(0.55 + 0.25 * (1 - night)).lerp(mid, 0.25);
  const base = H * 0.4;
  for (let layer = 0; layer < 2; layer++) {
    ctx.fillStyle = hex(layer ? sil : sil.clone().lerp(hor, 0.4));
    let x = 0;
    while (x < W) {
      const w = 8 + rnd() * 18, h = (layer ? 14 : 22) + rnd() * (layer ? 30 : 40);
      ctx.fillRect(x, base - h + layer * 6, w, h + 90);
      if (rnd() > 0.8) ctx.fillRect(x + w / 2 - 1, base - h - 8 + layer * 6, 2, 8);
      x += w + rnd() * 3;
    }
  }
  if (night > 0.3) {
    ctx.fillStyle = 'rgba(255,224,150,0.7)';
    for (let i = 0; i < 160; i++) ctx.fillRect(Math.floor(rnd() * W), base - 4 + Math.floor(rnd() * 30), 1, 1);
  }
  if (gfx.scene.background) gfx.scene.background.needsUpdate = true;
  if (gfx.skyMat) {
    const u = gfx.skyMat.uniforms;
    u.uTop.value.copy(top);
    u.uMid.value.copy(mid);
    u.uHor.value.copy(hor);
    u.uNight.value = night;
    u.uStarAmt.value = gfx.starAmt || 0;
    u.uSunDir.value.copy(gfx.skySunDir || SUN_DIR);
  }
}

const tmpA = C('#000'), tmpB = C('#000');
const mixed = { top: C('#000'), mid: C('#000'), hor: C('#000'), hemiSky: C('#000'), hemiGnd: C('#000'), sunC: C('#000') };
function updateDayNight(gfx) {
  const now = performance.now();
  if (!gfx.frozenHour) gfx.hour = (gfx.hour + ((now - gfx.lastClock) / 1000) * (24 / DAY_SECONDS)) % 24;
  gfx.lastClock = now;
  const h = gfx.hour;
  if (gfx.dayKey === h) return;
  gfx.dayKey = h;

  let i = 0;
  while (i < KEYS.length - 2 && h >= KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = (h - a[0]) / (b[0] - a[0]);
  const lerpC = (out, k) => out.copy(a[k]).lerp(b[k], t);
  const lerpN = (k) => a[k] + (b[k] - a[k]) * t;
  lerpC(mixed.top, 1); lerpC(mixed.mid, 2); lerpC(mixed.hor, 3);
  lerpC(mixed.hemiSky, 4); lerpC(mixed.hemiGnd, 5); lerpC(mixed.sunC, 8);

  const ang = ((h - 6) / 12) * Math.PI;
  const elev = Math.sin(ang);
  const isSun = elev >= 0;
  const e = Math.abs(elev);
  const dirX = isSun ? -Math.cos(ang) : Math.cos(ang);
  SUN_DIR.set(dirX * 760, Math.max(e, 0.1) * 760, -400);
  gfx.sun.color.copy(isSun ? mixed.sunC : MOON_COLOR);
  gfx.sun.intensity = isSun ? 3.4 * smooth(0, 0.3, e) : 0.55 * smooth(0, 0.3, e);

  // Moon: a second directional light that complements the sun at night. Only one casts
  // shadows at a time, so shadow cost stays at a single map.
  if (gfx.moon) {
    gfx.moon.color.copy(MOON_COLOR);
    gfx.moon.intensity = isSun ? 0 : 0.55 * smooth(0, 0.3, e);
    gfx.moon.castShadow = !isSun && !gfx.software;
    gfx.sun.castShadow = isSun && !gfx.software;
  }
  gfx.skySunDir = isSun ? SUN_DIR.clone().normalize() : MOON_DIR.clone().normalize();

  gfx.night = Math.min(1, Math.max(0, (0.12 - elev) / 0.3));
  gfx.hemi.color.copy(mixed.hemiSky);
  gfx.hemi.groundColor.copy(mixed.hemiGnd);
  gfx.hemi.intensity = lerpN(6);
  gfx.ambient.intensity = lerpN(7);
  gfx.renderer.toneMappingExposure = lerpN(9);
  gfx.scene.fog.color.copy(mixed.hor);
  // Exponential fog matched to the sky horizon colour; density rises at night.
  gfx.scene.fog.density = 0.00034 + 0.00028 * gfx.night;

  if (Math.abs(h - gfx.skyHour) >= SKY_REDRAW_STEP || gfx.frozenHour || gfx.skyHour < 0) {
    drawSky(gfx, mixed.top, mixed.mid, mixed.hor);
    gfx.skyHour = h;
  }

  gfx.base = {
    exp: gfx.renderer.toneMappingExposure, sun: gfx.sun.intensity, hemi: gfx.hemi.intensity,
    fog: gfx.scene.fog.color.clone(), fogDensity: gfx.scene.fog.density,
  };
  const n = gfx.night;
  for (const mat of gfx.buildingMats) mat.emissiveIntensity = gfx.windowBase * (1 + 3.6 * n);
  if (gfx.lampHead) {
    gfx.lampHead.material.color.setScalar(0.3 + 0.7 * n);
    gfx.lampPool.visible = n > 0.02;
    gfx.lampPool.material.opacity = 0.95 * n;
  }
}
const SUN_DIR = new THREE.Vector3();

const FACADE_SIZE = 512, FACADE_COLS = 8, FACADE_ROWS = 10;
const FACADE_REPEATS = [[2, 3], [3, 6], [4, 9]];

function makeFacadeTextures() {
  const cw = FACADE_SIZE / FACADE_COLS, rh = FACADE_SIZE / FACADE_ROWS;
  const mk = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = FACADE_SIZE;
    return [canvas, canvas.getContext('2d')];
  };
  const [fc, f] = mk();
  const [gc, g] = mk();
  f.fillStyle = '#c9c2b2';
  f.fillRect(0, 0, FACADE_SIZE, FACADE_SIZE);
  g.fillStyle = '#000';
  g.fillRect(0, 0, FACADE_SIZE, FACADE_SIZE);
  for (let row = 0; row < FACADE_ROWS; row++) {
    for (let col = 0; col < FACADE_COLS; col++) {
      const x = col * cw + 10, y = row * rh + 9, w = cw - 20, h = rh - 18;
      const lit = (row * 7 + col * 13 + row * col * 3) % 3 === 0;
      f.fillStyle = '#1d2733';
      f.fillRect(x - 4, y - 4, w + 8, h + 8);
      f.fillStyle = lit ? '#ffe0a0' : '#3f5670';
      f.fillRect(x, y, w, h);
      if (lit) { g.fillStyle = '#ffe0a0'; g.fillRect(x, y, w, h); }
      if (!lit && (row + col * 2) % 5 === 1) { f.fillStyle = '#c9556b'; f.fillRect(x, y, w * 0.4, h); }
      f.fillStyle = '#e8eef5';
      f.fillRect(x + w / 2 - 1, y, 2, h);
      f.fillRect(x, y + h / 2 - 1, w, 2);
      f.fillStyle = '#f4f1e8';
      f.fillRect(x - 6, y + h + 4, w + 12, 4);
      if ((row * 5 + col * 3) % 7 === 0) {
        const ax = x + w * 0.15, ay = y + h + 8, aw = w * 0.7, ah = rh * 0.2;
        f.fillStyle = '#aeb4b9'; f.fillRect(ax, ay, aw, ah);
        f.fillStyle = '#2a2f35';
        for (let k = 1; k < 4; k++) f.fillRect(ax + 3, ay + (ah * k) / 4, aw - 6, 2);
        f.fillRect(ax, ay + ah, aw, 2);
      }
      if (col === 5 && row % 2 === 0) {
        f.fillStyle = '#20252b';
        f.fillRect(col * cw + 2, y + h + 6, cw - 4, 5);
        f.fillRect(col * cw + 2, y + h - 16, cw - 4, 2);
        for (let k = 0; k < 5; k++) f.fillRect(col * cw + 4 + k * (cw - 8) / 4, y + h - 16, 2, 22);
        f.beginPath(); f.lineWidth = 3; f.strokeStyle = '#20252b';
        f.moveTo(col * cw + 8, y + h + 11); f.lineTo(col * cw + cw - 8, y + h + rh - 20); f.stroke();
      }
    }
    f.fillStyle = '#e8eef5';
    f.fillRect(0, Math.round(row * rh), FACADE_SIZE, 3);
    f.fillStyle = 'rgba(20,24,30,0.28)';
    f.fillRect(0, Math.round(row * rh) + 3, FACADE_SIZE, 3);
  }
  f.fillStyle = 'rgba(20,24,30,0.2)';
  for (let col = 0; col < FACADE_COLS; col++) f.fillRect(col * cw, 0, 3, FACADE_SIZE);
  const wrap = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  return { facade: wrap(fc), glow: wrap(gc) };
}

export function initRenderer(canvas, hudCanvas, world) {
  const probe = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
  const info = probe && probe.getExtension('WEBGL_debug_renderer_info');
  const names = probe ? [probe.getParameter(probe.RENDERER), info && probe.getParameter(info.UNMASKED_RENDERER_WEBGL)] : [];
  const software = /SwiftShader|Software/i.test(names.join(' '));

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !software });
  renderer.setPixelRatio(software ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(960, 540, false);
  renderer.shadowMap.enabled = !software;
  renderer.shadowMap.type = software ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  canvas.style.filter = 'contrast(1.40) saturate(1.22) brightness(1.02)';
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const sky = makeSkyDome(software);
  scene.background = sky.background;
  if (sky.dome) scene.add(sky.dome);
  scene.fog = new THREE.FogExp2(HORIZON, 0.00034);
  const hemi = new THREE.HemisphereLight(0x8fb4e8, 0x4a3a2a, 0.55);
  const ambient = new THREE.AmbientLight(0xffffff, 0.08);
  scene.add(hemi, ambient);

  const shadowSize = renderer.capabilities.isWebGL2 ? 2048 : 1024;
  const sun = new THREE.DirectionalLight(0xffc48a, 3.4);
  sun.position.copy(SUN_OFFSET);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = !software;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.8;
  fitShadowCamera(sun, SHADOW_HALF);
  scene.add(sun, sun.target);

  // A dedicated moon directional light so night scenes get a cool, soft fill with its own shadows.
  const moon = new THREE.DirectionalLight(MOON_COLOR, 0.0);
  moon.position.copy(MOON_DIR);
  moon.target.position.set(0, 0, 0);
  moon.castShadow = false;
  moon.shadow.mapSize.set(shadowSize, shadowSize);
  moon.shadow.bias = -0.0006;
  moon.shadow.normalBias = 0.8;
  fitShadowCamera(moon, SHADOW_HALF);
  scene.add(moon, moon.target);

  const camera = new THREE.PerspectiveCamera(60, 960 / 540, 2, 2400);
  const gfx = { renderer, scene, camera, sun, moon, software, shadowSize, frameNo: 0, hud: hudCanvas.getContext('2d'), carMesh: null, playerMesh: null, lightMesh: null, lightPhase: -1, skyMat: sky.mat || null };
  const hourParam = parseFloat(new URLSearchParams(location.search).get('hour'));
  const frozen = Number.isFinite(hourParam);
  Object.assign(gfx, {
    hemi, ambient, skyCtx: scene.background ? scene.background.image.getContext('2d') : null, skyHour: -1, dayKey: null,
    frozenHour: frozen, hour: frozen ? ((hourParam % 24) + 24) % 24 : START_HOUR, lastClock: performance.now(),
    night: 0, windowBase: software ? 0.35 : 0.6,
  });
  if (!software) setupBloom(gfx);
  buildWorldMeshes(gfx, world);
  buildCombatFx(gfx);
  gfx.buildingMats = [...gfx.buildingMeshes.map((m) => m.material), gfx.ghost.mesh.material];
  updateDayNight(gfx);
  gfx.metrics = () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles });
  return gfx;
}

// Fits a directional light's orthographic shadow camera to a fixed half-extent, so the shadow
// frustum tracks the player without wasting texel density on the whole city.
function fitShadowCamera(light, half) {
  light.shadow.camera.left = -half;
  light.shadow.camera.right = half;
  light.shadow.camera.top = half;
  light.shadow.camera.bottom = -half;
  light.shadow.camera.near = 40;
  light.shadow.camera.far = 2200;
  light.shadow.camera.updateProjectionMatrix();
}

// Re-fits the active shadow light so its camera follows the player and scales with camera distance.
function fitActiveShadow(gfx) {
  const light = gfx.sun.castShadow ? gfx.sun : gfx.moon;
  if (!light || !light.castShadow) return;
  const c = gfx.camera.position;
  const dist = Math.hypot(c.x, c.z);
  const half = Math.min(SHADOW_MAX, Math.max(SHADOW_MIN, dist + 320));
  const cam = light.shadow.camera;
  if (cam && Math.abs(cam.right - half) > 1) {
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.updateProjectionMatrix();
  }
  const dir = light === gfx.sun ? (gfx.sunDirOverride || SUN_DIR) : MOON_DIR;
  light.position.copy(dir).add(c);
  gfx.sun.target.position.set(c.x, 0, c.z);
  if (gfx.moon) gfx.moon.target.position.set(c.x, 0, c.z);
}

// ---------------------------------------------------------------- bloom
// A cheap additive bloom: render to a half-size target, keep only highlights, blur twice
// (low-res separable 9-tap Gaussian) and composite back over the scene. Uses the renderer's own
// final framebuffer via a full-screen triangle so no EffectComposer is needed.
const bloomVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`;

const brightFrag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  float m = smoothstep(uThreshold, uThreshold + 0.4, l);
  gl_FragColor = vec4(c * m, 1.0);
}`;

const blurFrag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uDir;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;
  float w = 0.227027;
  for (int i = 1; i <= 4; i++) {
    float wt = exp(-0.5 * float(i * i) / 2.25);
    vec2 o = uDir * uTexel * float(i);
    s += texture2D(tDiffuse, vUv + o).rgb * wt;
    s += texture2D(tDiffuse, vUv - o).rgb * wt;
    w += 2.0 * wt;
  }
  gl_FragColor = vec4(s / w, 1.0);
}`;

const compositeFrag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec3 base = texture2D(tDiffuse, vUv).rgb;
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  gl_FragColor = vec4(base + bloom * uStrength, 1.0);
}`;

function setupBloom(gfx) {
  const W = 960, H = 540;
  const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false };
  const sceneRT = new THREE.WebGLRenderTarget(W, H, { ...opts, type: THREE.HalfFloatType });
  // Match the renderer's output colour space so tone mapping + sRGB are applied into this buffer.
  sceneRT.texture.colorSpace = THREE.SRGBColorSpace;
  const half = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
  const brightRT = new THREE.WebGLRenderTarget(W / 2, H / 2, { ...half, type: THREE.HalfFloatType });
  const blurA = new THREE.WebGLRenderTarget(W / 2, H / 2, { ...half, type: THREE.HalfFloatType });
  const blurB = new THREE.WebGLRenderTarget(W / 2, H / 2, { ...half, type: THREE.HalfFloatType });

  const quadGeo = new THREE.BufferGeometry();
  quadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  quadGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

  const brightMat = new THREE.ShaderMaterial({ vertexShader: bloomVert, fragmentShader: brightFrag, depthTest: false, depthWrite: false, toneMapped: false, uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.85 } } });
  const blurMat = new THREE.ShaderMaterial({ vertexShader: bloomVert, fragmentShader: blurFrag, depthTest: false, depthWrite: false, toneMapped: false, uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uTexel: { value: new THREE.Vector2(1 / (W / 2), 1 / (H / 2)) } } });
  const compMat = new THREE.ShaderMaterial({ vertexShader: bloomVert, fragmentShader: compositeFrag, depthTest: false, depthWrite: false, toneMapped: false, uniforms: { tDiffuse: { value: null }, tBloom: { value: null }, uStrength: { value: 0.55 } } });
  compMat.outputColorSpace = THREE.SRGBColorSpace;

  const brightQuad = new THREE.Mesh(quadGeo, brightMat);
  brightQuad.frustumCulled = false;
  const blurQuad = new THREE.Mesh(quadGeo, blurMat);
  blurQuad.frustumCulled = false;
  const compQuad = new THREE.Mesh(quadGeo, compMat);
  compQuad.frustumCulled = false;

  const ppScene = new THREE.Scene();
  ppScene.add(compQuad, brightQuad, blurQuad);
  const ppCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  gfx.ppScene = ppScene;
  gfx.ppCamera = ppCamera;
  gfx.bloom = { sceneRT, brightRT, blurA, blurB, brightMat, blurMat, compMat, brightQuad, blurQuad, compQuad };
}

// Renders the scene into the bloom scene target, extracts and blurs highlights, and composites
// the result to the screen. Replaces the direct renderer.render() call for hardware renderers.
function renderBloom(gfx) {
  const b = gfx.bloom;
  const renderer = gfx.renderer;
  const renderScene = () => renderer.render(gfx.scene, gfx.camera);

  // 1. Scene -> sceneRT (tone mapped + sRGB).
  renderer.setRenderTarget(b.sceneRT);
  renderScene();

  // 2. Bright pass (half size).
  b.brightMat.uniforms.tDiffuse.value = b.sceneRT.texture;
  b.brightQuad.visible = true; b.blurQuad.visible = false; b.compQuad.visible = false;
  renderer.setRenderTarget(b.brightRT);
  renderer.render(gfx.ppScene, gfx.ppCamera);

  // 3. Horizontal blur.
  b.blurMat.uniforms.tDiffuse.value = b.brightRT.texture;
  b.blurMat.uniforms.uDir.value.set(1, 0);
  b.brightQuad.visible = false; b.blurQuad.visible = true; b.compQuad.visible = false;
  renderer.setRenderTarget(b.blurA);
  renderer.render(gfx.ppScene, gfx.ppCamera);

  // 4. Vertical blur.
  b.blurMat.uniforms.tDiffuse.value = b.blurA.texture;
  b.blurMat.uniforms.uDir.value.set(0, 1);
  renderer.setRenderTarget(b.blurB);
  renderer.render(gfx.ppScene, gfx.ppCamera);

  // 5. Composite to screen.
  b.compMat.uniforms.tDiffuse.value = b.sceneRT.texture;
  b.compMat.uniforms.tBloom.value = b.blurB.texture;
  b.brightQuad.visible = false; b.blurQuad.visible = false; b.compQuad.visible = true;
  renderer.setRenderTarget(null);
  renderer.render(gfx.ppScene, gfx.ppCamera);
}

const TRACER_N = 32, FLASH_N = 8, SPARK_N = 48;
const SHELL_N = 40, DEBRIS_N = 48, SMOKE_N = 64, FIREBALL_N = 6;
const fxTmp = new THREE.Color();
function buildCombatFx(gfx) {
  const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, vertexColors: true, fog: false };
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRACER_N * 6), 3).setUsage(THREE.DynamicDrawUsage));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRACER_N * 6), 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial(add));
  lines.frustumCulled = false; lines.renderOrder = 10;

  const quadIndex = (n) => { const idx = []; for (let i = 0; i < n; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3); return idx; };
  const makeQuads = (n) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 12), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 12), 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(quadIndex(n));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ ...add, side: THREE.DoubleSide }));
    m.frustumCulled = false; m.renderOrder = 11;
    return m;
  };
  const tracerQuads = makeQuads(TRACER_N), flashQuads = makeQuads(FLASH_N);

  const sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), SPARK_N);
  sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparkMesh.setColorAt(0, fxTmp.set('#ff8a1f'));
  sparkMesh.frustumCulled = false; sparkMesh.count = 0;

  // Shell casings: small bronze boxes that tumble as they fall.
  const shellMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 3, 1.4), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false, color: 0xc9a25a }), SHELL_N);
  shellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shellMesh.frustumCulled = false; shellMesh.count = 0;

  // Explosion debris: small dark chunks, some glowing.
  const debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), DEBRIS_N);
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debrisMesh.frustumCulled = false; debrisMesh.count = 0;

  // Smoke puffs: additive grey billows that rise and spread.
  const smokeMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, fog: false, color: 0x55585e }), SMOKE_N);
  smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  smokeMesh.frustumCulled = false; smokeMesh.count = 0;

  // Fireballs: additive orange glows (the smoke mesh is reused for a couple of large fire puffs).
  const fireMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }), FIREBALL_N);
  fireMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fireMesh.frustumCulled = false; fireMesh.count = 0;

  const lights = [];
  if (!gfx.software) {
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 160, 2);
      gfx.scene.add(l); lights.push(l);
    }
  }
  gfx.scene.add(lines, tracerQuads, flashQuads, sparkMesh, shellMesh, debrisMesh, smokeMesh, fireMesh);
  gfx.fx = { lines, tracerQuads, flashQuads, sparkMesh, shellMesh, debrisMesh, smokeMesh, fireMesh, lights };
}

const fxM = new THREE.Matrix4(), fxP = new THREE.Vector3(), fxQ = new THREE.Quaternion(), fxS = new THREE.Vector3(1, 1, 1);
const SPARK_COLORS = ['#ff8a1f', '#ff2a1a'];
function writeQuad(g, i, ax, ay, az, bx, by, bz, hw, r, gg, b) {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len * hw, nz = dx / len * hw;
  const p = g.attributes.position.array, col = g.attributes.color.array, o = i * 12;
  p.set([ax - nx, ay, az - nz, ax + nx, ay, az + nz, bx + nx, by, bz + nz, bx - nx, by, bz - nz], o);
  for (let k = 0; k < 4; k++) { col[o + k * 3] = r; col[o + k * 3 + 1] = gg; col[o + k * 3 + 2] = b; }
}

export function syncCombat(gfx, combat) {
  const fx = gfx.fx;
  if (!fx || !combat) return;
  const ox = WORLD_W / 2, oz = WORLD_H / 2;
  const lp = fx.lines.geometry.attributes.position.array, lc = fx.lines.geometry.attributes.color.array;
  const tg = fx.tracerQuads.geometry;
  combat.tracers.forEach((t, i) => {
    const a = t.t > 0 ? Math.min(1, t.t / t.max) * t.dim : 0;
    const [r, g, b] = t.color;
    lp.set([t.x0 - ox, t.z0, t.y0 - oz, t.x1 - ox, t.z1, t.y1 - oz], i * 6);
    lc.set([r * a, g * a, b * a, r * a, g * a, b * a], i * 6);
    writeQuad(tg, i, t.x0 - ox, t.z0, t.y0 - oz, t.x1 - ox, t.z1, t.y1 - oz, t.w * 0.5, r * a * 0.7, g * a * 0.7, b * a * 0.7);
  });
  fx.lines.geometry.attributes.position.needsUpdate = fx.lines.geometry.attributes.color.needsUpdate = true;
  tg.attributes.position.needsUpdate = tg.attributes.color.needsUpdate = true;

  const fg = fx.flashQuads.geometry;
  combat.flashes.forEach((f, i) => {
    const a = f.t > 0 ? Math.min(1, f.t / f.max) : 0;
    const [r, g, b] = f.color;
    const s = f.size * 0.5, c = Math.cos(f.angle), n = Math.sin(f.angle);
    const x = f.x - ox, z = f.y - oz, fy = f.z ?? 14;
    writeQuad(fg, i, x - c * s * 0.3, fy, z - n * s * 0.3, x + c * s, fy, z + n * s, s * 0.45, r * a, g * a, b * a);
  });
  fg.attributes.position.needsUpdate = fg.attributes.color.needsUpdate = true;

  let n = 0;
  for (const s of combat.sparks) {
    if (s.t <= 0) continue;
    fxP.set(s.x - ox, s.z, s.y - oz);
    fxM.compose(fxP, fxQ, fxS.setScalar(Math.min(1, s.t * 4)));
    fx.sparkMesh.setMatrixAt(n, fxM);
    fx.sparkMesh.setColorAt(n, fxTmp.set(SPARK_COLORS[s.hot]));
    n++;
  }
  fx.sparkMesh.count = n;
  fx.sparkMesh.instanceMatrix.needsUpdate = true;
  if (fx.sparkMesh.instanceColor) fx.sparkMesh.instanceColor.needsUpdate = true;

  // Shell casings
  const shellRot = new THREE.Quaternion(), shellSpin = new THREE.Quaternion(), shellX = new THREE.Vector3(0, 0, 1);
  let sn = 0;
  for (const s of combat.shells) {
    if (s.t <= 0) continue;
    fxP.set(s.x - ox, s.z, s.y - oz);
    shellRot.setFromAxisAngle(yAxis, -Math.atan2(s.vy, s.vx));
    shellRot.multiply(shellSpin.setFromAxisAngle(shellX, s.rot));
    fxM.compose(fxP, shellRot, fxS.set(1, 1, 1));
    fx.shellMesh.setMatrixAt(sn, fxM);
    sn++;
  }
  fx.shellMesh.count = sn;
  fx.shellMesh.instanceMatrix.needsUpdate = true;

  // Explosion debris
  let dn = 0;
  for (const d of combat.debris) {
    if (d.t <= 0) continue;
    fxP.set(d.x - ox, d.z, d.y - oz);
    fxM.compose(fxP, fxQ, fxS.setScalar(d.size));
    fx.debrisMesh.setMatrixAt(dn, fxM);
    fx.debrisMesh.setColorAt(dn, fxTmp.set(d.hot ? '#ff6a1f' : '#22262b'));
    dn++;
  }
  fx.debrisMesh.count = dn;
  fx.debrisMesh.instanceMatrix.needsUpdate = true;
  if (fx.debrisMesh.instanceColor) fx.debrisMesh.instanceColor.needsUpdate = true;

  // Smoke puffs
  let mn = 0;
  for (const s of combat.smoke) {
    if (s.t <= 0) continue;
    const life = Math.min(1, s.t / s.max);
    fxP.set(s.x - ox, s.z, s.y - oz);
    fxM.compose(fxP, fxQ, fxS.setScalar(s.size));
    fx.smokeMesh.setMatrixAt(mn, fxM);
    mn++;
  }
  fx.smokeMesh.count = mn;
  fx.smokeMesh.instanceMatrix.needsUpdate = true;

  // Fireballs
  let fn = 0;
  for (const f of combat.fireballs) {
    if (f.t <= 0) continue;
    const a = Math.min(1, f.t / f.max);
    fxP.set(f.x - ox, f.z, f.y - oz);
    fxM.compose(fxP, fxQ, fxS.setScalar(f.size * (0.6 + 0.5 * (1 - a))));
    fx.fireMesh.setMatrixAt(fn, fxM);
    fx.fireMesh.setColorAt(fn, fxTmp.setRGB(f.color[0], f.color[1] * a, f.color[2] * a * 0.5));
    fn++;
  }
  fx.fireMesh.count = fn;
  fx.fireMesh.instanceMatrix.needsUpdate = true;
  if (fx.fireMesh.instanceColor) fx.fireMesh.instanceColor.needsUpdate = true;

  fx.lights.forEach((l, i) => {
    const f = combat.flashes[(combat.flashCursor - 1 - i + FLASH_N * 8) % FLASH_N];
    const on = f && f.t > 0;
    l.intensity = on ? 900 * (f.t / f.max) : 0;
    if (on) { l.position.set(f.x - ox, (f.z ?? 20) + 4, f.y - oz); l.color.setRGB(f.color[0], f.color[1], f.color[2]); }
  });
}

export function makeGroundTexture(world, renderer, software = false) {
  const size = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(size / WORLD_W, size / WORLD_H);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = world.tiles[y * COLS + x];
      ctx.fillStyle = GROUND_COLORS[t];
      ctx.fillRect(x * TILE, y * TILE, TILE + 0.5, TILE + 0.5);
      if (t === T.SIDEWALK && (x + y) % 2 === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.04)';
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }

  ctx.fillStyle = '#f2c94c';
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (world.tiles[y * COLS + x] !== T.ROAD) continue;
      const vertical = x % 10 < 2 && y % 10 >= 2;
      const horizontal = y % 10 < 2 && x % 10 >= 2;
      if (vertical && x % 10 === 0 && y % 2 === 0) ctx.fillRect((x + 1) * TILE - 2, y * TILE + 4, 4, TILE - 8);
      if (horizontal && y % 10 === 0 && x % 2 === 0) ctx.fillRect(x * TILE + 4, (y + 1) * TILE - 2, TILE - 8, 4);
    }
  }

  if (software) {
    const sh = document.createElement('canvas');
    sh.width = sh.height = size;
    const sc = sh.getContext('2d');
    sc.scale(size / WORLD_W, size / WORLD_H);
    sc.fillStyle = '#000';
    const hs = Math.hypot(760, 540), k = hs / 460, ux = 760 / hs, uy = 540 / hs, ox = ux * 30, oy = uy * 30;
    for (const b of world.buildings) {
      const dx = ux * k * b.height, dy = uy * k * b.height;
      const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
      sc.fillRect(b.x, b.y, b.w, b.h);
      sc.fillRect(b.x + dx + ox, b.y + dy + oy, b.w, b.h);
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 4];
        sc.beginPath();
        sc.moveTo(ax, ay); sc.lineTo(bx, by); sc.lineTo(bx + dx + ox, by + dy + oy); sc.lineTo(ax + dx + ox, ay + dy + oy);
        sc.closePath(); sc.fill();
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.45;
    ctx.drawImage(sh, 0, 0);
    ctx.restore();
  }

  for (const p of world.parks) {
    ctx.fillStyle = '#7ab25a';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#e6d9a8';
    ctx.fillRect(p.x + p.w / 2 - 6, p.y, 12, p.h);
    ctx.fillRect(p.x, p.y + p.h / 2 - 6, p.w, 12);
    for (let i = 0; i < 6; i++) {
      const tx = p.x + 20 + ((i * 53) % (p.w - 40)), ty = p.y + 20 + ((i * 97) % (p.h - 40));
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.ellipse(tx + 4, ty + 6, 12, 8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#3f8f4a'; ctx.beginPath(); ctx.arc(tx, ty, 12, 0, 7); ctx.fill();
      ctx.fillStyle = '#58a85c'; ctx.beginPath(); ctx.arc(tx - 3, ty - 3, 7, 0, 7); ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

const GHOST_MAX = 8;
function makeBuildingMaterial(gfx, facade, glow, ghost) {
  const opts = { map: facade, emissiveMap: glow, emissive: 0xffffff, emissiveIntensity: gfx.software ? 0.35 : 0.6 };
  if (ghost) Object.assign(opts, { transparent: true, opacity: 0.22, depthWrite: false });
  const material = gfx.software
    ? new THREE.MeshLambertMaterial(opts)
    : new THREE.MeshStandardMaterial({ ...opts, roughness: 0.85, metalness: 0.0 });
  return material;
}

export function syncGhosts(gfx, ids) {
  const g = gfx.ghost;
  if (!g || !ids) return;
  const prev = g.ids;
  if (prev.length === ids.length && prev.every((v, i) => v === ids[i])) return;
  const touched = new Set();
  for (const i of prev) {
    const { mesh, local } = g.slot[i];
    mesh.instanceMatrix.array.set(g.orig.subarray(i * 16, i * 16 + 16), local * 16);
    touched.add(mesh);
  }
  ids.forEach((id, n) => {
    const { mesh, local } = g.slot[id];
    g.m.fromArray(g.orig, id * 16);
    g.mesh.setMatrixAt(n, g.m);
    g.mesh.setColorAt(n, g.c.set(g.colors[id]));
    mesh.instanceMatrix.array.fill(0, local * 16, local * 16 + 16);
    touched.add(mesh);
  });
  g.ids = ids.slice();
  g.mesh.count = ids.length;
  g.mesh.instanceMatrix.needsUpdate = true;
  if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
  for (const m of touched) m.instanceMatrix.needsUpdate = true;
}

export function buildWorldMeshes(gfx, world) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_W, WORLD_H),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture(world, gfx.renderer, gfx.software) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  gfx.ground = ground;
  gfx.scene.add(ground);

  const { facade, glow } = makeFacadeTextures();
  const matrix = new THREE.Matrix4(), color = new THREE.Color();
  const bucketOf = (h) => (h < 64 ? 0 : h <= 128 ? 1 : 2);
  const members = [[], [], []];
  world.buildings.forEach((b, i) => members[bucketOf(b.height)].push(i));
  const orig = new Float32Array(world.buildings.length * 16);
  const slot = new Array(world.buildings.length);
  gfx.buildingMeshes = members.map((ids, k) => {
    const [rx, ry] = FACADE_REPEATS[k];
    const map = facade.clone(), emissiveMap = glow.clone();
    for (const t of [map, emissiveMap]) { t.repeat.set(rx, ry); t.needsUpdate = true; }
    const material = makeBuildingMaterial(gfx, map, emissiveMap, false).clone();
    material.color.set(0xffffff);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, Math.max(1, ids.length));
    mesh.count = ids.length;
    ids.forEach((id, local) => {
      const b = world.buildings[id];
      matrix.compose(
        new THREE.Vector3(b.x + b.w / 2 - WORLD_W / 2, b.height / 2, b.y + b.h / 2 - WORLD_H / 2),
        new THREE.Quaternion(),
        new THREE.Vector3(b.w, b.height, b.h),
      );
      mesh.setMatrixAt(local, matrix);
      matrix.toArray(orig, id * 16);
      mesh.setColorAt(local, color.set(b.color));
      slot[id] = { mesh, local };
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = mesh.receiveShadow = true;
    gfx.scene.add(mesh);
    return mesh;
  });

  const ghostMat = makeBuildingMaterial(gfx, facade.clone(), glow, true);
  ghostMat.map.repeat.set(...FACADE_REPEATS[1]);
  ghostMat.map.needsUpdate = true;
  const ghostMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), ghostMat, GHOST_MAX);
  ghostMesh.count = 0;
  ghostMesh.frustumCulled = false;
  ghostMesh.renderOrder = 2;
  ghostMesh.setColorAt(0, color.set(0xffffff));
  gfx.scene.add(ghostMesh);
  gfx.ghost = { mesh: ghostMesh, ids: [], orig, slot, colors: world.buildings.map((b) => b.color), m: new THREE.Matrix4(), c: new THREE.Color() };

  const roofs = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshLambertMaterial(),
    world.buildings.length,
  );
  const roofRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  world.buildings.forEach((b, i) => {
    matrix.compose(
      new THREE.Vector3(b.x + b.w / 2 - WORLD_W / 2, b.height + 0.1, b.y + b.h / 2 - WORLD_H / 2),
      roofRot,
      new THREE.Vector3(b.w, b.h, 1),
    );
    roofs.setMatrixAt(i, matrix);
    roofs.setColorAt(i, color.set(b.color).multiplyScalar(ROOF_BOOST));
  });
  roofs.instanceMatrix.needsUpdate = true;
  roofs.instanceColor.needsUpdate = true;
  roofs.receiveShadow = true;
  gfx.scene.add(roofs);

  buildRoadMarkings(gfx);
  buildStreetDetail(gfx, world);

  const cars = new THREE.InstancedMesh(buildCarGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), MAX_CARS);
  cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cars.frustumCulled = false;
  cars.castShadow = cars.receiveShadow = true;
  gfx.scene.add(cars);
  gfx.carMesh = cars;

  const lights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(LIGHT_SIZE.length, LIGHT_SIZE.height, LIGHT_SIZE.width),
    new THREE.MeshBasicMaterial(),
    MAX_LIGHTS * 2,
  );
  lights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  lights.frustumCulled = false;
  lights.count = 0;
  gfx.scene.add(lights);
  gfx.lightMesh = lights;

  const playerMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(7, PLAYER_HEIGHT - 14, 4, 12),
    new THREE.MeshLambertMaterial({ color: 0x2b4a8b }),
  );
  playerMesh.castShadow = true;
  gfx.scene.add(playerMesh);
  gfx.playerMesh = playerMesh;

  const pedMesh = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(3.5, 9, 3, 8),
    new THREE.MeshLambertMaterial(),
    MAX_PEDS,
  );
  pedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pedMesh.frustumCulled = false;
  pedMesh.count = 0;
  gfx.scene.add(pedMesh);
  gfx.pedMesh = pedMesh;
  const umbrellas = new THREE.InstancedMesh(new THREE.ConeGeometry(9, 4, 10), new THREE.MeshLambertMaterial(), 40);
  umbrellas.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  umbrellas.frustumCulled = false;
  umbrellas.count = 0;
  umbrellas.setColorAt(0, new THREE.Color('#ffffff'));
  gfx.scene.add(umbrellas);
  gfx.umbrellaMesh = umbrellas;

  buildHeli(gfx);
  buildProps(gfx, world);
  buildMissionMarkers(gfx);
  buildWaterfront(gfx);
  buildLandmarks(gfx, world);
}

// ------------------------------------------------------------- waterfront
// Ocean, beach, pier and marina around the island edge. Everything is merged or
// instanced so this whole seam adds only a handful of draw calls, and it never
// touches the city tiles or gameplay logic (placed purely outside the grid).
const OCEAN_SIZE = 6800;
const OCEAN_Y = -4;
const BEACH_W = 104;
const PIER_CFG = { len: 336, width: 50, deck: 8, worldY: 2128 };
const BOAT_COLORS = ['#e8ecef', '#3a6ea5', '#c0392b', '#e0b23a', '#2f6f4f', '#8e5fb0'];

const oceanVert = `varying vec3 vWorldPos; varying vec3 vNormal; uniform float uTime;
void main() {
  vec3 p = position;
  float t = uTime;
  float w = sin(p.x * 0.02 + t * 0.7) * 1.5
          + sin(p.z * 0.024 + t * 0.5) * 1.1
          + sin((p.x + p.z) * 0.012 + t * 0.35) * 0.9;
  p.y += w;
  float dx = 0.02 * 1.5 * cos(p.x * 0.02 + t * 0.7) + 0.012 * 0.9 * cos((p.x + p.z) * 0.012 + t * 0.35);
  float dz = 0.024 * 1.1 * cos(p.z * 0.024 + t * 0.5) + 0.012 * 0.9 * cos((p.x + p.z) * 0.012 + t * 0.35);
  vNormal = normalize(vec3(-dx, 1.0, -dz));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const oceanFrag = `uniform float uTime; uniform vec3 uSunDir; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec2 uIslandHalf; uniform float uNight;
varying vec3 vWorldPos; varying vec3 vNormal;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDir);
  float lum = 0.5 + 0.5 * dot(N, L);
  vec3 col = mix(uShallow, uDeep, clamp(lum, 0.0, 1.0));
  vec3 R = reflect(-L, N);
  float spec = pow(max(dot(R, V), 0.0), 150.0);
  col += vec3(1.0, 1.0, 1.0) * spec * 1.6;
  vec2 q = vWorldPos.xz * 0.55;
  float g = hash21(floor(q + uTime * 2.0));
  col += vec3(1.0, 0.95, 0.85) * step(0.985, g) * 0.55 * smoothstep(3.0, 12.0, spec);
  float d = max(abs(vWorldPos.x) - uIslandHalf.x, abs(vWorldPos.z) - uIslandHalf.y);
  float shore = 1.0 - smoothstep(0.0, 260.0, d);
  col += vec3(1.0, 0.98, 0.90) * shore * 0.22 * (0.5 + 0.5 * sin(vWorldPos.x * 0.05 + vWorldPos.z * 0.05 + uTime * 1.5));
  col *= mix(vec3(0.45, 0.5, 0.65), vec3(1.0), 1.0 - uNight);
  gl_FragColor = vec4(col, 1.0);
}`;

function flatQuad(cx, cz, sx, sz) {
  const g = new THREE.PlaneGeometry(sx, sz);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, 0, cz);
  return g;
}

function buildPalmGeometry() {
  const parts = [{ geo: new THREE.CylinderGeometry(2.2, 4.0, 28, 7).translate(0, 14, 0), color: '#7a5c3e' }];
  for (let i = 0; i < 6; i++) {
    const fr = new THREE.ConeGeometry(4.5, 24, 4);
    fr.rotateZ(-0.85);
    fr.translate(0, 24, 0);
    fr.rotateY((i / 6) * Math.PI * 2 + 0.3);
    parts.push({ geo: fr, color: '#3f9a4a' });
  }
  for (let i = 0; i < 3; i++) {
    const fr = new THREE.ConeGeometry(3, 16, 4);
    fr.rotateZ(-0.3);
    fr.translate(0, 26, 0);
    fr.rotateY((i / 3) * Math.PI * 2 + 1.2);
    parts.push({ geo: fr, color: '#58b05a' });
  }
  return mergeColored(parts);
}

function buildBoatGeometry() {
  return mergeColored([
    { geo: new THREE.BoxGeometry(42, 6, 14).translate(0, 3, 0), color: '#ffffff' },
    { geo: new THREE.BoxGeometry(43, 1.5, 14.5).translate(0, 6.5, 0), color: '#ffffff' },
    { geo: new THREE.BoxGeometry(14, 7, 12).translate(6, 9.5, 0), color: '#35515a' },
    { geo: new THREE.BoxGeometry(14, 1.2, 12).translate(6, 13, 0), color: '#f0ede4' },
  ]);
}

function buildWaterfront(gfx) {
  // Ocean: one large animated plane below the island.
  const oceanGeo = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, 96, 96);
  oceanGeo.rotateX(-Math.PI / 2);
  const oceanMat = new THREE.ShaderMaterial({
    vertexShader: oceanVert,
    fragmentShader: oceanFrag,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: SUN_OFFSET.clone().normalize() },
      uDeep: { value: new THREE.Color('#1c4a6e') },
      uShallow: { value: new THREE.Color('#2f7fa6') },
      uIslandHalf: { value: new THREE.Vector2(WORLD_W / 2, WORLD_H / 2) },
      uNight: { value: 0 },
    },
  });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.position.y = OCEAN_Y;
  ocean.frustumCulled = false;
  gfx.scene.add(ocean);
  gfx.ocean = { mesh: ocean, mat: oceanMat };

  const m4 = new THREE.Matrix4(), p3 = new THREE.Vector3(), q4 = new THREE.Quaternion(), s3 = new THREE.Vector3(), c3 = new THREE.Color();
  const H = WORLD_W / 2;

  // Sand beach ring framing the island edge (just outside the city grid).
  const sandParts = [
    { geo: flatQuad(0, -H - BEACH_W / 2, WORLD_W, BEACH_W), color: '#e8d3a2' },
    { geo: flatQuad(0, H + BEACH_W / 2, WORLD_W, BEACH_W), color: '#e6d09c' },
    { geo: flatQuad(-H - BEACH_W / 2, 0, BEACH_W, WORLD_H), color: '#e8d3a2' },
    { geo: flatQuad(H + BEACH_W / 2, 0, BEACH_W, WORLD_H), color: '#e6d09c' },
    { geo: flatQuad(-H - BEACH_W / 2, -H - BEACH_W / 2, BEACH_W, BEACH_W), color: '#d6c087' },
    { geo: flatQuad(H + BEACH_W / 2, -H - BEACH_W / 2, BEACH_W, BEACH_W), color: '#d6c087' },
    { geo: flatQuad(-H - BEACH_W / 2, H + BEACH_W / 2, BEACH_W, BEACH_W), color: '#d6c087' },
    { geo: flatQuad(H + BEACH_W / 2, H + BEACH_W / 2, BEACH_W, BEACH_W), color: '#d6c087' },
  ];
  const sandMesh = new THREE.Mesh(mergeColored(sandParts), new THREE.MeshLambertMaterial({ vertexColors: true }));
  sandMesh.receiveShadow = true;
  gfx.scene.add(sandMesh);
  gfx.beach = sandMesh;

  // Palm trees sprinkled around the beach perimeter.
  const rand = makeRand(98);
  const palms = [];
  for (let i = 0; i < 54; i++) {
    const side = Math.floor(rand() * 4);
    const off = 8 + rand() * (BEACH_W - 18);
    if (side === 0) palms.push({ x: -H + rand() * WORLD_W, z: -H - off });
    else if (side === 1) palms.push({ x: -H + rand() * WORLD_W, z: H + off });
    else if (side === 2) palms.push({ x: -H - off, z: -H + rand() * WORLD_H });
    else palms.push({ x: H + off, z: -H + rand() * WORLD_H });
  }
  const palmMesh = new THREE.InstancedMesh(buildPalmGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), palms.length);
  palms.forEach((p, i) => {
    q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
    const sc = 0.85 + rand() * 0.5;
    m4.compose(p3.set(p.x, 0, p.z), q4, s3.set(sc, sc, sc));
    palmMesh.setMatrixAt(i, m4);
    palmMesh.setColorAt(i, c3.setScalar(0.9 + rand() * 0.25));
  });
  palmMesh.instanceMatrix.needsUpdate = true;
  if (palmMesh.instanceColor) palmMesh.instanceColor.needsUpdate = true;
  palmMesh.castShadow = true;
  palmMesh.frustumCulled = false;
  gfx.scene.add(palmMesh);
  gfx.palmMesh = palmMesh;

  // Beach umbrellas, clustered near the pier and scattered elsewhere.
  const pz0 = PIER_CFG.worldY - WORLD_H / 2;
  const umSpots = [];
  for (let i = 0; i < 16; i++) {
    if (i < 10) umSpots.push({ x: H + 22 + rand() * (BEACH_W - 44), z: pz0 + (rand() - 0.5) * 640 });
    else {
      const side = Math.floor(rand() * 4);
      if (side === 0) umSpots.push({ x: -H + rand() * WORLD_W, z: -H - 22 - rand() * (BEACH_W - 44) });
      else if (side === 1) umSpots.push({ x: -H + rand() * WORLD_W, z: H + 22 + rand() * (BEACH_W - 44) });
      else if (side === 2) umSpots.push({ x: -H - 22 - rand() * (BEACH_W - 44), z: -H + rand() * WORLD_H });
      else umSpots.push({ x: H + 22 + rand() * (BEACH_W - 44), z: -H + rand() * WORLD_H });
    }
  }
  const umbrellaGeo = mergeColored([
    { geo: new THREE.CylinderGeometry(1.4, 1.4, 30, 6).translate(0, 15, 0), color: '#e8e2d4' },
    { geo: new THREE.ConeGeometry(15, 11, 12).translate(0, 34, 0), color: '#ffffff' },
  ]);
  const umbrellaMesh = new THREE.InstancedMesh(umbrellaGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), umSpots.length);
  umSpots.forEach((u, i) => {
    const sc = 0.95 + rand() * 0.4;
    m4.compose(p3.set(u.x, 0, u.z), q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2), s3.set(sc, sc, sc));
    umbrellaMesh.setMatrixAt(i, m4);
    umbrellaMesh.setColorAt(i, c3.set(UMBRELLA_COLORS[i % UMBRELLA_COLORS.length]));
  });
  umbrellaMesh.instanceMatrix.needsUpdate = true;
  if (umbrellaMesh.instanceColor) umbrellaMesh.instanceColor.needsUpdate = true;
  umbrellaMesh.castShadow = true;
  umbrellaMesh.frustumCulled = false;
  gfx.scene.add(umbrellaMesh);
  gfx.beachUmbrellaMesh = umbrellaMesh;

  // Wooden pier on stilts, with railings and lamps, off the east edge.
  const px = H, pz = pz0, len = PIER_CFG.len, width = PIER_CFG.width, deckY = PIER_CFG.deck;
  const pierParts = [
    { geo: new THREE.BoxGeometry(len, 3, width).translate(px + len / 2, deckY, pz), color: '#b58a5a' },
    { geo: new THREE.BoxGeometry(len, 1, width + 2).translate(px + len / 2, deckY + 1.5, pz), color: '#c99a68' },
  ];
  const n = Math.floor(len / 48) + 1;
  const step = (len - 16) / (n - 1);
  for (let i = 0; i < n; i++) {
    const sx = px + 8 + i * step;
    for (const sz of [pz - width / 2 + 6, pz + width / 2 - 6]) pierParts.push({ geo: new THREE.CylinderGeometry(2.2, 2.4, 14, 6).translate(sx, 1.5, sz), color: '#5e4630' });
  }
  const railY = deckY + 3;
  const lampSpots = [];
  for (const side of [-1, 1]) {
    const sz = pz + side * (width / 2 - 3);
    for (let i = 0; i < n; i++) {
      const sx = px + 8 + i * step;
      pierParts.push({ geo: new THREE.BoxGeometry(2, 8, 2).translate(sx, railY + 3, sz), color: '#8a6a45' });
      lampSpots.push({ x: sx, z: sz });
    }
    pierParts.push({ geo: new THREE.BoxGeometry(len, 1.2, 1.6).translate(px + len / 2, railY + 7, sz), color: '#8a6a45' });
    pierParts.push({ geo: new THREE.BoxGeometry(len, 1, 1.2).translate(px + len / 2, railY + 3.5, sz), color: '#9a7a52' });
  }
  const pierMesh = new THREE.Mesh(mergeColored(pierParts), new THREE.MeshLambertMaterial({ vertexColors: true }));
  pierMesh.castShadow = pierMesh.receiveShadow = true;
  gfx.scene.add(pierMesh);
  gfx.pier = pierMesh;

  const lampGeo = new THREE.BoxGeometry(3.5, 4, 3.5);
  const lampMesh = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffe0a0, toneMapped: false, fog: false }), lampSpots.length);
  lampSpots.forEach((s, i) => {
    m4.compose(p3.set(s.x, railY + 9, s.z), q4.identity(), s3.set(1, 1, 1));
    lampMesh.setMatrixAt(i, m4);
    lampMesh.setColorAt(i, c3.set('#ffd9a0'));
  });
  lampMesh.instanceMatrix.needsUpdate = true;
  if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
  lampMesh.frustumCulled = false;
  gfx.scene.add(lampMesh);
  gfx.pierLamps = lampMesh;

  // Small marina: a floating dock and moored boats beside the pier.
  const dockX = H + 46, dockLen = 420, dockW = 26;
  const dockParts = [];
  for (const side of [-1, 1]) dockParts.push({ geo: new THREE.BoxGeometry(10, 3, dockLen).translate(dockX + side * (dockW / 2 - 5), -3, pz), color: '#3f6f8f' });
  dockParts.push({ geo: new THREE.BoxGeometry(dockW, 1.5, dockLen).translate(dockX, 0.5, pz), color: '#b58a5a' });
  for (const off of [-120, 0, 120]) dockParts.push({ geo: new THREE.BoxGeometry(40, 1.5, dockW).translate(dockX + 20, 0.5, pz + off), color: '#b58a5a' });
  const dockMesh = new THREE.Mesh(mergeColored(dockParts), new THREE.MeshLambertMaterial({ vertexColors: true }));
  dockMesh.castShadow = dockMesh.receiveShadow = true;
  gfx.scene.add(dockMesh);
  gfx.marina = dockMesh;

  const boatGeo = buildBoatGeometry();
  const boatSpots = [];
  for (const off of [-150, -60, 60, 150, -90, 90]) {
    const side = off < 0 ? -1 : 1;
    boatSpots.push({ x: dockX + 20 + side * 32, z: pz + off, a: side * Math.PI / 2 });
  }
  const boatMesh = new THREE.InstancedMesh(boatGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), boatSpots.length);
  boatSpots.forEach((b, i) => {
    m4.compose(p3.set(b.x, -1, b.z), q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.a), s3.set(1, 1, 1));
    boatMesh.setMatrixAt(i, m4);
    boatMesh.setColorAt(i, c3.set(BOAT_COLORS[i % BOAT_COLORS.length]));
  });
  boatMesh.instanceMatrix.needsUpdate = true;
  if (boatMesh.instanceColor) boatMesh.instanceColor.needsUpdate = true;
  boatMesh.castShadow = true;
  boatMesh.frustumCulled = false;
  gfx.scene.add(boatMesh);
  gfx.marinaBoats = boatMesh;
}

// ------------------------------------------------------------- landmarks
// A tall landmark tower with a lit crown (visible from anywhere on the island),
// richer downtown rooftop props (water tanks, AC condensers and antennas), and a
// flickering neon sign strip along one downtown street. Everything is merged or
// instanced so the seam costs only a handful of draw calls; it never touches tiles,
// lane points or gameplay, and it lives in the north-west part of downtown so the
// four ?shot= scenes keep their frames.
const TOWER_H = 620;
const CROWN_N = 12;
const CROWN_COLOR = '#ff2d95';
const NEON_STRIP_COLORS = ['#ff2d95', '#18e0ff', '#7dff6a', '#ffd23a', '#ff3ea5', '#9b5cff'];
const lmC = new THREE.Color();

function neonFlicker(t, phase) {
  const wave = Math.sin(t * 2.1 + phase) * 0.5 + 0.5;
  const buzz = Math.sin(t * 17.0 + phase * 5.3);
  const drip = buzz > 0.8 ? (buzz - 0.8) * 4.0 : 0.0;
  return Math.max(0, 0.72 + 0.28 * wave) * (1.0 + 0.25 * drip);
}

function buildTowerGeometry() {
  return mergeColored([
    { geo: new THREE.CylinderGeometry(12, 22, TOWER_H, 12).translate(0, TOWER_H / 2, 0), color: '#cfc9ba' },
    { geo: new THREE.CylinderGeometry(20, 20, 10, 12).translate(0, TOWER_H - 48, 0), color: '#b8b2a2' },
    { geo: new THREE.CylinderGeometry(17, 17, 12, 12).translate(0, TOWER_H - 12, 0), color: '#a9a396' },
    { geo: new THREE.CylinderGeometry(2.5, 5, 90, 8).translate(0, TOWER_H + 45, 0), color: '#9b958a' },
    { geo: new THREE.BoxGeometry(70, 10, 70).translate(0, 5, 0), color: '#8f8a80' },
    { geo: new THREE.BoxGeometry(3, 3, 3).translate(0, TOWER_H + 90, 0), color: '#ff3b30' },
  ]);
}

function buildWaterTankGeometry() {
  return mergeColored([
    { geo: new THREE.CylinderGeometry(7, 7, 14, 12).translate(0, 20, 0), color: '#9a6b46' },
    { geo: new THREE.CylinderGeometry(7.5, 7.5, 1.5, 12).translate(0, 27, 0), color: '#7d5438' },
    { geo: new THREE.ConeGeometry(8, 5, 12).translate(0, 30, 0), color: '#6e4830' },
    { geo: new THREE.CylinderGeometry(1, 1, 10, 6).translate(-5, 5, -5), color: '#3a2f27' },
    { geo: new THREE.CylinderGeometry(1, 1, 10, 6).translate(5, 5, -5), color: '#3a2f27' },
    { geo: new THREE.CylinderGeometry(1, 1, 10, 6).translate(-5, 5, 5), color: '#3a2f27' },
    { geo: new THREE.CylinderGeometry(1, 1, 10, 6).translate(5, 5, 5), color: '#3a2f27' },
  ]);
}

function buildAcGeometry() {
  return mergeColored([
    { geo: new THREE.BoxGeometry(11, 6, 8).translate(0, 3, 0), color: '#b8bec4' },
    { geo: new THREE.BoxGeometry(10, 5, 0.6).translate(0, 3, 4.1), color: '#7d858c' },
  ]);
}

function buildAntennaGeometry() {
  return mergeColored([
    { geo: new THREE.CylinderGeometry(0.8, 1.1, 46, 6).translate(0, 23, 0), color: '#2d3136' },
    { geo: new THREE.BoxGeometry(20, 0.5, 0.5).translate(0, 34, 0), color: '#2d3136' },
    { geo: new THREE.BoxGeometry(0.5, 0.5, 20).translate(0, 26, 0), color: '#2d3136' },
    { geo: new THREE.BoxGeometry(2, 2, 2).translate(0, 46, 0), color: '#ff3b30' },
  ]);
}

function buildLandmarks(gfx, world) {
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s3 = new THREE.Vector3();

  // Landmark tower in the park nearest the north-centre, so it rises above the skyline
  // and stays visible from anywhere on the island.
  const north = { x: WORLD_W / 2, y: WORLD_H * 0.3 };
  let park = null, best = Infinity;
  for (const p of world.parks) {
    const d = Math.hypot(p.x + p.w / 2 - north.x, p.y + p.h / 2 - north.y);
    if (d < best) { best = d; park = p; }
  }
  const tx = (park ? park.x + park.w / 2 : WORLD_W / 2) - WORLD_W / 2;
  const tz = (park ? park.y + park.h / 2 : WORLD_H * 0.3) - WORLD_H / 2;
  const tower = new THREE.Mesh(buildTowerGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  tower.position.set(tx, 0, tz);
  tower.castShadow = true;
  tower.frustumCulled = false;
  gfx.scene.add(tower);
  gfx.landmarkTower = tower;

  // Lit crown: a ring of emissive blocks around the deck, glowing at night.
  const crown = new THREE.InstancedMesh(
    new THREE.BoxGeometry(5, 6, 5),
    new THREE.MeshBasicMaterial({ toneMapped: false, fog: false, blending: THREE.AdditiveBlending, depthWrite: false }),
    CROWN_N,
  );
  for (let i = 0; i < CROWN_N; i++) {
    const a = (i / CROWN_N) * Math.PI * 2;
    q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    m4.compose(new THREE.Vector3(tx + Math.cos(a) * 18, TOWER_H - 8, tz + Math.sin(a) * 18), q4, s3.set(1, 1, 1));
    crown.setMatrixAt(i, m4);
  }
  crown.instanceMatrix.needsUpdate = true;
  crown.setColorAt(0, lmC.set(CROWN_COLOR));
  crown.instanceColor.needsUpdate = true;
  crown.frustumCulled = false;
  gfx.scene.add(crown);

  // Rooftop detail on downtown buildings: one water tank and a cluster of AC condensers
  // each, plus antennas on the taller towers, all as one InstancedMesh per prop kind.
  const rand = makeRand(711);
  const tanks = [], acs = [], ants = [];
  for (const b of world.buildings) {
    if (districtOfBlock(Math.floor(b.x / (10 * TILE)), Math.floor(b.y / (10 * TILE))) !== 0) continue;
    if (b.w < 48 || b.h < 48) continue;
    const cx = b.x + b.w / 2 - WORLD_W / 2, cz = b.y + b.h / 2 - WORLD_H / 2;
    const hx = b.w / 2 - 12, hz = b.h / 2 - 12;
    const spot = () => [cx + (rand() - 0.5) * 2 * hx, cz + (rand() - 0.5) * 2 * hz];
    let p = spot();
    tanks.push({ x: p[0], y: b.height, z: p[1], s: 0.85 + rand() * 0.5, r: rand() * Math.PI * 2 });
    const nAc = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < nAc; k++) { p = spot(); acs.push({ x: p[0], y: b.height + 2, z: p[1], s: 0.9 + rand() * 0.4, r: rand() * Math.PI * 2 }); }
    if (b.height >= 96) {
      const nA = 1 + Math.floor(rand() * 2);
      for (let k = 0; k < nA; k++) { p = spot(); ants.push({ x: p[0], y: b.height, z: p[1], s: 0.8 + rand() * 0.6 }); }
    }
  }
  const inst = (geo, data) => {
    if (!data.length) return;
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), data.length);
    data.forEach((d, i) => {
      q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.r);
      m4.compose(new THREE.Vector3(d.x, d.y, d.z), q4, s3.set(d.s, d.s, d.s));
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    gfx.scene.add(mesh);
  };
  inst(buildWaterTankGeometry(), tanks);
  inst(buildAcGeometry(), acs);
  inst(buildAntennaGeometry(), ants);

  // Neon sign strip along a downtown street: a dark mounting board behind a run of
  // glowing segments, each flickering independently once night falls.
  const roadX = 30 * TILE, z0 = 640, z1 = 1120;
  const back = new THREE.Mesh(new THREE.BoxGeometry(2, 10, z1 - z0), new THREE.MeshLambertMaterial({ color: 0x16181c }));
  back.position.set(roadX - TILE / 2 - WORLD_W / 2, 30, (z0 + z1) / 2 - WORLD_H / 2);
  gfx.scene.add(back);

  const segCount = Math.floor((z1 - z0) / 40);
  const neon = new THREE.InstancedMesh(
    new THREE.BoxGeometry(3, 7, 34),
    new THREE.MeshBasicMaterial({ toneMapped: false, fog: false, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    segCount,
  );
  const neonPhases = [];
  const nx = roadX - TILE / 2 - WORLD_W / 2;
  for (let i = 0; i < segCount; i++) {
    q4.identity();
    m4.compose(new THREE.Vector3(nx, 30, z0 + 20 + i * 40 - WORLD_H / 2), q4, s3.set(1, 1, 1));
    neon.setMatrixAt(i, m4);
    neonPhases.push(i * 1.31 + 0.7);
  }
  neon.instanceMatrix.needsUpdate = true;
  neon.setColorAt(0, lmC.set(NEON_STRIP_COLORS[0]));
  neon.instanceColor.needsUpdate = true;
  neon.frustumCulled = false;
  gfx.scene.add(neon);

  gfx.landmarks = { crown, neon, neonPhases };
}

function syncLandmarks(gfx) {
  const L = gfx.landmarks;
  if (!L) return;
  const t = performance.now() / 1000;
  const night = gfx.night || 0;
  if (L.crown) {
    for (let i = 0; i < CROWN_N; i++) {
      const pulse = 0.7 + 0.3 * Math.sin(t * 2.4 + i * 0.9);
      L.crown.setColorAt(i, lmC.set(CROWN_COLOR).multiplyScalar(night * pulse));
    }
    L.crown.instanceColor.needsUpdate = true;
  }
  if (L.neon) {
    const k = Math.min(1, night * 1.4);
    for (let i = 0; i < L.neon.count; i++) {
      L.neon.setColorAt(i, lmC.set(NEON_STRIP_COLORS[i % NEON_STRIP_COLORS.length]).multiplyScalar(k * neonFlicker(t, L.neonPhases[i])));
    }
    L.neon.instanceColor.needsUpdate = true;
  }
}

function syncOcean(gfx) {
  const o = gfx.ocean;
  if (!o) return;
  o.mat.uniforms.uTime.value = performance.now() / 1000;
  const d = gfx.sunDirOverride || gfx.skySunDir || SUN_DIR;
  if (d.lengthSq() > 1e-6) o.mat.uniforms.uSunDir.value.copy(d).normalize();
  o.mat.uniforms.uNight.value = gfx.night || 0;
}

function buildCarGeometry() {
  const wheel = (x, z) => ({ geo: new THREE.CylinderGeometry(4, 4, 4, 10).rotateX(Math.PI / 2).translate(x, -5, z), color: '#15171a' });
  return mergeColored([
    { geo: new THREE.BoxGeometry(56, 11, 22).translate(0, -3.5, 0), color: '#ffffff' },
    { geo: new THREE.BoxGeometry(28, 7, 18).translate(-4, 5.5, 0), color: '#ffffff' },
    { geo: new THREE.BoxGeometry(24, 4.4, 18.8).translate(-4, 6, 0), color: '#1c2a3a' },
    { geo: new THREE.BoxGeometry(0.8, 4, 17).translate(10.2, 5.8, 0), color: '#a9d6f2' },
    { geo: new THREE.BoxGeometry(0.8, 4, 17).translate(-18.4, 5.8, 0), color: '#a9d6f2' },
    { geo: new THREE.BoxGeometry(56.4, 1.6, 22.4).translate(0, -1.5, 0), color: '#2a2d33' },
    { geo: new THREE.BoxGeometry(30, 0.5, 4).translate(-4, 9.3, 0), color: '#15171a' },
    { geo: new THREE.BoxGeometry(50, 1.8, 22.6).translate(0, -2.2, 0), color: '#e23b2e' },
    { geo: new THREE.BoxGeometry(50, 0.5, 22.7).translate(0, 0.9, 0), color: '#101216' },
    { geo: new THREE.BoxGeometry(14, 0.5, 5).translate(18, 2.6, 0), color: '#15171a' },
    { geo: new THREE.BoxGeometry(0.8, 1.6, 19).translate(28.1, -5, 0), color: '#c9ced4' },
    { geo: new THREE.BoxGeometry(0.8, 1.6, 19).translate(-28.1, -5, 0), color: '#c9ced4' },
    { geo: new THREE.BoxGeometry(3, 1.4, 1).translate(5, 2.3, 11.2), color: '#101216' },
    { geo: new THREE.BoxGeometry(3, 1.4, 1).translate(5, 2.3, -11.2), color: '#101216' },
    wheel(17, 10), wheel(17, -10), wheel(-17, 10), wheel(-17, -10),
    { geo: new THREE.BoxGeometry(1.5, 3, 5).translate(28.2, -2, 7), color: '#fff2b0' },
    { geo: new THREE.BoxGeometry(1.5, 3, 5).translate(28.2, -2, -7), color: '#fff2b0' },
    { geo: new THREE.BoxGeometry(1.5, 3, 5).translate(-28.2, -2, 7), color: '#ff3030' },
    { geo: new THREE.BoxGeometry(1.5, 3, 5).translate(-28.2, -2, -7), color: '#ff3030' },
  ]);
}

const MARKER_MAX = 4, MARKER_RADIUS = 14, MARKER_HEIGHT = 120;
function buildMissionMarkers(gfx) {
  const pillar = new THREE.CylinderGeometry(MARKER_RADIUS, MARKER_RADIUS, MARKER_HEIGHT, 20, 1, true);
  pillar.translate(0, MARKER_HEIGHT / 2, 0);
  const ring = new THREE.RingGeometry(MARKER_RADIUS + 6, MARKER_RADIUS + 16, 32);
  ring.rotateX(-Math.PI / 2);
  ring.translate(0, 0.8, 0);
  const geo = mergeColored([{ geo: pillar, color: '#ffffff' }, { geo: ring, color: '#ffffff' }]);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.InstancedMesh(geo, mat, MARKER_MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.renderOrder = 5;
  gfx.scene.add(mesh);
  gfx.markerMesh = mesh;
}

const markerScale = new THREE.Vector3(1, 1, 1), markerQuat = new THREE.Quaternion();
function syncMarkers(gfx, missions) {
  const mesh = gfx.markerMesh;
  if (!mesh) return;
  const list = (missions && missions.markers) || [];
  const n = Math.min(list.length, MARKER_MAX);
  for (let i = 0; i < n; i++) {
    const k = list[i];
    carPosition.set(k.x - WORLD_W / 2, 0, k.y - WORLD_H / 2);
    markerScale.set(k.scale, 1, k.scale);
    carMatrix.compose(carPosition, markerQuat, markerScale);
    mesh.setMatrixAt(i, carMatrix);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
}

function buildHeli(gfx) {
  const group = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b2a44 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(44, 14, 16), dark);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(30, 5, 5), dark);
  tail.position.x = -34;
  const rotor = new THREE.Group();
  rotor.position.y = 10;
  const bladeMaterial = new THREE.MeshLambertMaterial({ color: 0x222222 });
  for (const turn of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(90, 1.5, 5), bladeMaterial);
    blade.rotation.y = turn;
    rotor.add(blade);
  }
  group.add(body, tail, rotor);
  group.traverse((o) => { if (o.isMesh) o.castShadow = !gfx.software; });
  group.visible = false;
  gfx.scene.add(group);

  const spot = new THREE.Mesh(
    new THREE.CircleGeometry(HELI_SPOT_RADIUS, 40),
    new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  spot.rotation.x = -Math.PI / 2;
  spot.position.y = 2.5;
  spot.visible = false;
  gfx.scene.add(spot);
  gfx.heli = { group, rotor, spot };
}

function syncHeli(gfx, world) {
  const heli = world.police && world.police.heli;
  const view = gfx.heli;
  if (!view) return;
  view.group.visible = view.spot.visible = !!heli;
  if (!heli) return;
  view.group.position.set(heli.x - WORLD_W / 2, heli.z, heli.y - WORLD_H / 2);
  view.group.rotation.y = -heli.angle;
  view.rotor.rotation.y = heli.rotor;
  view.spot.position.x = heli.x - WORLD_W / 2;
  view.spot.position.z = heli.y - WORLD_H / 2;
}

function makeRand(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mergeColored(parts) {
  const pos = [], nor = [], col = [];
  for (const { geo, color } of parts) {
    const g = geo.toNonIndexed();
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    const c = new THREE.Color(color);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return merged;
}

const PROP_CAR_COLORS = ['#e4572e', '#f3a712', '#29a3a3', '#4f86f7', '#e86a92', '#7bc950', '#f5d547', '#a06cd5', '#d9d9de', '#33363d'];
const LAMP_COLORS = { red: '#ff2a2a', yellow: '#ffc400', green: '#22e06a' };
const LIGHT_PERIOD = 6;
const POLE_HEIGHT = 40;
const INTERSECTIONS = [2, 3, 4, 5].flatMap((i) => [2, 3, 4].map((j) => [i, j]));

function buildProps(gfx, world) {
  const rand = makeRand(7);
  const strips = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (world.tiles[y * COLS + x] !== T.SIDEWALK) continue;
      const mx = x % 10, my = y % 10;
      const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
      if ((my === 2 || my === 9) && mx >= 3 && mx <= 8) strips.push({ cx, cy, horiz: true, road: my === 2 ? -1 : 1 });
      else if ((mx === 2 || mx === 9) && my >= 3 && my <= 8) strips.push({ cx, cy, horiz: false, road: mx === 2 ? -1 : 1 });
    }
  }
  for (let i = strips.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [strips[i], strips[j]] = [strips[j], strips[i]];
  }
  const spot = (s, perp, along = 0) => ({
    x: s.horiz ? s.cx + along : s.cx + s.road * perp,
    y: s.horiz ? s.cy + s.road * perp : s.cy + along,
    angle: s.horiz ? 0 : Math.PI / 2,
  });

  const blobs = [];
  const m4 = new THREE.Matrix4(), p3 = new THREE.Vector3(), q4 = new THREE.Quaternion(), s3 = new THREE.Vector3(), c3 = new THREE.Color();
  const place = (mesh, i, x, y, z, sx, sy, sz, yaw, color) => {
    q4.setFromAxisAngle(yAxis, -yaw);
    m4.compose(p3.set(x - WORLD_W / 2, y, z - WORLD_H / 2), q4, s3.set(sx, sy, sz));
    mesh.setMatrixAt(i, m4);
    if (color) mesh.setColorAt(i, c3.set(color));
  };

  const trees = [];
  for (let i = 0; i < 280; i++) {
    const s = strips.pop();
    const p = spot(s, 0, (rand() - 0.5) * 12);
    trees.push({ x: p.x, y: p.y, scale: 0.8 + rand() * 0.45, tint: 0.85 + rand() * 0.3 });
  }
  for (let i = 0, tries = 0; i < 40 && world.parks.length && tries < 400; tries++) {
    const park = world.parks[Math.floor(rand() * world.parks.length)];
    const x = park.x + 16 + rand() * (park.w - 32), y = park.y + 16 + rand() * (park.h - 32);
    if (Math.abs(x - (park.x + park.w / 2)) < 14 || Math.abs(y - (park.y + park.h / 2)) < 14) continue;
    trees.push({ x, y, scale: 0.9 + rand() * 0.5, tint: 0.85 + rand() * 0.3 });
    i++;
  }
  const treeMesh = new THREE.InstancedMesh(
    mergeColored([
      { geo: new THREE.BoxGeometry(5, 14, 5).translate(0, 7, 0), color: '#6b4a2b' },
      { geo: new THREE.ConeGeometry(12, 22, 8).translate(0, 22, 0), color: '#2f7d3c' },
      { geo: new THREE.ConeGeometry(8, 18, 8).translate(0, 36, 0), color: '#3f9a4a' },
    ]),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    trees.length,
  );
  trees.forEach((t, i) => {
    place(treeMesh, i, t.x, 0, t.y, t.scale, t.scale, t.scale, rand() * 6.28, c3.setScalar(t.tint));
    blobs.push({ x: t.x, y: t.y, sx: 11 * t.scale, sy: 11 * t.scale, angle: 0 });
  });
  treeMesh.frustumCulled = false;
  gfx.scene.add(treeMesh);

  const boxes = [], cyls = [];
  for (let i = 0; i < 220; i++) {
    const s = strips.pop(), p = spot(s, 12, (rand() - 0.5) * 10);
    boxes.push({ x: p.x, y: POLE_HEIGHT / 2, z: p.y, sx: 2, sy: POLE_HEIGHT, sz: 2, yaw: 0, color: '#3b3f45' });
    cyls.push({ x: p.x + (s.horiz ? 0 : s.road * 4), y: POLE_HEIGHT + 1, z: p.y + (s.horiz ? s.road * 4 : 0), sx: 3.5, sy: 2.5, sz: 3.5, color: '#fff2b0' });
  }
  const BENCH_COLORS = ['#8a5a33', '#5b7f3a', '#3f5f8f', '#a8483a'];
  for (let i = 0; i < 80; i++) {
    const s = strips.pop(), p = spot(s, -8, (rand() - 0.5) * 8);
    boxes.push({ x: p.x, y: 4, z: p.y, sx: 16, sy: 8, sz: 5, yaw: p.angle, color: BENCH_COLORS[i % 4] });
  }
  const HYDRANT_COLORS = ['#e0262b', '#f3c613', '#2b7de0'];
  for (let i = 0; i < 70; i++) {
    const s = strips.pop(), p = spot(s, 11, (rand() - 0.5) * 10);
    cyls.push({ x: p.x, y: 5, z: p.y, sx: 3.5, sy: 10, sz: 3.5, color: HYDRANT_COLORS[i % 3] });
  }
  const BIN_COLORS = ['#2f6f4f', '#3a3f48', '#4a6fa5', '#8a8f96'];
  for (let i = 0; i < 60; i++) {
    const s = strips.pop(), p = spot(s, -10, (rand() - 0.5) * 12);
    boxes.push({ x: p.x, y: 6, z: p.y, sx: 8, sy: 12, sz: 8, yaw: 0, color: BIN_COLORS[i % 4] });
  }
  const PLANTER_COLORS = ['#b5651d', '#8c8173', '#6f7f8f', '#c98b4a'];
  for (let i = 0; i < 40; i++) {
    const s = strips.pop(), p = spot(s, 9, (rand() - 0.5) * 12);
    boxes.push({ x: p.x, y: 5, z: p.y, sx: s.horiz ? 20 : 8, sy: 10, sz: s.horiz ? 8 : 20, yaw: 0, color: PLANTER_COLORS[i % 4] });
    boxes.push({ x: p.x, y: 11, z: p.y, sx: s.horiz ? 16 : 5, sy: 4, sz: s.horiz ? 5 : 16, yaw: 0, color: '#3f9a4a' });
  }
  for (let i = 0; i < 50; i++) {
    const s = strips.pop(), p = spot(s, 13, (rand() - 0.5) * 8);
    boxes.push({ x: p.x, y: 25, z: p.y, sx: 2.5, sy: 50, sz: 2.5, yaw: 0, color: '#5a4630' });
    boxes.push({ x: p.x, y: 46, z: p.y, sx: s.horiz ? 20 : 2, sy: 2, sz: s.horiz ? 2 : 20, yaw: 0, color: '#5a4630' });
  }
  const NEON_COLORS = ['#ff2d95', '#18e0ff', '#ffe03a'];
  const signs = [];
  for (let i = 0; i < 30; i++) {
    const s = strips.pop(), p = spot(s, -13, (rand() - 0.5) * 8);
    signs.push({ x: p.x, y: 22 + rand() * 8, z: p.y, yaw: p.angle, color: NEON_COLORS[i % 3] });
  }
  const signMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(18, 8), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), signs.length);
  signs.forEach((n, i) => place(signMesh, i, n.x, n.y, n.z, 1, 1, 1, n.yaw, n.color));
  signMesh.frustumCulled = false;
  signMesh.instanceMatrix.needsUpdate = true;
  signMesh.instanceColor.needsUpdate = true;
  gfx.scene.add(signMesh);
  for (let i = 0; i < 24; i++) {
    const s = strips.pop(), p = spot(s, -6, 0);
    boxes.push({ x: p.x, y: 13, z: p.y, sx: s.horiz ? 30 : 10, sy: 26, sz: s.horiz ? 10 : 30, yaw: 0, color: '#4b8fb5' });
  }
  for (let i = 0; i < 80; i++) {
    const s = strips.pop(), p = spot(s, 5, 0);
    boxes.push({ x: p.x, y: CAR_SIZE.height / 2 + 2, z: p.y, sx: CAR_SIZE.length, sy: CAR_SIZE.height, sz: CAR_SIZE.width, yaw: p.angle, color: PROP_CAR_COLORS[Math.floor(rand() * PROP_CAR_COLORS.length)] });
    blobs.push({ x: p.x, y: p.y, sx: 32, sy: 15, angle: p.angle });
  }

  const lampBase = cyls.length;
  const poleSpots = [];
  for (const [i, j] of INTERSECTIONS) {
    const ix = i * 10 * TILE, iy = j * 10 * TILE;
    poleSpots.push([ix + 70, iy - 6, 'h'], [ix - 6, iy + 70, 'v']);
  }
  poleSpots.forEach(([x, y, axis], k) => {
    boxes.push({ x, y: POLE_HEIGHT / 2, z: y, sx: 2.5, sy: POLE_HEIGHT, sz: 2.5, yaw: 0, color: '#23262b' });
    [38, 33, 28].forEach((h) => cyls.push({ x, y: h, z: y, sx: 3, sy: 4.5, sz: 3, color: '#ffffff' }));
    poleSpots[k] = { x, y, axis };
  });

  const lamps = poleSpots.map((p) => ({ x: p.x, z: p.y, h: POLE_HEIGHT }));
  for (let i = 0; i < 70 && strips.length; i++) {
    const s = strips.pop(), p = spot(s, 11, (rand() - 0.5) * 10);
    boxes.push({ x: p.x, y: 20, z: p.y, sx: 2, sy: 40, sz: 2, yaw: 0, color: '#23262b' });
    lamps.push({ x: p.x, z: p.y, h: 40 });
  }
  {
    const headGeo = new THREE.BoxGeometry(1, 1, 1);
    const head = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0x4d4a40, toneMapped: false, fog: false }), lamps.length);
    const pool = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      lamps.length,
    );
    const POOL_COLORS = ['#ffb050', '#6fd0ff', '#ff6fb0', '#ffd48a'];
    lamps.forEach((l, i) => {
      m4.compose(p3.set(l.x - WORLD_W / 2, l.h + 1, l.z - WORLD_H / 2), q4.identity(), s3.set(7, 2.5, 7));
      head.setMatrixAt(i, m4);
      m4.compose(p3.set(l.x - WORLD_W / 2, 0.35, l.z - WORLD_H / 2), blobFlat, s3.set(60, 60, 1));
      pool.setMatrixAt(i, m4);
      pool.setColorAt(i, c3.set(POOL_COLORS[i % 4]).multiplyScalar(1.4));
    });
    head.frustumCulled = pool.frustumCulled = false;
    pool.renderOrder = 1;
    pool.visible = false;
    gfx.scene.add(head, pool);
    gfx.lampHead = head;
    gfx.lampPool = pool;
  }

  for (let i = 0; i < 90; i++) {
    const road = Math.floor(rand() * 8) * 320;
    const lane = rand() < 0.5 ? 16 : 48;
    const horiz = rand() < 0.5;
    const a = Math.floor(rand() * 8) * 320 + 80 + rand() * 220;
    cyls.push({ x: horiz ? a : road + lane, y: 0.45, z: horiz ? road + lane : a, sx: 5, sy: 0.4, sz: 5, color: '#3a3d42' });
  }
  const BUS_GLASS = '#9fd3e8';
  for (let i = 0; i < 16 && strips.length; i++) {
    const s = strips.pop(), p = spot(s, 4, 0);
    const w = s.horiz ? 26 : 8, d = s.horiz ? 8 : 26;
    boxes.push({ x: p.x, y: 19, z: p.y, sx: w + 2, sy: 1.6, sz: d + 2, yaw: 0, color: '#d94a3a' });
    boxes.push({ x: p.x - (s.horiz ? 0 : s.road * 3.5), y: 9, z: p.y - (s.horiz ? s.road * 3.5 : 0), sx: s.horiz ? w : 0.8, sy: 16, sz: s.horiz ? 0.8 : d, yaw: 0, color: BUS_GLASS });
    for (const t of [-1, 1]) boxes.push({ x: p.x + (s.horiz ? t * (w / 2) : 0), y: 9, z: p.y + (s.horiz ? 0 : t * (d / 2)), sx: 1.2, sy: 18, sz: 1.2, yaw: 0, color: '#2a2d33' });
    boxes.push({ x: p.x, y: 4, z: p.y, sx: s.horiz ? w - 6 : 3, sy: 1.5, sz: s.horiz ? 3 : d - 6, yaw: 0, color: '#6b4a2b' });
  }
  const cables = [];
  for (let i = 0; i < 44; i++) {
    const horizontal = i % 2 === 0;
    const r = 1 + Math.floor(rand() * 7);
    const q = Math.floor(rand() * 8) * 320 + 90 + rand() * 200;
    const e0 = r * 320 - 16, e1 = r * 320 + 80;
    const pt = (t, y) => (horizontal ? [q, y, e0 + (e1 - e0) * t] : [e0 + (e1 - e0) * t, y, q]);
    for (const e of [e0, e1]) {
      const px = horizontal ? q : e, pz = horizontal ? e : q;
      boxes.push({ x: px, y: 25, z: pz, sx: 2.5, sy: 50, sz: 2.5, yaw: 0, color: '#4a3a2a' });
      boxes.push({ x: px, y: 47, z: pz, sx: horizontal ? 12 : 2, sy: 2, sz: horizontal ? 2 : 12, yaw: 0, color: '#4a3a2a' });
    }
    for (const off of [-4, 0, 4]) {
      for (let k = 0; k < 8; k++) {
        const t0 = k / 8, t1 = (k + 1) / 8;
        const sag = (t) => 46 - 7 * 4 * t * (1 - t);
        const a = pt(t0, sag(t0)), b = pt(t1, sag(t1));
        a[horizontal ? 0 : 2] += off; b[horizontal ? 0 : 2] += off;
        cables.push(a[0] - WORLD_W / 2, a[1], a[2] - WORLD_H / 2, b[0] - WORLD_W / 2, b[1], b[2] - WORLD_H / 2);
      }
    }
  }
  const cableGeo = new THREE.BufferGeometry();
  cableGeo.setAttribute('position', new THREE.Float32BufferAttribute(cables, 3));
  const cableMesh = new THREE.LineSegments(cableGeo, new THREE.LineBasicMaterial({ color: 0x14161a }));
  cableMesh.frustumCulled = false;
  gfx.scene.add(cableMesh);

  const boxMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), boxes.length);
  boxes.forEach((b, i) => place(boxMesh, i, b.x, b.y, b.z, b.sx, b.sy, b.sz, b.yaw, b.color));
  const cylMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10), new THREE.MeshBasicMaterial(), cyls.length);
  cyls.forEach((c, i) => place(cylMesh, i, c.x, c.y, c.z, c.sx, c.sy, c.sz, 0, c.color));
  treeMesh.castShadow = boxMesh.castShadow = true;
  for (const mesh of [boxMesh, cylMesh]) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    gfx.scene.add(mesh);
  }
  gfx.traffic = { mesh: cylMesh, base: lampBase, poles: poleSpots, key: -1 };

  if (gfx.software) {
    const blobMesh = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      blobs.length + MAX_CARS + 1,
    );
    blobMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    blobMesh.frustumCulled = false;
    blobMesh.renderOrder = 1;
    blobs.forEach((b, i) => setBlob(blobMesh, i, b.x, b.y, b.sx, b.sy, b.angle));
    blobMesh.count = blobs.length;
    gfx.scene.add(blobMesh);
    gfx.blobMesh = blobMesh;
    gfx.blobStatic = blobs.length;
  }
}

const blobFlat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const blobQuat = new THREE.Quaternion(), blobPos = new THREE.Vector3(), blobScale = new THREE.Vector3(), blobMatrix = new THREE.Matrix4();
function setBlob(mesh, i, x, y, sx, sy, angle) {
  blobQuat.setFromAxisAngle(yAxis, -angle).multiply(blobFlat);
  blobMatrix.compose(blobPos.set(x - WORLD_W / 2, 0.08, y - WORLD_H / 2), blobQuat, blobScale.set(sx, sy, 1));
  mesh.setMatrixAt(i, blobMatrix);
}

function lightState(time, axis) {
  const greenAxis = Math.floor(time / LIGHT_PERIOD) % 2 === 0 ? 'h' : 'v';
  if (greenAxis !== axis) return 2;
  return time % LIGHT_PERIOD > LIGHT_PERIOD - 1 ? 1 : 0;
}

const lampColor = new THREE.Color();
function syncTrafficLights(gfx, world) {
  const t = gfx.traffic;
  if (!t) return;
  const key = lightState(world.time, 'h') * 3 + lightState(world.time, 'v');
  if (key === t.key) return;
  t.key = key;
  const names = ['red', 'yellow', 'green'];
  t.poles.forEach((pole, k) => {
    const state = lightState(world.time, pole.axis);
    const lit = state === 0 ? 2 : state === 1 ? 1 : 0;
    names.forEach((name, n) => {
      lampColor.set(LAMP_COLORS[name]).multiplyScalar(n === lit ? 1 : 0.12);
      t.mesh.setColorAt(t.base + k * 3 + n, lampColor);
    });
  });
  t.mesh.instanceColor.needsUpdate = true;
}

function makeSignAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const g = canvas.getContext('2d');
  const cell = 256;
  const shops = [
    ['SUNNY MART', '#ffd23a', '#c8102e'], ['TACOS', '#ff7a1a', '#2b0f00'], ['24/7', '#18e0ff', '#06283a'], ['NEON CLUB', '#ff2d95', '#1a0620'],
    ['PIZZA', '#ffffff', '#b3261e'], ['DINER', '#fff0a0', '#0b4f8a'], ['BAR', '#7dff6a', '#10200c'], ['HOTEL', '#ffe9c0', '#4a1f6b'],
    ['PHARMACY', '#ffffff', '#0a8a4a'], ['SUSHI', '#ff9ab8', '#220c18'], ['VICE CAFE', '#2affd5', '#101030'], ['BURGERS', '#ffd23a', '#7a1010'],
  ];
  const boards = [
    ['GTA VI', '#ff3ea5', '#150a2e'], ['VICE CITY', '#18e0ff', '#2a0a3a'], ['SUNNY CITY', '#ffe03a', '#102a5a'], ['LIVE NOW', '#ffffff', '#c8102e'],
  ];
  const all = [...shops, ...boards];
  all.forEach(([text, fg, bg], i) => {
    const x = (i % 4) * cell, y = Math.floor(i / 4) * cell;
    g.fillStyle = bg; g.fillRect(x, y, cell, cell);
    g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(x + 8, y + 8, cell - 16, cell - 16);
    g.lineWidth = 2; g.strokeRect(x + 22, y + 22, cell - 44, cell - 44);
    let size = 70;
    g.font = `bold ${size}px sans-serif`;
    while (g.measureText(text).width > cell - 56 && size > 20) { size -= 4; g.font = `bold ${size}px sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = fg; g.shadowBlur = 14;
    g.fillStyle = fg;
    g.fillText(text, x + cell / 2, y + cell / 2);
    g.shadowBlur = 0;
  });
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildStreetDetail(gfx, world) {
  const items = [];
  const BLOCKS = COLS / 10, P = 10 * TILE;
  const SIDE = [
    { edge: (b) => b.x, ok: (b) => (b.x / TILE) % 10 === 3, nx: -1, nz: 0, len: (b) => b.h, cx: (b) => b.x, cz: (b) => b.y + b.h / 2 },
    { edge: (b) => b.x + b.w, ok: (b) => ((b.x + b.w) / TILE) % 10 === 9, nx: 1, nz: 0, len: (b) => b.h, cx: (b) => b.x + b.w, cz: (b) => b.y + b.h / 2 },
    { ok: (b) => (b.y / TILE) % 10 === 3, nx: 0, nz: -1, len: (b) => b.w, cx: (b) => b.x + b.w / 2, cz: (b) => b.y },
    { ok: (b) => ((b.y + b.h) / TILE) % 10 === 9, nx: 0, nz: 1, len: (b) => b.w, cx: (b) => b.x + b.w / 2, cz: (b) => b.y + b.h },
  ];
  const rand = makeRand(31);
  const cyls = [];
  const atlas = makeSignAtlas();
  const sp = [], su = [], si = [];
  const SHOP_CELLS = 12;
  const addQuad = (cx, cy, cz, nx, nz, w, h, cell) => {
    const rx = nz, rz = -nx;
    const col = cell % 4, row = Math.floor(cell / 4);
    const u0 = col / 4, u1 = (col + 1) / 4, v0 = 1 - (row + 1) / 4, v1 = 1 - row / 4;
    const base = sp.length / 3;
    const hw = w / 2, hh = h / 2;
    sp.push(cx - rx * hw, cy - hh, cz - rz * hw, cx + rx * hw, cy - hh, cz + rz * hw, cx + rx * hw, cy + hh, cz + rz * hw, cx - rx * hw, cy + hh, cz - rz * hw);
    su.push(u0, v0, u1, v0, u1, v1, u0, v1);
    si.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const ROOF_COLORS = ['#8a8f96', '#6f7378', '#a39a8c', '#5e656d'];
  const AWN = ['#c0392b', '#2e7d6b', '#d9a21b', '#3a62b3', '#8e44ad'];
  let sideNo = 0;
  for (const b of world.buildings) {
    for (const s of SIDE) {
      if (!s.ok(b)) continue;
      sideNo++;
      const L = s.len(b) - 8;
      const wx = s.cx(b) - WORLD_W / 2, wz = s.cz(b) - WORLD_H / 2;
      const S = { wx, wz, nx: s.nx, nz: s.nz, rx: s.nz, rz: -s.nx };
      const alongX = s.nz !== 0;
      const side = (t, off, y, a, u, d, color, rot) => items.push({ x: wx + S.rx * t + S.nx * off, y, z: wz + S.rz * t + S.nz * off, sx: alongX ? a : d, sy: u, sz: alongX ? d : a, color, rot });
      side(0, 0.6, 11, L, 18, 1.2, '#3b536b');
      const awn = AWN[Math.floor(b.x / TILE + b.y / TILE) % AWN.length];
      const segs = Math.max(1, Math.floor(L / 8));
      for (let k = 0; k < segs; k++) side(-L / 2 + (k + 0.5) * (L / segs), 3.5, 23, L / segs, 3, 7, k % 2 ? '#f2efe6' : awn);
      side(0, 7.2, 21, L, 1.2, 0.8, '#2a2d33');
      const shop = Math.floor(rand() * SHOP_CELLS);
      const st = (rand() - 0.5) * Math.max(0, L - 30);
      addQuad(wx + S.rx * st + S.nx * 2.2, 12.5, wz + S.rz * st + S.nz * 2.2, S.nx, S.nz, 24, 12, shop);
      side(st, 1.6, 12.5, 25.6, 13.6, 0.8, '#15171b');
      const floors = Math.round(b.height / 32);
      for (let f = 1; f < floors; f++) {
        for (let k = 0; k < 2; k++) {
          if (rand() < 0.45) continue;
          const t = (rand() - 0.5) * (L - 8);
          side(t, 2.5, f * 32 + 14, 7, 5, 5, '#c8ccd0');
          side(t, 5.2, f * 32 + 14, 5, 3.6, 0.8, '#2f343a');
        }
      }
      if (floors >= 2 && rand() < 0.7) {
        const t = (rand() - 0.5) * (L - 30);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(S.rx, 0, S.rz), 0.38);
        for (let f = 1; f <= floors - 1; f++) {
          side(t, 6, f * 32, 16, 1, 11, '#2a2f35');
          side(t, 11.5, f * 32 + 3.5, 16, 7, 0.6, '#3a4048');
          if (f < floors - 1) side(t + 5, 6, f * 32 + 16, 3, 33, 1, '#2a2f35', q);
        }
        side(t - 7.5, 11, (floors * 32) / 2, 1, floors * 32 - 4, 1, '#2a2f35');
        side(t + 7.5, 11, (floors * 32) / 2, 1, floors * 32 - 4, 1, '#2a2f35');
      }
    }
    const cx = b.x + b.w / 2 - WORLD_W / 2, cz = b.y + b.h / 2 - WORLD_H / 2, H = b.height;
    const hx = Math.max(4, b.w / 2 - 10), hz = Math.max(4, b.h / 2 - 10);
    const rp = () => [cx + (rand() - 0.5) * 2 * hx, cz + (rand() - 0.5) * 2 * hz];
    const nAc = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < nAc; k++) {
      const [x, z] = rp();
      const w = 7 + rand() * 7, d = 6 + rand() * 6;
      items.push({ x, y: H + 3, z, sx: w, sy: 6, sz: d, color: ROOF_COLORS[Math.floor(rand() * 4)] });
      items.push({ x, y: H + 6.3, z, sx: w - 3, sy: 0.8, sz: d - 3, color: '#2c3036' });
    }
    if (rand() < 0.55) {
      const [x, z] = rp();
      items.push({ x, y: H + 5, z, sx: 13, sy: 10, sz: 13, color: ROOF_COLORS[Math.floor(rand() * 4)] });
      items.push({ x, y: H + 10.4, z, sx: 14, sy: 1, sz: 14, color: '#3a3f46' });
    }
    if (H >= 64 && rand() < 0.6) {
      const [x, z] = rp();
      for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) items.push({ x: x + dx, y: H + 6, z: z + dz, sx: 1, sy: 12, sz: 1, color: '#3a2f27' });
      cyls.push({ x, y: H + 18, z, r: 7.5, h: 12, color: '#8a5a3a' });
      cyls.push({ x, y: H + 25, z, r: 3, h: 3, color: '#4a3a2e' });
    }
    if (rand() < 0.65) {
      const [x, z] = rp();
      const ah = 20 + rand() * 20;
      items.push({ x, y: H + ah / 2, z, sx: 1, sy: ah, sz: 1, color: '#2d3136' });
      items.push({ x, y: H + ah * 0.8, z, sx: 10, sy: 0.8, sz: 0.8, color: '#2d3136' });
      items.push({ x, y: H + ah * 0.62, z, sx: 0.8, sy: 0.8, sz: 14, color: '#2d3136' });
      items.push({ x, y: H + ah + 1, z, sx: 1.8, sy: 1.8, sz: 1.8, color: '#ff3b30' });
    }
  }

  const bigOnes = world.buildings.filter((b) => b.height >= 128 && b.w >= 64 && b.h >= 64);
  for (let i = bigOnes.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [bigOnes[i], bigOnes[j]] = [bigOnes[j], bigOnes[i]];
  }
  bigOnes.slice(0, 6).forEach((b, i) => {
    const cx = b.x + b.w / 2 - WORLD_W / 2, cz = b.y + b.h / 2 - WORLD_H / 2, H = b.height;
    const sz = cz > 0 ? -1 : 1, sx = cx > 0 ? -1 : 1;
    const panels = [
      { x: cx - 24, z: cz, nx: 0, nz: -sz },
      { x: cx + 24, z: cz, nx: sx, nz: 0 },
    ];
    panels.forEach((p, k) => {
      const cell = SHOP_CELLS + ((i * 2 + k) % 4);
      addQuad(p.x + p.nx * 1.4, H + 38, p.z + p.nz * 1.4, p.nx, p.nz, 64, 32, cell);
      const along = p.nx === 0;
      items.push({ x: p.x, y: H + 38, z: p.z, sx: along ? 67 : 2, sy: 35, sz: along ? 2 : 67, color: '#1b1d22' });
      for (const t of [-22, 22]) items.push({ x: p.x + (along ? t : 0), y: H + 10, z: p.z + (along ? 0 : t), sx: 2.5, sy: 20, sz: 2.5, color: '#2a2d33' });
      items.push({ x: p.x - p.nx * 3, y: H + 56, z: p.z - p.nz * 3, sx: along ? 60 : 2, sy: 2, sz: along ? 2 : 60, color: '#ffe9a8' });
    });
  });

  const signGeo = new THREE.BufferGeometry();
  signGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  signGeo.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
  signGeo.setIndex(si);
  const signMat = new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false });
  const signMesh = new THREE.Mesh(signGeo, signMat);
  signMesh.frustumCulled = false;
  gfx.scene.add(signMesh);
  gfx.signMat = signMat;

  const detail = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  const v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  items.forEach((it, i) => {
    detail.setMatrixAt(i, m.compose(v3.set(it.x, it.y, it.z), it.rot || q, s3.set(it.sx, it.sy, it.sz)));
    detail.setColorAt(i, c.set(it.color));
  });
  detail.instanceMatrix.needsUpdate = detail.instanceColor.needsUpdate = true;
  detail.frustumCulled = false;
  gfx.scene.add(detail);

  const tanks = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12), new THREE.MeshLambertMaterial(), cyls.length);
  cyls.forEach((cy, i) => {
    tanks.setMatrixAt(i, m.compose(v3.set(cy.x, cy.y, cy.z), q, s3.set(cy.r, cy.h, cy.r)));
    tanks.setColorAt(i, c.set(cy.color));
  });
  tanks.instanceMatrix.needsUpdate = tanks.instanceColor.needsUpdate = true;
  tanks.frustumCulled = false;
  gfx.scene.add(tanks);

  const kerbs = [];
  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      const x0 = i * P + 2 * TILE, y0 = j * P + 2 * TILE, span = 8 * TILE;
      const cx = x0 + span / 2 - WORLD_W / 2, cz = y0 + span / 2 - WORLD_H / 2;
      kerbs.push([cx, y0 + 1.5 - WORLD_H / 2, span, 3], [cx, y0 + span - 1.5 - WORLD_H / 2, span, 3]);
      kerbs.push([x0 + 1.5 - WORLD_W / 2, cz, 3, span], [x0 + span - 1.5 - WORLD_W / 2, cz, 3, span]);
    }
  }
  const kerbMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 3, 1), new THREE.MeshLambertMaterial({ color: 0xcfc8b8 }), kerbs.length);
  kerbs.forEach(([x, z, w, d], i) => kerbMesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, 1.5, z), q, new THREE.Vector3(w, 1, d))));
  kerbMesh.instanceMatrix.needsUpdate = true;
  kerbMesh.frustumCulled = false;
  gfx.scene.add(kerbMesh);
}

function buildRoadMarkings(gfx) {
  const marks = [];
  const BLOCKS = COLS / 10, PERIOD_U = 10 * TILE, ROAD_U = 2 * TILE;
  const add = (cx, cz, w, d) => marks.push([cx - WORLD_W / 2, cz - WORLD_H / 2, w, d]);
  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      const ix = i * PERIOD_U, iy = j * PERIOD_U;
      for (let s = 0; s < 6; s++) {
        const o = 6 + s * 10;
        add(ix + o, iy - 6, 5, 10);
        add(ix + o, iy + ROAD_U + 6, 5, 10);
        add(ix - 6, iy + o, 10, 5);
        add(ix + ROAD_U + 6, iy + o, 10, 5);
      }
    }
    for (let k = 0; k < BLOCKS; k++) {
      const a = k * PERIOD_U + 2 * TILE;
      const len = 6 * TILE + 3 * TILE;
      add(a + len / 2, i * PERIOD_U + 4, len, 1.5);
      add(a + len / 2, i * PERIOD_U + ROAD_U - 4, len, 1.5);
      add(i * PERIOD_U + 4, a + len / 2, 1.5, len);
      add(i * PERIOD_U + ROAD_U - 4, a + len / 2, 1.5, len);
      for (let d = 8; d < 256; d += 32) {
        add(a + d + 8, i * PERIOD_U + ROAD_U / 2, 16, 1.8);
        add(i * PERIOD_U + ROAD_U / 2, a + d + 8, 1.8, 16);
      }
    }
  }
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    marks.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  marks.forEach(([x, z, w, d], i) => {
    m.compose(new THREE.Vector3(x, 0.25, z), q, new THREE.Vector3(w, d, 1));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  gfx.scene.add(mesh);
}

const carMatrix = new THREE.Matrix4();
const carPosition = new THREE.Vector3();
const carQuaternion = new THREE.Quaternion();
const carScale = new THREE.Vector3(1, 1, 1);
const yAxis = new THREE.Vector3(0, 1, 0);
const carColor = new THREE.Color();

const RED = new THREE.Color('#ff2a2a'), BLUE = new THREE.Color('#2a5aff');
const lightOffset = new THREE.Vector3();

function syncPoliceLights(gfx, world) {
  const phase = Math.floor(world.time * LIGHT_HZ * 2) % 2;
  const cops = world.cars.filter((car) => car.driver === 'cop').slice(0, MAX_LIGHTS);
  const signature = cops.length * 2 + phase;
  const moving = cops.some((car) => car.speed !== 0);
  if (!moving && signature === gfx.lightSignature && gfx.lightPhase === phase) return;
  gfx.lightSignature = signature;
  gfx.lightPhase = phase;
  carScale.set(1, 1, 1);
  cops.forEach((car, i) => {
    carQuaternion.setFromAxisAngle(yAxis, -car.angle);
    [-1, 1].forEach((side, s) => {
      lightOffset.set(0, CAR_SIZE.height / 2 + 2, side * 6).applyQuaternion(carQuaternion);
      carPosition.set(car.x - WORLD_W / 2, CAR_SIZE.height / 2 + 2, car.y - WORLD_H / 2).add(lightOffset);
      carMatrix.compose(carPosition, carQuaternion, carScale);
      gfx.lightMesh.setMatrixAt(i * 2 + s, carMatrix);
      const lit = (s + phase) % 2 === 0;
      const base = side < 0 ? RED : BLUE;
      gfx.lightMesh.setColorAt(i * 2 + s, carColor.copy(base).multiplyScalar(lit ? 1 : 0.15));
    });
  });
  gfx.lightMesh.count = cops.length * 2;
  gfx.lightMesh.instanceMatrix.needsUpdate = true;
  if (gfx.lightMesh.instanceColor) gfx.lightMesh.instanceColor.needsUpdate = true;
}

const HEAD_COLOR = new THREE.Color('#fff2c4').multiplyScalar(1.6), TAIL_COLOR = new THREE.Color('#ff1a1a');
const OFF_COLOR = new THREE.Color('#000000');
function syncCarLights(gfx, world) {
  if (!gfx.carLamps) {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.5, 3, 5),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      MAX_CARS * 4,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    gfx.scene.add(mesh);
    gfx.carLamps = mesh;
  }
  const mesh = gfx.carLamps;
  if (gfx.night < 0.15) { mesh.count = 0; return; }
  const count = Math.min(world.cars.length, MAX_CARS);
  const half = CAR_SIZE.length / 2 - 1, y = CAR_SIZE.height / 2 + 1;
  carScale.set(1, 1, 1);
  world.cars.forEach((car, i) => {
    if (i >= MAX_CARS) return;
    carQuaternion.setFromAxisAngle(yAxis, -car.angle);
    const braking = Math.abs(car.speed) < 8 || car.braking;
    for (let k = 0; k < 4; k++) {
      const front = k < 2, side = k % 2 ? 1 : -1;
      lightOffset.set(front ? half : -half, 0, side * 7).applyQuaternion(carQuaternion);
      carPosition.set(car.x - WORLD_W / 2, y, car.y - WORLD_H / 2).add(lightOffset);
      carMatrix.compose(carPosition, carQuaternion, carScale);
      mesh.setMatrixAt(i * 4 + k, carMatrix);
      mesh.setColorAt(i * 4 + k, front ? HEAD_COLOR : carColor.copy(TAIL_COLOR).multiplyScalar(braking ? 1.5 : 0.7));
    }
  });
  mesh.count = count * 4;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function syncActors(gfx, world, player) {
  const count = Math.min(world.cars.length, MAX_CARS);
  world.cars.forEach((car, i) => {
    if (i >= MAX_CARS) return;
    carPosition.set(car.x - WORLD_W / 2, CAR_SIZE.height / 2 + 2, car.y - WORLD_H / 2);
    carQuaternion.setFromAxisAngle(yAxis, -car.angle);
    // Visible damage: a battered car squashes slightly and smokes (smoke driven in combat),
    // with a darker, scorched paint job as its hp drops.
    const hp = car.hp ?? 100;
    const dmg = Math.max(0, Math.min(1, 1 - hp / 100));
    const squash = 1 - dmg * 0.1;
    carScale.set(squash, 1 - dmg * 0.18, 1 + dmg * 0.08);
    carMatrix.compose(carPosition, carQuaternion, carScale);
    gfx.carMesh.setMatrixAt(i, carMatrix);
    gfx.carMesh.setColorAt(i, carColor.set(car.color).multiplyScalar(1 - dmg * 0.45));
  });
  gfx.carMesh.count = count;
  gfx.carMesh.instanceMatrix.needsUpdate = true;
  if (gfx.carMesh.instanceColor) gfx.carMesh.instanceColor.needsUpdate = true;

  syncPoliceLights(gfx, world);
  syncHeli(gfx, world);
  syncTrafficLights(gfx, world);

  gfx.playerMesh.visible = !player.car;
  gfx.playerMesh.position.set(player.x - WORLD_W / 2, PLAYER_HEIGHT / 2, player.y - WORLD_H / 2);
  gfx.playerMesh.rotation.y = -player.facing;

  if (gfx.blobMesh) {
    let n = gfx.blobStatic;
    for (let i = 0; i < count; i++) {
      const car = world.cars[i];
      setBlob(gfx.blobMesh, n++, car.x, car.y, CAR_SIZE.length * 0.62, CAR_SIZE.width * 0.75, car.angle);
    }
    if (!player.car) setBlob(gfx.blobMesh, n++, player.x, player.y, 9, 9, 0);
    gfx.blobMesh.count = n;
    gfx.blobMesh.instanceMatrix.needsUpdate = true;
  }
}

const pedScale = new THREE.Vector3(1, 1, 1);
const pedTilt = new THREE.Quaternion(), pedTiltX = new THREE.Vector3(1, 0, 0);
const PED_TINT_C = PED_TINTS.map((c) => new THREE.Color(c));
function syncPeds(gfx, player, peds) {
  const mesh = gfx.pedMesh;
  if (!mesh || !peds) return;
  const focus = player.car || player;
  let n = 0;
  for (let i = 0; i < peds.length && n < MAX_PEDS; i++) {
    const p = peds[i];
    if (Math.hypot(p.x - focus.x, p.y - focus.y) > PED_DRAW_RADIUS) continue;
    const cower = p.state === 'COWER';
    const down = p.state === 'DOWN';
    const sc = p.scale || 1;
    const tall = 0.8 + ((i * 37) % 11) / 11 * 0.6;
    // Fold a downed ped so its capsule lies almost flat, like a ragdoll fallen over.
    const fold = down ? (p.fold || 0) : 0;
    pedScale.set(sc, sc * tall * (cower ? 0.6 : 1) * (down ? 0.22 : 1), sc);
    carPosition.set(p.x - WORLD_W / 2, (PED_HEIGHT * pedScale.y) / 2 + 1, p.y - WORLD_H / 2);
    carQuaternion.setFromAxisAngle(yAxis, -p.angle);
    if (down && fold > 0) carQuaternion.multiply(pedTilt.setFromAxisAngle(pedTiltX, -fold * 1.2));
    carMatrix.compose(carPosition, carQuaternion, pedScale);
    mesh.setMatrixAt(n, carMatrix);
    mesh.setColorAt(n, carColor.set(PED_SHIRTS[(p.shirt ?? i) % PED_SHIRTS.length]).multiply(PED_TINT_C[(i * 3) % PED_TINTS.length]));
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  const um = gfx.umbrellaMesh;
  let u = 0;
  for (let i = 0; i < n && u < um.instanceMatrix.count; i++) {
    if (i % 4 !== 1) continue;
    mesh.getMatrixAt(i, carMatrix);
    carMatrix.decompose(carPosition, carQuaternion, pedScale);
    carPosition.y += PED_HEIGHT * pedScale.y * 0.5 + 6;
    pedScale.set(1, 1, 1);
    um.setMatrixAt(u, carMatrix.compose(carPosition, carQuaternion, pedScale));
    um.setColorAt(u, carColor.set(UMBRELLA_COLORS[i % 5]));
    u++;
  }
  um.count = u;
  um.instanceMatrix.needsUpdate = true;
  if (um.instanceColor) um.instanceColor.needsUpdate = true;
}

export function renderFrame(gfx, world, player, fps, police, peds, missions, combat) {
  syncActors(gfx, world, player);
  syncPeds(gfx, player, peds);
  syncMarkers(gfx, missions);
  syncCombat(gfx, combat);
  syncGhosts(gfx, gfx.camera.userData.ghost);
  if (combat) combat.applyShake(gfx.camera);
  const actor = player.car || player;
  const tx = actor.x - WORLD_W / 2, tz = actor.y - WORLD_H / 2;
  gfx.sun.target.position.set(tx, 0, tz);
  if (gfx.moon) gfx.moon.target.position.set(tx, 0, tz);
  updateDayNight(gfx);
  syncOcean(gfx);
  syncLandmarks(gfx);
  gfx.sun.position.set(tx, 0, tz).add(gfx.sunDirOverride || SUN_DIR);
  if (gfx.moon) gfx.moon.position.set(tx, 0, tz).add(MOON_DIR);
  fitActiveShadow(gfx);
  syncCarLights(gfx, world);
  if (gfx.beforeDraw) gfx.beforeDraw();
  if (gfx.interiorBefore) gfx.interiorBefore();
  if (gfx.hemi.intensity < 0.40) gfx.hemi.intensity = 0.40;
  if (gfx.ambient.intensity < 0.14) gfx.ambient.intensity = 0.14;
  if (gfx.frameNo++ % 2 === 0) gfx.renderer.shadowMap.needsUpdate = true;
  if (gfx.bloom) renderBloom(gfx); else gfx.renderer.render(gfx.scene, gfx.camera);
  if (gfx.interiorAfter) gfx.interiorAfter();
  if (combat) combat.clearShake(gfx.camera);
  drawHud(gfx.hud, world, player, fps, police, missions, gfx.camera, combat);
}

const hudProj = new THREE.Vector3();
function drawCombatHud(ctx, p, camera, combat) {
  if (combat.vignette > 0) {
    const a = Math.min(1, combat.vignette / 0.35) * 0.22;
    const g = ctx.createRadialGradient(480, 270, 180, 480, 270, 620);
    g.addColorStop(0, 'rgba(220,0,0,0)');
    g.addColorStop(1, `rgba(220,0,0,${a.toFixed(3)})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 960, 540);
  }
  if (combat.bustProgress > 0 && camera) {
    const f = p.car || p;
    hudProj.set(f.x - WORLD_W / 2, 20, f.y - WORLD_H / 2).project(camera);
    const sx = (hudProj.x + 1) / 2 * 960, sy = (1 - hudProj.y) / 2 * 540;
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.arc(sx, sy, 34, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#3d8bff';
    ctx.beginPath(); ctx.arc(sx, sy, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, combat.bustProgress)); ctx.stroke();
  }
  if (!combat.dead) {
    const { x, y } = combat.mouse;
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.moveTo(x - 15, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 15, y);
    ctx.moveTo(x, y - 15); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 15);
    ctx.stroke(); ctx.shadowBlur = 0;
  }
}

const MAP_SIZE = 320, MAP_R = 60, MAP_VIEW = 700, MAP_CX = 20 + MAP_R, MAP_CY = 540 - 20 - MAP_R;
let baseMap = null;
function getBaseMap(world) {
  if (baseMap) return baseMap;
  baseMap = document.createElement('canvas');
  baseMap.width = baseMap.height = MAP_SIZE;
  const c = baseMap.getContext('2d');
  c.scale(MAP_SIZE / WORLD_W, MAP_SIZE / WORLD_H);
  c.fillStyle = '#8a8d93';
  c.fillRect(0, 0, WORLD_W, WORLD_H);
  c.fillStyle = '#3a3d44';
  for (const b of world.buildings) c.fillRect(b.x, b.y, b.w, b.h);
  c.fillStyle = '#4f9a4f';
  for (const p of world.parks) c.fillRect(p.x, p.y, p.w, p.h);
  return baseMap;
}

function drawMinimap(ctx, world, p, police) {
  const focus = p.car || p;
  const k = MAP_R / MAP_VIEW;
  ctx.save();
  ctx.beginPath(); ctx.arc(MAP_CX, MAP_CY, MAP_R, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#2a2d33'; ctx.fillRect(MAP_CX - MAP_R, MAP_CY - MAP_R, MAP_R * 2, MAP_R * 2);
  const base = getBaseMap(world);
  ctx.translate(MAP_CX, MAP_CY);
  ctx.scale(k, k);
  ctx.translate(-focus.x, -focus.y);
  ctx.drawImage(base, 0, 0, WORLD_W, WORLD_H);
  if (police && police.stars > 0 && police.evadeTimer > 0) {
    ctx.fillStyle = 'rgba(80,140,255,0.22)';
    ctx.beginPath(); ctx.arc(focus.x, focus.y, 450, 0, Math.PI * 2); ctx.fill();
  }
  if (police) {
    ctx.fillStyle = '#ff2a2a';
    for (const cop of police.cars) { ctx.beginPath(); ctx.arc(cop.x, cop.y, 4 / k, 0, Math.PI * 2); ctx.fill(); }
    if (police.spikes && police.spikes.length) {
      ctx.strokeStyle = '#cfd6ff';
      ctx.lineWidth = 2;
      for (const s of police.spikes) {
        const w = 9 / k;
        ctx.save();
        ctx.translate(s.x, s.y); ctx.rotate(s.angle);
        ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(w, 0); ctx.stroke();
        ctx.restore();
      }
    }
  }
  ctx.restore();
  ctx.save();
  ctx.translate(MAP_CX, MAP_CY);
  ctx.rotate(p.car ? p.car.angle : p.facing || 0);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, 5); ctx.lineTo(-2, 0); ctx.lineTo(-5, -5); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(MAP_CX, MAP_CY, MAP_R, 0, Math.PI * 2); ctx.stroke();
}

function bar(ctx, x, y, w, h, frac, fill, back = 'rgba(0,0,0,0.55)') {
  ctx.fillStyle = back; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill; ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * Math.min(1, Math.max(0, frac))), h - 2);
}

let vignetteCanvas = null;
function getVignette() {
  if (vignetteCanvas) return vignetteCanvas;
  vignetteCanvas = document.createElement('canvas');
  vignetteCanvas.width = 960; vignetteCanvas.height = 540;
  const c = vignetteCanvas.getContext('2d');
  const g = c.createRadialGradient(480, 270, 300, 480, 270, 620);
  g.addColorStop(0, 'rgba(30,15,0,0)');
  g.addColorStop(1, 'rgba(30,15,0,0.35)');
  c.fillStyle = g; c.fillRect(0, 0, 960, 540);
  c.fillStyle = 'rgba(255,160,60,0.05)'; c.fillRect(0, 0, 960, 540);
  return vignetteCanvas;
}

export function drawHud(ctx, world, p, fps, police, missions, camera, combat) {
  ctx.clearRect(0, 0, 960, 540);
  ctx.drawImage(getVignette(), 0, 0);
  const car = p.car;
  const debug = typeof location !== 'undefined' && location.search.includes('debug');
  police = police || world.police;
  drawWanted(ctx, world, police);
  if (missions) drawMission(ctx, p, missions, camera);

  if (police && police.stars >= 3) {
    const pulse = 0.14 + 0.08 * Math.sin(world.time * 6);
    const g = ctx.createRadialGradient(480, 270, 270, 480, 270, 600);
    g.addColorStop(0, 'rgba(200,0,0,0)');
    g.addColorStop(1, `rgba(200,0,0,${pulse.toFixed(3)})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 960, 540);
  }

  if (combat) drawCombatHud(ctx, p, camera, combat);
  drawMinimap(ctx, world, p, police);
  const bx = MAP_CX - MAP_R, by = MAP_CY - MAP_R - 22;
  const hp = p.health != null ? p.health / (p.maxHealth || 100) : 1;
  bar(ctx, bx, by, MAP_R * 2, 8, hp, '#3ddc4f');
  if (police && police.evadeTimer > 0) {
    bar(ctx, bx, by - 16, MAP_R * 2, 12, police.evadeTimer / EVADE_MAX[Math.max(0, police.stars - 1)], '#9aa0a8');
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('MENGHILANG', MAP_CX, by - 6.5);
    ctx.textAlign = 'left';
  }

  if (car) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
    ctx.fillText(String(Math.round(Math.abs(car.speed) * 0.36)), 930, 452);
    ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#ddd';
    ctx.fillText('KM/H', 930, 466);
    ctx.shadowBlur = 0; ctx.textAlign = 'left';
  }

  if (!car && nearestEnterable(world, p)) {
    ctx.fillStyle = 'rgba(20,20,20,0.7)';
    ctx.fillRect(410, 500, 140, 20);
    ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('E: masuk mobil', 480, 514);
    ctx.textAlign = 'left';
  } else if (car) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '10px sans-serif';
    ctx.fillText('E: keluar', 20 + MAP_R * 2 + 10, 524);
  }

  if (debug) {
    const pos = car || p;
    ctx.fillStyle = '#fff'; ctx.font = '11px monospace';
    ctx.fillText(`X ${pos.x.toFixed(0)} Y ${pos.y.toFixed(0)} FPS ${fps}`, 8, 14);
  }
}

function starPath(ctx, cx, cy, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner, angle = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx[i === 0 ? 'moveTo' : 'lineTo'](cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }
  ctx.closePath();
}

function drawWanted(ctx, world, police = world.police) {
  if (!police) return;
  for (let i = 0; i < 5; i++) {
    starPath(ctx, 925 - i * 30, 30, 13, 5.5);
    if (i < police.stars) { ctx.fillStyle = STAR_COLOR; ctx.fill(); }
    ctx.strokeStyle = i < police.stars ? '#8a6d00' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  if (police.stars <= 0) return;
  if (Math.floor(world.time * 4) % 2 === 0) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ff4040';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('WANTED', 940, 64);
    ctx.textAlign = 'left';
  }
}

function drawMission(ctx, p, missions, camera) {
  const text = missions.objectiveText;
  if (!text) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 15px sans-serif';
  let shown = text;
  while (shown.length > 1 && ctx.measureText(shown).width > 592) shown = shown.slice(0, -2).trimEnd() + '\u2026';
  const pw = Math.min(620, ctx.measureText(shown).width + 28);
  ctx.fillStyle = 'rgba(8,8,14,0.55)'; ctx.fillRect(480 - pw / 2, 16, pw, 28);
  ctx.fillStyle = '#ffd21f';
  ctx.fillText(shown, 480, 35);
  const t = missions.target, focus = p.car || p;
  if (t && camera) {
    const fx = focus.x - WORLD_W / 2 - camera.position.x, fz = focus.y - WORLD_H / 2 - camera.position.z;
    const fl = Math.hypot(fx, fz) || 1;
    const dx = t.x - focus.x, dy = t.y - focus.y;
    const side = (dx * -fz + dy * fx) / fl, ahead = (dx * fx + dy * fz) / fl;
    const a = Math.atan2(side, ahead);
    ctx.translate(480 + Math.sin(a) * 400, 290 - Math.cos(a) * 200);
    ctx.rotate(a);
    ctx.scale(0.8, 0.8);
    ctx.fillStyle = '#ffd21f'; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(10, 10); ctx.lineTo(0, 4); ctx.lineTo(-10, 10); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
