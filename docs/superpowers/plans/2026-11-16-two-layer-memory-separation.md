# 两层记忆分离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** T1 owns episodic memory (episodes + trace), Harmonic owns semantic/procedural knowledge, and recall/UI present the two layers separately.

**Architecture:** Add derived `t1_episode_boundaries` / `t1_episodes` / `t1_episode_members` tables, a declared-first boundary builder, and an episode search layer. Stop new `episodic` writes in turnCompress, switch reflection/sessionContext to T1 episodes, filter legacy episodic from cortex recall, and demote T1 dense to a configurable channel. Ship behind flags, shadow first.

**Tech Stack:** TypeScript, better-sqlite3, Jest (gateway), node:test + @mafw/test-shim (desktop), SolidJS + @mafw/ui v2, gateway-sdk.

**Spec:** `docs/superpowers/specs/2026-11-16-two-layer-memory-separation-design.md`

## Global Constraints

- raw T1 (`t1_observations` / `t1_archive` / `t1_turns`) is immutable; every episode table is derived/rebuildable.
- single customer, multi-client; no project/session isolation or multi-tenancy.
- soft supersede only; never physically delete memories or T1 rows.
- sync `/api/recall/context` keeps its 100ms contract; episode retrieval never runs there.
- default flags: `recall.t1Episodes.mode='shadow'`, `recall.t1Recall.denseIndex='shadow'`, `recall.t1Recall.semanticAtoms='on'`.
- no raw `<button>` / `<input>` / bare `title`; use `@mafw/ui` v2 and theme tokens.
- gateway typecheck: `npx tsc --noEmit -p tsconfig.json` (must pass `-p`).
- desktop typecheck: `npx tsgo --noEmit -p tsconfig.json`.
- desktop single-file tests must use `--conditions=browser`.
- gateway tests: `npx jest --runInBand --forceExit <paths>`.
- do not run `electron-vite build` and packaging concurrently.
- commit after every task; do not mix phases in one commit.

## Review Focus

1. A declared boundary at the first turn (`after_turn=0`) must not create an empty episode or drop the first turn.
2. `/new-episode` pending flag must survive a restart and no-new-turn wait without retroactively moving completed turns.
3. Rebuild with active + archived turns and a mid-session boundary must be idempotent and keep `episodeId` stable while `endTurn` grows.
4. A pinned/sticky or directly fetched legacy `episodic` memory must remain visible and tagged, not silently hidden.
5. `denseIndex='off'` must still produce `sem:` atoms and keep `intent_shift` working when the embedding runtime is available.

---

## Phase 1 — Episode core (shadow, no behavior change)

### Task 1: Episode types + DB schema/methods

**Files:**
- Create: `gateway/src/recall/t1-episodes.ts`
- Modify: `gateway/src/memory/gateway-db.ts` (constructor schema block + methods)
- Test: `gateway/tests/unit/gateway-db-t1-episodes.test.ts`

**Interfaces:**
- Produces:
```ts
export type T1EpisodeStatus = 'open' | 'closed';
export type T1EpisodeBoundarySource = 'declared' | 'inferred' | 'session_end' | 'max_length';
export type T1EpisodeBoundaryReason =
  | 'user_declared' | 'agent_declared' | 'actor_shift' | 'topic_shift'
  | 'intent_shift' | 'idle_timeout' | 'session_deleted' | 'max_length';

export interface T1EpisodeBoundary {
  sessionId: string;
  afterTurn: number;               // turn N belongs to old episode, N+1 to new; 0 = before first
  source: 'agent' | 'user' | 'system';
  reason?: T1EpisodeBoundaryReason;
  intent?: string;
  createdAt: number;
}

export interface T1EpisodeRecord {
  episodeId: string;
  sessionId: string;
  startTurn: number;
  endTurn: number;
  status: T1EpisodeStatus;
  startedAt: number | null;
  endedAt: number | null;
  goalId?: string;
  boundarySource: T1EpisodeBoundarySource;
  boundaryReason: T1EpisodeBoundaryReason;
  confidence: number;
  intent?: string;
  outcome?: string;
  actors: Array<{ actorId: string; role: string; weight: number }>;
  conceptIds: string[];
  sourceTraceIds: string[];
}

export interface T1EpisodeMember { episodeId: string; traceId: string; turnSeq: number; }

export function episodeIdFor(sessionId: string, startTurn: number): string; // t1ep_<sha1(sessionId+':'+startTurn).slice(0,20)>
```
- DB methods on `GatewayDatabase`:
```ts
recordEpisodeBoundary(b: T1EpisodeBoundary): void;
listEpisodeBoundaries(sessionId: string): T1EpisodeBoundary[];
setPendingEpisodeBoundary(sessionId: string, payload: { reason?: string; intent?: string; createdAt: number }): void;
consumePendingEpisodeBoundary(sessionId: string, newTurnSeq: number): T1EpisodeBoundary | null;
replaceSessionEpisodes(sessionId: string, episodes: T1EpisodeRecord[], members: T1EpisodeMember[]): void;
getEpisode(episodeId: string): T1EpisodeRecord | null;
listEpisodes(opts: { sessionId?: string; limit: number; cursor?: string; since?: number }): { episodes: T1EpisodeRecord[]; nextCursor?: string };
listEpisodeMembers(episodeId: string): T1EpisodeMember[];
findEpisodeByTrace(traceId: string): string | null;
```

- [ ] **Step 1: Write failing DB tests**

