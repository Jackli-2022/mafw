# B3.1 — Per-turn diff from opencode snapshot trees

**Date:** 2026-10-23
**Status:** Implemented (2026-10-23; final review corrections applied)
**Supersedes/extends:** `2026-10-23-b3-checkpoint-rewind-design.md` (B3 code rewind HOLD)

## 1. Why

B3 delivered the checkpoint timeline and conversation rewind, but code rewind is
currently hidden because opencode 2.1 does not populate `message.summary.diffs`,
and `GET /api/sessions/:id/diff?messageID=...` ignores `messageID` and returns the
same session-wide VCS diff for every id (including a bogus id).

We found a reliable per-turn source that the serve already records:

- Every assistant message may carry `snapshot: { start, end, files }`.
- `start` / `end` are **git tree ids** in the opencode snapshot repository
  `~/.local/share/opencode/snapshot/<projectID>/<repoDir>`.
- `git --git-dir=<repo> diff <start> <end>` yields exactly the files changed by
  that assistant turn.
- A user turn is the assistant messages between it and the next user message. The
  per-turn range is the first assistant `snapshot.start` and the last assistant
  `snapshot.end`.

Probe evidence (2026-10-23):

- Session `ses_ea3fbfa84ffejPLA0tz2b5I5bi` (`C:\work\look`), user message
  `msg_1627e5777001Jggdf4cXkuqz79`; assistant `msg_1627ea65a001PtSKuQSWogsC9P`
  has `snapshot.start=887c13…`, `snapshot.end=02505c…`, `files=["linux_runner.py"]`.
  `git --git-dir=…/snapshot/b4ee…/b69… diff 887c13… 02505c…` produces the
  `linux_runner.py` new-file patch.
- The same serve ignores `messageID` for all tested user/assistant/bogus ids.
- A session whose directory is not a git repo (`ses_ea2e…`, `C:\work\work-loop`)
  has no `snapshot` fields at all. It must degrade to “per-turn diff unavailable”,
  not to the session-wide diff.
- Some historical snapshot ids are no longer present in the snapshot repo (objects
  pruned or session in a removed worktree). These must return unavailable, never a
  session-wide fallback.

## 2. Goals

1. Make `GET /api/sessions/:id/diff?messageID=<userMessageID>` return the
   **per-turn** diff computed from the user turn’s snapshot trees.
2. Re-enable B3 code rewind for turns with complete, invertible per-turn patches,
   keeping the existing safety gate (no new/deleted files, no unsafe fallback).
3. Light the B2 changes tree from the same per-turn data when `summary.diffs` is
   absent.
4. Keep the desktop’s current conversation-rewind behavior unchanged.

## 3. Non-goals

- Reconstructing diffs for non-git session directories, or for sessions whose
  snapshot objects were pruned.
- Recovering per-turn diffs from tool-call inputs (`edit`/`write`/bash) when no
  snapshot exists.
- Reverting new/deleted files, binary files, or patches that are not safe to invert.
- Changing opencode serve, `opencode-adapter.ts`, or the runtime capability
  contract. The route can implement this on top of `session.messages` /
  `session.get`.
- Worktree-scoped `vcs.apply` support (the existing apply path still targets the
  serve workspace; worktree sessions remain a known boundary).

## 4. Semantics

### 4.1 `messageID`

- `messageID` is a **user message id**, matching the checkpoint timeline rows.
- If omitted, the route keeps the current behavior: session-wide
  `runtime.session.diff` (used by live VCS snapshots).
- If present and not found, or not a user message: `404`.
- If present and the turn has no assistant snapshots: `404`
  (`per-turn diff unavailable`).
- If present and a snapshot exists but the git objects cannot be found: `404`.
- **Never** fall back to the session-wide diff when `messageID` is present.

### 4.2 Turn selection

1. Fetch messages via `runtime.session.messages({ sessionID, limit: 200 })`.
   The serve caps this endpoint at ~200 messages (`limit=250/300/500` returns an
   empty window); 200 is the largest reliable window. Normalize each item as
   `item.info ?? item`.
