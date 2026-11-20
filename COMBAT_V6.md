# COMBAT_V6 — Combat & vehicle feedback

Combat and vehicle damage give every shot and collision real weight. Hits read clearly, cars degrade and detonate, pedestrians fall over when killed, and a fifth weapon adds magazine-based fire. Everything is driven from `game/src/combat.js`, with weapon stats defined in `game/src/weapons.js` and death animation folded into `game/src/peds.js`.

## Five weapons with distinct feel

- `WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle', 'compactsmg']`. Each entry in the `WEAPONS` map carries `damage`, `cooldown`, `spread`, `pellets`, `range`, ammo fields, and new per-weapon `recoil` and `kick`.
- The **compact SMG** is the fifth weapon (slot 5). It fires faster and spreads more than the pistol but hits softer per shot, uses a cool-blue muzzle flash, and carries a 32-round magazine shown as `rounds/reserve` in the HUD. When the mag runs dry it reloads automatically (or on `G`), drawing from a reserve pool that pickups refill.
- **Recoil and camera kick**: each shot applies a short-lived pitch impulse (`kick`) to the camera and adds decaying aim drift (`recoil`), so sustained fire climbs.

## Impact feedback

- **Muzzle flash** spawns at the correct height (on-foot vs drive-by) and drives pooled point lights so each shot briefly lights the environment.
- **Tracers** stay colour-matched (player warm-white, cop red).
- **Hit markers** flash the crosshair (red on a kill) and **impact sparks** spray at the wall, car or ped struck.
- **Shell casings** eject from the muzzle as pooled bronze boxes, arc sideways, fall under gravity, bounce, and come to rest tumbling.

## Vehicle and pedestrian damage

- Cars track `hp`. Below 50% smoke puffs; at 0 hp a non-mission car detonates in a two-stage fireball with debris, sparks, smoke and a shockwave that shakes the camera when nearby.
- A killed pedestrian no longer teleports away — a `DOWN` state knocks them back, folds the capsule flat, and recycles them off-screen.
- `explodeCar` sets a distance-scaled `explShake` (larger magnitude, slower decay than a normal hit) so close blasts rock the camera.

## Shooting model

- Fire is hitscan. `hitscan(origin, angle, opts)` walks walls and tests cars (OBB) and peds (circle) in front of the muzzle, returning the nearest hit.
- Drive-by: when in a car, the shot originates from the car's angle with a wider `DRIVEBY_SPREAD`; otherwise aim follows the mouse ray onto a ground plane.
- Damage assigns heat by target (cops cost more than civilians), and reputation nudges per kill (peds penalise, cops reward).

## Health, police fire, and death

- The player has `health` (max 100) with armour absorbing damage first, then out-of-combat regen after `REGEN_DELAY`.
- At three stars cops open fire in bursts with a telegraph flash, line-of-sight and a `copAccuracy()` that tightens with stars and loosens with player speed; the helicopter shoots at five stars.
- Death is either `WASTED` (health zero) or `BUSTED` (caught at low speed near a cop for 3 s). Dying costs a fraction of cash (`MONEY_LOSS = 0.1`).

## Exported API

`createCombat({ gfx, world, player, police, peds, ui, missions, audio })` returns the combat state with `update(dt, keys, rawDt)`, `setMouse(x, y, rect)`, `hitscan(...)`, `forceCopFire(life)`, `explodeCar` (internal), and public fields the UI and other modules read (`weapon`, `ammo`, `mag`, `hit`, `dead`, `sens`, `vignette`, `shake`). `weapons.js` exports `WEAPONS`, `WEAPON_ORDER`, `createAmmo`, `createMags`, `refill`, `createPickups`, `updatePickups`.

## Build notes

- Stats: pistol `damage 25 / spread 0.01`, SMG `12 / 0.06`, shotgun `11 / 6 pellets`, rifle `50 / 0.004`, compact SMG `14 / cooldown 0.085 / spread 0.07 / mag 32 / reloadMs 1.5`.
- Pools are fixed-size with cursors: `TRACER_MAX = 32`, `FLASH_MAX = 8`, `SPARK_MAX = 48`, `SHELL_MAX = 40`, `DEBRIS_MAX = 48`, `SMOKE_MAX = 64`, `FIREBALL_MAX = 6`.
- Police fire constants: `COP_MIN_STARS = 3`, `COP_RANGE = 320`, `COP_BURST = 3`, `COP_DAMAGE = 6`, `HELI_DAMAGE = 4`; bust uses `BUST_RADIUS = 70`, `BUST_SPEED = 20`, `BUST_SECONDS = 3`.
- Pickups spawn via `updatePickups` with `PICKUP.max = 5`, `radius = 30`, `interval = 6`, spread `minDist 120` / `maxDist 520`.
- Sizes: `weapons.js` 53 lines, `combat.js` 608, `peds.js` 203.

## How to test

Combat visuals are live WebGL with no headless tests. In-browser: switch all five weapons (`1-5`), hold `Q` for the wheel, fire on foot and drive-by, watch casings and smoke, damage a car to 0 and confirm the explosion, and kill a pedestrian to see the `DOWN` fold. Reload the compact SMG with `G` after emptying the mag. `MAKEFUN_OUTPUT_DIR=out node main.ts` exits clean and packs the entry.