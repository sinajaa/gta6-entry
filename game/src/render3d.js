// render3d.js — render kota 3D dengan three.js dan HUD overlay
import * as THREE from '../vendor/three.module.min.js';
import { TILE, COLS, ROWS, T, WORLD_W, WORLD_H } from './world.js';
import { nearestEnterable } from './vehicle.js';

const GROUND_COLORS = { [T.ROAD]: '#6b6e73', [T.SIDEWALK]: '#d9d2c3', [T.GRASS]: '#8fc16a', [T.BUILDING]: '#8c8173' };
const SKY = 0x9fd0ff;
const SHADOW_HALF = 500;
const SUN_OFFSET = new THREE.Vector3(-0.6, 1, -0.4).normalize().multiplyScalar(900);
const CAR_SIZE = { length: 56, height: 18, width: 22 };
const PLAYER_HEIGHT = 28;
const MAX_CARS = 64;
const MAX_LIGHTS = 16, LIGHT_HZ = 6;
const LIGHT_SIZE = { length: 6, height: 3, width: 8 };
const STAR_COLOR = '#f5c518';

function cellHash(gx, gy) {
  let h = Math.imul(gx * 374761393 + gy * 668265263, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function initRenderer(canvas, hudCanvas, world) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(960, 540, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 900, 2200);
  scene.add(new THREE.HemisphereLight(0xbfdcff, 0x6b7a5a, 0.85));

  const sun = new THREE.DirectionalLight(0xfff2d8, 1.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 1.5;
  Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 2200 });
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(55, 960 / 540, 1, 2600);
  const gfx = { renderer, scene, camera, sun, hud: hudCanvas.getContext('2d'), carMesh: null, playerMesh: null, lightMesh: null, lightPhase: -1 };
  buildWorldMeshes(gfx, world);
  return gfx;
}

export function makeGroundTexture(world, renderer) {
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
    new THREE.MeshLambertMaterial({ map: makeGroundTexture(world, gfx.renderer) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  gfx.scene.add(ground);

  const buildings = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial(),
    world.buildings.length,
  );
  const matrix = new THREE.Matrix4(), color = new THREE.Color();
  world.buildings.forEach((b, i) => {
    const height = TILE * (1.5 + cellHash(Math.round(b.x / TILE), Math.round(b.y / TILE)) * 2.5);
    matrix.compose(
      new THREE.Vector3(b.x + b.w / 2 - WORLD_W / 2, height / 2, b.y + b.h / 2 - WORLD_H / 2),
      new THREE.Quaternion(),
      new THREE.Vector3(b.w, height, b.h),
    );
    buildings.setMatrixAt(i, matrix);
    buildings.setColorAt(i, color.set(b.roof));
  });
  buildings.instanceMatrix.needsUpdate = true;
  buildings.instanceColor.needsUpdate = true;
  buildings.castShadow = buildings.receiveShadow = true;
  gfx.scene.add(buildings);

  const cars = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CAR_SIZE.length, CAR_SIZE.height, CAR_SIZE.width),
    new THREE.MeshLambertMaterial(),
    MAX_CARS,
  );
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

  gfx.playerMesh.visible = !player.car;
  gfx.playerMesh.position.set(player.x - WORLD_W / 2, PLAYER_HEIGHT / 2, player.y - WORLD_H / 2);
  gfx.playerMesh.rotation.y = -player.facing;
}

export function renderFrame(gfx, world, player, fps, police) {
  syncActors(gfx, world, player);
  const actor = player.car || player;
  const tx = actor.x - WORLD_W / 2, tz = actor.y - WORLD_H / 2;
  gfx.sun.target.position.set(tx, 0, tz);
  gfx.sun.position.set(tx, 0, tz).add(SUN_OFFSET);
  gfx.renderer.render(gfx.scene, gfx.camera);
  drawHud(gfx.hud, world, player, fps, police);
}

export function drawHud(ctx, world, p, fps, police) {
  ctx.clearRect(0, 0, 960, 540);
  drawWanted(ctx, world, police);
  const car = p.car;
  ctx.fillStyle = 'rgba(20,20,20,0.6)';
  ctx.fillRect(8, 8, 170, car ? 56 : 40);
  ctx.fillStyle = '#fff';
  ctx.font = '12px monospace';
  const pos = car || p;
  ctx.fillText(`X ${pos.x.toFixed(0)}  Y ${pos.y.toFixed(0)}`, 16, 24);
  ctx.fillText(`FPS ${fps}${p.sprinting && !car ? '  SPRINT' : ''}`, 16, 40);
  if (car) {
    ctx.fillText(`${Math.round(Math.abs(car.speed) * 0.36)} km/j`, 16, 56);
    ctx.fillText('E: keluar mobil', 16, 530);
  } else if (nearestEnterable(world, p)) {
    ctx.fillStyle = 'rgba(20,20,20,0.7)';
    ctx.fillRect(380, 490, 200, 28);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('E: masuk/keluar mobil', 480, 508);
    ctx.textAlign = 'left';
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
    starPath(ctx, 932 - i * 26, 24, 11, 4.5);
    if (i < police.stars) { ctx.fillStyle = STAR_COLOR; ctx.fill(); }
    ctx.strokeStyle = i < police.stars ? '#8a6d00' : '#8a8f98';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  if (police.stars <= 0) return;
  ctx.textAlign = 'right';
  if (Math.floor(world.time * 2 * 2) % 2 === 0) {
    ctx.fillStyle = '#ff4040';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('WANTED', 940, 56);
  }
  if (police.evadeTimer > 0) {
    ctx.fillStyle = '#fff';
    ctx.font = '11px monospace';
    ctx.fillText(`EVADE ${Math.ceil(police.evadeTimer)}s`, 940, 74);
  }
  ctx.textAlign = 'left';
  ctx.font = '12px monospace';
}
