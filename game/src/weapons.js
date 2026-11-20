// Daftar senjata dan amunisi ini ditulis sendiri oleh pembuat entry.
// weapons.js — definisi 5 senjata, ammo, dan pickup kotak ammo
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle', 'compactsmg'];

export const WEAPONS = {
  pistol: { name: 'PISTOL', damage: 25, cooldown: 0.25, spread: 0.01, pellets: 1, range: 600, maxAmmo: 120, startAmmo: 60, pack: 24, recoil: 0.012, kick: 0.14, switchMs: 0.15 },
  smg: { name: 'SMG', damage: 12, cooldown: 0.08, spread: 0.06, pellets: 1, range: 520, maxAmmo: 300, startAmmo: 120, pack: 60, recoil: 0.006, kick: 0.07, switchMs: 0.2 },
  shotgun: { name: 'SHOTGUN', damage: 11, cooldown: 0.8, spread: 0.14, pellets: 6, range: 260, maxAmmo: 40, startAmmo: 16, pack: 8, recoil: 0.04, kick: 0.5, switchMs: 0.4 },
  rifle: { name: 'RIFLE', damage: 50, cooldown: 0.45, spread: 0.004, pellets: 1, range: 800, maxAmmo: 90, startAmmo: 30, pack: 15, recoil: 0.02, kick: 0.3, switchMs: 0.45 },
  compactsmg: { name: 'COMPACT SMG', damage: 14, cooldown: 0.085, spread: 0.07, pellets: 1, range: 440, maxAmmo: 192, startAmmo: 64, pack: 32, recoil: 0.007, kick: 0.06, switchMs: 0.18, mag: 32, reloadMs: 1.5, flash: [0.45, 0.85, 1.0] },
};

export const PICKUP = { max: 5, radius: 30, minDist: 120, maxDist: 520, interval: 6, farDist: 900, minSeparation: 80 };

export function createAmmo() {
  const ammo = {};
  for (const id of WEAPON_ORDER) ammo[id] = WEAPONS[id].startAmmo;
  return ammo;
}

export function createMags() {
  const mags = {};
  for (const id of WEAPON_ORDER) if (WEAPONS[id].mag) mags[id] = WEAPONS[id].mag;
  return mags;
}

export function refill(ammo) {
  for (const id of WEAPON_ORDER) ammo[id] = Math.min(WEAPONS[id].maxAmmo, ammo[id] + WEAPONS[id].pack);
}

export function createPickups() {
  return { list: [], timer: 2 };
}

export function updatePickups(pk, world, focus, dt, onCollect) {
  pk.timer -= dt;
  pk.list = pk.list.filter((p) => Math.hypot(p.x - focus.x, p.y - focus.y) < PICKUP.farDist);
  if (pk.timer <= 0 && pk.list.length < PICKUP.max) {
    pk.timer = PICKUP.interval;
    const pts = world.lanePoints.filter((p) => {
      const d = Math.hypot(p.x - focus.x, p.y - focus.y);
      return d >= PICKUP.minDist && d <= PICKUP.maxDist;
    });
    if (pts.length) {
      const p = pts[Math.floor(Math.random() * pts.length)];
      if (pk.list.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > PICKUP.minSeparation)) pk.list.push({ x: p.x, y: p.y });
    }
  }
  for (let i = pk.list.length - 1; i >= 0; i--) {
    const p = pk.list[i];
    if (Math.hypot(p.x - focus.x, p.y - focus.y) < PICKUP.radius) { pk.list.splice(i, 1); onCollect(p); }
  }
}
