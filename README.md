# SUNNY CITY

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
