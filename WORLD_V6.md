# WORLD_V6 — island waterfront

This checkpoint frames the procedural city as an island and adds a living waterfront around its edge: an animated ocean with sun glitter, a sand beach with palms and parasols, a wooden pier, and a small marina. Everything below is real scene geometry (not backdrop trickery) and lives in one place — a `buildWaterfront` seam inside `game/src/render3d.js`.

## Design constraints honored

- **Low draw calls** — the whole seam uses merged or instanced geometry, so it adds roughly eight draw calls total:
  - the ocean is a single `ShaderMaterial` plane,
  - the beach ring is one `mergeColored` mesh,
  - palms, beach umbrellas, pier lamps and boats are one `InstancedMesh` each,
  - the pier and the marina dock are one `mergeColored` mesh each.
- **Gameplay untouched** — nothing here edits `world.js` tiles, lane points, or AI logic. All props sit *outside* the city grid (the island is the existing 80×80 tile block), so cars, pedestrians, police and missions behave exactly as before.
- **Screenshots unaffected** — the four `?shot=` scenes (`street`, `chase`, `firefight`, `driving`) are all well inside the island, so the beach, ocean, pier and marina never enter their frames.

## What was added

### Ocean plane with gentle waves and sun glitter
- A large plane (`OCEAN_SIZE = 6800`, 96×96 segments) sits below the island at `y = -4` and extends far past every edge.
- A GLSL `ShaderMaterial` displaces each vertex with three summed low-frequency sine waves (a gentle swell, not a churning sea), recomputing an analytic surface normal so lighting stays coherent.
- The fragment shader blends shallow→deep water by surface angle, then adds:
  - a specular glint (`reflect` + a sharp Blinn-style highlight) for the sun,
  - moving sparkle speckles from a time-seeded `hash21`,
  - a brighter **sun-glitter sheen band hugging the island edge** — a distance-to-island function (`uIslandHalf`) and a time-oscillating term concentrate the sparkle along the shore,
  - a night tint (`uNight`) that cools and dims the surface after dark.
- `syncOcean` updates `uTime` (wave movement), the sun/moon direction, and the night amount every frame from `renderFrame`.

### Sand beach strip
- A rectangular ring of sandy quads (one merged mesh) wraps the island edge just outside the city grid, with slightly darker "wet sand" corners.
- **Palm trees** — 54 instanced palms (a bent trunk plus fanned fronds, built with `mergeColored`) are scattered around the four beach edges with random yaw and scale.
- **Beach umbrellas** — 16 instanced parasols (pole + cone canopy) cluster near the pier and scatter elsewhere, colored from the existing `UMBRELLA_COLORS` palette.

### Wooden pier on stilts
- A merged wood deck runs east off the island, supported by two rows of cylinder stilts that descend to the seabed.
- Railings with posts and top/mid rails run along both sides, and a row of instanced warm-glow lamps lines each railing so the pier reads at night.

### Small marina with moored boats
- A floating dock (twin pontoons plus wooden deck planks and three finger slips) sits beside the pier at the waterline.
- Six instanced boats (hull, gunwale, cabin and roof in a single merged geometry) are moored alongside, each tinted a different color.

## Files changed

| File | Change |
|---|---|
| `game/src/render3d.js` | `buildWaterfront` seam (ocean/beach/palms/umbrellas/pier/marina), `buildPalmGeometry`, `buildBoatGeometry`, `flatQuad`, ocean shaders, and `syncOcean` wired into `renderFrame` |

No mission scripts, control bindings or world-generation code were changed.

## Verification

`MAKEFUN_OUTPUT_DIR=out node main.ts` exits 0 and packs the entry. The waterfront is a live WebGL scene with no headless unit tests; it is exercised in-browser alongside the rest of the renderer.