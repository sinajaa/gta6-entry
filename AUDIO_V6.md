# AUDIO_V6 — adaptive synthesized sound

This checkpoint replaces the thin WebAudio sketch in `game/src/audio.js` with a real, fully
procedural audio system — no external audio files, every sound synthesized from oscillators and
noise buffers at runtime. It keeps the three radio stations working and leaves the mission scripts
and controls untouched.

## Adaptive music director (bass, chords, drums, crossfade)

The director is a dedicated sequencer that runs on its own interval and layers three voice groups,
each on its own gain bus so they can fade independently:

- **Bass** — a sawtooth line through a lowpass whose cutoff opens with heat.
- **Chords** — triangle pads built from per-district chord sets (bright downtown, mellow outskirts).
- **Drums** — a sine kick and highpass noise hats that get denser as heat rises.

Two live inputs steer it every frame, read from `audio.update(...)` in the main loop:

- **Heat** (`police.stars`, 0–5) raises the intensity and brightness of all three layers; the layer
  bus gains are `setTargetAtTime`-crossfaded toward heat-scaled targets so a chase swells in instead
  of snapping.
- **District** (`districtAt`, 0 pusat / 1 tengah / 2 pinggir) picks a different root/chord table per
  district — the center is brighter and higher, the outskirts mellower and lower — plus a calm factor
  that pulls the whole bed down near the edge.

## Engine and tyre tied to speed (doppler-ish pitch)

A continuous engine voice (sawtooth → lowpass) and a looping bandpass noise tyre voice both start
with the AudioContext. `setDrive(speed)` maps speed (0 to ~470, the boosted top speed) to:

- an engine fundamental that rises `45 → 175 Hz` and is multiplied by a slight, time-based wobble to
  give a doppler-ish detune, with a lowpass that climbs past 600 Hz at speed,
- a tyre level and a bandpass center (700 → 2100 Hz) that scale with speed so you hear the road whine
  kick in as you accelerate.

Both lines ride `setTargetAtTime`, so entering/leaving a car fades the engine in and out smoothly.

## Richer per-gun weapon sounds with tail reverb

`shot(weapon)` now takes a weapon id and uses a per-gun profile (`GUNS`) for fundamental pitch,
burst length, lowpass start, volume, noise burst length, and reverb send. The four player weapons
(pistol, SMG, shotgun, rifle) and a `cop` profile each read distinctly:

- a noise burst shaped by a swept lowpass (the crack),
- a low sine "body thump" that decays alongside it,
- a shared **feedback delay reverb** (short delay + damped feedback loop) that gives each shot a
  decaying tail instead of a dry click.

The shotgun additionally fires a second, softer burst a hair later for the double-report. Combat
calls `audio.shot(c.weapon)` on every player shot and `audio.shot('cop')` for cop/helo gunfire.

## Ambient city bed

- **Distant traffic** — a looping lowpassed noise bed (a breathing LFO on its gain) sits under
  everything as a constant city hum.
- **Gulls near the water** — an isolated gull-voice bus only becomes audible when the player is near
  the island edge (`water` proximity, computed in the main loop from distance to the world border).
  Whenever `water > 0.3`, randomized rising-falling gull calls fire on a rolling schedule.

## Thunder follows lightning

Retained and clarified: the weather system already waited a random 300–1700 ms after the flash
before calling `audio.thunder()`; the thunder voice (a 1.8 s lowpass noise swell) is unchanged, so
the delay-to-flash relationship stays intact.

## Radio stations preserved

`NEON WAVE 101.3`, `FUNKY TOWN 94.7` and `LOFI BAY 88.1` are untouched — same sequencers, same
`setRadio`/`nextStation`/`stationName` interface, same in-car toggle and `R` to switch.

## Low-fuel warning beep

The player car's nitro reserve (`car.nitroFuel`, 0–1) is the on-board fuel gauge. A low level
(under `FUEL_LOW = 0.15`) triggers a doubled square-wave beep — two short blips (880 / 920 Hz) in
quick succession, then a ~0.9 s pause before it repeats — so a nearly drained tank pings clearly
but stays unobtrusive. The beep pattern stops the moment the reserve rises back above the
threshold. `update(...)` reads `car.nitroFuel` each frame and a `setFuel(0..1)` hook mirrors it.

## Distant siren ambient loop

A second, faint siren voice — two detuned sine tones (440 / 660 Hz) alternating on a slower 900 ms
cadence, on its own gain bus — sits under the mix as a background wail. Its gain crossfades in
with `ctx.heat` (reaching full at heat 4) over ~0.8 s via `setTargetAtTime`, so a high chase makes
a distant squad-car cry drift up through the city bed without ever stomping on the primary
`setSiren` proximity siren.

## Files changed

| File | Change |
| --- | --- |
| `game/src/audio.js` | full rewrite: adaptive music director, engine/tyre, per-gun shot + reverb, ambient bed, gull calls, low-fuel beep, distant siren loop, and `setHeat`/`setDistrict`/`setEngine`/`setWater`/`setFuel`/`update` hooks |
| `game/src/combat.js` | accepts `audio` and calls `audio.shot(c.weapon)` / `audio.shot('cop')` |
| `game/src/main.js` | passes `audio` to `createCombat`, imports `districtAt`, and calls `audio.update({car, heat, district, water})` each frame |

`MAKEFUN_OUTPUT_DIR=out node main.ts` exits 0 and packs the entry. The audio has no headless unit
tests; it is exercised in-browser alongside the renderer.

## Build notes

- The whole system lives in one file, `game/src/audio.js` (531 lines), with no external audio assets — every voice is synthesized from oscillators and noise buffers at runtime.
- The adaptive music director picks per-district pitch tables from `MUSIC_ROOTS = [[38, 41, 43], [33, 36, 38], [31, 34, 36]]` (MIDI notes for pusat/tengah/pinggir) and `MUSIC_CHORDS`, one row per district.
- Engine pitch maps speed to `45 → 175 Hz` via `setDrive`, with a `setTargetAtTime` ramp so enter/exit fades smoothly; the tyre voice sweeps a bandpass centre `700 → 2100 Hz`.
- Per-gun profiles are keyed in a `GUNS` map; `shot('pistol'|'smg'|'shotgun'|'rifle'|'cop')` drives the noise burst, sine body thump, and a shared feedback-delay reverb tail.
- The low-fuel warning reads `car.nitroFuel` against `FUEL_LOW = 0.15`, emitting a doubled square-wave beep at `880 / 920 Hz` followed by a ~0.9 s pause (`setFuel` mirrors the value each frame).
- The distant siren loop is two detuned sines at `440 / 660 Hz` on a 900 ms cadence; its gain crossfades in with `ctx.heat`, reaching full at heat 4 via `setTargetAtTime`.
- `update({car, heat, district, water})` is called from `main.js` each frame; `districtAt` is imported there to feed the director, and `water` proximity (edge distance) gates the gull-call bus.
- Radio stations `NEON WAVE 101.3`, `FUNKY TOWN 94.7`, `LOFI BAY 88.1` keep the same `setRadio`/`nextStation`/`stationName` interface, switched with `R` in-car.