```ts
test('boundary roundtrip + pending flag consumed once', () => {
  db.recordEpisodeBoundary({ sessionId:'s1', afterTurn:3, source:'agent', reason:'agent_declared', createdAt:1 });
  db.setPendingEpisodeBoundary('s1', { reason:'user_declared', createdAt:2 });
  expect(db.consumePendingEpisodeBoundary('s1', 5)).toMatchObject({ afterTurn:4, source:'user', reason:'user_declared' });
  expect(db.consumePendingEpisodeBoundary('s1', 6)).toBeNull();
  expect(db.listEpisodeBoundaries('s1').map(b => b.afterTurn)).toEqual([3,4]);
});

test('replaceSessionEpisodes is idempotent and episodeId is startTurn-only', () => {
  const id = episodeIdFor('s1', 2);
  db.replaceSessionEpisodes('s1', [ep({ episodeId:id, startTurn:2, endTurn:3 })], [{ episodeId:id, traceId:'t1t_a', turnSeq:2 }]);
  db.replaceSessionEpisodes('s1', [ep({ episodeId:id, startTurn:2, endTurn:4 })], [{ episodeId:id, traceId:'t1t_a', turnSeq:2 }, { episodeId:id, traceId:'t1t_b', turnSeq:3 }]);
  expect(db.getEpisode(id)!.endTurn).toBe(4);
  expect(db.listEpisodeMembers(id)).toHaveLength(2);
  expect(db.findEpisodeByTrace('t1t_b')).toBe(id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --runInBand --forceExit tests/unit/gateway-db-t1-episodes.test.ts`
Expected: FAIL with `recordEpisodeBoundary is not a function`.

- [ ] **Step 3: Add schema + methods**

