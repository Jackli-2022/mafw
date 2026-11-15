# Agent-native Chat Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the composer mode bar and let Lead / Tech Lead actions surface as inline transcript cards, starting with Goal creation.

**Architecture:** The composer becomes a single send surface. The Lead already creates discussion Goals through `mafw_create_goal`; the desktop renders that tool result as an actionable `GoalCreatedCard` instead of a mode button. Episode marking moves from the composer row to the transcript header. Review and boundary cards are later phases.

**Tech Stack:** SolidJS renderer, session-ui tool-card registry, Node test runner + `@mafw/test-shim`, TypeScript (`tsgo`).

**Spec:** `.superpowers/brainstorm/1145-1794690626/content/agent-native-intent.html` (approved option D)

## Global Constraints

- No new runtime names or capability flags in client DTOs.
- UI controls use `@mafw/ui` v2 components; no bare `<button>` / `<input>`; no bare `title`.
- Human-only actions (resolve review item, accept, merge, plan approval, decide) stay explicit user clicks.
- Goal cards only render for `routedTo: "tech_lead"`; legacy `mafw_create_goal` results keep the existing generic card.
- Tests must run with `--conditions=browser`.
- No push, merge, or release without explicit approval.

## Review Focus

- A `mafw_create_goal` tool result that is still running must not render a success card.
- A legacy (non-Lead) Goal result must not offer Pod actions.
- A Goal whose Tech Lead session failed must show a warning but still offer opening the Goal.
- Removing the mode bar must not remove the only entry to Episode marking or free-discussion handoff.
- A queued/busy message must not carry a stale mode directive.

---

### Task 1: Remove composer mode state and mode bar

**Files:**
- Delete: `packages/desktop/src/renderer/mafw/components/ChatModeBar.tsx`
- Delete: `packages/desktop/src/renderer/mafw/chat/composer-mode.ts`
- Delete: `packages/desktop/src/renderer/mafw/chat-mode-bar.css`
- Delete: `packages/desktop/src/renderer/mafw/chat/composer-mode.test.ts`
- Delete: `packages/desktop/tests/chat-mode-bar-wiring.test.ts`
- Delete: `packages/desktop/tests/chat-mode-delegate-wiring.test.ts`
- Delete: `packages/desktop/tests/chat-mode-resolve-wiring.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/chat/use-send-message.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/turn-queue.ts`
- Modify: `packages/desktop/src/renderer/mafw/chat/use-send-message.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorldOverviewStage.tsx`
- Test: `packages/desktop/tests/agent-native-chat-wiring.test.ts`

**Interfaces:**
- Produces: `sendMessage(mode?: "send" | "queue", opts?: { voiceOrigin?: boolean })`
- Produces: `QueuedTurn = { text; atts; agents; voiceOrigin? }` (no `chatMode`)

- [ ] **Step 1: Write the failing wiring test**

```ts
test("composer has no transient mode bar", () => {
  assert.doesNotMatch(chat, /ChatModeBar|composerMode|modeActionLabel|modeSendsMessage/)
  assert.doesNotMatch(shell, /canDelegate=|canResolve=|onDelegateDraft=|onResolveRequest=/)
  assert.doesNotMatch(send, /chatMode|modeDirective|modeSendsMessage/)
  assert.doesNotMatch(queue, /chatMode/)
})

test("send path keeps clean text without synthetic mode parts", () => {
  // covered in use-send-message.test.ts
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/agent-native-chat-wiring.test.ts`
Expected: FAIL on `ChatModeBar`.

- [ ] **Step 3: Delete mode files and simplify the send pipeline**

Remove `composerMode`, `modeSendsMessage`, `modeDirective`, `modeActionLabel`, `modeAvailability`, `setComposerMode`. `submitComposer` always calls `sendMessage`. `useSendMessage` no longer builds a synthetic `prt_mode_` part, and `QueuedTurn` no longer stores `chatMode`.

- [ ] **Step 4: Update `ChatPane` props and `MafwShell` wiring**

Remove `canDelegate`, `canResolve`, `onDelegateDraft`, `onResolveRequest`, `openGoalComposerWithDraft`, `openReviewFromChat`, `goalComposerInitial`, and `WorldOverviewStage.composerInitial`. Keep `onHandoffToLead` for free discussions.

- [ ] **Step 5: Run tests**

Run: `npm run test:desktop`
Expected: PASS with obsolete mode tests removed.

- [ ] **Step 6: Commit**

```bash
git add -A packages/desktop
git commit -m "refactor(desktop): remove transient composer modes"
```

---

