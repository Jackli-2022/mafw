# Cortex grounding minors — implementation plan

> **For agentic workers:** inline execution; TDD per task.

**Goal:** Close the E1 minors: real cortex composition stats, batched index writes, session-based `episode_hint` shadow links, and logical retirement reporting for legacy episodic.

**Spec:** `docs/superpowers/specs/2026-11-18-cortex-grounding-design.md` (decision 4: no guessing; hints are separate from `episode_id`).

## Global Constraints

- `episode_id` stays exact; `episode_hint` is a separate, hedged field with `basis` + `confidence`.
- Hints are shadow-only: retrieval does not consume them yet.
- No physical delete/archive of legacy units; report composition and keep supersede chains readable.
- Fail-open; no new HTTP route.
- Gateway tsc/build/tests must be green; SDK/contract unchanged unless a schema field is added.

## Tasks

### Task 1: Cortex composition stats

- Modify `gateway/src/routes/memory.ts`, test `gateway/tests/unit/routes/memory-wiring.test.ts`.
- Add `t1.cortex = { total, active, legacyEpisodic, superseded, exactGrounding, hintGrounding }`:
  - `active` = `!superseded_by && type !== 'episodic'`
  - `legacyEpisodic` = `type === 'episodic'`
  - `superseded` = `Boolean(superseded_by)`
  - `exactGrounding` = `withEpisode`
  - `hintGrounding` = entries with `episode_hint` (0 before Task 3)
- RED: extend the two stats expectations; run; implement; green; commit.

### Task 2: Batched index writes

- Modify `gateway/src/core/memory/harmonic-index.ts` (`addEntry(unit, tier, opts?: {save?: boolean})`), `gateway/src/memory/harmonic-file-store.ts` (`write(unit, tier?, opts?)`).
- Test: `gateway/tests/unit/memory/harmonic-index-batch.test.ts` — spy on `save`; `{save:false}` does not call it; `save()` flushes once.
- Commit.

### Task 3: `episode_hint` type + OKF/index roundtrip

- Modify `gateway/src/core/memory/harmonic-types.ts` (`EpisodeHint`, `HarmonicUnit.episode_hint`, `HarmonicIndexEntry.episode_hint`), `gateway/src/memory/okf-writer.ts`, `gateway/src/core/memory/harmonic-index.ts` (`addEntry` passthrough).
- Test `gateway/tests/unit/memory/okf-provenance.test.ts`: build/parse + store write/read/index.
- Commit.

### Task 4: Hint planner

- Modify `gateway/src/memory/cortex-grounding.ts`.
- `planEpisodeHints(entries, episodesBySession)`:
  - skip exact `episode_id` or existing `episode_hint`
  - no session → `noSession`; 0 episodes → `noEpisode`
  - 1 episode → `{basis:'session_single', confidence:0.8}`
  - >1 and `created_at >= latest.endedAt` → `{basis:'session_latest_after', confidence:0.6}`
  - otherwise `ambiguous`
- Test `gateway/tests/unit/memory/cortex-hints.test.ts`.
- Commit.

### Task 5: Hint backfill + live shadow audit

- Create `gateway/scripts/backfill-cortex-hints.ts` (dry-run/apply, batched saves every 500).
- Build `episodesBySession` from `GatewayDatabase.listEpisodes({sessionId, limit:1000})`.
- Apply via `store.write({...unit, episode_hint}, undefined, {save:false})`.
- Live: dry-run, apply, restart, stats `cortex.hintGrounding`.
- Sample 20 hints (unit abstraction vs episode intent/actors) and report structural precision; do not expose hints in retrieval.

### Task 6: Release note + final gate

- Full gateway suite, tsc, build; SDK/contract unchanged.
- `docs/releases/2026-11-18-cortex-grounding-minors.md` with counts and the hint audit.
- Commit.

## Review Focus

- A hint must never overwrite/serve as `episode_id`.
- `session_latest_after` uses the unit's write time, not the turn time; mark it medium confidence and shadow-only.
- Batched save must still flush on the final unit and on error (fail-open).
- Legacy episodic remains readable by id and excluded from default search.
