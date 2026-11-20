# AUDIO_V6 — Adaptive synthesized sound

SUNNY CITY's entire soundscape is synthesized at runtime in `game/src/audio.js` — no external audio files, every voice built from oscillators and noise buffers through WebAudio. It layers an adaptive music director, a speed-following engine and tyre bed, per-weapon gunshots with reverb tails, city ambience, and weather cues, all driven by a single `update(...)` call in the main loop.

## Adaptive music director

A dedicated sequencer runs on its own interval and layers three voice groups, each on its own gain bus so they fade independently:

- **Bass** — a sawtooth line through a lowpass whose cutoff opens with heat.
- **Chords** — triangle pads from per-district chord sets (bright downtown, mellow outskirts).
- **Drums** — a sine kick and highpass noise hats that densify as heat rises.

Two live inputs steer it every frame, read from `audio.update(...)`:

- **Heat** (`police.stars`, 0–5) raises intensity and brightness across all three layers; bus gains crossfade toward heat-scaled targets via `setTargetAtTime`, so a chase swells in rather than snapping.
- **District** (`districtAt`, 0 pusat / 1 tengah / 2 pinggir) selects a root/chord table per district — the center brighter and higher, the outskirts mellower — plus a calm factor that pulls the whole bed down near the edge.

## Engine and tyre tied to speed

A continuous sawtooth engine voice and a looping bandpass noise tyre run from the first use. `setDrive(speed)` maps speed (0 → ~470, the boosted top speed) to an engine fundamental climbing `45 → 175 Hz` with a slight time wobble for a doppler-ish detune, and a tyre level plus bandpass centre sweeping `700 → 2100 Hz`. Both ride `setTargetAtTime`, so getting in or out of a car fades the engine in and out.

## Per-gun shots with reverb

`shot(weapon)` takes a weapon id and looks up a `GUN_PROFILES` entry for fundamental pitch, burst length, lowpass start, volume, noise length and reverb send. The five player weapons (pistol, SMG, compact SMG, shotgun, rifle) and a `cop` profile each read distinctly, built from a swept-lowpass noise crack plus a decaying sine "body thump", both sent through a shared feedback-delay reverb. The shotgun fires a second softer report slightly later. `combat.js` calls `audio.shot()` for the player and `audio.shot('cop')` for police/helo fire.

## Ambient city bed and weather

- **Distant traffic** — a looping lowpassed noise bed with a breathing LFO sits under everything.
- **Gulls** — an isolated gull bus rises only near the island edge (`water` proximity, computed in the main loop); when `water > 0.3`, randomized rising-falling calls fire on a rolling schedule.
- **Rain and thunder** — `setRain(amount)` fades a highpass noise bed with the weather system; thunder is a ~1.8 s lowpass swell, and the weather script already delays `audio.thunder()` 300–1700 ms after the flash so the thunder follows the lightning.
- **Sirens** — a near `setSiren(intensity)` proximity two-tone (650/950 Hz) plus a distant 440/660 Hz ambient wail whose gain crossfades in with `heat`, reaching full around heat 4.
- **Low-fuel beep** — when the nitro reserve (the on-board fuel gauge) drops under `FUEL_LOW = 0.15`, a doubled square-wave blip (880/920 Hz) pings on a ~0.9 s loop and stops the moment the reserve climbs back.

## Six radio stations

`radio.js` packages six stations (Neon Wave 101.3, Funky Town 94.7, LoFi Bay 88.1, Green Ridge 76.9, Pulse 108.5, Rock Classics 99.9), each with a genre, DJ banter lines and a jingle. The actual synthesized bed is three procedural step sequencers in `audio.js` (`STATIONS`), switched with `audio.nextStation`; the music changes per bed so each station sounds distinct. `R` / `[` cycle stations while driving.

## Exported API

`createAudio()` returns a state handle used across the game. Key methods: `start()`, `setSiren(intensity)`, `shot(weapon)`, `crash(strength)`, `click()`, `complete()`, `setRadio(on)`, `nextStation()`, `stationName()`, `setRain(amount)`, `thunder()`, `pickup()`, `toggleMute()`, `setVolume(vol)`, `setHeat(h)`, `setDistrict(d)`, `setEngine(speed)`, `setWater(a)`, `setFuel(f)`, and the central `update({ car, heat, district, water })` that `main.js` calls each frame.

## Build notes

- Everything lives in `game/src/audio.js` (531 lines) with zero audio assets; master volume is `MASTER_VOLUME = 0.35`, applied through the master gain and overridden by Settings (`audio.setVolume`).
- District tables are `MUSIC_ROOTS = [[38,41,43],[33,36,38],[31,34,36]]` (MIDI notes for pusat/tengah/pinggir) and `MUSIC_CHORDS`, one row per district; step spacing is `MUSIC_SPB = 60/95/4`.
- Per-gun profiles live in `GUN_PROFILES`; the compact SMG and shotgun have their own double-report / tighter burst signatures.
- Radio sequencer apps are indexed in `STATIONS`; `radioTick` schedules steps on a lookahead horizon, `setRadio` crossfades the radio gain 0↔0.6, and `nextStation` steps the bed index.
- `update({car, heat, district, water})` is called from `main.js`; `districtAt` is imported there to feed the director, and `water` (edge distance) gates the gull bus.

## How to test

No headless unit tests — audio is exercised in-browser beside the renderer. Serve the game and confirm: entering a car fades the engine in, a wanted level swells the music and sirens, `R` switches station (bed and jingle change), rain triggers thunder after lightning, and driving near the island edge brings gulls. `MAKEFUN_OUTPUT_DIR=out node main.ts` packs the entry cleanly.