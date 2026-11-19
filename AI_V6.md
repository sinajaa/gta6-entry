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

### Coordination flow

`updatePolice` (called from `main.js` each frame) assigns roles before the cop loop, then routes each cop to `pitManeuver`, `blockAhead` or the existing `chase` logic; `updateSpikes`, the helicopter and roadblock continue to run alongside. No controls or mission scripts were changed.