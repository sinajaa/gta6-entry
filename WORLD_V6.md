# WORLD_V6 — Procedural city & island waterfront

`game/src/world.js` generates the procedural city grid; `game/src/render3d.js` frames it as an island with a living waterfront. Together they define the playable space SUNNY CITY runs on. Everything is real scene geometry, not backdrop trickery.

## The city grid

- A `COLS = 80` × `ROWS = 80` tile grid at `TILE = 32` (world 2560×2560 units). Tiles are `T = { ROAD: 0, SIDEWALK: 1, GRASS: 2, BUILDING: 3 }`, laid out on a `PERIOD = 10` cadence: roads on the first two rows/cols of each block, sidewalk bands on the next, and lots in the middle.
- Lots are split recursively (`splitRect`/`layoutLots`) into 3–4 buildings per block with deterministic `mulberry32` randomness; ~10% of blocks become parks instead. Building heights scale by district (`districtFloors`).
- Three districts — PUSAT (centre, tallest), TENGAH, PINGGIR (outskirts) — resolved by `districtOfBlock(bx, by)` from each block's distance to the map centre. `districtAt(x, y)` maps a world coordinate to a district.
- `buildLanePoints` precomputes the drivable lane samples; every route, spawn, chase, race and pickup system draws its random points from `world.lanePoints`.

## The waterfront (render3d.js `buildWaterfront`)

- **Ocean** — a `ShaderMaterial` plane (`OCEAN_SIZE = 6800`, 96×96 segments) at `y = -4`, displaced by three summed low-frequency sine waves with an analytic normal. The fragment shader adds sun specular, moving sparkle speckles, a brighter sun-glitter band hugging the shore, and a `uNight` tint. `syncOcean` updates time, sun/moon direction and night amount each frame.
- **Beach** — a merged ring of sandy quads with wet-sand corners, plus 54 instanced palms and 16 instanced parasols tinted from `UMBRELLA_COLORS = ['#ff3b6b', '#18c8ff', '#ffd23a', '#9b5cff', '#2ee06a']`.
- **Pier** — a merged wooden deck on two rows of stilts with railings and a line of instanced warm-glow lamps per side.
- **Marina** — a floating dock (twin pontoons + deck + three slips) with six instanced boats moored alongside.

The whole seam is merged/instanced geometry for roughly eight draw calls, and it sits outside the city grid so cars, peds, police and missions behave exactly as before.

## Player and world tuning

- `game/src/player.js` defines movement: `WALK = 150`, `SPRINT = 260`, `SWIM = 70`, with sprint stamina (`STAMINA_MAX = 100`, drain 22/s, regen 30/s). Within `WATER_EDGE = 260` of the island edge the player swims.
- Enterable interiors (`game/src/interiors.js`) add five walk-in spaces — restaurant, gun shop, bank, diner and laundromat — each with `E`-to-enter doors and spot interactions (`meal`, `ammo`, `vault`).

## Exported API

- `world.js`: `createWorld(seed = 1337)` → `{ tiles, buildings, parks, lanePoints, width, height }`; `tileAt(world, x, y)`; `districtOfBlock(bx, by)`; `districtAt(x, y)`; constants `TILE`, `COLS`, `ROWS`, `WORLD_W`, `WORLD_H`, `T`.
- `player.js`: `createPlayer(x, y)` → a player object; `updatePlayer(p, keys, world, dt)`.
- `interiors.js`: `createInteriors(ctx)` → `{ active, doors, tryInteract(), update(dt, keys), beforeDraw(), afterDraw() }`.
- `render3d.js` `buildWaterfront` is internal to `initRenderer`/`buildWorldMeshes`.

## Build notes

- District floors: pusat `3–6`, tengah `2–4`, pinggir `1–3` floors; `districtFloors` multiplies by `TILE` for height.
- `layoutLots` splits a 6×6 lot interior into 3 or 4 buildings; roofs reuse the wall colour.
- Shore props are instanced counts: 54 palms, 16 parasols, 6 boats; `OCEAN_SIZE = 6800`.
- Player edge detection: `edgeD = min(x, y, width-x, height-y)`; `inWater = edgeD < WATER_EDGE`.
- Interiors use `HALF_W = 120`, `HALF_D = 90`, `WALL_H = 44`, `DOOR_RANGE = 30`, `USE_RANGE = 34`, with interaction constants `VAULT_CASH = 2500`, `AMMO_PRICE = 200`, `MEAL_PRICE = 50`.
- Module sizes: `world.js` 144 lines, `player.js` 48, `interiors.js` 301, `render3d.js` 2791.

## How to test

Build with `MAKEFUN_OUTPUT_DIR=out node main.ts` and serve. Confirm the island edge shows ocean, beach, pier and marina; walk past `WATER_EDGE` to slow to swim pace; find doors (beam markers) and enter each interior with `E`; and open the map (`M`) to see the three district blocks over the road grid. The four `?shot=` scenes are all inside the island and unaffected by the waterfront.