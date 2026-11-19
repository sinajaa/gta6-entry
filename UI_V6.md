# UI_V6 — Interface features

This pass adds the game's missing interface layer on top of the existing HUD, without touching the mission scripts (`missions.js`) or the story content. The HUD drawing and the save/load flow are preserved as-is.

## Map screen (`M`)

A full-screen map is drawn on the HUD canvas. Press **M** while playing to open it; **M**, **Esc** or **Enter** closes it.

- **Districts** — the three districts (`PUSAT`, `TENGAH`, `PINGGIR`) are colour-coded blocks with centred labels, derived from `districtOfBlock` in `world.js`.
- **Roads** — road tiles are drawn as a dark grid over the district fill, sampled straight from `world.tiles`.
- **Parks** — green patches from `world.parks`.
- **Player arrow** — a white arrow at the player's position, rotated to the player's facing (or the car's heading).
- **Mission markers** — the active mission's markers (`missions.markers`) are shown as yellow dots.

The map background is pre-rendered once into an offscreen canvas (`buildMapCanvas`) and blitted each frame, so only the arrow and markers are redrawn live.

## Pause menu

Press **Esc** to open the pause menu: **Resume**, **Settings**, **Save** and **Quit**. Navigate with the up/down arrows and confirm with **Enter**. `Quit` returns to the title screen.

## Settings

The **Settings** submenu (arrow keys to pick a row, left/right to change) exposes four options, persisted to `localStorage` under `sunnycity.settings.v1`:

- **Render quality** — `RENDAH` / `SEDANG` / `TINGGI`, applied to the renderer pixel ratio.
- **Shadows** — toggles `renderer.shadowMap.enabled`.
- **Mouse sensitivity** — scales `combat.sens`, which the aim code uses to scale pointer movement from screen centre.
- **Master volume** — drives a new `audio.setVolume` on the WebAudio master gain.

Changes are applied live through `ui.onSettings` and saved immediately.

## Mission log (`Tab`)

**Tab** toggles an overlay listing the eight missions (`MISSION_LIST`) with their state: active (highlighted yellow), completed (green, with the giver's name), or not-yet-reached (grey). It does not pause the game.

## Photo mode (`P`)

Press **P** to enter photo mode:

- The HUD (including the minimap) is hidden.
- The camera orbits the player; **arrow keys** rotate yaw and change pitch/height.
- **Enter** saves the WebGL canvas as a PNG — a small "SCREENSHOT DISIMPAN" toast confirms it.
- **P** or **Esc** returns to the game.

The game world is frozen while in any of these screens, so the orbit camera renders the last live scene.

## Files changed

- `game/src/ui.js` — map, pause menu, settings, mission log, photo hint; settings load/save; new `MAP` / `PHOTO` states.
- `game/src/main.js` — key routing for `M` / `Tab` / `P`, photo-mode camera orbit and screenshot, `applySettings` wiring.
- `game/src/audio.js` — added `setVolume`.
- `game/src/combat.js` — added `sens` and centre-scaled mouse mapping.
- `game/src/touch.js` — bigger stick/button hit areas with a visible dead-zone ring, a dedicated **REM** (handbrake) button, a persistent **LARI** (sprint) toggle, and haptic vibration on press (`navigator.vibrate`).
- `game/index.html` — touch control markup/CSS for the dead-zone ring, enlarged buttons and the new handbrake button.
- `README.md` — updated controls table.