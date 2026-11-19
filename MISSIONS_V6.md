# MISSIONS_V6 — side jobs and checkpoint respawn

This checkpoint adds two player-started **side jobs** launched from the mission log, plus a **checkpoint respawn** system so a failed mission retries from its last objective instead of from the very beginning. The eight chained story missions and the controls are unchanged.

## Design constraints honored

- **Story missions frozen** — the eight chained missions (`delivery` … `finale`) and the cursor that advances them are untouched. The side jobs are appended to `MISSION_LIST` with a `kind: 'side'` flag and are never reached by the story cursor, so the narrative loop runs exactly as before.
- **Controls untouched** — no existing keybinding changes. The mission log (Tab) gains arrow-key selection and Enter/mouse to start a *side* job only; existing keys keep their meaning.
- **One file for logic** — all mission logic lives in `game/src/missions.js`, with only narrow read-only UI glue in `game/src/ui.js` and `game/src/main.js`.

## What was added

### Two side jobs (started from the mission log)

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

### Checkpoint respawn

- On `fail()`, if the active mission has advanced past `stage 0`, the current objective state is captured into `m.checkpoint` — `stage`, and per-mission objective fields (`dest`, `pickup`, `points`, and heist wave timers `wave` / `waveT` / `waveDuration`).
- On the next `start()` of that same mission id, `m.active` is repopulated from the checkpoint, so the retry resumes at the last objective (e.g. heist wave 2 instead of the drive to the bank, taxi drop off instead of pickup, race at the last passed checkpoint).
- `m.checkpoint` is cleared on `finish()` and on any unrelated mission start, so no stale state leaks across completed or different missions.

### Mission-log selection (UI)

- `ui.logIdx` tracks the highlighted row; Up/Down move it and Enter starts the selected *side* job (it closes the log and calls `missions.startSide`).
- Side-job rows render in a distinct cyan (`#7fd6ff`) with the hint "SIDE JOB — Enter untuk mulai"; the selected row gets a gold outline.
- Mouse click on a row selects and starts it via `ui.logClick`, wired in `main.js`'s pointer-down handler while the log is open.

## Files changed

- `game/src/missions.js` — two new `MISSION_LIST` entries, `heist` and `taxi` handlers, their `init` branches, `startSide`, and the checkpoint cache/restore in `start`/`fail`/`finish`.
- `game/src/ui.js` — `logIdx`, `logSelect`, `logStartSelected`, `logClick`, log-open key handling, and the rewrite of `drawMissionLog` to select/start side jobs.
- `game/src/main.js` — pointer-down routing to `ui.logClick` when the log is open.