2. Sort ascending by `time.created` (stable).
3. Find the user message with the requested id. If absent → 404.
4. The turn extends from that user message to (excluding) the next user message.
5. Consider assistant messages in that range that carry `snapshot.start`.
   - `start` = first such assistant’s `snapshot.start`.
   - `end` = last such assistant’s `snapshot.end`.
   - If the last snapshot has no `end` and `snapshot.files` is non-empty, the turn
     is incomplete → 404. Do not guess.
   - If the last snapshot has no `end` and `snapshot.files` is empty, use its
     `start` (no file changes in the final step); earlier changes are still
     covered by the first `start` and the last available end.
6. If no assistant snapshot exists → 404.
7. If `start === end` → return `{ files: [] }` without invoking git.

**Window limitation:** only the newest ~200 messages are addressable. A checkpoint
older than that returns 404 and the UI hides its per-turn data. This is consistent
with the existing “loaded window” scope; no adapter/contract change or pagination
is added in this slice.

### 4.3 Snapshot repository discovery

- Root: `MAFW_OPENCODE_SNAPSHOT_ROOT` if set, else
  `$XDG_DATA_HOME/opencode/snapshot`, else
  `~/.local/share/opencode/snapshot`.
- Try `<root>/<projectID>/*` first (`projectID` from `runtime.session.get`).
- If no repo contains both trees, scan the remaining project directories for the
  first repo that contains both. This handles stale/mismatched project ids.
- A repo is a git directory (it has `HEAD` / `objects` directly, no `.git`
  subdirectory). Use `git --git-dir=<repo>`.
- Verify both ids are objects (`git cat-file -t`); require `tree`.
- If none found → 404.

### 4.4 Diff command and parsing

```
git --git-dir <repo> -c core.quotePath=false diff --no-color --no-ext-diff \
    --no-textconv --no-renames <start> <end>
```

- `--no-renames` turns renames into delete+add, which the safety gate rejects.
- Timeout 30s; `maxBuffer` 32 MB; `windowsHide: true`.
- Parse into `FileDiffInfo[]`:
  - File path from `+++ b/…` / `--- a/…`; `/dev/null` side selects the other.
  - Status: `new file mode` → `added`; `deleted file mode` → `deleted`; else
    `modified`.
  - Additions/deletions count `+`/`-` lines excluding `+++`/`---`.
  - Patch is the complete `diff --git …` block.
  - Blocks without hunks (binary/mode-only) are kept; the desktop gate will refuse
    them for code rewind.
- Empty output with `start !== end` is still `{ files: [] }` (e.g. only
  submodule changes).

### 4.5 Route responses

- `200 { files: FileDiffInfo[] }` — computed, including no changes.
- `404 { error: "per-turn diff unavailable: …" }` — no snapshots/repo/objects.
- `502 { error: … }` — git execution/parse failure.
- Capability gate unchanged: no `diffApi` → 503.

## 5. Gateway design

New module `gateway/src/core/diff/turn-diff.ts` (pure logic + injected I/O):

- `selectTurnSnapshot(messages, messageID)` → `{ ok, start, end }` or
  `{ ok:false, reason }`.
- `parseGitDiff(patchText)` → `FileDiffInfo[]` (pure, unit-tested).
- `findSnapshotRepo({ root, projectID, start, end, git })` → repo path or null.
- `computeTurnDiff({ messages, messageID, projectID, root, git })` → files.
- `git` is an injected `run(args) → { stdout, stderr }` for tests; default
  implementation uses `child_process.execFile`.

Route `gateway/src/routes/session-diff.ts`:

```ts
if (messageID) {
  const session = await runtime.session.get({ sessionID });
  const { data } = await runtime.session.messages({ sessionID, limit: 200 });
  const files = await computeTurnDiff({ ... });
  json(res, 200, { files });
  return;
}
// existing session-wide path
```

The route must not call `runtime.session.diff` in the `messageID` branch. This is
the critical safety fix.

No changes to `opencode-adapter.ts`, `contract.ts`, or the SDK shape (`{ files }`).

## 6. Desktop design

### 6.1 Shared per-turn fetch helper

