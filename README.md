# SUNNY CITY

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/sinajaa/gta6-entry/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/sinajaa/gta6-entry/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

A 3D open-world crime game that runs offline in your browser, built with three.js.

## Features

- **Driving** — steal any car, drive through traffic that keeps lanes and stops at red lights, and repair or repaint at the garage. Drifting scores cash and kicks up tire smoke.
- **Shooting** — five weapons (pistol, compact SMG, SMG, shotgun, rifle) behind a weapon wheel, with recoil, tracers, muzzle flash, hit markers, and tumbling shell casings.
- **Police** — a 5-star wanted level brings coordinated cops: roadblocks, PIT manoeuvres, spike strips, and a helicopter at higher stars.
- **Weather** — a day-night cycle with periodic rain and lightning.
- **Missions** — eight chained story missions plus six side jobs, with checkpoint respawn so a failed mission retries from its last objective.
- **Side jobs** — bank heist, taxi, stunt jumps, a bounty chase, pizza delivery, and car repossession.
- **Interiors** — walk into a diner, a gun shop, and a bank with a vault.
- **Audio** — three radio stations and per-weapon sound.
- **Save** — progress and settings persist in `localStorage`.

## Controls

Keyboard and mouse:

| Key | Action |
|---|---|
| WASD / arrows | Move, drive |
| Shift | Sprint (nitro in a nitro-equipped car) |
| Mouse / F | Aim; shoot with left button or F |
| 1-5 | Select weapon |
| G | Reload (compact SMG) |
| Q (hold) | Weapon wheel |
| E | Enter/exit car, use doors and the garage |
| R | Next radio station (while driving) |
| M | Full-screen map |
| Tab | Mission log |
| P | Photo mode |
| Esc | Pause menu (Resume, Settings, Save, Quit) |
| Enter | Start / save a screenshot |

Touch (on phones and small screens): a virtual joystick steers, and on-screen buttons cover enter, action/shoot, a sprint toggle, handbrake, and pause.

## Missions

Story: courier delivery, car chase, target execution, escort protection, warehouse theft, checkpoint race, police siege, and a finale. Side jobs: bank heist, taxi, stunt jumps, live bounty, pizza delivery, and car repossession. Side jobs start from the mission log without advancing the story.

## Run

```bash
MAKEFUN_OUTPUT_DIR=out node main.ts
```

This packs `game/` and `screenshots/` into `out/` and builds the dossier. For a quick play test, serve the game directory with any static server (no build step, no network — WebGL comes from the vendored three.js in `game/vendor/`).

## Screenshots

| # | Scene | Query |
|---|---|---|
| 1 | Street | `?shot=street&seed=1` |
| 2 | Chase | `?shot=chase&seed=1` |
| 3 | Firefight | `?shot=firefight&seed=1` |
| 4 | Driving | `?shot=driving&seed=1` |

Rendered screenshots live in `screenshots/`.

## Repository

- `main.ts` — entry packer: copies `game/` and `screenshots/` into the output and builds the dossier.
- `game/src/*.js` — world, render, vehicle, police, missions, combat, interiors, extras, UI, audio.
- `screenshots/` — exported screenshot scenes.
- `shots.json` — the `?shot=...` scene list.

## Build notes

- The game is 7,786 lines of source across 18 modules under `game/src/`, with `render3d.js` the largest at 2,777 lines; `main.ts` packs `game/` and `screenshots/` into `out/` via `MAKEFUN_OUTPUT_DIR=out node main.ts`.
- Five weapons are defined in `weapons.js` (`WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle', 'compactsmg']`); the compact SMG carries a 32-round mag, reloads on `G` or automatically, and fires with `damage: 14`, `cooldown: 0.085`, `spread: 0.07`.
- The world is a procedural 80×80 tile grid (`COLS`/`ROWS` in `world.js`) with tiles `T = { ROAD: 0, SIDEWALK: 1, GRASS: 2, BUILDING: 3 }` and three districts (pusat/tengah/pinggir) resolved by `districtOfBlock`.
- Traffic lights alternate green axes every `PHASE_SECONDS = 6` (`vehicle.js`); NPC cars hold their lane, brake for red, and queue via `blockedByCar`.
- The six side jobs (heist, taxi, stunt, bounty, pizza, repo) start from the mission log (`Tab`); checkpoint respawn restores the last objective from `m.checkpoint` on `fail()`.
- Key bindings: `M` map, `Tab` mission log, `P` photo mode, `Esc` pause, `F` aim/filter-cycle in photo mode, `Enter` start/save screenshot, `G` reload, `R` radio, `E` enter/use, `Q` (hold) weapon wheel, `1-5` weapon select.
- Settings persist to `localStorage` under `sunnycity.settings.v1`; the four `?shot=` scenes in `shots.json` are `1-street.jpg`, `2-chase.jpg`, `3-firefight.jpg`, `4-driving.jpg`, each using `seed=1`.

Bounty: https://make.fun/bounty/gta6-01