### Task 2: Move Episode marking to the transcript header

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/chat-episodes.css`
- Test: `packages/desktop/tests/agent-native-chat-wiring.test.ts`

**Interfaces:**
- Produces: header action `.mafw-episode-mark` calling `startEpisode()`.

- [ ] **Step 1: Write the failing test**

```ts
test("Episode marking stays reachable from the transcript header", () => {
  assert.match(chat, /startEpisode/)
  assert.match(chat, /mafw-episode-mark/)
  assert.doesNotMatch(chat, /mafw-chat-mode-row/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/agent-native-chat-wiring.test.ts`
Expected: FAIL on `mafw-episode-mark` placement.

- [ ] **Step 3: Implement**

Add a ghost `ButtonV2` labeled `标记 Episode` in the chat header next to `时间线`, disabled when `visibleTurns()` is empty, with a `TooltipV2` explaining that it starts a discussion segment. Remove `.mafw-chat-mode-row` and `.mafw-chat-mode-bar` styles.

- [ ] **Step 4: Run tests**

Run: `npm run test:desktop`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/chat-episodes.css packages/desktop/tests/agent-native-chat-wiring.test.ts
git commit -m "refactor(desktop): move episode marking to the transcript header"
```

---

### Task 3: Render Lead-created Goals as an inline action card

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/goal-created.ts`
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/goal-created.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/goal-created.css`
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/goal-created.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/index.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/tests/goal-created-card-wiring.test.ts`

**Interfaces:**
- Produces: `goalCreatedView(input, output, status): GoalCreatedView`
- Produces: `configureGoalCreatedActions(actions: { open(goalId): void; cancel(goalId): Promise<boolean> } | null): void`
- Consumes: `window.api.mafw.goals.control({ goalId, action: "ABORT" })`

- [ ] **Step 1: Write the failing pure test**

```ts
test("tech_lead result becomes an open-discussion card", () => {
  const view = goalCreatedView(
    { title: "修复登录" },
    JSON.stringify({
      success: true, routedTo: "tech_lead", podId: "pod_1", goalId: "g1",
      revision: 1, stage: "discussing", sessionID: "ses_1",
      sourceRef: { sessionID: "ses_lead" },
    }),
    "completed",
  )
  assert.equal(view.kind, "tech_lead")
  assert.equal(view.title, "修复登录")
  assert.equal(view.hasHandoff, true)
  assert.equal(view.sessionID, "ses_1")
})

test("legacy result keeps the generic card", () => {
  const view = goalCreatedView({ title: "旧 Goal" }, JSON.stringify({ success: true, routedTo: "legacy", goalId: "g2" }), "completed")
  assert.equal(view.kind, "legacy")
})

test("running tool call is pending", () => {
  const view = goalCreatedView({ title: "进行中" }, undefined, "running")
  assert.equal(view.kind, "pending")
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/tool-cards/goal-created.test.ts`
Expected: FAIL with `goalCreatedView is not defined`.

- [ ] **Step 3: Implement `goalCreatedView` and the card**

`goalCreatedView` returns `{ kind, title, goalId, stage, sessionID, hasHandoff, warning }`. The component uses `BasicTool` + `ButtonV2`, shows “讨论中（未执行）”, “打开 Tech Lead 讨论”, and an inline “撤销 → 确认撤销” two-step. Non-`tech_lead` results fall back to `familyCard(TOOL_SPECS.mafw_create_goal)`.

- [ ] **Step 4: Register the card and wire actions**

In `registerMafwToolCards`, call `registerAliased("mafw_create_goal", MafwGoalCreatedCard)` after the generic loop. In `MafwShell` `onMount`, call `configureGoalCreatedActions` with `open = openGoalAndDiscuss(goalId, "timeline")` and `cancel = goals.control({ goalId, action: "ABORT" })`; clear on cleanup.

- [ ] **Step 5: Run tests**

Run: `npm run test:desktop`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/goal-created-card-wiring.test.ts
git commit -m "feat(desktop): render Lead-created goals as an inline action card"
```

---

### Task 4: Gates and docs

**Files:**
- Modify: `docs/architecture/desktop.md`
- Create: `docs/releases/2026-11-15-agent-native-chat-intent.md`

- [ ] **Step 1: Update architecture and release notes**

Record: mode bar removed; Lead creates Goals directly; `GoalCreatedCard`; Episode moved to header; review/boundary cards are next phases.

- [ ] **Step 2: Run gates**

```bash
npm run test:desktop
cd packages/desktop && npx tsgo --noEmit -p tsconfig.json
cd packages/desktop && npx electron-vite build
```

Expected: all pass, `rc=0`.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/desktop.md docs/releases/2026-11-15-agent-native-chat-intent.md
git commit -m "docs: record agent-native chat intent"
```