New `packages/desktop/src/renderer/mafw/components/turn-diffs.ts`:

- `collectTurnDiffCandidates(messages)` — user messages whose following turn has at
  least one assistant `snapshot.start` and is not a local/optimistic id.
- `loadTurnDiffs(sessionID, messages)` — fetch each candidate via
  `window.api.mafw.sessions.diff(sid, messageID)`; return a map
  `messageID → FileDiffEntry[] | null`. `null` means unavailable/failed. Use a
  small concurrency cap (e.g. 4) and swallow per-turn errors.
- `mergeDiffLists(base, perTurn)` — merge by file path; per-turn entries win.
- `applyTurnDiffsToCheckpoints(checkpoints, map)` — replace `files`/`filesKnown`
  only when a non-null map entry exists.

### 6.2 B3 overlay

`CheckpointOverlay` loads turn diffs when it opens (and when `sessionID` changes),
only when `caps.diffApi === true`:

- Merge the map into the `checkpoints` memo.
- While loading, show “正在加载回合级文件数据…”.
- `canRewindCode` then operates on real patches and keeps its existing strict
  gate: every target turn must have `filesKnown`, and every non-empty file must
  have an invertible patch (no new/deleted/binary/mode-only).
- A turn with a snapshot but no changes has `filesKnown=true, files=[]`; it does
  not by itself make code rewind available.
- If a turn is unavailable (`null`), code rewind remains hidden for that target.
- The file chips now show per-turn files (basename), instead of “文件记录不可用”.
- Conversation rewind is unchanged and remains available whenever the runtime
  supports it.

`ChatPane.revertCodeTo` keeps its preflight check on the merged checkpoints. No
new fetch is needed at confirm time; the overlay only enables the code action
after all targets are known and invertible.

### 6.3 B2 changes dock and editor dock

`MafwShell` owns the per-session per-turn data for both dock consumers:

- When `rightDockTab` is `changes` or `editor`, `runtimeCaps.diffApi === true`,
  and the current session has turn-diff candidates, it calls
  `loadTurnDiffs(sessionID, messages)` once per `sessionID + candidate set`
  (a memo key prevents refetching on every streaming token).
- It merges the map with `aggregateSessionDiffs(messages)` and passes the merged
  list to **both** `ChangesDock` and `EditorDock` (`diffs` prop).
- Per-turn entries win for the same file; summary-derived entries remain for
  turns without per-turn data.

`ChangesDock` then uses the merged `diffs` for the tree, totals, and its embedded
`DiffReviewPanel`. The existing live-diff pulse stays unchanged (SSE
`session.diff` is a live VCS snapshot, not the historical tree source).

The overlay (below) fetches its own map when it opens; it does not depend on the
dock being open, so timelines work without opening the changes tab.

### 6.4 Failure and loading behavior

- Per-turn fetch failures are per-turn; they never blank the whole tree or
  timeline.
- The gateway 404 is expected for non-git sessions, pruned snapshots, and turns
  with no assistant snapshots; the UI simply has no per-turn data.
- No silent use of the session-wide diff in any checkpoint/code path.

### 6.5 DiffReviewPanel safety in the embedded docks

The existing `DiffReviewPanel` has two behaviors that are unsafe once it is fed
per-turn data:

1. If `props.diffs` is empty, it calls `sessions.diff(sessionID)` (session-wide
   VCS diff) and shows that as review content.
2. “回退选中” accepts any hunk, including a new-file patch (`@@ -0,0 +…`), which
   can delete a newly added file.

Add two optional props (defaults preserve existing composer behavior):

- `allowSessionFallback?: boolean` (default `true`). `ChangesDock` and
  `EditorDock` pass `false`; when merged per-turn/summary data is empty, the
  embedded panel shows its empty state instead of fetching a session-wide diff.
- `allowNonInvertibleRevert?: boolean` (default `true`). The embedded docks pass
  `false`. For each file with a patch, use the same `isInvertiblePatch` rule as
  B3; non-invertible files (added/deleted/binary/mode-only) render a
  “新增/删除文件不支持回退” note and no selectable hunk checkbox. The footer
  count excludes them. Comments and annotation drafting remain available.

