# COMBAT_V6 — combat & vehicle feedback

This checkpoint adds "feel" to combat and vehicles: every shot has weight, every hit reads clearly, cars that take damage degrade and then explode, and pedestrians collapse realistically when killed.

## What was added

### Compact SMG (new weapon)
- A fifth weapon, the compact SMG (`compactsmg` in `weapons.js`), sits at slot 5 in the weapon switch order and the weapon wheel. It fires faster and spreads more than the pistol but hits softer per shot, with its own cool blue muzzle-flash colour instead of the standard warm-white.
- It carries a 32-round magazine: the HUD shows `rounds/reserve` (e.g. `32/64`), and when the mag runs dry the player reloads — press `G` or keep firing to trigger it automatically, drawing fresh rounds from the reserve pool. Ammo pickups refill the reserve.

### Per-weapon recoil and camera kick
- Each weapon in `weapons.js` now carries `recoil` (aim drift that accumulates while firing) and `kick` (an upward camera pitch impulse on each shot).
- `combat.js` applies the camera kick as a short-lived pitch offset on the active camera, and the recoil drifts subsequent shots upward until it decays.

### Muzzle flash light + tracers
- The muzzle flash now spawns at the correct muzzle height (on-foot gun height vs. drive-by car height) and drives the pooled point lights so the environment is briefly lit by each shot.
- Tracers already lit the shot path; they are preserved and still color-matched (player warm-white, cop red).

### Hit markers and impact sparks
- The existing hit marker (crosshair flash, red for a kill) is retained, and impact sparks spray at the wall, vehicle or pedestrian that was struck.

### Shell casings
- A new pooled particle system (bronze boxes) ejects a casing from the muzzle on each shot. Casings arc sideways, fall under gravity, bounce once or twice off the ground, and come to rest tumbling.

### Vehicle deformation, smoke and explosion
- Cars track hp. As it drops, `render3d.js` squashes the instance, darkens the paint (scorched look), and — below 50% hp — `combat.js` emits rising smoke puffs.
- At 0 hp a (non-mission) car detonates: a two-stage fireball, a shower of glowing and dark debris chunks, a burst of sparks, smoke, and a shockwave that shakes the screen when the player is close.

### Pedestrian ragdoll-like tumble
- A killed pedestrian no longer teleports away. A new `DOWN` state in `peds.js` knocks them backward a short distance and folds the rendered capsule flat, then they are recycled off-screen.

### Explosion screen shake
- `explodeCar` sets a distance-scaled `explShake` that uses a larger magnitude and slower decay than the damage shake, so nearby blasts visibly rock the camera.

## Files changed

| File | Change |
|---|---|
| `game/src/weapons.js` | per-weapon `recoil` and `kick` |
| `game/src/combat.js` | recoil/kick, casing/debris/smoke/fireball pools, explosion, car smoke, ped `DOWN` trigger, explosion shake |
| `game/src/peds.js` | `DOWN` tumble state + folding |
| `game/src/render3d.js` | casing/debris/smoke/fireball meshes, muzzle-light height, car damage deformation, ped fold rendering |

No mission scripts or control bindings were changed.

## Verification

`MAKEFUN_OUTPUT_DIR=out node main.ts` exits 0 and packs the entry. Combat and vehicle visuals are exercised in-browser; the renderer is a live WebGL scene and has no headless unit tests.

## Build notes

- Weapon stats are defined in `game/src/weapons.js` (`WEAPONS` map) with `WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle', 'compactsmg']`; the compact SMG carries `mag: 32`, `reloadMs: 1.5`, and a cool-blue `flash: [0.45, 0.85, 1.0]`.
- The compact SMG has `damage: 14`, `cooldown: 0.085`, `spread: 0.07`, `range: 440`, `maxAmmo: 192`, `startAmmo: 64`, `pack: 32` — fires faster and spreads more than the pistol (`damage: 25`, `spread: 0.01`).
- Per-weapon `recoil` and `kick` are columns in `WEAPONS` (e.g. pistol `recoil: 0.012, kick: 0.14`; shotgun `recoil: 0.04, kick: 0.5`); `combat.js` applies kick as a camera pitch impulse and recoil as decaying aim drift.
- The reload is keyed to `G` (or fires automatically when the mag runs dry); ammo pickups spawn from `updatePickups` with `PICKUP.max = 5`, `radius = 30`, `interval = 6`, and a spawn distance band of `minDist: 120` / `maxDist: 520`.
- Vehicle damage thresholds: below 50% hp `combat.js` emits smoke puffs, and at 0 hp `explodeCar` runs the two-stage fireball plus debris/smoke/spark/shockwave; a distance-scaled `explShake` shakes the camera.
- Killed pedestrians enter a `DOWN` state in `peds.js` (knocked back and folded flat) instead of teleporting away, then are recycled off-screen.
- The muzzle flash now spawns at the correct height (on-foot vs. drive-by) and drives the pooled point lights; tracers stay color-matched (player warm-white, cop red).
- Modules touched: `weapons.js` (53 lines), `combat.js` (593), `peds.js` (200), `render3d.js` (2777).