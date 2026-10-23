# B3.1 Per-turn Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user chose inline execution: implement each task in this session, TDD, commit per task, then request a fresh independent review.

**Goal:** Make `GET /api/sessions/:id/diff?messageID=<userMessageID>` return the real per-turn diff from opencode snapshot trees, and use it to light B3 code rewind and the B2 changes tree without ever falling back to the session-wide diff.

**Architecture:** A new gateway service selects the user turn’s assistant snapshots, finds the opencode snapshot git dir, runs `git diff` between the first `snapshot.start` and the last `snapshot.end`, and parses the result. The existing diff route branches on `messageID` and never calls the session-wide runtime diff in that branch. The desktop fetches these per-turn diffs for loaded turns, merges them into the B3 overlay and the B2/Editor dock lists, and keeps the existing invertible-patch safety gate.

**Tech Stack:** TypeScript, Node HTTP route, `child_process.execFile`, Jest (gateway), SolidJS, Node `--test` + `@mafw/test-shim` (desktop).

**Spec:** `docs/superpowers/specs/2026-10-23-b31-per-turn-diff-design.md`

## Global Constraints

- Do not modify `gateway/src/runtime/opencode-adapter.ts`, `gateway/src/runtime/contract.ts`, or the SDK request/response shape (`{ files: FileDiffInfo[] }`).
- `messageID` means **user message id**. When it is present, the route must never call `runtime.session.diff` (the old session-wide fallback).
- Fetch at most `limit: 200` messages; this is the largest reliable window on opencode 2.1.
- Code rewind remains limited to complete, invertible modification patches. Added/deleted/binary/mode-only files stay visible in B2 but are not code-rewindable.
- `DiffReviewPanel` defaults must preserve existing non-dock behavior: `allowSessionFallback` defaults `true`, `allowNonInvertibleRevert` defaults `true`.
- Run git via `execFile`/argv, never a shell; pass `windowsHide: true`.
- Existing tests use `bun:test` imports even under Node’s test shim; follow the local pattern.
- UI copy stays in Chinese, matching the surrounding components.
- Do not touch the untracked `docs/superpowers/plans/2026-10-22-workbench-phase2.md`.

## Review Focus

These are the failure modes most likely to bite a user; each has a named test in the task that owns it:

1. A non-git session, a missing snapshot object, or a bogus `messageID` must not show the session-wide diff. (Task 2 route test; Task 4 overlay hides.)
2. A newly added or deleted file must appear in B2 but must not be selectable for code rewind. (Task 1 parser status; Task 5 `isFileRevertible`.)
3. The last assistant snapshot has no `end` and a non-empty `files` list; the turn is incomplete and must be unavailable, not “no changes”. (Task 1 selection test.)
4. A mismatched `projectID` or a pruned/reinitialized snapshot repo must degrade to 404, not crash or use a wrong repo. (Task 1 `findSnapshotRepo` tests; Task 2 404.)
5. The diff must be scoped to the requested user turn, including multiple assistant steps and excluding the next user’s assistants. (Task 1 boundary test; Task 2 bogus-id 404.)

---

### Task 1: Gateway per-turn diff service

**Files:**
- Create: `gateway/src/core/diff/turn-diff.ts`
- Create: `gateway/tests/unit/diff/turn-diff.test.ts`

**Interfaces:**
- Produces:
  - `FileDiffInfo = { file?: string; patch?: string; additions?: number; deletions?: number; status?: string }`
  - `TurnDiffUnavailableError` (message starts with `per-turn diff unavailable:`)
  - `GitRunner = { run(args: string[], opts?: { timeoutMs?: number; maxBuffer?: number }): Promise<{ code: number; stdout: string; stderr: string }> }`
  - `selectTurnSnapshot(messages: any[], messageID: string): { start: string; end: string }`
  - `parseGitDiff(patchText: string): FileDiffInfo[]`
  - `findSnapshotRepo(opts: { root: string; projectID?: string; start: string; end: string; git: GitRunner }): Promise<string | null>`
  - `computeTurnDiff(opts: { messages: any[]; messageID: string; projectID?: string; snapshotRoot?: string; git?: GitRunner }): Promise<FileDiffInfo[]>`
  - `computeTurnDiffForRuntime(runtime, sessionID, messageID, opts?: { snapshotRoot?: string; git?: GitRunner }): Promise<FileDiffInfo[]>`
- Consumes: no project module; uses `fs`, `path`, `os`, `child_process.execFile`.

- [ ] **Step 1: Write the failing tests**

Create `gateway/tests/unit/diff/turn-diff.test.ts` with these cases. Use `info` wrappers in at least one case to prove normalization.

