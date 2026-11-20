# VISUAL_V6 — Renderer upgrades

`game/src/render3d.js` is the renderer (2791 lines). It builds the city meshes, draws the waterfront, cars, peds and props, runs the day/night tone-mapping pipeline plus bloom with god rays, and culls distant props each frame. This entry adds baked ambient occlusion, car paint and reflective glass, a quality gate on the expensive passes, and per-frame prop culling — all clean rewrites rather than line patches, preserving the four `?shot=` scenes and the build.

## Ambient occlusion

- **Near walls** — `makeGroundTexture` bakes a soft dark rim into the ground texture just outside each building footprint (two nested strips for a gentle falloff), so walls read as sitting on the street at zero per-frame cost.
- **Under cars** — the contact `blobMesh` (one dark ellipse per car/player) is built for the hardware renderer too. `syncActors` writes one blob per vehicle each frame; static prop blobs are skipped via `gfx.blobStatic = 0` so real shadow maps still handle trees and props.

## Exposure regression fix

The first AO/lighting pass over-darkened the scene (mean luminance dropped well below the 95–125 target). Each darkening layer was tuned down while keeping god rays, car sheen and the quality gate:

- `makeGroundTexture` AO strips from `rgba(0,0,0,0.14/0.06)` down to `0.06/0.03`.
- Contact-AO blob opacity under cars from `0.22` to `0.12` on hardware (software keeps `0.35`).
- Car paint `metalness` from `0.7` to `0.1` — a metallic surface with no environment map contributes almost no diffuse and read near-black. The `clearcoat: 1.0` now carries the glossy look.

## Sun god rays

`compositeFrag` in the bloom pass marches each pixel toward the screen-space sun and accumulates the bright/fog buffer to produce light shafts. `updateGodRays` (from `renderFrame`) projects the sun/moon direction through the camera to set `uSun`, tints with `gfx.sun.color`, and fades to zero at night (the moon casts no shafts) — no extra render targets.

## Car paint fresnel + reflective glass

- `buildCarGeometry` returns `{ paint, glass }`. Paint uses `MeshPhysicalMaterial` with `clearcoat` (fresnel sheen) and low metalness, falling back to `MeshLambertMaterial` on the software renderer.
- Glass uses its own `makeGlassMaterial` shader (`glassVert`/`glassFrag`) reflecting the current day/night sky gradient along the reflected view ray, with a fresnel boost and a tight sun specular — replacing the flat `#a9d6f2` tint. `syncActors` drives `gfx.glassMesh` with the same per-car matrix so damage squash still applies.

## Quality gate & prop culling

- `applySettings` (`main.js`) derives the expensive passes from quality: **low** drops both bloom and shadow maps; **medium/high** run both. The dedicated shadows toggle still overrides. `renderFrame` skips bloom (and zeroes god-ray strength) when `gfx.bloomEnabled` is false.
- Street furniture was previously `frustumCulled = false` and drawn in full every frame. `buildProps`/`buildPropSet` records each instance's matrix and world position into `gfx.props`; `cullProps` collapses instances beyond `CULL_RADIUS = 1050` to a near-zero matrix and restores them on return — without re-indexing buffers the traffic-light colour logic depends on.

## Waterfront, night lamps & weather

- The island edge carries an animated ocean (a `ShaderMaterial` plane at `OCEAN_SIZE = 6800`, 96×96 segments), a merged beach ring, instanced palms (54), parasols (16 from `UMBRELLA_COLORS`), a wooden pier on stilts with warm lamps, and a six-boat marina — all in `buildWaterfront` with roughly eight draw calls.
- Street lamps add additive warm glow at night and faint wet-road reflection streaks after rain, scaled by `gfx.wetAmount` (set by `extras.js` weather). Verified luminance after tuning: 103/121/118/115.

## Day/night & tone mapping

`updateDayNight` drives the sky gradient, sun/moon, fog and `gfx.renderer.toneMappingExposure` from `gfx.hour`, and caches the base exposure/sun/hemi in `gfx.base` used by the shot and weather overrides. Exposure, tone mapping and shot framing are hand-tuned and treated as off-limits in edits.

## Exported API

`initRenderer(canvas, hudCanvas, world)` builds and returns `gfx` (scene, camera, renderer, materials, meshes). Other exports: `makeGroundTexture`, `buildWorldMeshes`, `syncCombat`, `syncGhosts`, `syncActors`, `syncOcean` (internal), `renderFrame(gfx, world, player, fps, police, peds, missions, combat)`, and `drawHud`.

## Build notes

- Ground/road colours are the `GROUND_COLORS` map: `T.ROAD #565b60`, `T.SIDEWALK #d9d2c3`, `T.GRASS #8fc16a`, `T.BUILDING #8c8173`.
- God rays live in `compositeFrag`/`updateGodRays`; bloom strength is `uStrength: 0.55` and the composite sun colour `#fff1dc`.
- `buildCarGeometry` splits glass out of the vertex-coloured paint shell; `syncActors` sets both `gfx.carMesh` and `gfx.glassMesh` matrices per car.
- Prop culling collapses instances at `CULL_RADIUS = 1050`; `buildCursor`/tree/box/sign/cylinder meshes are reused.
- The four `?shot=` scenes (street/chase/firefight/driving) stay inside the cull radius and are unaffected by the bloom/glass changes.

## How to test

The renderer is live WebGL with no headless unit tests. Build with `MAKEFUN_OUTPUT_DIR=out node main.ts` (exits 0) and run the four screenshots via `?shot=street&seed=1` etc. to verify framing and luminance (95–125). In-browser: confirm god rays at day fade at night, car glass reflects the sky, low quality drops bloom/shadows, and distant props pop back in when approached. Brightness is validated with the `cap_lum` harness check.