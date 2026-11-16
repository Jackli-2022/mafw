# Cortex Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every new cortical memory point back to the T1 episode that produced it, backfill the exact trace-linked units, and expose grounding coverage.

**Architecture:** A single `deriveEpisodeId` helper resolves the first source trace to an episode. The dashboard route, MCP add-memory handler, reflection, and consolidation all use it. A pure planner drives a one-off backfill of existing units; stats and `mafw_get_memory` expose the link.

**Tech Stack:** TypeScript, better-sqlite3, OKF files, Jest.

**Spec:** `docs/superpowers/specs/2026-11-18-cortex-grounding-design.md`

## Global Constraints

- `episode_id` is derived server-side only; clients cannot set it.
- Every write path is fail-open: an episode lookup error writes the memory without a link.
- No new HTTP route; no T1 schema change.
- Backfill only exact `source_trace_ids`; never guess from session/time.
- Gateway type gate: `cd gateway && npx tsc --noEmit -p tsconfig.json`.
- Gateway tests: `cd gateway && npx jest --runInBand --forceExit <paths>`.

## File Structure

| File | Responsibility |
|---|---|
| `gateway/src/core/memory/provenance.ts` | `deriveEpisodeId` + episode lookup type |
| `gateway/src/recall/reflection.ts` | Set `episode_id` from the processed episode |
| `gateway/src/mcp/handlers/add-memory.ts` | Derive `episode_id` from validated traces |
| `gateway/src/routes/dashboard.ts` | Use the shared helper (behavior-preserving) |
| `gateway/src/memory/consolidation-service.ts` | Preserve/merge `episode_id` |
| `gateway/src/memory/cortex-grounding.ts` (new) | Pure backfill planner |
| `gateway/scripts/backfill-cortex-grounding.ts` (new) | Dry-run/apply backfill |
| `gateway/src/routes/memory.ts` | `withEpisode` / `episodeCoverage` stats |
| `gateway/src/mcp/handlers/get-memory.ts` | Expose `episode_id` in the response |
| `packages/gateway-sdk/src/types.ts` | `MemoryUnit.episode_id` |
| `docs/releases/2026-11-18-cortex-grounding.md` (new) | Delivered numbers |

---

### Task 1: `deriveEpisodeId` + SDK type

**Files:**
- Modify: `gateway/src/core/memory/provenance.ts`
- Modify: `packages/gateway-sdk/src/types.ts` (`MemoryUnit.episode_id?: string`)
- Test: `gateway/tests/unit/memory/provenance-episode.test.ts`

**Interfaces:**
- Produces:
```ts
export interface EpisodeLookup {
  findEpisodeByTrace(traceId: string): string | null;
}
export function deriveEpisodeId(
  lookup: EpisodeLookup | null | undefined,
  traceIds: readonly string[] | undefined,
): string | null;
```
Semantics: first trace that resolves wins; unknown/empty/throwing lookup → `null`; max 20 traces.

- [ ] **Step 1: Write the failing test**

```ts
test('first resolvable trace wins', () => {
  const lookup = { findEpisodeByTrace: (id: string) => id === 't1t_b' ? 't1ep_a' : null };
  expect(deriveEpisodeId(lookup, ['t1t_a', 't1t_b'])).toBe('t1ep_a');
});
test('unknown traces, empty input and a throwing lookup return null', () => {
  expect(deriveEpisodeId({ findEpisodeByTrace: () => null }, ['x'])).toBeNull();
  expect(deriveEpisodeId({ findEpisodeByTrace: () => 't1ep_a' }, [])).toBeNull();
  expect(deriveEpisodeId({ findEpisodeByTrace: () => { throw new Error('down'); } }, ['x'])).toBeNull();
});
```
- [ ] **Step 2: Run; expect module/type failure.**
- [ ] **Step 3: Implement** the helper; add `episode_id?: string` to `MemoryUnit`.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `feat(memory): add episode grounding helper`.

---

### Task 2: Reflection sets `episode_id`

**Files:**
- Modify: `gateway/src/recall/reflection.ts`
- Test: `gateway/tests/unit/recall/reflection-episodes.test.ts`

**Interfaces:**
- Consumes: `deriveEpisodeId` (Task 1), `ReflectEpisode.id` (episode id), `ReflectEpisode.traceIds`.

- [ ] **Step 1: Write the failing test**

Extend the existing episode test: after `pipeline.runSession('s1')`, read
`<dir>/memory/.harmonic_index.json` and assert the insight entry (primary
abstraction `baseline evidence matters`) has `episode_id: 't1ep_a'`.

- [ ] **Step 2: Run; expect `episode_id` undefined.**
- [ ] **Step 3: Implement** a `traceId -> episodeId` map from the batch, derive from `validatedTraceIds`, fall back to the last processed episode id; set `episode_id` on the unit.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `feat(memory): link reflection insights to episodes`.

---

### Task 3: MCP add-memory + dashboard use the helper