```ts
const user = (id: string, created: number) => ({ id, role: 'user', time: { created } });
const asst = (id: string, created: number, snapshot: any) => ({ id, role: 'assistant', time: { created }, snapshot });
const PATCH = [
  'diff --git a/x.txt b/x.txt',
  '--- a/x.txt',
  '+++ b/x.txt',
  '@@ -1,2 +1,2 @@',
  ' a',
  '-b',
  '+c',
  '',
].join('\n');

describe('selectTurnSnapshot', () => {
  it('uses the first start and last end inside the user turn', () => {
    const messages = [
      user('u0', 1), asst('a0', 2, { start: 's0', end: 'e0' }),
      user('u1', 10), asst('a1', 11, { start: 's1', end: 'm1' }), asst('a2', 12, { start: 'm1', end: 'e1' }),
      user('u2', 20), asst('a3', 21, { start: 's2', end: 'e2' }),
    ];
    expect(selectTurnSnapshot(messages, 'u1')).toEqual({ start: 's1', end: 'e1' });
  });

  it('throws when the last snapshot has no end and files are non-empty', () => {
    const messages = [user('u1', 1), asst('a1', 2, { start: 's1', files: ['x'] })];
    expect(() => selectTurnSnapshot(messages, 'u1')).toThrow(TurnDiffUnavailableError);
  });

  it('treats a missing end with empty files as no final change', () => {
    const messages = [user('u1', 1), asst('a1', 2, { start: 's1', files: [] })];
    expect(selectTurnSnapshot(messages, 'u1')).toEqual({ start: 's1', end: 's1' });
  });

  it('throws for no assistant snapshot, a missing user, and an assistant id', () => {
    expect(() => selectTurnSnapshot([user('u1', 1), asst('a1', 2, {})], 'u1')).toThrow(TurnDiffUnavailableError);
    expect(() => selectTurnSnapshot([user('u1', 1)], 'missing')).toThrow(TurnDiffUnavailableError);
    expect(() => selectTurnSnapshot([user('u1', 1), asst('a1', 2, { start: 's', end: 'e' })], 'a1')).toThrow(TurnDiffUnavailableError);
  });

  it('handles wrapped items and unsorted input', () => {
    const messages = [
      { info: asst('a2', 12, { start: 'm', end: 'e' }) },
      { info: user('u1', 10) },
      { info: asst('a1', 11, { start: 's', end: 'm' }) },
    ];
    expect(selectTurnSnapshot(messages, 'u1')).toEqual({ start: 's', end: 'e' });
  });
});

describe('parseGitDiff', () => {
  it('parses a modified file', () => {
    expect(parseGitDiff(PATCH)).toEqual([
      { file: 'x.txt', patch: PATCH, additions: 1, deletions: 1, status: 'modified' },
    ]);
  });
  it('marks added and deleted files', () => {
    const added = 'diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1 @@\n+x\n';
    const deleted = 'diff --git a/d b/d\ndeleted file mode 100644\n--- a/d\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n';
    expect(parseGitDiff(added)).toMatchObject([{ file: 'n', status: 'added' }]);
    expect(parseGitDiff(deleted)).toMatchObject([{ file: 'd', status: 'deleted' }]);
  });
  it('keeps a binary/no-hunk block and handles multiple files', () => {
    const patch = 'diff --git a/a b/a\nBinary files a/a and b/a differ\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-x\n+y\n';
    expect(parseGitDiff(patch)).toHaveLength(2);
    expect(parseGitDiff(patch)[0]).toMatchObject({ file: 'a', patch: expect.stringContaining('Binary files') });
    expect(parseGitDiff(patch)[1].file).toBe('b');
  });
});

it('findSnapshotRepo scans other project dirs and returns null for non-trees', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-snapshot-scan-'));
  fs.mkdirSync(path.join(root, 'other', 'repo'), { recursive: true });
  const treeGit: GitRunner = { async run(args) {
    return args.includes('cat-file')
      ? { code: 0, stdout: 'tree\n', stderr: '' }
      : { code: 0, stdout: PATCH, stderr: '' };
  } };
  const found = await findSnapshotRepo({ root, projectID: 'stale', start: 's', end: 'e', git: treeGit });
  expect(found).toBe(path.join(root, 'other', 'repo'));

  const blobGit: GitRunner = { async run() { return { code: 0, stdout: 'blob\n', stderr: '' }; } };
  expect(await findSnapshotRepo({ root, projectID: 'stale', start: 's', end: 'e', git: blobGit })).toBeNull();
});
```

Add a temp-git integration test for `computeTurnDiff` (the positive modified-file fixture):