This keeps B2 review/comment useful for new files while preventing the dock from
performing a code revert that the B3 safety gate forbids.

## 7. Tests

Gateway (jest):

- `parseGitDiff`: modified, added, deleted, binary/no-hunk, rename-disabled output,
  quoted paths, multiple files, additions/deletions counts.
- `selectTurnSnapshot`: multiple assistant messages, missing `end`, no assistant,
  user not found, assistant id, next-user boundary, unsorted input.
- `findSnapshotRepo`: project id hit, scan fallback, missing objects.
- `computeTurnDiff`: start=end short-circuit, real temp git tree diff (integration),
  git error, missing tree.
- Route: 200 per-turn, 404 no snapshot, 404 missing message, 502 git error,
  **no session-wide fallback** when `messageID` is present, 503 no diffApi.
- Regression: no `messageID` still calls `runtime.session.diff` once.

Desktop (node --test):

- `collectTurnDiffCandidates` / `loadTurnDiffs` / `mergeDiffLists` /
  `applyTurnDiffsToCheckpoints`.
- `checkpoint-revert` gating with per-turn files (modified ok, added/deleted/
  binary rejected, unavailable hidden).
- `session-diffs` merge behavior (per-turn wins, summary kept when no entry).
- `DiffReviewPanel`: embedded mode with `allowSessionFallback=false` never calls
  the session-wide endpoint; non-invertible files are not selectable and are
  excluded from `revertSelected`.
- Existing B2/B3 tests updated; all desktop tests pass.
- `tsgo --noEmit` and `electron-vite build`.

## 8. Acceptance

1. With `ses_ea3fbfa84ffejPLA0tz2b5I5bi` and user
   `msg_1627e5777001Jggdf4cXkuqz79`, the endpoint returns one file
   `linux_runner.py` with a new-file patch (not the session-wide diff).
2. A bogus `messageID` returns 404, not the session-wide patch.
3. The B3 timeline shows per-turn file chips for that session; code rewind is
   hidden for the new-file turn. The **positive** modified-file case is verified
   by a temp-git integration test that creates an existing file, modifies it,
   and asserts an invertible modified patch; a manual positive check uses any
   session/turn with an existing-file modification if one is available.
4. The B2 changes tree shows the per-turn file and its stats; the embedded review
   panel cannot fall back to the session-wide diff and cannot select the new-file
   hunk for rewind.
5. A non-git session (or missing snapshot object) shows no per-turn data; code
   rewind stays hidden; conversation rewind still works.

## 9. Known limitations

- Per-turn code rewind requires a git-backed session directory with intact
  opencode snapshot trees. The current `C:\work\work-loop` session is not a git
  repo, so it will not light up; sessions opened in
  `C:\work\work-loop\opencode-plugin-mafw` or `C:\work\look` can.
- Historical snapshot objects may have been pruned. The endpoint returns 404 and
  the UI hides the feature rather than guessing.
- New/deleted/binary/mode-only changes are shown in the B2 tree but are not
  code-rewindable.
- The gateway fetches up to 200 messages per call and runs one git diff per
  requested turn; the desktop only requests turns in the loaded window and runs
  them with a small concurrency cap.
- `vcs.apply` still applies to the serve workspace rather than a per-session
  worktree; worktree sessions are out of scope for this slice.

## 10. Final review corrections (2026-10-23)

- A blank `?messageID=` is treated as present (`messageID !== undefined`) and
  returns 404; it must never fall through to the session-wide diff.
- The desktop per-turn map is preseeded in chronological candidate order so the
  **latest** turn wins regardless of which HTTP/git request finishes first.
- Final gates: desktop 1405/1405, gateway 2538/2538, desktop `tsgo` rc=0,
  `electron-vite build` ok, gateway `npm run build` ok. The full gateway suite
  needs `--forceExit` because of pre-existing open handles; test results are green.
- History note: `c36c7ef9` also captured pre-existing user sticky-switch hunks in
  `MafwShell.tsx` while the user was editing in parallel. HEAD builds and the
  user's later commit supplies the preload methods; main history was not rewritten.

