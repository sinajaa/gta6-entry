# AI_V6 — Living-world AI

This entry extends the traffic, pedestrian and police systems into a coherent living world. All behaviour below is real simulation code (not scripted cutscenes) and lives in three modules under `game/src/`.

## Where it lives

| Behaviour | File |
|---|---|
| NPC traffic lane discipline + traffic-light obedience | `game/src/vehicle.js` |
| Pedestrian sidewalk walking, crossings, panic/flee from gunfire | `game/src/peds.js` |
| Police coordination (block-ahead, PIT, spike strips) | `game/src/police.js` |
| Spike strip minimap marker | `game/src/render3d.js` |

## Cars: lane discipline and traffic lights

- Each NPC car is spawned onto a lane (`car.axis`, `car.lane`, `car.dir`) and holds that lane, constantly steering back toward it — a simple lane-keeping loop, not a rail.
- Cars at intersections check the signal phase in `mustStopAtLight`. A global clock (the same `PHASE_SECONDS` used elsewhere) alternates which axis is "green". A car approaching a red light brakes using its own braking distance and holds at the stop line, then accelerates on green.
- `blockedByCar` gives car-following so cars queue behind one another instead of ghosting through.

Location: `vehicle.js` — `updateNpc`, `mustStopAtLight`, `blockedByCar`.

## Pedestrians: sidewalks, crossings, gunfire flee

- Pedestrians walk only on sidewalk tiles (`sidewalkTiles`, `onSidewalk`, `turnWalk`), turning at corners rather than walking through buildings.
- At a marked crossing, a pedestrian detects a road tile ahead of them with sidewalk on the far side (`findCrossing`), enters a `CROSS` state, walks straight across the road to the opposite sidewalk, then resumes sidewalk walking (`snapToSidewalk`).
- Gunfire and crashes already trigger `alarmPeds` (wired from `combat.js` on every shot and from `main.js` on collisions, which feed the nearby `alarmPeds` calls). Each warned pedestrian enters `PANIC`, fleeing directly away from the noise source, then cowers briefly before returning to walk.

Location: `peds.js` — `findCrossing`, `CROSS` state in `updatePeds`, `startPanic` / `alarmPeds`.

## Police: coordinated three-piece pursuit

At wanted levels the chasing cruisers split into roles each frame (`assignRoles`), then act accordingly:

- **Block ahead** — the cop with the largest forward projection along the player's heading is assigned `BLOCK`; it drives out ahead and then swings perpendicular, stopping across the lane to cut off the escape (`blockAhead`). At five stars this stacks with the existing static roadblock.
- **PIT manoeuvre** — the cop deepest behind the player is assigned `PIT`; it dives for the player's rear quarter and, once close and at the right lateral angle, taps the rear and applies a spin and speed loss to the player's car, with a cooldown (`pitManeuver`).
- **Spike strips** — at three stars or more, `updateSpikes` lays fresh strips on the road ahead of the player's heading (picking road/sidewalk tiles, spaced so they don't stack). Driving over one deflates a tyre, which is applied through the driving model: the car's top speed drops and the steering wobbles for a few seconds (`vehicle.js` `updateDrivenCar` reads `car.flatT`). Strips deplete over time and are shown as pale dashes on the minimap.

Location: `police.js` — `assignRoles`, `blockAhead`, `pitManeuver`, `updateSpikes`; deflation effect in `vehicle.js`.

- **Foot patrols** — two officers (`state.officers`, data only, not yet rendered) walk the downtown block loop at ~2 u/s, run at the player while wanted until a patrol car is within 150 units, then resume the loop (`updateOfficers`).

### Coordination flow

`updatePolice` (called from `main.js` each frame) assigns roles before the cop loop, then routes each cop to `pitManeuver`, `blockAhead` or the existing `chase` logic; `updateSpikes`, the helicopter and roadblock continue to run alongside. No controls or mission scripts were changed.

## Build notes

- Traffic-light timing is `PHASE_SECONDS = 6` (defined at the top of `vehicle.js` with `ROAD_PERIOD = 10 * TILE`); `mustStopAtLight` computes `greenAxis = Math.floor(time / PHASE_SECONDS) % 2` to alternate the horizontal/vertical axes.
- Pedestrian tuning lives in `peds.js`: `WALK_SPEED = 55`, `PANIC_SPEED = 160`, `PANIC_TIME = 4`, `COWER_TIME = 2` (all units/sec and seconds), with `findCrossing` walking a ray from a road tile to the far sidewalk.
- Foot patrols are constants in `police.js` (`FOOT_WALK = 2`, `FOOT_RUN = 95`, `FOOT_ARRIVE = 150`); `updateOfficers` moves the two `state.officers` along the downtown loop and only switches them to running while wanted.
- Spike-strip placement in `updateSpikes` checks `ground === T.ROAD || ground === T.SIDEWALK` and keeps a `SPIKE_CLEAR` separation so strips never stack; a hit writes `car.flatT` that `vehicle.js` `updateDrivenCar` reads to drop top speed and wobble steering.
- Role assignment (`assignRoles`) picks `BLOCK` from the cop with the largest forward projection and `PIT` from the one deepest behind, both refreshed every frame before the cop loop.
- `alarmPeds` is wired from two call sites — `combat.js` on every player shot and `main.js` on vehicle collisions — so both gunfire and crashes push nearby peds into `PANIC`.
- Module line counts at this checkpoint: `vehicle.js` 208, `peds.js` 200, `police.js` 437, `render3d.js` 2777.