```ts
it('computes a real tree diff from a bare snapshot repo', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-turn-diff-'));
  const repo = path.join(root, 'proj', 'repo');
  const work = path.join(root, 'work');
  fs.mkdirSync(path.join(root, 'proj'), { recursive: true });
  execFileSync('git', ['init', '--separate-git-dir', repo, work]);
  execFileSync('git', ['-C', work, 'config', 'core.autocrlf', 'false']);
  const git = (args: string[]) => execFileSync('git', ['-C', work, ...args], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(work, 'x.txt'), 'a\nb\n');
  git(['add', '-A']); const start = git(['write-tree']);
  fs.writeFileSync(path.join(work, 'x.txt'), 'a\nc\n');
  git(['add', '-A']); const end = git(['write-tree']);
  const files = await computeTurnDiff({
    messages: [user('u1', 1), asst('a1', 2, { start, end })],
    messageID: 'u1', projectID: 'proj', snapshotRoot: root,
  });
  expect(files).toEqual([{ file: 'x.txt', patch: expect.stringContaining('@@'), additions: 1, deletions: 1, status: 'modified' }]);
});

it('computeTurnDiffForRuntime fetches limit 200 and passes projectID', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-turn-diff-runtime-'));
  fs.mkdirSync(path.join(root, 'p', 'r'), { recursive: true });
  let limit = -1;
  const git: GitRunner = { async run(args) {
    if (args.includes('cat-file')) return { code: 0, stdout: 'tree\n', stderr: '' };
    return { code: 0, stdout: PATCH, stderr: '' };
  } };
  const runtime = {
    session: {
      get: async () => ({ projectID: 'p' }),
      messages: async (o: { limit?: number }) => { limit = o.limit ?? -1; return { data: [user('u1', 1), asst('a1', 2, { start: 's', end: 'e' })] }; },
    },
  };
  const files = await computeTurnDiffForRuntime(runtime as any, 's1', 'u1', { snapshotRoot: root, git });
  expect(limit).toBe(200);
  expect(files[0].file).toBe('x.txt');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/diff/turn-diff.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/diff/turn-diff'`.

- [ ] **Step 3: Implement `gateway/src/core/diff/turn-diff.ts`**

Implement the exact interfaces above. Decisions the tests leave open:

- `selectTurnSnapshot` sorts a copy by `time.created` ascending. The turn is from the requested user index to the next user index (exclusive). Use `item.info ?? item`.
- `start` is the first assistant snapshot start; `end` is the last snapshot end. If the last snapshot has no `end` and `(snapshot.files?.length ?? 0) > 0`, throw `TurnDiffUnavailableError`. If it has no `end` and files are empty/absent, set `end = start`.
- If `start === end`, `computeTurnDiff` returns `[]` before resolving a repo.
- `snapshotRoot` defaults to `process.env.MAFW_OPENCODE_SNAPSHOT_ROOT` → `$XDG_DATA_HOME/opencode/snapshot` → `path.join(os.homedir(), '.local', 'share', 'opencode', 'snapshot')`.
- `findSnapshotRepo` lists `<root>/<projectID>` directories first, then all project directories. Treat `projectID` as a single path segment only: if it is absolute, contains `/`/`\`, or contains `..`, skip the direct lookup and use the scan. For each candidate directory, run `git --git-dir <repo> cat-file -t <start>` and the same for `end`; accept only `tree\n`. Return the first hit; `null` if none. Use `fs.readdirSync` with `withFileTypes`; skip files. Do not throw on missing dirs.
- `computeTurnDiff` runs:
  `['--git-dir', repo, '-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', start, end]`
  with `timeoutMs: 30_000`, `maxBuffer: 32 * 1024 * 1024`. A non-zero code throws a plain `Error` containing stderr.
- Default `GitRunner` uses `execFile('git', args, { encoding: 'utf8', windowsHide: true, timeout, maxBuffer })`, resolving `{ code: 0, stdout, stderr }` on success and `{ code, stdout, stderr }` on a non-zero exit (do not reject for a normal git exit code; reject only spawn errors).
- `parseGitDiff`: split into blocks at lines starting `diff --git `. For each block, file from `+++ b/…` (fallback `--- a/…`; `/dev/null` side selects the other). If there is no `+++`/`---` (binary or mode-only block), parse the `^diff --git a/(.+) b/(.+)$` header and use the `b/` side. Status from `new file mode`/`deleted file mode`; counts of `+`/`-` excluding `+++`/`---`; patch = block. Preserve `\n`; tolerate `\r\n`.
- `computeTurnDiffForRuntime` calls `runtime.session.get({ sessionID })`, then `runtime.session.messages({ sessionID, limit: 200 })`, then `computeTurnDiff({ messages: data, messageID, projectID: session.projectID, ...opts })`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/diff/turn-diff.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/diff/turn-diff.ts gateway/tests/unit/diff/turn-diff.test.ts
git commit -m "feat(gateway): per-turn diff from opencode snapshot trees"
```

---

