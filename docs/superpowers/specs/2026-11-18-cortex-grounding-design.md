# Cortex grounding & two-way index — design

**Date:** 2026-11-18
**Status:** awaiting approval
**Predecessor:** `docs/superpowers/specs/2026-11-17-t1-atom-calibration-design.md`

## Why

The T1 side is now a working hippocampal loop: raw trace + turn code + sparse
atoms + episode index + replay. The cortical side has the functions (semantic /
procedural abstraction, consolidation, forgetting), but the **index between the
two layers is weak**. Live audit of `~/.mafw/memory/.harmonic_index.json`:

| metric | value |
|---|---:|
| Harmonic units | 17,559 |
| semantic / procedural / global | 8,648 / 6,809 / 88 |
| legacy `episodic` still stored | 2,014 (11.5%) |
| superseded (soft) | 5,099 (29%) |
| units with exact `source_trace_ids` | 699 (4.0%) |
| units with `episode_id` | **0** |
| new units in last 7d | 5,830 |
| last-7d units with provenance | 699 (12%) |

So the cortex is largely "floating knowledge": it can say *what* it believes,
but rarely *which experience* it came from. Indexing theory says a cortical
trace should point back to the hippocampal episode; today it almost never does.

## Goals

- Every **new** cortical write that has resolvable source traces carries an
  `episode_id`.
- Reflection (the main semantic/procedural writer) sets it from the episode it
  actually processed.
- Merges/updates never drop an existing `episode_id`.
- Backfill the **exact** 699 trace-linked units; do not guess the rest.
- Expose `episodeCoverage` in `/api/memory/stats`, `episode_id` in
  `mafw_get_memory`, and the type in the SDK.
- Measure before/after on the live gateway.

## Non-goals (separate plans)

- **E2 — novelty/mismatch (CA1)**: a surprise score at encode, used to
  prioritize replay/reflection.
- **E3 — cortex hygiene + dictionary**: archive the 2,014 legacy episodic units,
  compact the 5,099 superseded entries, expand the 12-anchor dictionary or move
  to term-level sparse coding.
- **E4 — replay sampling by surprise/activation.**

## Decisions

1. **`episode_id` is a single soft hint, not a foreign key.** A memory can draw
   from several episodes; the field records the first resolvable source trace's
   episode (reflection falls back to the batch's last episode). No join is
   required at read time.
2. **Derived server-side only.** Clients may send `sourceTraceIds`; they cannot
   set `episode_id`. The existing HTTP route already does this; reflection and
   MCP get the same helper.
3. **One helper, four writers.** `deriveEpisodeId(lookup, traceIds)` is used by
   the dashboard route, the MCP add-memory handler, reflection, and the
   consolidation merge. A writer that does not call it is a test failure.
4. **Backfill by exact trace only.** For units without `source_trace_ids`, do
   not guess from session/time; report them as `ungrounded`. A later phase can
   add a time-window heuristic if the coverage is too low.
5. **No new HTTP route.** Stats field + existing get-memory response only.
6. **Fail-open.** Episode lookup errors leave the memory written without a link;
   they never fail the write.

## Success criteria

- New reflection units: `episode_id` present when the batch has an episode.
- New `mafw_add_memory` with a trace that resolves: `episode_id` present.
- Backfill: all 699 trace-linked units attempted; resolved count reported.
- `/api/memory/stats.t1.provenance` exposes `{withExact, coverage, withEpisode,
  episodeCoverage}`.
- Full gateway suite green; the T1 eval is unaffected.
