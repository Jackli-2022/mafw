# T1 atom calibration + query wiring — design

**Date:** 2026-11-17
**Status:** awaiting approval
**Predecessor:** `docs/superpowers/specs/2026-11-16-two-layer-memory-separation-design.md`

## Why

The two-layer separation shipped a write-time embedding step that projects a turn
onto 12 concept anchors. Measured against the real local model
(`Qwen3-Embedding-0.6B.Q4_K_M`, 1024d):

- Chinese paraphrases map to the **correct** anchor at rank 1 (5/5, including the
  holdout `解码失败` → `error:json_parse` at 0.577).
- But **8 of 12 anchors survive per turn** at the default `0.35 / top-8`, so the
  code is 67% dense. `weather tomorrow in Shanghai` also gets 8 atoms.
- Two consequences:
  1. `intent_shift` (episode boundary) requires disjoint atom sets, and every
     turn shares 5–7 atoms, so that signal can never fire.
  2. The query side (`querySparseTermIds`) never emits `sem:` terms, so the
     stored atoms are unreachable from retrieval. The eval's `sparse: 0.938`
     is lexical + alias only.

The embedding is good; the dictionary projection and the read path are not.

## Evidence

Probe on 5 turns + 6 queries, real model:

| rule | atoms/turn | query→turn hits | pairwise atom overlap |
|---|---:|---:|---:|
| raw `0.35 / top8` (shipped) | 8.0 | 2/6 | 5–7 of 8 |
| raw `0.45 / top1` | 1.0 | 5/6 | 0–1 |
| per-anchor baseline `top1` | 1.0 | 5/6 | 0.00 |
| per-text centering `top2 / 0.03` | 1.8 | 6/6 | 0.30 |
| double centering `top2 / 0.03` | 1.8 | 5/6 | 0.20 |
| dense cosine (reference) | 1024 | 6/6 | — |

Per-anchor baselines measured on 24 generic zh/en sentences:
`0.366` (connection_reset) … `0.455` (metric:coverage). The model's unrelated-text
floor is above the shipped `0.35` threshold, which is the root cause.

Research: sentence embeddings are anisotropic; mean/background correction is the
standard training-free remedy (Ethayarajh 2019; R2/ABTT; CSLS/background
correction). SPLADE is the alternative shape (learned term-vocabulary sparsity),
but it needs an MLM head and a separate model — out of scope here.

## Goals

- Make the atom code actually sparse (≈1–2 atoms per turn) and calibrated per
  embedding provider.
- Make the atoms reachable from retrieval (`sem:` on both write and query).
- Restore `intent_shift` as a usable boundary signal.
- Backfill atoms for existing T1 turns and measure the real effect on the
  shipped eval + live gateway.
- Operate it: build, restart, backfill, observe, roll back.

## Non-goals

- Training an SAE or shipping a SPLADE model.
- Replacing dense retrieval. Dense stays `shadow` by default.
- Rewriting legacy `episodic` cortex rows.
- Mobile/TUI episode UI.

## Decisions

1. **Calibration = per-anchor baseline + per-text centering (double centering).**
   `score_k = (cos_k - b_k) - mean_j(cos_j - b_j)`. Baselines are computed once
   per provider instance from 24 reference texts sampled from real T1 rows,
   falling back to a built-in zh/en generic list when the DB is empty. No
   persistence: recomputation is cheap (36 embeddings once) and a model change
   must not reuse old baselines.

2. **Selection = top-2, `minScore 0.03`, `minTop1 0.05`.** `minTop1` lets
   out-of-domain text produce **zero** atoms instead of a forced nearest
   concept. Zero atoms is a valid state: the sparse channel abstains and the
   lexical/dense channels carry the turn.

3. **Query side uses the same encoder instance** (`getT1SemanticEncoder`
   caches per provider), so write and query share anchors and baselines. The
   query atom ids are added to the sparse lookup as `sem:<id>`; the existing
   inverted index does the rest. This costs one extra query embedding per T1
   search and only runs on async paths (snapshot builder, MCP search), never on
   the 100 ms boundary path.

4. **`intent_shift` switches from "no intersection" to atom Jaccard < 0.2.**
   With 1–2 atoms per turn this is approximately "no shared atom", but it stays
   correct when an episode's union grows.

5. **Backfill is a bounded, idempotent pass** that reuses `encodeT1Turn` with
   atoms (so lexical terms are recomputed, not lost). It runs from a one-off
   script for the initial history and is also wired into the daily
   `memory:decay` action for stragglers.

6. **No new HTTP route.** The backfill is a script + a decay hook; the only
   API change is a stats field.

## Rollback

| switch | effect |
|---|---|
| `recall.t1Recall.semanticAtoms='off'` | write and query atoms both stop; lexical code unchanged |
| `recall.t1Recall.denseIndex='on'` | restore dense fusion (independent) |
| `recall.t1Episodes.mode='shadow'` | episodes written, not consumed |
| `recall.reflectionInput='legacy-episodic'` | legacy reflection path |

Atoms are additive rows in `t1_sparse_terms`; deleting `kind='semantic'` rows
returns the previous behavior exactly.
