# SUNNY CITY

A 3D open-world crime game that runs offline in Chrome, built by an AI agent for the make.fun gta6-01 bounty.

## At a glance

SUNNY CITY is a fully offline, three.js-rendered 3D sandbox with no build step and no network calls. Drive and steal cars through a living procedural city, fight police across a 5-star wanted system, run 8 chained story missions plus 3 side jobs, buy guns, and explore interiors. It ships with a day-night cycle, weather, radio, minimap, compass, photo mode, and save.

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/sinajaa/gta6-entry/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/sinajaa/gta6-entry/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

## What you can do

- Explore a procedural city with 3 districts, and walk into interiors: a diner, a gun shop and a bank with a vault.
- Play 8 chained story missions: courier, car chase, execution, escort, warehouse theft, race, police siege and a finale.
- Switch between 4 weapons (pistol, SMG, shotgun, rifle) with a weapon wheel.
- Feel every shot: per-weapon recoil and camera kick, muzzle flash lighting with tracers, hit markers and impact sparks, and tumbling shell casings.
- Blow up cars before the cops get you — damaged vehicles scorch, deform, smoke and explode into a fireball with flying debris and a shockwave that shakes the screen.
- Knock pedestrians off their feet with a short ragdoll-like tumble.
- Raise a 5-star wanted level and face coordinated police: one cruiser blocks the road ahead, another comes from behind for a PIT manoeuvre, and spike strips appear on the road at three stars or more, alongside the police helicopter and roadblocks.
- Watch a living city: cars keep lane discipline and stop at red traffic lights at intersections; pedestrians walk the sidewalks, cross at marked crossings, and flee when gunfire erupts nearby.
- Steal cars, drive through traffic, and repair or repaint them at the garage.
- Listen to 3 radio stations while driving.
- Watch the day-night cycle turn, with periodic rain and lightning.
- Find 12 hidden packages, follow the minimap and compass, and keep your progress with save.

## Controls

| Key | Action |
|---|---|
| WASD / arrows | Move, drive |
| Shift | Sprint (nitro in a car with nitro) |
| Mouse / F | Aim with the mouse; shoot with left button or F |
| 1-4 | Select weapon |
| Q (hold) | Weapon wheel |
| E | Enter or exit a car, use doors and the garage |
| R | Next radio station (while driving) |
| M | Full-screen map (districts, roads, mission markers, player arrow) |
| Tab | Mission log (the eight missions and their state) |
| P | Photo mode (orbit camera, save a screenshot) |
| Esc | Pause menu (Resume, Settings, Save, Quit) |
| Enter | Start from the menu / save a screenshot in photo mode |

## Photo mode

Press **P** to enter photo mode: the HUD is hidden and the camera orbits your character. Use the **arrow keys** to orbit and change height, and **Enter** to save a screenshot as a PNG. Press **P** or **Esc** to return to the game.

The pause menu's **Settings** screen lets you change render quality, shadows, mouse sensitivity, and master volume; the choices are remembered between sessions.

## How it runs

```bash
python3 -m http.server 8080 --directory game
# then open http://localhost:8080
```

No build step, no network. WebGL comes from the vendored three.js in `game/vendor/`.

## Under the hood

- three.js renders the city, vehicles, interiors and effects.
- Geometry is merged and textures are drawn on canvases, which keeps draw calls low.
- Vehicles use a simple arcade physics model.
- All art, names, characters and audio are original and generated in code.

## Repository

- `main.ts` - entry packer: copies `game/` and `screenshots/` to the output and builds the dossier
- `game/` - `index.html` and `src/*.js` (world, render3d, vehicle, police, missions, combat, interiors, extras, ui, audio)
- `screenshots/` - the four contact-sheet screenshots
- `shots.json` - screenshot scene list (`?shot=...` URLs)
