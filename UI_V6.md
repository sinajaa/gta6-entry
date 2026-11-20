# UI_V6 — Interface layer & screens

`game/src/ui.js` provides the full interface on top of the HUD: map, pause menu, settings, mission log, photo-mode hint, weapon/ammo readout, hit marker, minimap legend, standing bar, garage menu, and the toast system, all drawn to a 960×540 HUD canvas. It does not touch mission or story logic.

## Map screen (`M`)

A full-screen map (`openMap`/`closeMap`) draws the three districts (PUSAT / TENGAH / PINGGIR) as colour-coded blocks, dark roads sampled from `world.tiles`, green parks from `world.parks`, a white player arrow rotated to facing, and yellow mission markers from `missions.markers`. The background is pre-rendered once into `buildMapCanvas` and blitted each frame; only the arrow and markers redraw live.

## Pause menu & settings (`Esc`)

`Esc` opens Resume / Settings / Save / Quit, navigated with arrows and confirmed with `Enter`. `Quit` returns to the title screen. Settings exposes four persisted options (`sunnycity.settings.v1`): render quality (RENDAH/SEDANG/TINGGI → pixel ratio and pass gating), shadows, mouse sensitivity (`combat.sens`), and master volume (`audio.setVolume`). Changes apply live through `ui.onSettings` → `applySettings` in `main.js`.

## Mission log (`Tab`)

`Tab` toggles an overlay listing `MISSION_LIST` with active rows highlighted yellow, completed green, and the rest grey. It does not pause, and doubles as the side-job launcher (see the mission selection entries in `logSelect`/`logStartSelected`/`logClick`).

## Photo-mode hint & filters (`P`)

`ui.openPhoto` freezes the world; while active the HUD (and minimap) hides and the camera orbits. `F` cycles filter presets NORMAL / NOIR / WARM / COOL (HUD-canvas tint + vignette only, not baked into the saved PNG), and Enter saves the WebGL canvas.

## HUD state

`drawPlaying` renders money, the package/collectible counter, toasts, the central prompt, the station banner, and then `drawWeapon` (name + `[slot]` + mag/reserve), the hit marker, the weapon wheel (`Q`), minimap legend, standing bar with heat shield, and the garage menu. `drawDead` renders the WASTED/BUSTED splash. `drawOverlay` handles menu and pause screens, including a STATISTIK block (drift best, collectibles, side jobs) in the pause overlay.

## Save/load

`ui.save()` writes `money`, `missionsDone`, `pkMask`, `standing`, `wanted`, `driftBest`, `sideDone` and a timestamp to `sunnycity.save.v1`; `loadSave()` restores them. `main.js` additionally persists `suncity.save` counters for cars-stolen on a 20-second interval and on `beforeunload`.

## Exported API

`createUI(hud)` returns the `ui` object with `state`, `money`, `missionsDone`, `standing`, `settings`, `toast`, `addMoney`, `save`, `saveSettings`, `link`, `handleKey`, `click`, `update(dt, ctx)`, plus the map/log/photo/pause helpers above. `GARAGE_ROWS` is exported for `extras.js`. Many HUD fields are written by other modules (`weapon`, `ammo`, `mag`, `reserve`, `hit`, `wheel`, `station`, `prompt`, `standingHud`, `wanted`, `dead`), so the UI stays a thin render-plus-state layer.

## Build notes

- The map uses a cached offscreen canvas of `MAP_VIEW_W = 820` × `MAP_VIEW_H = 456`, reusing `districtOfBlock` for fills and `names = ['PUSAT','TENGAH','PINGGIR']` for labels.
- Settings default to `{ quality: 'high', shadows: true, sensitivity: 0.5, volume: 0.7 }` and are clamped on load.
- `drawMissionLog` lays out rows at `y = 172 + i * 42` in the `640..940` column, matching the click hit-test in `logClick` (first row 157, step 42).
- Weapon display keys off `ui.reserve != null` to switch between mag and total-ammo representation for the compact SMG.
- `ui.js` is 677 lines; `main.js` (366) wires keys, pointer events, settings and the photo/render loop.

## How to test

In-browser: `M` opens/closes the map; `Esc` → Settings → change quality/sensitivity/volume and confirm immediate effect; `Tab` opens the log and Enter starts a side job; `P` enters photo mode and `F` cycles filters. Confirm money, packages and standing persist across a reload. `MAKEFUN_OUTPUT_DIR=out node main.ts` exits clean.