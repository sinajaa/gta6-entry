# MISSIONS_V6 — Story chain, side jobs & checkpoint respawn

`game/src/missions.js` holds the mission system: eight chained story missions plus six player-started side jobs, all driven by a data table and a per-mission handler registry, with checkpoint respawn so a failed mission retries from its last objective.

## Design shape

- **Story frozen** — the eight missions (`delivery` … `finale`) advance through a cursor (`cursor = (cursor + 1) % STORY_MISSIONS`), untouched. Side jobs are appended to `MISSION_LIST` with `kind: 'side'` and are never reached by the story cursor; they start manually from the mission log.
- **Data-driven** — every mission is a row in `MISSION_LIST` with `id`, `title`, `who`, `reward`, `limit`, `intro`, `win`, `lose` (and `kind` for side jobs). A `HANDLERS` map gives each one its `update(a, focus, dt)`, `text(a)`, `markers(a)`, `target(a)`, and an optional `noLimit`.

## Eight story missions

courier delivery (pick up → deliver), car chase (tail a fleeing car), target execution (destroy a parked car), escort protection (defend Lena from thugs for 60 s), warehouse theft (grab cargo → police → safe point), a checkpoint race, a police siege (survive 45 s), and the finale (meet the boss, destroy his car). Rewards climb 300 → 1500.

## Six side jobs (from the mission log)

1. **heist** (PERAMPOKAN BANK, 2 gelombang) — reach the bank, then hold through two 20-second police waves while a pulse timer re-heats the wanted level, then escape by car to a safe point `350–650` units away. Reward `$1200`.
2. **taxi** (TARIF TAKSI) — pick up a passenger, deliver to a `350–700`-unit destination. `$400`, timed 90 s.
3. **stunt** (LOMPATAN STUNT, 3 ramp) — three ramps; enter each within 34 units at >140 units/sec, score air time (up to 100 = `air * 80`) plus a +40 clean landing, then finish. Reward `$900`.
4. **bounty** (BURUAN HIDUP) — chase a target at 240 units/sec (hp 150); tail within 30 units (drains 40 hp/s) or ram at >150 (80 hp/s); 2.5 s hold or 0 hp finishes. `$1000`, timed 90 s.
5. **pizza** (KIRIM PIZZA, 3 titik) — deliver three chained drops, bonus for speed. `$250` + bonus.
6. **repo** (REPOSESSI MOBIL) — steal a marked car, return to the garage before it drops to 35% hp. `$1500`.

## Checkpoint respawn

On `fail()`, if the active mission has advanced past stage 0, its objective state is captured into `m.checkpoint` (`stage`, plus per-mission fields like `dest`, `pickup`, `points`, `score`, `ramps`, and heist `wave`/`waveT`/`waveDuration`). The next `start()` of the same id restores it, so a retry resumes at the last passed objective. `m.checkpoint` clears on `finish()` and on any unrelated start.

## Mission-log selection (UI)

`ui.logIdx` tracks a highlighted row; Up/Down move it, Enter or a click starts a *side* job (closing the log). Side rows render cyan with a "SIDE JOB — Enter untuk mulai" hint; the selected row gets a gold outline. `main.js` routes pointer-down to `ui.logClick` while the log is open.

## Exported API

`createMissions(world, ui, audio)` returns `{ list, active, done, markers, target, focus, checkpoint, next(), startSide(id), start(id), update(dt, player, w), abort(), objectiveText }`. `MISSION_LIST` is exported directly. The same `markers`/`target`/`objectiveText` contract is reused by the v8 heist, race and taxi modules, so `main.js` composes a single `objectiveView` the renderer consumes without changes.

## Build notes

- All mission logic is in `game/src/missions.js` (728 lines); the six side jobs live in `MISSION_LIST` with `kind: 'side'` and their names/rewards mirror the README.
- Side rewards/limits: heist `1200/240`, taxi `400/90`, stunt `900/120`, bounty `1000/90`, pizza `250/180`, repo `1500/180`.
- Checkpoint `snapshotCheckpoint` stores `stage` and the per-mission fields on `fail()`; `restoreCheckpoint` reapplies them on the next matching start.
- Stunt scoring requires entering the ramp within 34 units while travelling >140 units/sec; a slower approach toasts "LAJU TERLALU PELAN".
- `finish()` adds the reward plus any `a.bonus`, bumps `missionsDone` (story only), pays district rep, and calls `ui.save()`; a cooldown `gap` spaces the next story mission.

## How to test

Serve the game and press `Tab` to open the log; arrow to a side job, press Enter to start it, and confirm the marker advances through stages. Kill/zero a mission to trigger `fail()`, restart it, and confirm it resumes at the last objective rather than stage 0. The eight story missions chain automatically after each `finish()`. `MAKEFUN_OUTPUT_DIR=out node main.ts` exits clean.