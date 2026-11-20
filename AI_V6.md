# AI_V6 — Living-world AI

This module set turns SUNNY CITY's procedural grid into a believable, reactive place. Every behaviour below is real simulation code running each frame — no scripted cutscenes. Three files carry the civilian and law-enforcement intelligence, and the renderer draws a couple of their on-screen cues.

## Where it lives

| Behaviour | File |
|---|---|
| NPC traffic lane discipline + traffic-light obedience | `game/src/vehicle.js` |
| Pedestrian sidewalks, crossings, gunfire panic, idle pauses | `game/src/peds.js` |
| Coordinated police pursuit (PIT, block, spikes, foot patrol) | `game/src/police.js` |
| Spike-strip minimap markers | `game/src/render3d.js` |

## Cars: lanes and signals

- Every NPC car spawns onto a lane (`car.axis`, `car.lane`, `car.dir`) and steers constantly back toward it — a lane-keeping loop, not a rail. Cars are spawned in `createCars` (28 NPCs plus parked spots) and advanced in `updateNpc` from `updateTraffic`.
- A car approaching its lane's next intersection asks `mustStopAtLight`, which reads a global `world.time` clock against `PHASE_SECONDS` to figure out which axis is green, then brakes using the car's own braking distance and holds at the stop line until the phase flips.
- `blockedByCar` provides car-following so traffic queues bumper-to-bumper behind a stopped leader rather than ghosting through it.

## Pedestrians: sidewalks, crossings, panic, idle

- Pedestrians keep to sidewalk tiles. `turnWalk` picks a new direction only among options that stay on sidewalk, so they corner around blocks instead of clipping buildings.
- `findCrossing` probes ahead for a road tile backed by sidewalk on the far side; a ped that finds one enters `CROSS`, walks straight across, then `snapToSidewalk` resumes the walk.
- Gunfire and crashes both feed `alarmPeds`. `combat.js` calls it on every player shot and `main.js` on hard vehicle collisions; each warned ped enters `PANIC`, flees directly away from the noise, then `COWER`s before returning to walk.
- Two idle states break up the loop organically: `PHONE` (pauses near a shop front) and `SIT` (rests on a bench in a park), both resuming after a timer.
- Notes on the shared pool: any ped with `p.gang != null` is owned by `gangs.js`, and `updatePeds` skips it so the civilian and rival walkers never fight over steering.

## Police: coordinated pursuit

`assignRoles` re-splits the chase every frame before the cop loop, then routes each officer:

- **Block ahead** — the cop with the largest forward projection along the player's heading gets `BLOCK`; it drives out ahead, then swings perpendicular and stops across the lane (`blockAhead`). At five stars this stacks with the static `updateRoadblock`.
- **PIT manoeuvre** — the cop deepest behind the player gets `PIT`; it dives for the rear quarter and, once close at the right lateral angle, taps the rear to spin and slow the player (`pitManeuver`, gated by `pitCooldown`).
- **Spike strips** — at three stars or more, `updateSpikes` lays fresh strips on road/sidewalk ahead of the player, spaced so they never stack. Driving over one sets `car.flatT`, which `updateDrivenCar` reads to cut top speed and wobble steering for a few seconds. Strips deplete over time and appear as pale dashes on the minimap.
- **Foot patrols** — two `state.officers` (data only, not rendered) walk the downtown block loop; while wanted with no patrol car within 150 units they run at the player instead (`updateOfficers`).

### Flow

`updatePolice` (called from `main.js` each frame) assigns roles, then routes each cop to `pitManeuver`, `blockAhead`, or `chase`; the helicopter, roadblock, spikes and officers run alongside. No mission script or control binding was changed.

## Build notes

- Traffic-light timing is `PHASE_SECONDS = 6` in `vehicle.js` (`ROAD_PERIOD = 10 * TILE`); `mustStopAtLight` does `greenAxis = Math.floor(time / PHASE_SECONDS) % 2` to alternate axes.
- Pedestrian tuning in `peds.js`: `WALK_SPEED = 55`, `PANIC_SPEED = 160`, `PANIC_TIME = 4`, `COWER_TIME = 2` (units/sec and seconds); `alarmPeds` also has a radius parameter so call sites (gunfire 150–200, crashes 300) scale the panic circle.
- Police constants: `MAX_SPEED = [0,240,290,320,330,360]` and `COP_COUNT = [0,1,2,3,4,5]` per star; `PIT_RANGE = 60`, `PIT_ANGLE = 0.7`, `PIT_COOLDOWN = 3`; spike `SPIKE_AHEAD_MIN = 170` / `MAX = 330`, `SPIKE_MAX = 6`, `SPIKE_LIFE = 14`; foot patrol `FOOT_WALK = 2` / `FOOT_RUN = 95` / `FOOT_ARRIVE = 150`.
- Role assignment picks `BLOCK` from the cop with the largest forward projection and `PIT` from the one deepest behind, both recomputed each frame before the chase loop.
- `alarmPeds` is wired from two sites — `combat.js` (every shot) and `main.js` (collision) — so both gunfire and crashes spook nearby peds.
- Module sizes at this checkpoint: `vehicle.js` 210 lines, `peds.js` 203, `police.js` 526, `render3d.js` 2791.

## How to test

The AI is a live in-browser simulation with no headless unit tests. Serve the game (`MAKEFUN_OUTPUT_DIR=out node main.ts` to build, then `node serve.ts`) and watch traffic brake at red lights, pedestrians scatter when you shoot, and a 3+ star chase trigger spike strips, a PIT, and a block-ahead cruiser. The `?shot=chase` scene is a deterministic hand-placed pursuit for a quick visual check.