**Files:**
- Modify: `gateway/src/mcp/handlers/add-memory.ts` (add `findEpisodeByTrace?` to services)
- Modify: `gateway/src/routes/dashboard.ts` (replace inline lookup with `deriveEpisodeId`)
- Test: `gateway/tests/unit/mcp/add-memory-pressure.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
test('validated source traces derive an episode id', async () => {
  await handleAddMemory(
    { ...args, sourceTraceIds: ['t1t_a'] },
    {
      mafwDir: tmp(),
      hasTrace: () => true,
      findEpisodeByTrace: () => 't1ep_a',
      pressure: () => null,
    } as any,
  );
  expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ episode_id: 't1ep_a' }));
});
test('no resolvable trace leaves episode_id absent', async () => { ... });
```
- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Implement** in the handler after `normalizeSourceTraceIds`; refactor the dashboard route to the same helper.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `feat(memory): ground MCP and HTTP writes`.

---

### Task 4: Consolidation / merge preserves the link

**Files:**
- Modify: `gateway/src/memory/consolidation-service.ts`
- Test: `gateway/tests/unit/consolidation-service.test.ts`

- [ ] **Step 1: Write the failing test**: merge an incoming unit without `episode_id` into a target with `episode_id: 't1ep_a'`; assert the merged unit keeps it. Also assert incoming wins when both present.
- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Implement** `episode_id: incoming.episode_id ?? target.episode_id` in the merged unit; verify the `route-write` update path preserves it.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `feat(memory): preserve episode groundings on merge`.

---

### Task 5: Stats + get-memory exposure

**Files:**
- Modify: `gateway/src/routes/memory.ts`
- Modify: `gateway/src/mcp/handlers/get-memory.ts` (only if it rebuilds the unit)
- Modify: `gateway/tests/unit/routes/memory-wiring.test.ts`
- Test: `gateway/tests/unit/mcp/get-memory-episode.test.ts` (extend)

- [ ] **Step 1: Write the failing assertions**:
```ts
provenance: { memories: 3, withExact: 2, coverage: 2/3, withEpisode: 1, episodeCoverage: 1/3 }
```
and `mafw_get_memory` body contains `unit.episode_id`.
- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Implement** `withEpisode`/`episodeCoverage`; ensure the get-memory unit passes the field through.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `feat(memory): expose episode grounding coverage`.

---

### Task 6: Backfill planner + script

**Files:**
- Create: `gateway/src/memory/cortex-grounding.ts`
- Create: `gateway/scripts/backfill-cortex-grounding.ts`
- Test: `gateway/tests/unit/memory/cortex-grounding.test.ts`

**Interfaces:**
- Produces:
```ts
export interface GroundingPlan {
  updates: Array<{ id: string; episodeId: string }>;
  unresolved: string[];
  ungrounded: number;
}
export function planCortexGrounding(
  entries: Array<{ id: string; episode_id?: string; source_trace_ids?: string[] }>,
  lookup: EpisodeLookup,
): GroundingPlan;
```
- [ ] **Step 1: Write the failing test**: entries with/without traces, existing episode, unresolved traces, no traces; assert counts and update ids.
- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Implement the planner.**
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Script**: open `GatewayDatabase` + `HarmonicUnitFileStore` at `~/.mafw`; dry-run by default; `--apply` writes `episode_id` through `store.write`; print `{candidates, resolved, unresolved, applied}`.
- [ ] **Step 6: Commit** `feat(memory): backfill cortical episode groundings`.

---

### Task 7: Live rollout + measurement

**Files:** `docs/releases/2026-11-18-cortex-grounding.md`

- [ ] **Step 1: Full gate**: gateway full suite, gateway tsc, build.
- [ ] **Step 2: Restart** via `mafw-gateway-restart` (action `restart`).
- [ ] **Step 3: Dry-run** `scripts/backfill-cortex-grounding.ts`; record candidates/resolved/unresolved.
- [ ] **Step 4: Apply**; verify `stats.t1.provenance.withEpisode/episodeCoverage` and a spot-check `mafw_get_memory` unit.
- [ ] **Step 5: Write the release note** with before/after coverage, test counts, commit hash; commit it.

---

## Review Focus

- A writer that forgets the helper → new unit with traces but no episode; test each writer by name.
- Episode lookup throws / DB missing → memory still writes without a link (fail-open).
- Merge drops the link → consolidation test.
- Backfill resolves a trace to a **different** episode than expected → spot-check 5 units and print the mapping.
- `episode_id` leaks into clients as a client-set field → only server-derived; the HTTP route ignores input.
- Legacy units without traces are not guessed → `ungrounded` count stays explicit.

## Roadmap after this plan

- **E2 — CA1 novelty/mismatch**: a surprise score at turn encode, used to prioritize replay/reflection.
- **E3 — cortex hygiene + dictionary**: archive 2,014 legacy episodic units, compact 5,099 superseded, expand the 12-anchor dictionary or move to term-level sparse coding.
- **E4 — replay sampling**: prioritize surprise/high-activation traces, not just recent closed episodes.