Add the three tables and indexes from spec §4.2 to the constructor `CREATE TABLE` block. Implement methods with `better-sqlite3` prepared statements; `replaceSessionEpisodes` deletes by `session_id` then inserts in one transaction. `listEpisodes` orders by `started_at DESC, episode_id DESC`; cursor is `started_at|episodeId`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --runInBand --forceExit tests/unit/gateway-db-t1-episodes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/t1-episodes.ts gateway/src/memory/gateway-db.ts gateway/tests/unit/gateway-db-t1-episodes.test.ts
git commit -m "feat(memory): add T1 episode schema and DB primitives"
```

---

### Task 2: Boundary pure function

**Files:**
- Create: `gateway/src/recall/t1-episode-boundary.ts`
- Test: `gateway/tests/unit/recall/t1-episode-boundary.test.ts`

**Interfaces:**
```ts
export interface EpisodeTurnInput {
  turnSeq: number;
  traceId: string;
  createdAt: number;
  isUserTurn: boolean;
  intent?: string;
  specificActors: string[];   // already excludes user:local
  conceptIds: string[];
  entities: string[];
  semanticAtoms: string[];    // `sem:` term ids, prefix stripped
  goalId?: string;
}
export interface ComputeEpisodeRangesInput {
  sessionId: string;
  turns: EpisodeTurnInput[];
  boundaries: T1EpisodeBoundary[]; // from Task 1
  maxTurns: number;                // 30
  idleCloseMs: number;             // 6h
  now: number;
  sessionDeleted?: boolean;
}
export interface EpisodeRange {
  startTurn: number;
  endTurn: number;
  status: T1EpisodeStatus;
  boundarySource: T1EpisodeBoundarySource;
  boundaryReason: T1EpisodeBoundaryReason;
  confidence: number;
}
export function computeEpisodeRanges(input: ComputeEpisodeRangesInput): EpisodeRange[];
```

- [ ] **Step 1: Write failing tests**

Cover: declared boundary at `afterTurn=0` keeps first turn; declared at middle; inference only on `isUserTurn`; actor disjoint; topic disjoint; intent disjoint only when actor/topic untouched; max 30; idle close; session deleted; profile union (turn 1 and 3 share a concept, turn 4 does not → cut).

```ts
test('ignores declarations that would create an empty episode', () => {
  const ranges = computeEpisodeRanges({ sessionId:'s1', now:10, maxTurns:30, idleCloseMs:10,
    boundaries:[{ sessionId:'s1', afterTurn:0, source:'agent', createdAt:1 }],
    turns:[turn(1,{isUserTurn:true}), turn(2,{isUserTurn:false})] });
  expect(ranges.map(r => [r.startTurn, r.endTurn])).toEqual([[1,2]]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-episode-boundary.test.ts`
Expected: FAIL with `computeEpisodeRanges is not defined`.

- [ ] **Step 3: Implement pure walk**

Walk turns once. Build `declaredAfter = Set(boundaries.map(b => b.afterTurn))`. Maintain `profile` sets. Cut before current turn when `declaredAfter.has(prevTurn)` or `isUserTurn && (actorShift || topicShift || intentShift)` or `currentLength >= maxTurns`. Close tail at `sessionDeleted || now - lastCreatedAt >= idleCloseMs`. Return ranges with reason/confidence per spec §5.3. Never emit empty or out-of-range ranges.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-episode-boundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/t1-episode-boundary.ts gateway/tests/unit/recall/t1-episode-boundary.test.ts
git commit -m "feat(memory): add deterministic T1 episode boundary rules"
```

---

### Task 3: Rebuild service + session input loader + config

**Files:**
- Create: `gateway/src/recall/t1-episode-rebuild.ts`
- Modify: `gateway/src/memory/gateway-db.ts` (`readSessionEpisodeTurns`)
- Modify: `gateway/src/config.ts` (`recall.t1Episodes` type + default)
- Test: `gateway/tests/unit/recall/t1-episode-rebuild.test.ts`

**Interfaces:**
```ts
export type EpisodeTurnRow = EpisodeTurnInput;
// DB:
readSessionEpisodeTurns(sessionId: string): EpisodeTurnRow[];
// rebuild:
export function rebuildSessionEpisodes(
  db: GatewayDatabase,
  sessionId: string,
  opts: { maxTurns?: number; idleCloseMs?: number; now?: number; sessionDeleted?: boolean } = {},
): { episodes: T1EpisodeRecord[]; members: T1EpisodeMember[] } | null;
```
`rebuildSessionEpisodes` joins per-turn feature/actor/concept/sparse; derives `isUserTurn` from any `user_input` row; `specificActors` excludes `user:local`; `semanticAtoms` strips `sem:`; `intent` from feature.intent; `outcome` from last feature.result/decision; actors/concepts union across members; `sourceTraceIds` from members; writes via `replaceSessionEpisodes`.

- [ ] **Step 1: Write failing tests with a real DB**

Seed 4 turns: turn 1 user, turn 2 reviewer, turn 3 user with boundary after 2, turn 4 user. Assert two episodes, turn ranges `[1,2]` and `[3,4]`, stable IDs from `episodeIdFor`. Re-run rebuild → same rows. Archive turn 1 then rebuild → same result.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-episode-rebuild.test.ts`
Expected: FAIL with `rebuildSessionEpisodes is not exported`.

- [ ] **Step 3: Implement loader + rebuild + config**

Add `readSessionEpisodeTurns` reading `t1_turns` ordered by `turn_seq` with left joins/subqueries for feature, actors, concepts, sparse `sem:` terms. Add `config.recall.t1Episodes = { enabled:true, mode:'shadow', maxTurns:30, idleCloseMs:6*3600e3, timeGapWeakMs:2*3600e3, inferOnUserTurnOnly:true }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-episode-rebuild.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/t1-episode-rebuild.ts gateway/src/memory/gateway-db.ts gateway/src/config.ts gateway/tests/unit/recall/t1-episode-rebuild.test.ts
git commit -m "feat(memory): rebuild T1 episodes from turn code"
```

---

### Task 4: Backfill + idle close + shadow log

**Files:**
- Modify: `gateway/src/recall/t1-episode-rebuild.ts`
- Modify: `gateway/src/automation-engine.ts` (nightly decay hook)
- Modify: `gateway/src/boot.ts` (boot backfill)
- Test: `gateway/tests/unit/recall/t1-episode-backfill.test.ts`

**Interfaces:**
```ts
export function backfillT1Episodes(
  db: GatewayDatabase,
  opts: { limit?: number; sinceDays?: number; now?: number } = {},
): { scanned: number; rebuilt: number; failed: number };

export function closeIdleEpisodes(
  db: GatewayDatabase,
  opts: { idleMs?: number; now?: number } = {},
): number; // number of open episodes closed
```

- [ ] **Step 1: Write failing tests**

Assert backfill scans at most `limit` sessions, rebuilds, converges (`scanned===0` after one pass), and one failing session increments `failed` without throwing. Assert `closeIdleEpisodes` closes only open episodes older than idleMs.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-episode-backfill.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`backfillT1Episodes` lists distinct session ids from `t1_turns` with rows older than `sinceDays`, slices `limit`, calls `rebuildSessionEpisodes`, catches per-session errors. `closeIdleEpisodes` is a DB update `status='closed', boundary_source='session_end', boundary_reason='idle_timeout', ended_at=last_turn_created_at` where `status='open'` and last turn older than idleMs. Wire boot: after DB init, fire-and-forget `backfillT1Episodes(db,{limit:1000,sinceDays:90})`; nightly `memory:decay` calls close + backfill(500) and reports counts. Shadow log: write one JSONL line per boundary candidate when `mode='shadow'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-episode-backfill.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/t1-episode-rebuild.ts gateway/src/automation-engine.ts gateway/src/boot.ts gateway/tests/unit/recall/t1-episode-backfill.test.ts
git commit -m "feat(memory): backfill and idle-close T1 episodes"
```

---

## Phase 2 — Declarations

### Task 5: Boundary HTTP endpoint + pending flag consumption

**Files:**
- Modify: `gateway/src/routes/obs.ts` (`POST /api/obs/episode-boundary`; consume pending on user capture)
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/routes/schemas/obs.ts` (or nearest existing schema file)
- Test: `gateway/tests/unit/routes/obs-episode-boundary.test.ts`

**Interfaces:**
```ts
POST /api/obs/episode-boundary
body: { sessionID: string; scope?: 'start_new'|'end_current'|'next_user_turn'; afterTurn?: number; reason?: string; intent?: string }
→ { ok: true; boundary?: T1EpisodeBoundary; pending?: true }
```
- `next_user_turn` → `setPendingEpisodeBoundary`, returns `{ok:true,pending:true}`
- `start_new` → `afterTurn = currentMaxTurn - 1` (if currentMaxTurn<=0 ignore)
- `end_current` → `afterTurn = currentMaxTurn`
- explicit `afterTurn` wins
- On `POST /api/obs/capture` with `source==='user_input'`, call `consumePendingEpisodeBoundary(sessionID, turnSeq)` and record the returned boundary.

- [ ] **Step 1: Write failing route tests**

Assert: `next_user_turn` writes pending; a fresh `GatewayDatabase` on the same file still consumes it; next user capture writes boundary `after_turn = newTurn - 1`; second capture does not duplicate; invalid scope returns 400; start_new at first turn is ignored.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --runInBand --forceExit tests/unit/routes/obs-episode-boundary.test.ts`
Expected: FAIL with 404/unknown operation.

- [ ] **Step 3: Implement route + capture hook**

Attach `obs.episodeBoundary` handler; add route-catalog entry; parse body with existing chunked reader pattern. In capture, after `append`, consume pending.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --runInBand --forceExit tests/unit/routes/obs-episode-boundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/obs.ts gateway/src/routes/route-catalog.ts gateway/src/routes/schemas gateway/tests/unit/routes/obs-episode-boundary.test.ts
git commit -m "feat(memory): add episode boundary endpoint"
```

---

### Task 6: Native tool + `/new-episode` command

**Files:**
- Create: `src/tools/mark-episode-boundary.ts`
- Modify: `src/plugin.ts` (tool map + command map)
- Test: `tests/mark-episode-boundary.test.ts` (follow existing `tests/plugin-v2.test.ts` style)

**Interfaces:**
```ts
// tool name: mafw_mark_episode_boundary
args: { scope?: 'start_new'|'end_current'; afterTurn?: number; reason?: string; intent?: string }
execute(args, ctx: { sessionID: string; abort: AbortSignal }): Promise<unknown>
// POST /api/obs/episode-boundary
// user command `/new-episode` posts { scope:'next_user_turn', reason:'user_declared' }
```

- [ ] **Step 1: Write failing tests**

Mock `fetch`; assert tool posts `sessionID` + default `scope='start_new'`; command posts `scope='next_user_turn'`; gateway unreachable returns a non-throwing error object.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --runInBand --forceExit tests/mark-episode-boundary.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement tool + command**

Mirror `src/tools/add-memory.ts` (zod args, 10s abort, fail-open return). Register `mafw_mark_episode_boundary` in `src/plugin.ts`; add `/new-episode` command returning `{ text: 'episode boundary queued' }` after the POST. Add a short instruction to `src/hooks/memory-guide.ts`: call the tool when the user changes subject or you switch tasks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --runInBand --forceExit tests/mark-episode-boundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/mark-episode-boundary.ts src/plugin.ts src/hooks/memory-guide.ts tests/mark-episode-boundary.test.ts
git commit -m "feat(plugin): add mafw_mark_episode_boundary tool"
```

---

### Task 7: TurnPipeline rebuild wiring + shadow behavior

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts`
- Modify: `gateway/src/kernel.ts` (pass DB-backed rebuild)
- Test: `gateway/tests/unit/turn-pipeline-episodes.test.ts`

**Interfaces:**
- `TurnPipelineOptions.rebuildEpisodes?: (sessionID: string) => void`
- After per-turn encode loop and before archive: if `rebuildEpisodes`, call it in try/catch.
- `mode='off'` skips; `shadow` rebuilds but does not change prompt/recall; `live` rebuilds and later tasks consume.

- [ ] **Step 1: Write failing test**

Seed a session with 2 turns; run `pipeline.runSession`; assert `db.listEpisodes({sessionId})` has 1 episode and members; assert a throwing `rebuildEpisodes` does not fail the run.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand --forceExit tests/unit/turn-pipeline-episodes.test.ts`
Expected: FAIL (no episodes).

- [ ] **Step 3: Implement**

Add option; kernel passes `(sessionID) => { if (config.recall.t1Episodes.enabled && config.recall.t1Episodes.mode !== 'off') rebuildSessionEpisodes(this.getGatewayDb(), sessionID, {...}) }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand --forceExit tests/unit/turn-pipeline-episodes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/turn-pipeline.ts gateway/src/kernel.ts gateway/tests/unit/turn-pipeline-episodes.test.ts
git commit -m "feat(memory): rebuild episodes from the turn pipeline"
```

---

## Phase 3 — Layered recall

### Task 8: Episode search service

**Files:**
- Create: `gateway/src/recall/t1-episode-search.ts`
- Test: `gateway/tests/unit/recall/t1-episode-search.test.ts`

**Interfaces:**
```ts
export interface EpisodeSearchDeps {
  searchTurns(query: string, k: number): Promise<Array<{ traceId?: string|null; sessionId: string; turnId: number; excerpt: string; score?: number }>>;
  findEpisodeByTrace(traceId: string): string | null;
  getEpisode(episodeId: string): T1EpisodeRecord | null;
  listMembers(episodeId: string): T1EpisodeMember[];
}
export interface EpisodeHit {
  episodeId: string; sessionId: string; startTurn: number; endTurn: number;
  status: 'open'|'closed'; startedAt: number|null; intent?: string; outcome?: string;
  actors: string[]; conceptIds: string[]; score: number;
  sources: Array<'turn'|'actor'|'concept'|'sparse'|'declared'>;
  topTraceIds: string[];
}
export async function searchT1Episodes(deps: EpisodeSearchDeps, query: string, k: number): Promise<EpisodeHit[]>;
```

- [ ] **Step 1: Write failing tests**

Assert: 3 turns of one episode aggregate to 1 hit; `topTraceIds` max 3 ordered by score; declared boundary adds `sources:['declared']` and bonus; turns with no episode are skipped; empty query returns [].

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-episode-search.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Call `searchTurns(query, k*4)`, map trace→episode, aggregate scores, dedupe, sort desc, slice k. `sources` union from turn hit `sources` plus `declared` when `boundarySource='declared'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-episode-search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/t1-episode-search.ts gateway/tests/unit/recall/t1-episode-search.test.ts
git commit -m "feat(memory): aggregate T1 turn hits into episodes"
```

---

### Task 9: API `layer=episodes|auto` + list endpoint + SDK

**Files:**
- Modify: `gateway/src/routes/memory.ts`
- Modify: `gateway/src/routes/schemas/memory.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/mcp/handlers/search-hybrid.ts`
- Modify: `gateway/src/mcp/tool-registry.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Test: `gateway/tests/unit/api-contract.test.ts`, `packages/gateway-sdk/src/client.test.ts`

**Interfaces:**
```ts
type MemoryLayer = 'gist'|'t1'|'both'|'episodes'|'auto';
interface T1SearchHit { /* existing */ episodeId?: string }
interface MemoryLayeredSearchResult {
  layer: MemoryLayer;
  results: MemoryUnit[];
  t1Results: T1SearchHit[];
  episodes?: EpisodeHit[];
  legacyEpisodic?: MemoryUnit[];
}
// GET /api/memory/episodes?limit=&cursor=&sessionId=&since=
// → { episodes: EpisodeHit[]; nextCursor?: string }
// GET /api/memory/episodes/:id
// → { episode: T1EpisodeRecord; members: Array<{traceId,turnSeq}> }
// SDK: memory.episodes(opts) / memory.episode(id)
```

- [ ] **Step 1: Write failing contract/client tests**

Assert `layer=episodes` returns `{results:[], t1Results:[]?, episodes}`; `layer=auto` in shadow returns `episodes: []`; `layer=auto` in live returns episodes; `GET /api/memory/episodes` with empty query lists recent; SDK sends query params and normalizes.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --runInBand --forceExit tests/unit/api-contract.test.ts`
Run: `npx jest --runInBand --forceExit packages/gateway-sdk/src/client.test.ts` (workspace command ok)
Expected: FAIL.

- [ ] **Step 3: Implement handler + schemas + SDK**

Extend layer validation in HTTP and MCP (`gist|t1|both|episodes|auto`); for `episodes|auto`, call `searchT1Episodes` with deps (`searchT1`, db lookup); `auto` only includes episodes when `config.recall.t1Episodes.mode==='live'`. Add `memory.episodes` + `memory.episode` handlers (list + detail). Add optional `episodeId` to `T1SearchHit` schema/SDK. Update TypeBox schemas and SDK DTO/client; update MCP tool description.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --runInBand --forceExit tests/unit/api-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/memory.ts gateway/src/routes/schemas/memory.ts gateway/src/routes/route-catalog.ts gateway/src/mcp/handlers/search-hybrid.ts gateway/src/mcp/tool-registry.ts packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts gateway/tests/unit/api-contract.test.ts packages/gateway-sdk/src/client.test.ts
git commit -m "feat(memory): expose episode search and list APIs"
```

---

### Task 10: `t1ep:` pointer redemption

**Files:**
- Modify: `gateway/src/mcp/handlers/get-memory.ts`
- Modify: `gateway/src/mcp/tool-registry.ts` (description)
- Modify: `gateway/src/routes/memory.ts` (deps passed to `handleGetMemory`)
- Modify: `gateway/src/kernel.ts` (wire `getEpisode`/`listEpisodeMembers`)
- Test: `gateway/tests/unit/mcp/get-memory-episode.test.ts`

**Interfaces:**
```ts
// mafw_get_memory("t1ep:<episodeId>")
// → { success: true, episode: T1EpisodeRecord, members: Array<{ traceId, turnSeq, rows: T1Observation[] }> }
```
- Reject malformed/unknown id with existing not-found shape.
- Cap members at 20; cap rows per member at 20.

- [ ] **Step 1: Write failing test**

Assert `t1ep:` returns episode + members; unknown returns not found; `t1:<traceId>` still works unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand --forceExit tests/unit/mcp/get-memory-episode.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `getEpisode` + `listEpisodeMembers` to handler deps; branch before legacy `t1:`; update tool description.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand --forceExit tests/unit/mcp/get-memory-episode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mcp/handlers/get-memory.ts gateway/src/mcp/tool-registry.ts gateway/src/routes/memory.ts gateway/src/kernel.ts gateway/tests/unit/mcp/get-memory-episode.test.ts
git commit -m "feat(memory): redeem t1ep episode pointers"
```

---

### Task 11: Snapshot / recall block two sections

**Files:**
- Modify: `gateway/src/recall/snapshot-builder.ts`
- Modify: `gateway/src/recall/recall-context.ts`
- Modify: `gateway/src/recall/recall-snapshot.ts`
- Test: `gateway/tests/unit/recall/layered-recall-render.test.ts`

**Interfaces:**
```ts
export function renderLayeredRecall(input: {
  episodes: EpisodeHit[]; memories: Array<{ id: string; primary_abstraction: string }>;
  maxChars: number;
}): string;
```
- Episodes section first, knowledge second; omit empty sections.
- Episode line: `[t1ep:<id>] <date> · <actors> · <intent> (<n> turns)`.
- Knowledge line: `[<id>] <primary_abstraction>`.
- Sync `/api/recall/context` does not call episode search; snapshot builder does.

- [ ] **Step 1: Write failing test**

Assert order, labels, omission, and char cap. Assert `searchRecallMemories` options path has no episode call (spy).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand --forceExit tests/unit/recall/layered-recall-render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add renderer; snapshot builder calls `layer=auto` equivalent (episode search + Harmonic) only when mode `live`; sync path untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand --forceExit tests/unit/recall/layered-recall-render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/snapshot-builder.ts gateway/src/recall/recall-context.ts gateway/src/recall/recall-snapshot.ts gateway/tests/unit/recall/layered-recall-render.test.ts
git commit -m "feat(memory): render episodes and knowledge as separate recall sections"
```

---

## Phase 4 — Desktop UI

### Task 12: Preload/IPC episode APIs

**Files:**
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/main/ipc.ts`
- Test: `packages/desktop/src/main/memory-episodes-ipc.test.ts`

**Interfaces:**
```ts
memory.episodes(opts: { limit?: number; cursor?: string; sessionId?: string; since?: number }): Promise<{episodes: EpisodeHit[]; nextCursor?: string}>
memory.episode(id: string): Promise<{episode: T1EpisodeRecord; members: ...}>
```

- [ ] **Step 1: Write failing IPC test** (node:test with `--conditions=browser`)

```ts
test('memory.episodes forwards limit/sessionId and returns nextCursor', async () => {
  const calls: any[] = []
  const handler = createMemoryEpisodesHandler({ fetchEpisodes: async (opts) => { calls.push(opts); return { episodes: [ep], nextCursor: 'c2' } } })
  const out = await handler({ limit: 10, sessionId: 's1' })
  assert.deepEqual(calls[0], { limit: 10, sessionId: 's1' })
  assert.equal(out.nextCursor, 'c2')
})
```

- [ ] **Step 2: Run it, expect fail**

Run: `cd packages/desktop && node --test --conditions=browser src/main/memory-episodes-ipc.test.ts`
Expected: FAIL with `createMemoryEpisodesHandler is not a function`.

- [ ] **Step 3: Add preload methods + main handlers proxying gateway**

`memory.episodes` → `GET /api/memory/episodes`; `memory.episode(id)` → `GET /api/memory/episodes/{id}` (or `mafw_get_memory("t1ep:<id>")` via the memory route).

- [ ] **Step 4: Re-run, expect pass**

Run: `cd packages/desktop && node --test --conditions=browser src/main/memory-episodes-ipc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/preload/mafw-api.ts packages/desktop/src/main/ipc.ts packages/desktop/src/main/memory-episodes-ipc.test.ts
git commit -m "feat(desktop): expose episode list/detail IPC"
```

---

### Task 13: Memory page Episodes/Knowledge tabs

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/Memory.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/MemoryEpisodes.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/MemoryEpisodeDetail.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/src/renderer/mafw/components/MemoryEpisodes.test.ts`

**Interfaces:**
- Tabs `episodes | knowledge`, default `knowledge` for compatibility.
- Episodes tab: empty query calls `memory.episodes({limit:50})`; query calls `memory.search({query, topK:50, layer:'episodes'})`.
- Card shows date, actors, intent/outcome, turn count, boundary source.
- Click opens detail (members timeline).
- Use `ButtonV2`/`TextInputV2`, no raw primitives.

- [ ] **Step 1: Write failing pure-view tests** (format date/actors/intent, empty state, legacy tag)

```ts
test('episode card summarizes without narrative', () => {
  const line = formatEpisodeSummary({ startedAt: 1700000000000, actors: ['agent:reviewer','agent:builder'], intent: 'review embedding', turnCount: 4, boundarySource: 'declared' })
  assert.match(line, /reviewer, builder/)
  assert.match(line, /review embedding/)
  assert.match(line, /4 turns/)
  assert.match(line, /declared/)
})
```

- [ ] **Step 2: Run with `--conditions=browser`, expect fail**

Run: `cd packages/desktop && node --test --conditions=browser src/renderer/mafw/components/MemoryEpisodes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement components + wire page**

Episodes tab default list uses `memory.episodes({limit:50})`; query uses `memory.search({query, topK:50, layer:'episodes'})`. Default active tab remains `knowledge`.

- [ ] **Step 4: Re-run + `npx tsgo --noEmit -p tsconfig.json`**

Run: `cd packages/desktop && node --test --conditions=browser src/renderer/mafw/components/MemoryEpisodes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pages/Memory.tsx packages/desktop/src/renderer/mafw/components/MemoryEpisodes.tsx packages/desktop/src/renderer/mafw/components/MemoryEpisodeDetail.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/components/MemoryEpisodes.test.ts
git commit -m "feat(desktop): add Episodes and Knowledge memory tabs"
```

---

### Task 14: Legacy episodic / citation labels

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/Memory.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/memory-read.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/memory-read.test.ts`

**Interfaces:**
- `unit.legacyEpisodic === true` → grey `legacy episode` tag; not in default Knowledge list.
- Recall citation badge: `episode` vs `knowledge`.
- Direct `mafw_get_memory` of a legacy episodic still renders.

- [ ] **Step 1: Write failing tests**

```ts
test('legacy episodic gets the grey tag and stays visible when directly fetched', () => {
  const rows = memoryReadSections({ success: true, legacyEpisodic: true, memory: { type: 'episodic', primary_abstraction: 'old narrative' } })
  assert.match(JSON.stringify(rows), /legacy episode/)
})
```

- [ ] **Step 2: Run, expect fail**

Run: `cd packages/desktop && node --test --conditions=browser src/renderer/mafw/components/tool-cards/memory-read.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement tags/badges**

- [ ] **Step 4: Re-run**

Run: `cd packages/desktop && node --test --conditions=browser src/renderer/mafw/components/tool-cards/memory-read.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pages/Memory.tsx packages/desktop/src/renderer/mafw/components/tool-cards/memory-read.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/components/tool-cards/memory-read.test.ts
git commit -m "feat(desktop): label legacy episodic memories"
```

---

## Phase 5 — Cortex separation

### Task 15: `mafw_add_memory` coerce + schemas

**Files:**
- Modify: `src/tools/add-memory.ts`
- Modify: `gateway/src/routes/dashboard.ts` (`POST /api/memory/add`)
- Modify: `gateway/src/mcp/tool-registry.ts` / handlers (add-memory)
- Modify: `gateway/src/core/mcp/tools.ts`
- Modify: `gateway/src/routes/schemas/memory.ts`
- Test: `gateway/tests/unit/add-memory-episodic-coerce.test.ts`, `tests/plugin-v2.test.ts`

**Interfaces:**
- `memoryType` enum in native tool: `semantic|procedural|global`.
- HTTP/MCP accepts `episodic` and coerces to `semantic`; response includes `warnings: ['episodic is retired; stored as semantic gist']`.
- Server derives `episodeId` from `sourceTraceIds` via `findEpisodeByTrace`; stores optional `episode_id` in memory metadata; ignores client-supplied `episodeId`.

- [ ] **Step 1: Write failing tests**

```ts
test('HTTP add coerces episodic to semantic with a warning', async () => {
  const res = await postAdd({ content: 'we fixed the parser', memoryType: 'episodic' })
  expect(res.storedType).toBe('semantic')
  expect(res.warnings).toContain('episodic is retired; stored as semantic gist')
})

test('server derives episodeId from sourceTraceIds', () => {
  expect(deriveEpisodeId(['t1t_a'], (id) => (id === 't1t_a' ? 't1ep_x' : null))).toBe('t1ep_x')
})
```

- [ ] **Step 2: Run, expect fail**

Run: `npx jest --runInBand --forceExit tests/unit/add-memory-episodic-coerce.test.ts tests/plugin-v2.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement schemas + coercion + derivation**

Keep `episodic` accepted at HTTP/MCP for one release; native tool enum removes it. Store `episode_id` only when `findEpisodeByTrace(sourceTraceIds[0])` resolves.

- [ ] **Step 4: Re-run**

Run: `npx jest --runInBand --forceExit tests/unit/add-memory-episodic-coerce.test.ts tests/plugin-v2.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/add-memory.ts gateway/src/routes/dashboard.ts gateway/src/mcp/tool-registry.ts gateway/src/core/mcp/tools.ts gateway/src/routes/schemas/memory.ts gateway/tests/unit/add-memory-episodic-coerce.test.ts tests/plugin-v2.test.ts
git commit -m "feat(memory): retire episodic writes from the cortex"
```

---

### Task 16: turnCompress prompt + reflection episode source

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts` (`TOOL_EXTRACTION_SYSTEM`)
- Modify: `gateway/src/recall/reflection.ts`
- Modify: `gateway/src/memory/gateway-db.ts` (`listReflectableEpisodes`)
- Modify: `gateway/src/config.ts` (`reflection.input`, `lookbackDays`, `maxEpisodesPerRun`)
- Modify: `gateway/src/kernel.ts` (`isInternalSession: (sid) => this.internalSessionRoles.has(sid)`)
- Test: `gateway/tests/unit/recall/reflection-episodes.test.ts`, `gateway/tests/unit/turn-pipeline-prompt.test.ts`

**Interfaces:**
```ts
listReflectableEpisodes(opts: { limit: number; lookbackDays: number; now: number }): T1EpisodeRecord[];
```
- Eligible: `status='closed'`, `end_turn-start_turn+1>=2`, `ended_at >= now-lookbackDays`, not internal session (caller filters).
- Cursor: `kv_store` scope `reflect-episode-cursor`, key sessionId, value last_end_turn.
- Reflection input item `{ id: episodeId, text: intent+outcome, traceIds }`; skip Harmonic `store.read` when `source='episodes'`.

- [ ] **Step 1: Write failing tests**

```ts
test('reflection input only includes closed episodes with >=2 turns', () => {
  const rows = db.listReflectableEpisodes({ limit: 10, lookbackDays: 30, now: 100 })
  expect(rows.map((r) => r.episodeId)).toEqual(['t1ep_ok'])
  expect(rows[0].status).toBe('closed')
})

test('turnCompress prompt no longer offers episodic', () => {
  expect(TOOL_EXTRACTION_SYSTEM).not.toMatch(/episodic/i)
})
```

- [ ] **Step 2: Run, expect fail**

Run: `npx jest --runInBand --forceExit tests/unit/recall/reflection-episodes.test.ts tests/unit/turn-pipeline-prompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement prompt + episode source + cursor**

Add `reflection.input='episodes'|'legacy-episodic'` default `episodes`; episodes path builds `{id,text,traceIds}` directly and skips `store.read`; cursor uses `kv_store` `reflect-episode-cursor` with `last_end_turn`. Legacy path stays for rollback.

- [ ] **Step 4: Re-run**

Run: `npx jest --runInBand --forceExit tests/unit/recall/reflection-episodes.test.ts tests/unit/turn-pipeline-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/turn-pipeline.ts gateway/src/recall/reflection.ts gateway/src/memory/gateway-db.ts gateway/src/config.ts gateway/tests/unit/recall/reflection-episodes.test.ts gateway/tests/unit/turn-pipeline-prompt.test.ts
git commit -m "feat(memory): reflect over T1 episodes instead of cortical narratives"
```

---

### Task 17: sessionContext from episodes

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts` (`sessionContext`)
- Test: `gateway/tests/unit/turn-pipeline-session-context.test.ts`

**Interfaces:**
- `sessionContext(index, sessionID, maxEpisodes, opts?: { episodes?: T1EpisodeRecord[] })`: prefer episode intents; fallback to legacy episodic entries only when `episodes` absent (rollback).

- [ ] **Step 1: Write failing test**

```ts
test('sessionContext prefers episode intents over legacy episodic entries', () => {
  const ctx = sessionContext({ getIndex: () => ({ entries: [{ type: 'episodic', source_session_id: 's1', primary_abstraction: 'old' }] }) }, 's1', 10, {
    episodes: [{ intent: 'episode intent' } as any],
  })
  expect(ctx).toContain('episode intent')
  expect(ctx).not.toContain('old')
})
```

- [ ] **Step 2: Run, expect fail**

Run: `npx jest --runInBand --forceExit tests/unit/turn-pipeline-session-context.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Caller (TurnPipeline) loads recent episodes for the session and passes them; no episodes → legacy fallback.

- [ ] **Step 4: Re-run**

Run: `npx jest --runInBand --forceExit tests/unit/turn-pipeline-session-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/turn-pipeline.ts gateway/tests/unit/turn-pipeline-session-context.test.ts
git commit -m "feat(memory): build session context from T1 episodes"
```

---

## Phase 6 — Legacy + dense

### Task 18: Legacy episodic filter + pinned exception

**Files:**
- Modify: `gateway/src/core/memory/harmonic-index.ts` (`SearchOptions.includeLegacyEpisodic?: boolean`)
- Modify: `gateway/src/recall/recall-context.ts` (default false)
- Modify: `gateway/src/routes/memory.ts` (`includeLegacyEpisodic` query param)
- Modify: `gateway/src/recall/turn-pipeline.ts` (consolidation/prior input excludes legacy)
- Test: `gateway/tests/unit/legacy-episodic-filter.test.ts`

**Interfaces:**
- `searchScored(..., { includeLegacyEpisodic?: boolean })`; default false.
- Pinned/sticky entries stay visible in disclosure; direct `getById` unaffected.
- `GET /api/memory/search?includeLegacyEpisodic=true` returns them with `legacyEpisodic: true`.

- [ ] **Step 1: Write failing tests**

```ts
test('default search hides legacy episodic; pinned and direct get stay visible', () => {
  expect(search('narrative').map((e) => e.id)).not.toContain('legacy')
  expect(search('narrative', { includeLegacyEpisodic: true }).map((e) => e.id)).toContain('legacy')
  expect(index.getById('legacy')).not.toBeNull()
})

test('pinned legacy episodic stays in disclosure', () => {
  expect(pinnedFor('s1').map((e) => e.id)).toContain('legacy')
})
```

- [ ] **Step 2: Run, expect fail**

Run: `npx jest --runInBand --forceExit tests/unit/legacy-episodic-filter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement filter + flag**

Filter in `searchScored` candidate selection after pinned/sticky exception; do not filter `getById`; consolidation input uses default false.

- [ ] **Step 4: Re-run**

Run: `npx jest --runInBand --forceExit tests/unit/legacy-episodic-filter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/memory/harmonic-index.ts gateway/src/recall/recall-context.ts gateway/src/routes/memory.ts gateway/src/recall/turn-pipeline.ts gateway/tests/unit/legacy-episodic-filter.test.ts
git commit -m "feat(memory): filter legacy episodic from cortex recall"
```

---

### Task 19: denseIndex / semanticAtoms config + stats

**Files:**
- Modify: `gateway/src/config.ts` (`t1Recall.denseIndex`, `t1Recall.semanticAtoms`)
- Modify: `gateway/src/recall/t1-search.ts` (skip dense in shadow/off; shadow records would-rank)
- Modify: `gateway/src/recall/turn-pipeline.ts` / `kernel.ts` (atoms gated by semanticAtoms, not denseIndex)
- Modify: `gateway/src/routes/memory.ts` stats
- Test: `gateway/tests/unit/recall/t1-dense-mode.test.ts`

**Interfaces:**
- `denseIndex='shadow'` → compute dense, do not pass to `fuseT1Hits`; increment `wouldRank` stats.
- `denseIndex='off'` → skip dense; no embedding runtime call for dense.
- `semanticAtoms='off'` → `semanticAtomsFor` returns empty map; `intent_shift` falls back to tokens.
- Stats expose `denseIndex`, `semanticAtoms`.

- [ ] **Step 1: Write failing tests**

```ts
test('shadow computes dense but does not fuse it', async () => {
  const hits = await search('q', 3, { denseIndex: 'shadow' })
  expect(denseSpy).toHaveBeenCalled()
  expect(hits.every((h) => !h.sources?.includes('dense'))).toBe(true)
})

test('off skips dense but still returns semantic atoms', async () => {
  const hits = await search('q', 3, { denseIndex: 'off', semanticAtoms: 'on' })
  expect(denseSpy).not.toHaveBeenCalled()
  expect(atomsSpy).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run, expect fail**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-dense-mode.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement config + modes**

`denseIndex` gates only `denseSearch`; `semanticAtoms` gates `semanticAtomsFor`. Stats expose both.

- [ ] **Step 4: Re-run**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-dense-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/config.ts gateway/src/recall/t1-search.ts gateway/src/recall/turn-pipeline.ts gateway/src/kernel.ts gateway/src/routes/memory.ts gateway/tests/unit/recall/t1-dense-mode.test.ts
git commit -m "feat(memory): make T1 dense and semantic atoms independent"
```

---

### Task 20: Evaluation + docs + full gates

**Files:**
- Modify: `evaluation/t1/src/fixtures.ts`, `run.ts`, `README.md`, `baseline.json`
- Modify: `docs/architecture/memory.md`
- Create: `docs/releases/2026-11-16-two-layer-memory-separation.md`
- Test: run eval + full gates

**Steps:**
- [ ] Add episode-level queries (e.g. `上次那个 plan 后来怎么定的`, `reviewer 和 builder 那次争论`) and boundary fixtures.
- [ ] Run `npm run eval:t1`; record dense on/shadow/off × atoms on/off.
- [ ] Update README/baseline; state the decision gate result. If no-dense fused recall@3 drops ≤2% and episode queries do not regress, set `denseIndex='off'`; otherwise keep `shadow`. Promote `t1Episodes.mode` to `live` only if shadow boundary review and episode retrieval pass; otherwise keep `shadow`.
- [ ] Run gateway full tests (`npx jest --runInBand --forceExit`), desktop tests (`npm run test:desktop`), both tsc gates (`gateway: npx tsc --noEmit -p tsconfig.json`; desktop: `npx tsgo --noEmit -p tsconfig.json`), gateway build (`npm run build`).
- [ ] Write release note with commit, new test count, full pass count.
- [ ] Commit.

```bash
git add evaluation/t1 docs/architecture/memory.md docs/releases/2026-11-16-two-layer-memory-separation.md
git commit -m "test(memory): evaluate two-layer episode recall"
```

---

## Self-Review Notes

- Spec §4/§5 ↔ Tasks 1–7; §8 ↔ Tasks 8–11; §9 ↔ Tasks 12–14; §7/§11 ↔ Tasks 15–18; §10 ↔ Task 19; §12/§13 ↔ Tasks 4/19/20.
- Interface names used consistently: `T1EpisodeRecord`, `T1EpisodeBoundary`, `EpisodeHit`, `rebuildSessionEpisodes`, `searchT1Episodes`, `renderLayeredRecall`.
- Review Focus items map to: Task 2 (after_turn=0), Task 5 (pending flag), Task 3 (rebuild idempotence), Task 18 (pinned legacy), Task 19 (dense/atoms split).
- Deferred: LLM legacy conversion, mobile/TUI UI, MCP boundary tool.
