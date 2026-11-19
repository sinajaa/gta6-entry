# VISUAL_V6 — renderer upgrades

This pass improves the `game/src/render3d.js` renderer with real code for ambient occlusion, sun god rays, car paint/glass shading, a quality gate for shadows+bloom, and per-frame prop culling. All changes are clean function rewrites (not line patches) and preserve the four `?shot=` screenshot scenes and the `MAKEFUN_OUTPUT_DIR=out node main.ts` build.

## Cheap ambient occlusion

- **Near walls** — `makeGroundTexture` bakes a soft dark rim into the ground texture just outside every building footprint (two nested strips for a gentle falloff). Walls read as sitting on the street instead of floating over flat colour, at zero per-frame cost.
- **Under cars** — the contact-AO `blobMesh` (previously software-only) is now built for the hardware renderer too. `syncActors` already writes one dark ellipse under every car, and the player, each frame; on hardware the static prop blobs are skipped (`gfx.blobStatic = 0`) so real shadow maps still do the tree/prop work.

## Exposure regression fix (post-pass)

The first AO/light pass over-darkened the scene: measured mean luminance fell to ~27 on the chase scene and ~71 on street (target 95–125), with crushed blacks. Root causes were the three darkening layers landing at once, all now tuned down while keeping god rays, car-paint sheen and the quality gate intact:

- `makeGroundTexture` AO strips reduced from `rgba(0,0,0,0.14)`/`0.06` to `0.06`/`0.03`.
- Contact-AO blob opacity under cars reduced from `0.22` to `0.12` on the hardware renderer (software keeps `0.35`).
- Car paint `metalness` reduced from `0.7` to `0.1`. A metallic surface with no environment map contributes almost no diffuse, so `metalness: 0.7` read as near-black across every car. The clearcoat (`clearcoat: 1.0`) supplies the fresnel sheen, which is now what carries the glossy car-paint look instead of flattened metal.

## Sun god rays through the fog

`compositeFrag` in the bloom pipeline gained a god-ray term: it marches each pixel toward the screen-space sun and accumulates the bright/fog glow buffer, producing light shafts. `updateGodRays` (called from `renderFrame`) projects the current `SUN_DIR`/`skySunDir` through the camera to set `uSun`, tints with `gfx.sun.color`, and fades strength to zero at night (the moon casts no shafts). No extra render passes or targets.

## Car paint fresnel + sky-reflecting windows

- `buildCarGeometry` now returns `{ paint, glass }` (a new colourless `mergeParts` twin of `mergeColored`). The glass pieces (cabin band + two side windows) are split out of the vertex-coloured paint shell.
- Paint uses `MeshPhysicalMaterial` with `clearcoat` for a fresnel sheen and low `metalness` (`0.1`) so diffuse colour stays visible (falls back to `MeshLambertMaterial` on the software renderer).
- Glass gets its own `makeGlassMaterial` shader (`glassVert`/`glassFrag`) that reflects the current day/night sky gradient (`uTop`/`uMid`/`uHor`, updated each frame from `updateDayNight`) along the reflected view ray, with a fresnel boost and a tight sun specular. It supersedes the old flat `#a9d6f2` tint and no longer inherits the car's paint colour under damage.
- `syncActors` transforms the new `gfx.glassMesh` with the same per-car matrix (so damage squash still applies), while paint darkening stays on `gfx.carMesh`.

## Render quality toggles shadows + bloom

`applySettings` (`main.js`) now derives the expensive passes from the quality tier: **low** drops both bloom and shadow maps, **medium/high** run both. The existing dedicated "shadows" toggle still overrides the shadow map on top. `renderFrame` skips `renderBloom` (and `updateGodRays` zeroes its strength) when `gfx.bloomEnabled` is false, falling back to a direct tone-mapped render.

## Per-frame prop culling

Street furniture (`treeMesh`, `boxMesh`, `cylMesh`, `signMesh`) was previously `frustumCulled = false` and drawn in full every frame. `buildProps` now records each instance's original matrix plus its world position into `gfx.props` (`buildPropSet`), and `cullProps` (called each frame) collapses instances beyond `CULL_RADIUS` (1050) to a near-zero matrix, restoring the original when the camera returns. This skips distant props without re-indexing the instance buffers that the traffic-light colour logic depends on.

## Verification

`MAKEFUN_OUTPUT_DIR=out node main.ts` exits 0; `node --check` passes on `game/src/render3d.js` and `game/src/main.js`. The four `?shot=` scenes are street/chase/firefight/driving daytime shots, all well within the cull radius and unaffected by the bloom/glass changes; the renderer remains a live WebGL scene with no headless unit tests, so runtime visuals are exercised in-browser.