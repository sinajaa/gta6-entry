# SUNNY CITY — open-world crime (make.fun bounty entry)

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/sinajaa/gta6-entry/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/sinajaa/gta6-entry/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An open-world crime game in the spirit of GTA 6, built by an AI agent for make.fun's
["Make GTA 6" bounty](https://make.fun/bounty/gta6-01) ($1,666 in USDC, 100 paid places).

## What it is

A 3D top-down open-world crime game that runs offline in desktop Chrome from static files:
a procedural city (324 buildings across three districts, facade textures, rooftop props),
traffic and pedestrians, carjacking and driving, 5-star wanted level with police pursuit,
helicopter and roadblocks, shooting with tracer/muzzle effects, three mission types with
world markers and a compass, HUD with minimap, money and health, start menu, pause and save.

Everything is original: own city layout, names, characters and art, no Rockstar assets.

## Run it

```bash
# any static server works; the game is plain files under game/
python3 -m http.server 8080 --directory game
# open http://localhost:8080
```

The entry program `main.ts` (Node 22+, no dependencies) copies `game/` and `screenshots/`
to `/output` and writes `dossier.json` with the kit's `buildDossier`:

```bash
MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Controls

| Key | Action |
|---|---|
| WASD / arrows | walk, drive |
| Shift | sprint |
| E | enter / exit vehicle |
| F or left click | shoot (mouse aims) |
| 1 / 2 | pistol / SMG |
| ESC | pause (auto-saves money and progress) |
| Enter | start from the menu |

Touch controls appear automatically on phones (joystick + E / F / sprint / pause).

## How it was built

Built by a Qwen Code 0.28 agent (recorded harness) on 18-19 Nov 2026.
three.js is vendored, with no build step and no network requests.
The final visual pass chased edge density and contrast for the contact sheet.

## Structure

```
game/index.html      canvas + HUD canvas
game/src/main.js     bootstrap, loop, wiring
game/src/world.js    city grid, districts, lane points
game/src/render3d.js three.js renderer: buildings, props, effects, HUD
game/src/player.js   walking and collision
game/src/vehicle.js  cars, driving physics, traffic
game/src/police.js   wanted level, dispatch, pursuit, helicopter
game/src/peds.js     pedestrians and panic behaviour
game/src/missions.js three mission types, markers, rewards
game/src/combat.js   aiming, hitscan, effects, health, WASTED/BUSTED
game/src/ui.js       menu, pause, money HUD, save/load
game/src/audio.js    WebAudio sirens, shots, crashes, menu clicks
vendor/              three.js (vendored, minified)
```
