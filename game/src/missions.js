// missions.js — sistem misi berantai: DELIVERY, CHASE, TIMED
const GAP_SECONDS = 3;
const DELIVERY = { min: 400, max: 700, reach: 40, reward: 250 };
const CHASE = { spawn: 300, speed: 170, reach: 40, hold: 2, reward: 400, timeout: 120 };
const TIMED = { count: 3, seconds: 60, reach: 30, reward: 300, min: 150, max: 450, spacing: 100 };

export const MISSION_LIST = [
  { id: 'delivery', title: 'ANTAR PAKET' },
  { id: 'chase', title: 'KEJAR TARGET' },
  { id: 'timed', title: 'KUMPUL PAKET' },
];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function lanePointsBetween(world, from, min, max) {
  return world.lanePoints.filter((p) => { const d = dist(p, from); return d >= min && d <= max; });
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function createMissions(world, ui, audio) {
  let cursor = 0;
  let gap = 0;
  const m = {
    list: MISSION_LIST,
    active: null,
    done: 0,
    markers: [],
    target: null,

    next() {
      const def = MISSION_LIST[cursor % MISSION_LIST.length];
      cursor++;
      m.start(def.id);
    },

    start(id) {
      cleanup();
      const def = MISSION_LIST.find((d) => d.id === id);
      if (!def) throw new Error('misi tidak dikenal: ' + id);
      m.active = { id, title: def.title, pending: true };
      gap = 0;
    },

    update(dt, player, w = world) {
      const focus = player.car || player;
      if (!m.active) {
        if (gap > 0) { gap -= dt; if (gap <= 0) m.next(); }
        return;
      }
      const a = m.active;
      if (a.pending) { init(a, focus, w); a.pending = false; }
      if (a.id === 'delivery') updateDelivery(a, focus);
      else if (a.id === 'chase') updateChase(a, focus, dt);
      else updateTimed(a, focus, dt);
      refreshMarkers();
    },

    abort() { if (m.active) fail(); },

    get objectiveText() {
      const a = m.active;
      if (!a) return gap > 0 ? 'MISI BERIKUTNYA...' : '';
      if (a.pending) return a.title;
      const f = m.focus;
      if (a.id === 'delivery') return `${a.title}: ${Math.round(dist(f, a.dest))}m`;
      if (a.id === 'chase') {
        const hold = a.hold > 0 ? ` (${a.hold.toFixed(1)}/${CHASE.hold}s)` : '';
        return `${a.title}: ${Math.round(dist(f, a.car))}m${hold}`;
      }
      return `${a.title}: ${a.packages.length ? TIMED.count - a.packages.length : TIMED.count}/${TIMED.count} — ${Math.ceil(a.timeLeft)}s`;
    },
    focus: { x: 0, y: 0 },
  };

  function init(a, focus, w) {
    m.focus = focus;
    if (a.id === 'delivery') {
      a.dest = pick(lanePointsBetween(w, focus, DELIVERY.min, DELIVERY.max));
    } else if (a.id === 'chase') {
      let pts = lanePointsBetween(w, focus, CHASE.spawn - 40, CHASE.spawn + 40);
      if (!pts.length) pts = lanePointsBetween(w, focus, CHASE.spawn - 120, CHASE.spawn + 120);
      const p = pick(pts);
      const dir = (p.horizontal ? p.x - focus.x : p.y - focus.y) >= 0 ? 1 : -1;
      const angle = p.horizontal ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      const car = { x: p.x, y: p.y, angle, speed: CHASE.speed, color: '#ff2fb3', driver: 'target', horizontal: p.horizontal, dir };
      w.cars.push(car);
      a.car = car; a.hold = 0; a.age = 0;
    } else {
      const pts = lanePointsBetween(w, focus, TIMED.min, TIMED.max);
      a.packages = [];
      for (let tries = 0; tries < 200 && a.packages.length < TIMED.count; tries++) {
        const p = pick(pts);
        if (p && a.packages.every((q) => dist(p, q) > TIMED.spacing)) a.packages.push({ x: p.x, y: p.y });
      }
      a.timeLeft = TIMED.seconds;
    }
  }

  function cleanup() {
    const a = m.active;
    if (a && a.car) { const i = world.cars.indexOf(a.car); if (i >= 0) world.cars.splice(i, 1); }
    m.active = null;
    m.markers = [];
    m.target = null;
  }

  function finish(reward) {
    ui.addMoney(reward);
    ui.toast(`MISI SELESAI +$${reward}`);
    ui.missionsDone++;
    m.done++;
    audio.complete();
    cleanup();
    gap = GAP_SECONDS;
  }

  function fail() {
    ui.toast('MISI GAGAL');
    cleanup();
    gap = GAP_SECONDS;
  }

  function updateDelivery(a, f) {
    m.focus = f;
    if (dist(f, a.dest) < DELIVERY.reach) finish(DELIVERY.reward);
  }

  function updateChase(a, f, dt) {
    m.focus = f;
    const c = a.car;
    a.age += dt;
    const limit = world.width - 30;
    const pos = c.horizontal ? 'x' : 'y';
    if (c[pos] > limit) c.dir = -1; else if (c[pos] < 30) c.dir = 1;
    c.angle = c.horizontal ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    c.speed = CHASE.speed;
    c.x += Math.cos(c.angle) * c.speed * dt;
    c.y += Math.sin(c.angle) * c.speed * dt;
    if (dist(f, c) < CHASE.reach) a.hold += dt; else a.hold = 0;
    if (a.hold >= CHASE.hold) finish(CHASE.reward);
    else if (a.age > CHASE.timeout) fail();
  }

  function updateTimed(a, f, dt) {
    m.focus = f;
    a.timeLeft -= dt;
    a.packages = a.packages.filter((p) => dist(f, p) >= TIMED.reach);
    if (!a.packages.length) { finish(TIMED.reward); return; }
    if (a.timeLeft <= 0) fail();
  }

  function refreshMarkers() {
    const a = m.active;
    if (!a) { m.markers = []; m.target = null; return; }
    if (a.id === 'delivery') { m.markers = [{ x: a.dest.x, y: a.dest.y, scale: 1 }]; m.target = a.dest; }
    else if (a.id === 'chase') { m.markers = [{ x: a.car.x, y: a.car.y, scale: 0.6 }]; m.target = a.car; }
    else {
      m.markers = a.packages.map((p) => ({ x: p.x, y: p.y, scale: 0.4 }));
      m.target = a.packages.reduce((best, p) => (!best || dist(m.focus, p) < dist(m.focus, best) ? p : best), null);
    }
  }

  return m;
}