### Task 2: Route `messageID` to per-turn snapshots

**Files:**
- Modify: `gateway/src/routes/session-diff.ts`
- Modify: `gateway/tests/unit/diff/routes-session-diff.test.ts`

**Interfaces:**
- Consumes: `computeTurnDiffForRuntime`, `TurnDiffUnavailableError` from Task 1.
- Produces:
  - `SessionDiffDeps` gains optional `turnDiff?: (args: { runtime: AgentRuntime; sessionID: string; messageID: string }) => Promise<FileDiffInfo[]>` (test seam; production defaults to `computeTurnDiffForRuntime`).

- [ ] **Step 1: Update the failing tests**

In `gateway/tests/unit/diff/routes-session-diff.test.ts`, import `TurnDiffUnavailableError`, change the existing messageID test, and add the new cases:

```ts
it('messageID goes to per-turn diff and never calls session.diff', async () => {
  const { deps, calls } = makeDeps();
  const turnCalls: any[] = [];
  deps.turnDiff = async (a) => { turnCalls.push(a); return FILES; };
  const res = makeRes();
  await handleSessionDiff(res, 's1', 'm1', deps);
  expect(res.statusCode).toBe(200);
  expect(JSON.parse((res as any).body)).toEqual({ files: FILES });
  expect(turnCalls).toEqual([{ runtime: deps.runtime, sessionID: 's1', messageID: 'm1' }]);
  expect(calls.some((c) => c[0] === 'diff')).toBe(false);
});

it('no messageID still calls the session-wide runtime diff', async () => {
  const { deps, calls } = makeDeps();
  const res = makeRes();
  await handleSessionDiff(res, 's1', undefined, deps);
  expect(res.statusCode).toBe(200);
  expect(calls[0]).toEqual(['diff', { sessionID: 's1' }]);
});

it('maps unavailable to 404 and git/other errors to 502', async () => {
  const unavailable = makeDeps();
  unavailable.deps.turnDiff = async () => { throw new TurnDiffUnavailableError('per-turn diff unavailable: no snapshots'); };
  const r1 = makeRes();
  await handleSessionDiff(r1, 's1', 'm1', unavailable.deps);
  expect(r1.statusCode).toBe(404);

  const failed = makeDeps();
  failed.deps.turnDiff = async () => { throw new Error('git failed'); };
  const r2 = makeRes();
  await handleSessionDiff(r2, 's1', 'm1', failed.deps);
  expect(r2.statusCode).toBe(502);
  expect(JSON.parse((r2 as any).body).error).toContain('git failed');
});
```

`makeDeps` must include a `runtime` with `capabilities.diffApi: true`, `session.diff`, `session.vcs.apply`, and (for the no-messageID branch) nothing else. The default `turnDiff` is not used in these tests because messageID tests inject it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd gateway && npx jest --runInBand tests/unit/diff/routes-session-diff.test.ts`
Expected: FAIL — old code calls `session.diff` for `m1`; 404/502 cases fail.

- [ ] **Step 3: Implement the route branch**

In `handleSessionDiff`:

```ts
if (messageID) {
  const run = deps.turnDiff ?? ((a) => computeTurnDiffForRuntime(a.runtime, a.sessionID, a.messageID));
  try {
    const files = await run({ runtime: deps.runtime!, sessionID, messageID });
    json(res, 200, { files: Array.isArray(files) ? files : [] });
  } catch (err: any) {
    if (err instanceof TurnDiffUnavailableError) json(res, 404, { error: err.message });
    else json(res, 502, { error: err?.message ?? String(err) });
  }
  return;
}
// existing session-wide call unchanged
```

Do not add any `session.diff` fallback in the `messageID` branch. Keep the existing `diffApi` 503 gate before the branch.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd gateway && npx jest --runInBand tests/unit/diff/routes-session-diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/session-diff.ts gateway/tests/unit/diff/routes-session-diff.test.ts
git commit -m "feat(gateway): route session.diff messageID to per-turn snapshots"
```

---

