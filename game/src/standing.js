// standing.js — reputasi pemain per distrik (pusat/tengah/pinggir): diskon, heat shield, toast
import { districtAt } from './world.js';

export const DISTRICT_NAMES = ['PUSAT', 'TENGAH', 'PINGGIR'];
const DISCOUNT_BY_TIER = [0, 5, 10, 15], TIER_STEP = 25, SHIELD_AT = 75, TOAST_GAP = 2, JOB_UNLOCK = 3, JOB_BONUS = 50;
const clamp = (v) => Math.max(0, Math.min(100, v));

export function normalizeStanding(raw) {
  const a = Array.isArray(raw) ? raw : [];
  return [0, 1, 2].map((i) => (Number.isFinite(Number(a[i])) ? clamp(Number(a[i])) : 0));
}

export function createStanding(ui) {
  const frozen = typeof location !== 'undefined' && new URLSearchParams(location.search).has('shot');
  const seen = ui.standing.slice();
  const pending = [0, 0, 0];
  let gap = 0;

  const discountOf = (v) => DISCOUNT_BY_TIER[Math.min(3, Math.floor(v / TIER_STEP))];

  function flush() {
    let best = -1;
    for (let i = 0; i < 3; i++) if (pending[i] !== 0 && (best < 0 || Math.abs(pending[i]) > Math.abs(pending[best]))) best = i;
    if (best < 0) return;
    const v = ui.standing[best], old = clamp(v - pending[best]), delta = Math.round(v) - Math.round(old);
    pending[best] = 0;
    if (delta === 0) return;
    let msg = `${DISTRICT_NAMES[best]} ${delta > 0 ? '+' : ''}${delta} \u2192 ${Math.round(v)}`;
    if (old < SHIELD_AT && v >= SHIELD_AT) msg += ' \u00B7 HEAT SHIELD';
    else if (old >= SHIELD_AT && v < SHIELD_AT) msg += ' \u00B7 SHIELD HILANG';
    if (discountOf(old) !== discountOf(v)) msg += ` \u00B7 DISKON ${discountOf(v)}%`;
    ui.toast(msg);
    gap = TOAST_GAP;
  }

  const s = {
    frozen,
    visible: !frozen,
    cur: 0,
    discountPct: (d) => (frozen ? 0 : discountOf(ui.standing[d])),
    shield: (x, y) => !frozen && ui.standing[districtAt(x, y)] >= SHIELD_AT,
    price: (base, x, y) => Math.round(base * (1 - s.discountPct(districtAt(x, y)) / 100)),
    jobs: [0, 0, 0],
    job(x, y) {
      if (frozen) return 0;
      const d = districtAt(x, y);
      return ++s.jobs[d] >= JOB_UNLOCK ? JOB_BONUS : 0;
    },
    repairPrice: (base, x, y) => Math.round(s.price(base, x, y) * (s.jobs[districtAt(x, y)] >= JOB_UNLOCK ? 0.8 : 1)),
    add(x, y, delta) {
      if (frozen) return;
      const d = districtAt(x, y);
      ui.standing[d] = clamp(ui.standing[d] + delta);
    },
    set(d, v) { if (!frozen) ui.standing[d] = clamp(v); },
    update(dt, x, y) {
      s.cur = districtAt(x, y);
      if (frozen) return;
      gap = Math.max(0, gap - dt);
      for (let i = 0; i < 3; i++) {
        ui.standing[i] = clamp(ui.standing[i]);
        pending[i] += ui.standing[i] - seen[i];
        seen[i] = ui.standing[i];
      }
      if (gap <= 0) flush();
    },
  };
  return s;
}
