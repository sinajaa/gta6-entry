// render3d.js — render kota 3D dengan three.js dan HUD overlay
import * as THREE from '../vendor/three.module.min.js';
import { TILE, COLS, ROWS, T, WORLD_W, WORLD_H } from './world.js';
import { nearestEnterable } from './vehicle.js';

const GROUND_COLORS = { [T.ROAD]: '#9aa0a6', [T.SIDEWALK]: '#d9d2c3', [T.GRASS]: '#8fc16a', [T.BUILDING]: '#8c8173' };
const HORIZON = 0xf6c48c;
const SHADOW_HALF = 560;
const SUN_OFFSET = new THREE.Vector3(-900, 420, -500);
const ROOF_BOOST = 1.25;
const CAR_SIZE = { length: 56, height: 18, width: 22 };
const PLAYER_HEIGHT = 28;
const MAX_CARS = 64;
const MAX_PEDS = 80, PED_DRAW_RADIUS = 700, PED_HEIGHT = 16;
const PED_SHIRTS = ['#ffffff', '#2a5aff', '#e0262b', '#f5c518'];
const MAX_LIGHTS = 16, LIGHT_HZ = 6;
const LIGHT_SIZE = { length: 6, height: 3, width: 8 };
const EVADE_MAX = [10, 14, 18, 24, 30];
const HELI_SPOT_RADIUS = 140;
const STAR_COLOR = '#f5c518';

function makeSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#2f5f9e');
  g.addColorStop(0.18, '#7fa6c9');
  g.addColorStop(0.27, '#f6c48c');
  g.addColorStop(1, '#f6c48c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeFacadeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e8e8ee';
  ctx.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) {
      ctx.fillStyle = (row * 3 + col * 5) % 7 === 0 ? '#4a5a70' : '#2c3a4e';
      ctx.fillRect(col * 32 + 5, row * 64 + 12, 22, 38);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, row * 64, 256, 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
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
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog(HORIZON, 350, 1500);
  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x9a8a6a, 0.9));
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));

  const shadowSize = renderer.capabilities.isWebGL2 ? 2048 : 1024;
  const sun = new THREE.DirectionalLight(0xffc890, 2.6);
  sun.position.copy(SUN_OFFSET);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = !software;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.8;
  Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 100, far: 1800 });
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(48, 960 / 540, 3, 1700);
  const gfx = { renderer, scene, camera, sun, software, shadowSize, frameNo: 0, hud: hudCanvas.getContext('2d'), carMesh: null, playerMesh: null, lightMesh: null, lightPhase: -1 };
  buildWorldMeshes(gfx, world);
  buildCombatFx(gfx);
  return gfx;
}

const TRACER_N = 32, FLASH_N = 8, SPARK_N = 48;
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

  const lights = [];
  if (!gfx.software) {
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 160, 2);
      gfx.scene.add(l); lights.push(l);
    }
  }
  gfx.scene.add(lines, tracerQuads, flashQuads, sparkMesh);
  gfx.fx = { lines, tracerQuads, flashQuads, sparkMesh, lights };
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
    const x = f.x - ox, z = f.y - oz;
    writeQuad(fg, i, x - c * s * 0.3, 14, z - n * s * 0.3, x + c * s, 14, z + n * s, s * 0.45, r * a, g * a, b * a);
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

  fx.lights.forEach((l, i) => {
    const f = combat.flashes[(combat.flashCursor - 1 - i + FLASH_N * 8) % FLASH_N];
    const on = f && f.t > 0;
    l.intensity = on ? 900 * (f.t / f.max) : 0;
    if (on) { l.position.set(f.x - ox, 20, f.y - oz); l.color.setRGB(f.color[0], f.color[1], f.color[2]); }
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
    const k = Math.hypot(900, 500) / 420, ux = 900 / Math.hypot(900, 500), uy = 500 / Math.hypot(900, 500);
    for (const b of world.buildings) {
      const dx = ux * k * b.height, dy = uy * k * b.height;
      const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
      sc.fillRect(b.x, b.y, b.w, b.h);
      sc.fillRect(b.x + dx, b.y + dy, b.w, b.h);
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 4];
        sc.beginPath();
        sc.moveTo(ax, ay); sc.lineTo(bx, by); sc.lineTo(bx + dx, by + dy); sc.lineTo(ax + dx, ay + dy);
        sc.closePath(); sc.fill();
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.25;
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

export function buildWorldMeshes(gfx, world) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_W, WORLD_H),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture(world, gfx.renderer, gfx.software) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  gfx.scene.add(ground);

  const facade = makeFacadeTexture();
  const buildings = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    gfx.software
      ? new THREE.MeshLambertMaterial({ map: facade, emissive: 0x222222 })
      : new THREE.MeshStandardMaterial({ map: facade, roughness: 0.85, metalness: 0.0 }),
    world.buildings.length,
  );
  buildings.material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
  vec3 bsz = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  float horiz = abs(normal.x) > 0.5 ? bsz.z : bsz.x;
  vMapUv = (mapTransform * vec3(uv.x * horiz / 256.0, uv.y * bsz.y / 128.0, 1.0)).xy;