### Task 3: Desktop per-turn fetch/merge helper

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/turn-diffs.ts`
- Create: `packages/desktop/src/renderer/mafw/components/turn-diffs.test.ts`

**Interfaces:**
- Produces:
  - `TurnDiffCandidate = { messageID: string; snapshotKey: string }`
  - `collectTurnDiffCandidates(messages: any[]): TurnDiffCandidate[]`
  - `loadTurnDiffs(sessionID, messages, fetchDiff, concurrency = 4): Promise<Record<string, FileDiffEntry[] | null>>`
  - `mergeDiffLists(base: FileDiffEntry[], perTurn: Record<string, FileDiffEntry[] | null>): FileDiffEntry[]`
  - `applyTurnDiffsToCheckpoints(checkpoints: Checkpoint[], perTurn: Record<string, FileDiffEntry[] | null>): Checkpoint[]`
  - `shouldFetchSessionDiff(hasDiffs: boolean, allowSessionFallback = true): boolean`
  - `turnDiffRequestKey(runtimeName: string, sessionID: string, candidates: TurnDiffCandidate[]): string`
- Consumes: `FileDiffEntry` type from `./DiffReviewPanel`, `Checkpoint`/`CheckpointFile` from `./checkpoint-model`, `isLocalMessageId` from `../chat/local-id`.

- [ ] **Step 1: Write the failing tests**

Create `turn-diffs.test.ts` with:

```ts
const user = (id: string, created: number) => ({ id, role: 'user', time: { created } });
const asst = (id: string, created: number, snapshot: any) => ({ id, role: 'assistant', time: { created }, snapshot });
const PATCH = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';

test('collects user turns with assistant snapshots and excludes local ids', () => {
  const msgs = [
    asst('a0', 1, { start: 's0', end: 'e0' }),
    user('u1', 2), asst('a1', 3, { start: 's1', end: 'e1' }),
    user('local-1', 4), asst('a2', 5, { start: 's2', end: 'e2' }),
    user('u2', 6), asst('a3', 7, {}),
  ];
  const out = collectTurnDiffCandidates(msgs);
  expect(out.map(c => c.messageID)).toEqual(['u1']);
  expect(out[0].snapshotKey).toContain('e1');
});

test('fetch is per-turn, failures become null, and merge keeps per-turn wins', async () => {
  const msgs = [user('u1', 1), asst('a1', 2, { start: 's', end: 'e' }), user('u2', 3), asst('a2', 4, { start: 's2', end: 'e2' })];
  const called: string[] = [];
  const map = await loadTurnDiffs('s1', msgs, async (_sid, mid) => {
    called.push(mid);
    if (mid === 'u2') throw new Error('404');
    return { files: [{ file: 'x', patch: PATCH }] };
  });
  expect(called.sort()).toEqual(['u1', 'u2']);
  expect(map.u1).toHaveLength(1);
  expect(map.u2).toBeNull();
  const merged = mergeDiffLists([{ file: 'x', patch: 'OLD' }, { file: 'base', patch: 'B' }], map);
  expect(merged.find(f => f.file === 'x')!.patch).toBe(PATCH);
  expect(merged.some(f => f.file === 'base')).toBe(true);
});

test('applyTurnDiffsToCheckpoints distinguishes known-empty from unavailable', () => {
  const cps = [
    { messageID: 'u1', createdAt: 0, prompt: '', files: [], filesKnown: false },
    { messageID: 'u2', createdAt: 0, prompt: '', files: [], filesKnown: false },
  ] as any;
  const out = applyTurnDiffsToCheckpoints(cps, { u1: [], u2: null });
  expect(out[0]).toMatchObject({ filesKnown: true, files: [] });
  expect(out[1].filesKnown).toBe(false);
});

