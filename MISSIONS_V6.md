# MISSIONS_V6 — side jobs and checkpoint respawn

This checkpoint adds four player-started **side jobs** launched from the mission log, plus a **checkpoint respawn** system so a failed mission retries from its last objective instead of from the very beginning. The eight chained story missions and the controls are unchanged.

## Design constraints honored

- **Story missions frozen** — the eight chained missions (`delivery` … `finale`) and the cursor that advances them are untouched. The side jobs are appended to `MISSION_LIST` with a `kind: 'side'` flag and are never reached by the story cursor, so the narrative loop runs exactly as before.
- **Controls untouched** — no existing keybinding changes. The mission log (Tab) gains arrow-key selection and Enter/mouse to start a *side* job only; existing keys keep their meaning.
- **One file for logic** — all mission logic lives in `game/src/missions.js`, with only narrow read-only UI glue in `game/src/ui.js` and `game/src/main.js`.

## What was added

### Four side jobs (started from the mission log)

**1. `heist` — PERAMPOKAN BANK (2 GELOMBANG)**

A three-stage job with a two-wave police siege and a car escape:

- **Stage 0 (reach the bank):** a yellow marker leads to the vault. Crossing `REACH` triggers the next stage, calls `addHeat(world, 150, 'heist')`, and toasts "GELOMBANG 1".
- **Stage 1 (survive two waves):** each wave lasts `waveDuration = 20s`. A `pulse` timer re-heats the wanted level so cops keep arriving. After the second wave completes, the job advances.
- **Stage 2 (car escape):** a new safe-point marker spawns `350–650` units away; reaching it calls `finish()`.
- Reward `$1200`, no time limit beyond the story `limit` guard.

**2. `taxi` — TARIF TAKSI BERJALAN**

- **Stage 0 (pickup):** drive to the pickup marker; crossing `REACH` sets the trip and toasts "PENUMPANG NAIK".
- **Stage 1 (drop off):** a destination marker spawns `350–700` units away; reaching it calls `finish()`.
- Timed: the `limit` of `90s` is enforced by the shared mission timer. Reward `$400`.

**3. `stunt` — LOMPATAN STUNT (3 RAMP)**

A timed side job scored on three marked ramps by **air time** and **landing**:

- **Three ramps** are spawned along the city's lane points (each `160–340` units from the last), shown as yellow markers; the next ramp in sequence is the active target.
- The player must be in a car (`playerCar` detects a `speed`/`angle` focus) and hit the ramp mark within `34` units while travelling faster than `140` units/sec; slower approach toasts "LAJU TERLALU PELAN".
- Crossing the ramp at speed begins an "airborne" window: `a.air` accumulates `dt` per frame until landing is detected (car slows below `90` or travels `260+` units past the ramp).
- On landing, the jump is scored: **air time** → up to `100` points (`air * 80`, capped), plus **landing** → `+40` if the car is still rolling cleanly (speed `>40` and `<260`, still on car wheels). The per-ramp total is added to `a.score`.
- After the third ramp the job calls `finish()`. Reward `$900`, `limit` `120s`.
- Checkpoint respawn preserves `a.score` and the remaining `a.ramps` (via `score`/`ramps` fields in `m.checkpoint`).

**4. `bounty` — BURUAN HIDUP**

A timed car-chase where the target flees fast and must be stopped before the timer expires:

- A `mark` car spawns `260–380` units ahead with `hp = 150` and runs at a constant `240` units/sec via `driveLane`, following the lane grid and bouncing at world edges.
- **Stop the target** by tailing within `30` units (accumulates `a.hold` and drains `40 hp/s`) or **ramming** at speed (`>150` units/sec drains `80 hp/s`). Staying close `2.5s` or reducing `hp` to `0` calls `finish()`.
- The shared mission `limit` of `90s` is the expiry: if the target is not stopped in time, the job `fail()`s.
- Reward `$1000`; the target car is cleaned up on finish/fail like the story `chase`/`execute` cars.

**5. `pizza` — KIRIM PIZZA (3 TITIK)**

A small timed delivery side job:

- Three drop points spawn in a chain (`spot(w, from, 250, 500)` each), the HUD marker advances to the next point as each pizza is delivered, and delivering all three triggers `finish()`.
- A **cash bonus** is paid on top of the base `$250` for finishing quickly: the remaining `limit` is converted via `a.bonus = round(left) * 5` and folded into the reward inside `finish()`.
- The `180s` limit is the shared mission expiry.

**6. `repo` — REPOSESSI MOBIL**

A steal-and-return side job that reuses the garage location:

- A cyan parked `mark` car spawns `260–450` units away (`speed 0`, like the story `execute`). Reaching it "steals" it: the marked car is removed from `world.cars`, `addHeat(world, 120, 'repo')` raises the wanted level, and the player drives it toward the garage.
- **Wrecking** is tracked against the car's starting health (captured at steal time into `startHp`); if `hp` drops to `35%` of it, the job `fail()`s.
- Reaching the garage (`dist < 60`, garage resolved from `world.garage` set by `extras.js`) calls `finish()`. Reward `$1500`.

### Checkpoint respawn

- On `fail()`, if the active mission has advanced past `stage 0`, the current objective state is captured into `m.checkpoint` — `stage`, and per-mission objective fields (`dest`, `pickup`, `points`, and heist wave timers `wave` / `waveT` / `waveDuration`).
- On the next `start()` of that same mission id, `m.active` is repopulated from the checkpoint, so the retry resumes at the last objective (e.g. heist wave 2 instead of the drive to the bank, taxi drop off instead of pickup, race at the last passed checkpoint).
- `m.checkpoint` is cleared on `finish()` and on any unrelated mission start, so no stale state leaks across completed or different missions.

### Mission-log selection (UI)

- `ui.logIdx` tracks the highlighted row; Up/Down move it and Enter starts the selected *side* job (it closes the log and calls `missions.startSide`).
- Side-job rows render in a distinct cyan (`#7fd6ff`) with the hint "SIDE JOB — Enter untuk mulai"; the selected row gets a gold outline.
- Mouse click on a row selects and starts it via `ui.logClick`, wired in `main.js`'s pointer-down handler while the log is open.

## Files changed

- `game/src/missions.js` — six new `MISSION_LIST` entries, the `heist`, `taxi`, `stunt`, `bounty`, `pizza`, and `repo` handlers, their `init` branches, `startSide`, `playerCar`, the per-mission `bonus` reward in `finish()`, and the checkpoint cache/restore in `start`/`fail`/`finish`.
- `game/src/ui.js` — `logIdx`, `logSelect`, `logStartSelected`, `logClick`, log-open key handling, and the rewrite of `drawMissionLog` to select/start side jobs.
- `game/src/main.js` — pointer-down routing to `ui.logClick` when the log is open.
- District job reputation: `standing.js` `job()` counts finished jobs per district; at 3 it pays +$50 per job (call in `missions.js finish()`) and `repairPrice` gives 20% off garage repair (`extras.js`).