#endif`);
  };
  const matrix = new THREE.Matrix4(), color = new THREE.Color();
  world.buildings.forEach((b, i) => {
    matrix.compose(
      new THREE.Vector3(b.x + b.w / 2 - WORLD_W / 2, b.height / 2, b.y + b.h / 2 - WORLD_H / 2),
      new THREE.Quaternion(),
      new THREE.Vector3(b.w, b.height, b.h),
    );
    buildings.setMatrixAt(i, matrix);
    buildings.setColorAt(i, color.set(b.color));
  });
  buildings.instanceMatrix.needsUpdate = true;
  buildings.instanceColor.needsUpdate = true;
  buildings.castShadow = buildings.receiveShadow = true;
  gfx.scene.add(buildings);

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

  buildHeli(gfx);
  buildProps(gfx, world);
  buildMissionMarkers(gfx);
}

function buildCarGeometry() {
  const wheel = (x, z) => ({ geo: new THREE.CylinderGeometry(4, 4, 4, 10).rotateX(Math.PI / 2).translate(x, -5, z), color: '#15171a' });
  return mergeColored([
    { geo: new THREE.BoxGeometry(56, 11, 22).translate(0, -3.5, 0), color: '#ffffff' },
    { geo: new THREE.BoxGeometry(28, 7, 18).translate(-4, 5.5, 0), color: '#6f8aa8' },
    wheel(17, 10), wheel(17, -10), wheel(-17, 10), wheel(-17, -10),
    { geo: new THREE.BoxGeometry(1.5, 3, 5).translate(28.2, -2, 7), color: '#fff2b0' },
    { geo: new THREE.BoxGeometry(1.5, 3, 5).translate(28.2, -2, -7), color: '#fff2b0' },
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
  for (let i = 0; i < 140; i++) {
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
  for (let i = 0; i < 120; i++) {
    const s = strips.pop(), p = spot(s, 12, (rand() - 0.5) * 10);
    boxes.push({ x: p.x, y: POLE_HEIGHT / 2, z: p.y, sx: 2, sy: POLE_HEIGHT, sz: 2, yaw: 0, color: '#3b3f45' });
    cyls.push({ x: p.x + (s.horiz ? 0 : s.road * 4), y: POLE_HEIGHT + 1, z: p.y + (s.horiz ? s.road * 4 : 0), sx: 3.5, sy: 2.5, sz: 3.5, color: '#fff2b0' });
  }
  for (let i = 0; i < 40; i++) {
    const s = strips.pop(), p = spot(s, -8, (rand() - 0.5) * 8);
    boxes.push({ x: p.x, y: 4, z: p.y, sx: 16, sy: 8, sz: 5, yaw: p.angle, color: '#8a5a33' });
  }
  for (let i = 0; i < 30; i++) {
    const s = strips.pop(), p = spot(s, 11, (rand() - 0.5) * 10);
    cyls.push({ x: p.x, y: 5, z: p.y, sx: 3.5, sy: 10, sz: 3.5, color: '#e0262b' });
  }
  for (let i = 0; i < 12; i++) {
    const s = strips.pop(), p = spot(s, -6, 0);
    boxes.push({ x: p.x, y: 13, z: p.y, sx: s.horiz ? 30 : 10, sy: 26, sz: s.horiz ? 10 : 30, yaw: 0, color: '#4b8fb5' });
  }
  for (let i = 0; i < 40; i++) {
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

function buildStreetDetail(gfx, world) {
  const items = [];
  const BLOCKS = COLS / 10, P = 10 * TILE;
  const SIDE = [
    { edge: (b) => b.x, ok: (b) => (b.x / TILE) % 10 === 3, nx: -1, nz: 0, len: (b) => b.h, cx: (b) => b.x, cz: (b) => b.y + b.h / 2 },
    { edge: (b) => b.x + b.w, ok: (b) => ((b.x + b.w) / TILE) % 10 === 9, nx: 1, nz: 0, len: (b) => b.h, cx: (b) => b.x + b.w, cz: (b) => b.y + b.h / 2 },
    { ok: (b) => (b.y / TILE) % 10 === 3, nx: 0, nz: -1, len: (b) => b.w, cx: (b) => b.x + b.w / 2, cz: (b) => b.y },
    { ok: (b) => ((b.y + b.h) / TILE) % 10 === 9, nx: 0, nz: 1, len: (b) => b.w, cx: (b) => b.x + b.w / 2, cz: (b) => b.y + b.h },
  ];
  for (const b of world.buildings) {
    for (const s of SIDE) {
      if (!s.ok(b)) continue;
      const L = s.len(b) - 8, alongX = s.nz !== 0;
      const wx = s.cx(b) - WORLD_W / 2, wz = s.cz(b) - WORLD_H / 2;
      items.push({ x: wx + s.nx * 0.6, y: 11, z: wz + s.nz * 0.6, sx: alongX ? L : 1.2, sy: 18, sz: alongX ? 1.2 : L, color: '#3b536b' });
      items.push({ x: wx + s.nx * 3.5, y: 23, z: wz + s.nz * 3.5, sx: alongX ? L : 7, sy: 3, sz: alongX ? 7 : L, color: ['#c0392b', '#2e7d6b', '#d9a21b', '#3a62b3'][Math.floor(b.x / TILE + b.y / TILE) % 4] });
    }
  }
  const detail = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  items.forEach((it, i) => {
    detail.setMatrixAt(i, m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz)));
    detail.setColorAt(i, c.set(it.color));
  });
  detail.instanceMatrix.needsUpdate = detail.instanceColor.needsUpdate = true;
  detail.frustumCulled = false;
  gfx.scene.add(detail);

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

export function syncActors(gfx, world, player) {
  const count = Math.min(world.cars.length, MAX_CARS);
  world.cars.forEach((car, i) => {
    if (i >= MAX_CARS) return;
    carPosition.set(car.x - WORLD_W / 2, CAR_SIZE.height / 2 + 2, car.y - WORLD_H / 2);
    carQuaternion.setFromAxisAngle(yAxis, -car.angle);
    carMatrix.compose(carPosition, carQuaternion, carScale);
    gfx.carMesh.setMatrixAt(i, carMatrix);
    gfx.carMesh.setColorAt(i, carColor.set(car.color));
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
function syncPeds(gfx, player, peds) {
  const mesh = gfx.pedMesh;
  if (!mesh || !peds) return;
  const focus = player.car || player;
  let n = 0;
  for (let i = 0; i < peds.length && n < MAX_PEDS; i++) {
    const p = peds[i];
    if (Math.hypot(p.x - focus.x, p.y - focus.y) > PED_DRAW_RADIUS) continue;
    const cower = p.state === 'COWER';
    pedScale.set(1, cower ? 0.6 : 1, 1);
    carPosition.set(p.x - WORLD_W / 2, (PED_HEIGHT * pedScale.y) / 2 + 1, p.y - WORLD_H / 2);
    carQuaternion.setFromAxisAngle(yAxis, -p.angle);
    carMatrix.compose(carPosition, carQuaternion, pedScale);
    mesh.setMatrixAt(n, carMatrix);
    mesh.setColorAt(n, carColor.set(PED_SHIRTS[i % PED_SHIRTS.length]));
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function renderFrame(gfx, world, player, fps, police, peds, missions, combat) {
  syncActors(gfx, world, player);
  syncPeds(gfx, player, peds);
  syncMarkers(gfx, missions);
  syncCombat(gfx, combat);
  if (combat) combat.applyShake(gfx.camera);
  const actor = player.car || player;
  const tx = actor.x - WORLD_W / 2, tz = actor.y - WORLD_H / 2;
  gfx.sun.target.position.set(tx, 0, tz);
  gfx.sun.position.set(tx, 0, tz).add(SUN_OFFSET);
  if (gfx.frameNo++ % 2 === 0) gfx.renderer.shadowMap.needsUpdate = true;
  gfx.renderer.render(gfx.scene, gfx.camera);
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
    ctx.fillText(String(Math.round(Math.abs(car.speed) * 0.36)), 930, 500);
    ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#ddd';
    ctx.fillText('KM/H', 930, 518);
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
  ctx.font = 'bold 16px sans-serif';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.fillStyle = '#ffd21f';
  ctx.strokeText(text, 480, 36); ctx.fillText(text, 480, 36);
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