test('session fallback and request key', () => {
  expect(shouldFetchSessionDiff(false, false)).toBe(false);
  expect(shouldFetchSessionDiff(true, true)).toBe(false);
  expect(shouldFetchSessionDiff(false, true)).toBe(true);
  expect(turnDiffRequestKey('opencode', 's', [{ messageID: 'u', snapshotKey: 'a' }])).toBe('opencode|s|u:a');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/desktop`:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/turn-diffs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `turn-diffs.ts`**

- `collectTurnDiffCandidates`: sort ascending; walk users; for each non-local user, find the next user, collect assistant snapshots with `snapshot.start`; if any, candidate with `snapshotKey` = last snapshot’s `${start}:${end ?? ''}:${files?.length ?? 0}`.
- `loadTurnDiffs`: candidates; worker pool of `Math.min(concurrency, candidates.length)`; each calls `fetchDiff(sessionID, candidate.messageID)`, validates `Array.isArray(r.files) ? r.files : []`, catches to `null`.
- `mergeDiffLists`: map base by `file`, skip entries without a non-empty file; for each per-turn array, overwrite/set; null ignored; return values.
- `applyTurnDiffsToCheckpoints`: if `perTurn[cp.messageID]` is an array, map to `CheckpointFile` (copy `file`, `additions`, `deletions`, `status`, `patch` only if a string), set `filesKnown: true`; otherwise return the cp unchanged.
- `shouldFetchSessionDiff(hasDiffs, allowSessionFallback = true)` → `allowSessionFallback && !hasDiffs`.
- `turnDiffRequestKey(runtimeName, sessionID, candidates)` → `${runtimeName}|${sessionID}|${candidates.map(c => `${c.messageID}:${c.snapshotKey}`).join(',')}`.

- [ ] **Step 4: Run the test to verify it passes**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/turn-diffs.ts packages/desktop/src/renderer/mafw/components/turn-diffs.test.ts
git commit -m "feat(desktop): per-turn diff fetch and merge helpers"
```

---

### Task 4: B3 overlay uses per-turn diffs

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/checkpoint-model.ts` (add the overlay merge seam)
- Modify: `packages/desktop/src/renderer/mafw/components/CheckpointOverlay.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/checkpoint-revert.test.ts` (cross-module gating test)
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx` (failure copy only)

**Interfaces:**
- Consumes: `collectTurnDiffCandidates`, `loadTurnDiffs`, `applyTurnDiffsToCheckpoints` from Task 3.
- Produces: no new public props; the overlay still takes `sessionID`, `messages`, `parts`, `caps`, etc.

- [ ] **Step 1: Add the failing gating test**

In `checkpoint-revert.test.ts`, add a test that proves per-turn data can turn the code action on only for a safe modification:

```ts
import { checkpointsWithTurnDiffs } from "./checkpoint-model"
// ...
test("per-turn diffs feed canRewindCode without weakening the gate", () => {
  const NOW = 1_700_000_000_000
  const cpFor = (id: string, files: any[] | null) =>
    checkpointsWithTurnDiffs([{ id, role: "user", time: { created: NOW } }], {}, NOW, { [id]: files })
  const safe = cpFor("u1", [{ file: "x", patch: PATCH }])
  expect(canRewindCode(safe, "u1")).toBe(true)
  const added = cpFor("u2", [{
    file: "new",
    patch: "new file mode 100644\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+x",
  }])
  expect(canRewindCode(added, "u2")).toBe(false)
  const missing = cpFor("u3", null)
  expect(canRewindCode(missing, "u3")).toBe(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/desktop`:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/checkpoint-revert.test.ts`
Expected: FAIL — `checkpointsWithTurnDiffs` is not exported yet.

- [ ] **Step 3: Implement the overlay fetch/merge**

In `checkpoint-model.ts`, add the testable overlay seam:

```ts
import type { FileDiffEntry } from "./DiffReviewPanel"
import { applyTurnDiffsToCheckpoints } from "./turn-diffs"

export function checkpointsWithTurnDiffs(
  messages: any[],
  parts: Record<string, any[]>,
  now: number,
  turnDiffs: Record<string, FileDiffEntry[] | null> = {},
): Checkpoint[] {
  return applyTurnDiffsToCheckpoints(buildCheckpoints(messages, parts, now), turnDiffs)
}
```

In `CheckpointOverlay.tsx`:

- Import `createEffect` (already imports `onCleanup`), `collectTurnDiffCandidates`, `loadTurnDiffs`, `checkpointsWithTurnDiffs`, and `type FileDiffEntry`.
- Add `const [turnFiles, setTurnFiles] = createSignal<Record<string, FileDiffEntry[] | null>>({})` and `const [loadingTurnFiles, setLoadingTurnFiles] = createSignal(false)`.
- Add a `createEffect` that:
  - returns unless `props.caps?.diffApi === true` and `props.messages` has candidates;
  - builds `key = props.sessionID + '|' + candidates.map(c => c.messageID + ':' + c.snapshotKey).join(',')`;
  - skips if the key equals the last fetched key (local `let lastKey = ''`);
  - calls `loadTurnDiffs(props.sessionID, props.messages, (s, m) => window.api.mafw.sessions.diff(s, m))`;
  - sets `turnFiles` and clears `loading`; use a `cancelled` flag + `onCleanup` so a closed overlay does not set state.
- Change the checkpoints memo to:
  ```ts
  const checkpoints = createMemo(() => checkpointsWithTurnDiffs(props.messages, props.parts, Date.now(), turnFiles()))
  ```
- Keep `canCode` exactly as is; it now sees the per-turn files.
- Change the loading/no-data notes:
  - while `loadingTurnFiles()`: “正在加载回合级文件数据…”;
  - else if `props.caps?.diffApi === true && !checkpoints().some(cp => cp.filesKnown)`: “当前会话没有可用的回合级文件数据（需要 git 仓库快照）。”
- The file chips already render `cp.filesKnown`; now they show per-turn files. No other change.
- In `ChatPane.tsx`, update the `revertCodeTo` failure copy from “该检查点缺少可安全回滚的回合级文件数据（新增/删除文件或摘要缺失）。” to “该检查点缺少可安全回滚的回合级文件数据（新增/删除文件或数据不可用）。” (behavior unchanged).

- [ ] **Step 4: Run the tests to verify they pass**

Run:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/checkpoint-revert.test.ts src/renderer/mafw/components/turn-diffs.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the component**

Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: rc=0.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/checkpoint-model.ts packages/desktop/src/renderer/mafw/components/CheckpointOverlay.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/components/checkpoint-revert.test.ts
git commit -m "feat(desktop): B3 code rewind uses per-turn diffs"
```

---

### Task 5: B2 changes tree and review safety

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChangesDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/DiffReviewPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/checkpoint-revert.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/checkpoint-revert.test.ts`

**Interfaces:**
- Consumes: `collectTurnDiffCandidates`, `loadTurnDiffs`, `mergeDiffLists`, `turnDiffRequestKey`, `shouldFetchSessionDiff` from Task 3; `isInvertiblePatch` from `checkpoint-revert`.
- Produces:
  - `isFileRevertible(file: { patch?: string }, allowNonInvertible = true): boolean` in `checkpoint-revert.ts`.
  - `DiffReviewPanel` props `allowSessionFallback?: boolean`, `allowNonInvertibleRevert?: boolean`.
  - `MafwShell` merged diff memo passed to both `ChangesDock` and `EditorDock`.

- [ ] **Step 1: Add the failing safety tests**

In `checkpoint-revert.test.ts`, add `isFileRevertible` to the existing import from
`./checkpoint-revert`, then add:

```ts
test("isFileRevertible gates non-invertible patches only in strict mode", () => {
  expect(isFileRevertible({ patch: PATCH }, false)).toBe(true)
  expect(isFileRevertible({ patch: "new file mode 100644\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+x" }, false)).toBe(false)
  expect(isFileRevertible({ patch: "new file mode 100644\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+x" }, true)).toBe(true)
})
```

In `turn-diffs.test.ts`, the `shouldFetchSessionDiff` and `turnDiffRequestKey` assertions from Task 3 already cover the panel/dock decisions.

- [ ] **Step 2: Run the tests to verify they fail**

Run from `packages/desktop`:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/checkpoint-revert.test.ts`
Expected: FAIL — `isFileRevertible` not exported.

- [ ] **Step 3: Implement `isFileRevertible` and the panel safety**

`checkpoint-revert.ts`:

```ts
export function isFileRevertible(file: { patch?: string }, allowNonInvertible = true): boolean {
  return allowNonInvertible || isInvertiblePatch(file.patch ?? "")
}
```

`DiffReviewPanel.tsx`:

- Add the two props.
- In `refresh`, use `shouldFetchSessionDiff((props.diffs?.length ?? 0) > 0, props.allowSessionFallback !== false)`; when false, clear `fetched` and return without calling the session-wide endpoint.
- When `allowSessionFallback === false`, hide the panel’s “刷新” button (the embedded dock has no per-turn refresh endpoint; the parent owns the data).
- In the file loop, compute `const revertible = isFileRevertible(f, props.allowNonInvertibleRevert !== false)`.
- When `!revertible`, render a `mafw-diff-note` “新增/删除文件不支持回退” and render the hunk checkbox `disabled`; `toggle` must no-op for that file.
- In `revertSelected`, skip files where `!isFileRevertible(f, props.allowNonInvertibleRevert !== false)`; keep the footer count consistent by never selecting those keys.
- Keep the existing hint/comments/annotations.

`ChangesDock.tsx`: pass `allowSessionFallback={false}` and `allowNonInvertibleRevert={false}` to its embedded `DiffReviewPanel`.

`EditorDock.tsx`: same two props on its `DiffReviewPanel` (around line 428).

- [ ] **Step 4: Wire per-turn data into the B2/Editor diff list**

`MafwShell.tsx`:

- Import `collectTurnDiffCandidates`, `loadTurnDiffs`, `mergeDiffLists`, `turnDiffRequestKey` and the `FileDiffEntry` type.
- Add:
  ```ts
  const [sessionTurnDiffs, setSessionTurnDiffs] = createSignal<Record<string, Record<string, FileDiffEntry[] | null>>>({})
  const requestedTurnDiffs = new Set<string>()
  const sessionMessages = createMemo(() => (store.message as any)[currentSessionID()] || [])
  const mergedSessionDiffs = createMemo(() => mergeDiffLists(
    aggregateSessionDiffs(sessionMessages()),
    sessionTurnDiffs()[currentSessionID() || ""] || {},
  ))
  ```
- Add a `createEffect` after `rightDockTab` is declared:
  ```ts
  createEffect(() => {
    const sid = currentSessionID()
    const tab = rightDockTab()
    if (!sid || rtCaps().diffApi !== true || (tab !== "changes" && tab !== "editor")) return
    const msgs = sessionMessages()
    const candidates = collectTurnDiffCandidates(msgs)
    if (!candidates.length) return
    const key = turnDiffRequestKey(rtName(), sid, candidates)
    if (requestedTurnDiffs.has(key)) return
    requestedTurnDiffs.add(key)
    void loadTurnDiffs(sid, msgs, (s, m) => window.api.mafw.sessions.diff(s, m))
      .then(map => setSessionTurnDiffs(prev => ({ ...prev, [sid]: map })))
      .catch(() => { /* fail-open; per-turn data stays absent */ })
  })
  ```
- Replace both `diffs={aggregateSessionDiffs(...)}` occurrences in the `ChangesDock` and `EditorDock` JSX with `diffs={mergedSessionDiffs()}`.
- Ensure the effect is after `rtCaps`, `currentSessionID`, `rightDockTab`, and `rtName` declarations; if the placement is awkward, move the memo/effect block to immediately after `rightDockTab`.

- [ ] **Step 5: Run the tests to verify they pass**

Run:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/checkpoint-revert.test.ts src/renderer/mafw/components/turn-diffs.test.ts src/renderer/mafw/components/session-diffs.test.ts src/renderer/mafw/components/change-tree.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and build**

Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: rc=0.

Run: `npx electron-vite build`
Expected: success.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/ChangesDock.tsx packages/desktop/src/renderer/mafw/components/EditorDock.tsx packages/desktop/src/renderer/mafw/components/DiffReviewPanel.tsx packages/desktop/src/renderer/mafw/components/checkpoint-revert.ts packages/desktop/src/renderer/mafw/components/checkpoint-revert.test.ts
git commit -m "feat(desktop): B2 changes tree and review from per-turn diffs"
```

---

### Task 6: Full gates, independent review, ship notes

**Files:**
- Modify: `AGENTS.md` (B3/B3.1 status paragraph; keep it short)
- Modify: `docs/superpowers/specs/2026-10-23-b31-per-turn-diff-design.md` (status → implemented, final review corrections if any)

**Interfaces:** none.

- [ ] **Step 1: Run the gateway tests**

Run: `cd gateway && npm test`
Expected: full gateway suite green; record the number of tests.

- [ ] **Step 2: Run the desktop full suite**

Run: `cd packages/desktop && npm test`
Expected: all desktop tests green; record the pass count and the new-test count relative to 1388.

- [ ] **Step 3: Typecheck and build**

Run: `cd packages/desktop && npx tsgo --noEmit -p tsconfig.json`
Expected: rc=0.

Run: `cd packages/desktop && npx electron-vite build`
Expected: success.

Run: `cd gateway && npm run build`
Expected: tsc success.

- [ ] **Step 4: Verify the real look-session payload without restarting the user’s gateway**

Use the live gateway’s messages (read-only) and the new service in a throwaway script:

- Fetch `GET /api/sessions/ses_ea3fbfa84ffejPLA0tz2b5I5bi/message?limit=200` and
  `GET /api/sessions/ses_ea3fbfa84ffejPLA0tz2b5I5bi` (the gateway already has them).
- Run `computeTurnDiff` in a one-off `ts-node`/`tsx` script with
  `projectID: "b4ee80f33040d0555c7b37821f1847783c4218ea"` and
  `messageID: "msg_1627e5777001Jggdf4cXkuqz79"`.
- Expected: one file `linux_runner.py` with a new-file patch. A bogus message id
  must throw `TurnDiffUnavailableError` (the route would return 404).

Do not restart the user’s gateway for this step. GUI smoke of the timeline/dock is a
user follow-up after they next restart the dev app/gateway; record that in the ship
notes.

- [ ] **Step 5: Independent review**

Dispatch a fresh reviewer subagent (read-only, may run the targeted tests) with:
- the B3.1 spec and this plan,
- the task commits’ diff,
- the Review Focus list.

Ask for Critical/Important issues only. Fix all Critical/Important findings, then
re-run the affected tests. If the reviewer is unavailable (403/network), self-review
against the Review Focus list and record that fact.

- [ ] **Step 6: Ship notes**

Update the B3 paragraph in `AGENTS.md` to say:
- code rewind is no longer HOLD for git-backed sessions with intact snapshot trees;
- per-turn diff comes from `snapshot.start/end` tree diffs, not `summary.diffs`;
- new/deleted files remain visible in B2 but not code-rewindable;
- non-git sessions, missing snapshots, and pruned trees return 404 and hide code rewind;
- GUI smoke remains pending until the next dev-app/gateway restart.

Set the B3.1 spec status to “Implemented (commit `<hash>`)”. Commit the notes:

```bash
git add AGENTS.md docs/superpowers/specs/2026-10-23-b31-per-turn-diff-design.md
git commit -m "docs: B3.1 per-turn diff ship notes"
```

- [ ] **Step 7: Report**

Report to the user: new test count, full desktop and gateway pass counts, typecheck/build
results, task commit hashes, and the known limitations (non-git sessions, pruned
snapshots, new/deleted files, worktree apply boundary).
