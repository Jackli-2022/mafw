# Workbench Chat Modes & Episodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Chat express intent and group discussion by question: four composer modes (discuss / propose / delegate / resolve), plus episodes that collapse a closed discussion into a decision record link.

**Architecture:** Modes are UI intent, not new permissions. Discuss/propose send a synthetic mode part alongside the user message (invisible in the transcript); delegate opens the existing Goal delegation preview; resolve opens the existing review queue. Episodes are a per-session view grouping stored in `localStorage` (`mafw-episodes:v1:<sessionID>`); closing an episode can draft (not confirm) a decision record, which the human confirms in the existing decision board. No new session model, no new mandate.

**Tech Stack:** Electron 42, SolidJS, TypeScript, `@mafw/ui` v2, `node:test` + `@mafw/test-shim`, electron-vite, Jest for gateway.

**Spec:** `docs/superpowers/specs/2026-11-12-workbench-stage-first-design.md`
**Predecessor:** `docs/superpowers/plans/2026-11-12-workbench-chat-decisions.md`

## Scope split

This plan covers §10.4 episodes and §10.5 composer modes. **Plan 5** covers the remaining workbench pieces: split view, world overview subject, legacy `WorkbenchContext` / four-context cleanup, execution drawer removal, and decision-board SSE invalidation + record virtualization. Those are independent from Chat modes and the spec’s migration order keeps legacy cleanup last.

## Global Constraints

- 模式改变 Agent prompt / 可用动作，不改变 mandate、权限或 human-only 边界。
- Discuss/propose 的模式指令只作为 `synthetic: true` text part 发送；用户消息正文与 transcript 不得出现 `[[mode:...]]`。
- Delegate 不得直接发送消息或创建 Goal；必须打开委托单预览，确认后才创建。
- Resolve 不得由 Agent 执行；只把人带到评审队列 / 决定板。
- Episode 是视图分组，不是新的 session / topic / ContextManifest；不修改 runtime 历史。
- Episode 关闭只能 **起草** 决定记录（`status: 'draft'`），确认仍由人在决定板完成。
- 桌面 UI 只用 `@mafw/ui` v2 组件；禁止新增裸 `<button>` / `<input>` / 裸 `title`。
- Tooltip `openDelay={300}`；颜色只用主题 token。
- 单文件测试必须带 `--conditions=browser`；gateway 测试用 `jest --runInBand`。
- 新持久化 fail-open；episode localStorage 坏数据不得阻塞 Chat。
- 当前工作区有并行的 events / standing-goals 未提交改动；不得触碰 `gateway/src/core/events/*`、`gateway/src/core/standing/*`、`StandingGoalsPanel.tsx`、`Config.tsx`、`event-layer-wiring.test.ts` 等文件。
- 本地 `main`，未 push。

## Review Focus

- **模式不脏正文。** propose 发送后用户消息只显示原文；`[[mode:propose]]` 只存在于 synthetic part。
- **委托不越权。** delegate 只打开委托单预览；未确认不创建、不启动 Goal。
- **解决不由 Agent 代做。** resolve 不发送消息、不调用 resolveReviewItem；只打开评审队列。
- **Episode 不丢消息。** 关闭后折叠、展开后所有 turn / tool card 回来；刷新后边界仍在。
- **决定记录只起草。** Episode 关闭产生的记录是 draft；确认前不进 `已定`，Agent / 自动流程不能代确认。
- **外部工作区隔离。** 并行 events / standing-goals 改动不得进入本 plan 的提交。

---

### Task 1: Composer mode model

**Files:**
- Create: `packages/desktop/src/renderer/mafw/chat/composer-mode.ts`
- Test: `packages/desktop/src/renderer/mafw/chat/composer-mode.test.ts`

**Interfaces:**
- Consumes: nothing at runtime.
- Produces:

```ts
export type ChatMode = 'discuss' | 'propose' | 'delegate' | 'resolve'
export type ChatModeAvailability = Record<ChatMode, boolean>

export const CHAT_MODE_ITEMS: readonly {
  id: ChatMode
  label: string
  hint: string
}[]

export function modeDirective(mode: ChatMode): string | null
export function modeAvailability(input: {
  canDelegate: boolean
  canResolve: boolean
}): ChatModeAvailability
export function modeSendsMessage(mode: ChatMode): boolean
export function modeActionLabel(mode: ChatMode): string
```

Behavior:
- `discuss` → `null`, sends, label `发送`.
- `propose` → `[[mode:propose]] 请给出至少两个选项、取舍、风险与建议；不要直接执行。`, sends, label `提议`.
- `delegate` → `null`, does not send, label `委托`.
- `resolve` → `null`, does not send, label `去处理`.
- `modeAvailability`: discuss/propose always true; delegate = `canDelegate`; resolve = `canResolve`.
- `CHAT_MODE_ITEMS` labels: `讨论` / `提议` / `委托` / `解决`; hints one line each.

- [ ] **Step 1: Write the failing test**

Test names:
- `discuss sends the original text with no directive`
- `propose carries the exact directive and still sends`
- `delegate and resolve do not send`
- `availability disables delegate and resolve without a target`
- `mode action labels are stable`

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/chat/composer-mode.test.ts
```

Expected: FAIL, module missing.

- [ ] **Step 3: Implement the pure model**

No Solid, DOM, or API calls.

- [ ] **Step 4: Run it to verify it passes**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/chat/composer-mode.ts packages/desktop/src/renderer/mafw/chat/composer-mode.test.ts
git commit -m "feat(desktop): add chat composer mode model"
```

---

### Task 2: Composer mode bar

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/ChatModeBar.tsx`
- Create: `packages/desktop/src/renderer/mafw/chat-mode-bar.css`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/tests/chat-mode-bar-wiring.test.ts`

**Interfaces:**
- Consumes: `ChatMode`, `ChatModeAvailability`, `CHAT_MODE_ITEMS`.
- Produces:

```ts
export function ChatModeBar(props: {
  mode: ChatMode
  availability: ChatModeAvailability
  onMode: (mode: ChatMode) => void
}): JSX.Element
```

Behavior:
- Four `ButtonV2` chips in a single row; active chip uses `aria-pressed={true}` and a tokenized active style.
- Disabled chips use `disabled` and `TooltipV2 openDelay={300}` explaining why.
- `ChatPane` adds a local `composerMode` signal default `discuss`; render `ChatModeBar` directly above `.mafw-composer`.
- `ChatPaneProps` adds:
  ```ts
  canDelegate?: () => boolean
  canResolve?: () => boolean
  onDelegateDraft?: (draft: { text: string }) => void
  onResolveRequest?: () => void
  ```
- `MafwShell` passes:
  - `canDelegate={() => !!currentProject()}`
  - `canResolve={() => activeFocus()?.scope.kind === "goal" || contentScopeIsGoal()}`
  - `onDelegateDraft={openGoalComposerWithDraft}` (Task 4)
  - `onResolveRequest={openReviewFromChat}` (Task 5)
- For Task 2 only, the callbacks can be no-op placeholders; Task 4/5 wire them.
- CSS uses only `var(--...)` tokens; no absolute positioning.

- [ ] **Step 1: Write the failing wiring test**

Assertions:
- `ChatModeBar.tsx` contains `mafw-chat-mode-bar`, `ButtonV2`, `TooltipV2`, `openDelay={300}`, `aria-pressed`, no raw `<button>`.
- `ChatPane.tsx` contains `ChatModeBar`, `composerMode`, `canDelegate`, `canResolve`.
- `MafwShell.tsx` contains `canDelegate=`, `canResolve=`, `onDelegateDraft=`, `onResolveRequest=`.
- `chat-mode-bar.css` has the block and uses `var(--`.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/chat-mode-bar-wiring.test.ts
```

Expected: FAIL, files missing.

- [ ] **Step 3: Implement the bar and ChatPane state**

Place the bar above the composer, after the topic/status panels and before the pending annotation bars. Do not persist the mode globally; ChatPane’s keyed remount resets it per session.

- [ ] **Step 4: Run it to verify it passes**

Same command; expected PASS.

- [ ] **Step 5: Run the desktop type gate**

```bash
cd packages/desktop
npx tsgo --noEmit -p tsconfig.json
```

Expected: rc=0.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ChatModeBar.tsx packages/desktop/src/renderer/mafw/chat-mode-bar.css packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/chat-mode-bar-wiring.test.ts
git commit -m "feat(desktop): add chat composer mode bar"
```

---

### Task 3: Send mode as a synthetic part

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/chat/use-send-message.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `gateway/src/core/pod/pod-tech-lead-service.ts`
- Modify: `gateway/src/routes/pod-collaboration.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Test: `packages/desktop/src/renderer/mafw/chat/use-send-message.test.ts`
- Test: `gateway/tests/unit/pod/pod-tech-lead-message-parts.test.ts`

**Interfaces:**
- Consumes: `ChatMode`, `modeDirective`, `modeSendsMessage`.
- Produces:

```ts
// use-send-message.ts
async function sendMessage(
  mode?: 'send' | 'queue',
  opts?: { voiceOrigin?: boolean; chatMode?: ChatMode },
): Promise<void>

// PodTechLeadService
sendMessage(opts: {
  goalId: string
  content: string
  actorSessionID?: string
  parts?: Array<{ type: string; text: string; synthetic?: boolean }>
}): Promise<unknown>

// MafwClient / preload
sendTechLeadMessage(
  podID: string,
  goalID: string,
  text: string,
  body?: {
    actorSessionID?: string
    parts?: Array<{ type: string; text: string; synthetic?: boolean }>
  },
): Promise<PodTechLeadPrompt>
```

Behavior:
- In `useSendMessage`, compute:
  ```ts
  const directive = chatMode ? modeDirective(chatMode) : null
  const modePart = directive
    ? { type: 'text', id: `prt_mode_${ts}`, text: directive, synthetic: true }
    : null
  ```
- Normal Chat: append `modePart` to `sendParts` after voice part.
- Tech Lead: pass `parts: modePart ? [modePart] : undefined` in the `sendTechLeadMessage` body.
- Gateway `PodTechLeadService.sendMessage` builds:
  ```ts
  parts: [...(opts.parts ?? []), { type: 'text', text: content }]
  ```
  and the route passes `body.parts` through with validation (array, ≤8 entries, each `{ type: 'text', text: string, synthetic?: boolean }`).
- The user-visible message text never contains the directive.
- Slash commands and queue replays keep the same mode part behavior; delegate/resolve never reach `sendMessage`.

- [ ] **Step 1: Write the failing desktop tests**

In `use-send-message.test.ts`:
- `propose adds one synthetic mode part and leaves message text clean`
- `discuss adds no mode part`
- `delegate and resolve bypass send`
- `tech lead send forwards the mode part`

- [ ] **Step 2: Run them to verify they fail**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/chat/use-send-message.test.ts
```

Expected: FAIL, signature/parts missing.

- [ ] **Step 3: Implement the desktop send path**

Add `chatMode` to `opts`; keep `sendMessage` backward-compatible. Do not prefix `message`.

- [ ] **Step 4: Write the failing gateway test**

`pod-tech-lead-message-parts.test.ts`:
- `sendMessage appends the synthetic mode part before the content part`
- `route passes parts through` (fake service captures the parts array)

- [ ] **Step 5: Run gateway tests to verify they fail**

```bash
cd gateway
npx jest --runInBand tests/unit/pod/pod-tech-lead-message-parts.test.ts
```

Expected: FAIL, signature missing.

- [ ] **Step 6: Implement the gateway passthrough**

Add optional `parts` to the service and route; validate entries and cap at 8. Do not persist the synthetic part into topic/handoff summaries (existing filters already exclude `synthetic: true`).

- [ ] **Step 7: Run both test sets and type gates**

```bash
cd gateway && npx jest --runInBand tests/unit/pod/pod-tech-lead-message-parts.test.ts && npx tsc --noEmit -p tsconfig.json
cd ../packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/chat/use-send-message.test.ts && npx tsgo --noEmit -p tsconfig.json
```

Expected: PASS, rc=0.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/renderer/mafw/chat/use-send-message.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx gateway/src/core/pod/pod-tech-lead-service.ts gateway/src/routes/pod-collaboration.ts packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/renderer/mafw/chat/use-send-message.test.ts gateway/tests/unit/pod/pod-tech-lead-message-parts.test.ts
git commit -m "feat(chat): send composer mode as a synthetic part"
```

---

### Task 4: Delegate mode opens the Goal composer

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodGoalComposer.tsx` only if `initial` needs a reset key
- Test: `packages/desktop/tests/chat-mode-delegate-wiring.test.ts`

**Interfaces:**
- Consumes: `onDelegateDraft`, `PodGoalComposer.initial`.
- Produces:

```ts
// MafwShell
const [goalComposerInitial, setGoalComposerInitial] = createSignal<{
  title: string
  objective?: string
} | null>(null)

const openGoalComposerWithDraft = (draft: { text: string }): void => {
  const text = draft.text.trim()
  if (!text) return
  const [first, ...rest] = text.split(/\r?\n/)
  setGoalComposerInitial({
    title: first.slice(0, 120),
    objective: text,
  })
  openNewGoalComposer()
}
```

- `ProjectWorkView` prop:
  ```ts
  composerInitial?: { title: string; objective?: string } | null
  ```
  pass to `PodGoalComposer initial={props.composerInitial ?? undefined}`.
- `MafwShell` passes `composerInitial={goalComposerInitial()}`.
- On a new Goal composer request from `openNewGoalComposer` (no draft), clear `goalComposerInitial` so the composer isn’t prefilled by an old draft.

Behavior:
- Delegate mode never calls `sendMessage`; ChatPane calls `onDelegateDraft({ text })`, clears the composer draft, and opens the project workbench with the New Goal composer prefilled.
- The existing `DelegationPreview` still gates creation.
- If `canDelegate` is false, the chip is disabled and send does nothing.

- [ ] **Step 1: Write the failing wiring test**

Assertions:
- `MafwShell.tsx` contains `openGoalComposerWithDraft`, `goalComposerInitial`, `setGoalComposerInitial`, `composerInitial=`.
- `ProjectWorkView.tsx` contains `composerInitial` and passes `initial={props.composerInitial ?? undefined}`.
- `ChatPane.tsx` contains `modeSendsMessage` / `onDelegateDraft` and does not call `props.onDelegateDraft` from inside `sendMessage`.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/chat-mode-delegate-wiring.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the draft handoff**

Clear the composer input and draft after opening the Goal composer. Do not create anything.

- [ ] **Step 4: Run it to verify it passes and type gate**

Same command plus `npx tsgo --noEmit -p tsconfig.json`; expected PASS, rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx packages/desktop/src/renderer/mafw/components/PodGoalComposer.tsx packages/desktop/tests/chat-mode-delegate-wiring.test.ts
git commit -m "feat(chat): delegate mode opens the goal composer"
```

---

### Task 5: Resolve mode opens the review queue

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Test: `packages/desktop/tests/chat-mode-resolve-wiring.test.ts`

**Interfaces:**
- Consumes: `activeFocus`, `applyFocusLens`, `contentScopeIsGoal`, `openWorkbenchContext`.
- Produces:

```ts
const openReviewFromChat = (): void => {
  const focus = activeFocus()
  if (focus?.scope.kind === "goal") {
    applyFocusLens("review")
    return
  }
  if (contentScopeIsGoal()) {
    openGoalDetail(contentScope().goalId, "result")
    return
  }
  openWorkbenchContext("review")
}
```

Behavior:
- Resolve mode never calls `sendMessage`; ChatPane calls `onResolveRequest()` and keeps the draft.
- Goal focus → switch to the `review` lens so the InstrumentRail queue is visible.
- Goal content scope → open the Goal result/face where review items live.
- No Goal → open the legacy review context.
- No automatic resolve/reopen; the human still acts in the queue.

- [ ] **Step 1: Write the failing wiring test**

Assertions:
- `MafwShell.tsx` contains `openReviewFromChat`, `applyFocusLens("review")`, `openWorkbenchContext("review")`.
- `ChatPane.tsx` contains `onResolveRequest` and `mode === "resolve"`.
- `resolveReviewItem` is not called from the resolve handler.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/chat-mode-resolve-wiring.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the routing**

Reuse existing focus/review paths; do not add a new review surface.

- [ ] **Step 4: Run it to verify it passes and type gate**

Same command plus `npx tsgo --noEmit -p tsconfig.json`; expected PASS, rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/tests/chat-mode-resolve-wiring.test.ts
git commit -m "feat(chat): resolve mode opens the review queue"
```

---

### Task 6: Episode model and store

**Files:**
- Create: `packages/desktop/src/renderer/mafw/chat/episode-model.ts`
- Create: `packages/desktop/src/renderer/mafw/chat/episode-store.ts`
- Test: `packages/desktop/src/renderer/mafw/chat/episode-model.test.ts`
- Test: `packages/desktop/src/renderer/mafw/chat/episode-store.test.ts`

**Interfaces:**
- Consumes: nothing at runtime.
- Produces:

```ts
export type EpisodeStatus = 'open' | 'closed'

export type ChatEpisode = {
  id: string
  sessionID: string
  title: string
  startMessageId: string
  endMessageId: string | null
  status: EpisodeStatus
  decisionRecordId: string | null
  createdAt: string
  updatedAt: string
}

export function createEpisode(input: {
  sessionID: string
  title: string
  startMessageId: string
  now?: string
  id?: string
}): ChatEpisode

export function closeEpisode(
  episode: ChatEpisode,
  endMessageId: string,
  decisionRecordId?: string | null,
): ChatEpisode

export function reopenEpisode(episode: ChatEpisode): ChatEpisode

export function groupTurnsByEpisode<T extends { id: string }>(
  turns: readonly T[],
  episodes: readonly ChatEpisode[],
): Array<{ episode: ChatEpisode | null; turns: T[] }>

export function createEpisodeStore(storage: Storage, sessionID: string): {
  load(): ChatEpisode[]
  save(episodes: readonly ChatEpisode[]): void
  upsert(episode: ChatEpisode): ChatEpisode[]
  remove(id: string): ChatEpisode[]
}
```

Behavior:
- `groupTurnsByEpisode` walks turns in order; an episode starts when a turn id equals `startMessageId` and ends inclusively at `endMessageId`. Turns before the first episode or between episodes get `episode: null`. An episode whose start is absent is ignored. A closed episode with `endMessageId: null` extends to the end.
- Store key `mafw-episodes:v1:<sessionID>`; load validates every field, drops bad rows, caps at 100; save is fail-open.
- Episode ids `ep_<random>`; `now` defaults to `new Date().toISOString()`.
- No gateway/session changes.

- [ ] **Step 1: Write the failing model tests**

- `createEpisode defaults to open and trims the title`
- `groupTurnsByEpisode keeps unassigned turns and exact boundaries`
- `closed episode without an end extends to the end`
- `unknown episode start is ignored`
- `reopenEpisode clears the end and decision link`

- [ ] **Step 2: Write the failing store tests**

- `store round-trips episodes`
- `bad JSON and bad rows are dropped`
- `store caps at 100 episodes`
- `save failure is fail-open`

- [ ] **Step 3: Run them to verify they fail**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/chat/episode-model.test.ts src/renderer/mafw/chat/episode-store.test.ts
```

Expected: FAIL, modules missing.

- [ ] **Step 4: Implement the pure model and localStorage store**

No Solid, DOM, or API calls in `episode-model.ts`; `episode-store.ts` takes a `Storage` interface so tests can use a fake.

- [ ] **Step 5: Run them to verify they pass**

Same command; expected PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/chat/episode-model.ts packages/desktop/src/renderer/mafw/chat/episode-store.ts packages/desktop/src/renderer/mafw/chat/episode-model.test.ts packages/desktop/src/renderer/mafw/chat/episode-store.test.ts
git commit -m "feat(chat): add episode model and store"
```

---

### Task 7: Episode UI in the transcript

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/EpisodeHeader.tsx`
- Create: `packages/desktop/src/renderer/mafw/chat-episodes.css`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Test: `packages/desktop/tests/chat-episodes-wiring.test.ts`

**Interfaces:**
- Consumes: `ChatEpisode`, `groupTurnsByEpisode`, `episodeStore`.
- Produces:

```ts
export function EpisodeHeader(props: {
  episode: ChatEpisode
  collapsed: boolean
  turnCount: number
  onToggle: () => void
  onClose: () => void
  onReopen: () => void
  onOpenRecord: () => void
}): JSX.Element
```

Behavior:
- `ChatPane` owns `episodes` and `collapsedEpisodes` signals, keyed by session; load from `episodeStore` on mount, save on change.
- Replace the single `For each={visibleTurns()}` with a `For` over `groupTurnsByEpisode(visibleTurns(), episodes())`:
  - `episode: null` → render turns exactly as today.
  - `episode` → render `EpisodeHeader`, then its turns unless `episode.status === "closed"` and collapsed.
- Extract the existing turn JSX into a `renderTurn(msg)` local function so both branches share it (no behavior change).
- Composer action `标记 Episode` (a small `ButtonV2` next to the mode bar) starts an episode at the last user message; default title `讨论 N`; disabled when there is no user message.
- `EpisodeHeader` shows title (inline `TextInputV2` edit), status, turn count, and actions: 关闭 / 重新打开 / 查看决定记录 (when linked).
- Closed + collapsed shows one line `已关闭 · N 轮 · 决定记录`; expanding restores all turns and tool cards.
- CSS uses tokens; no absolute positioning.

- [ ] **Step 1: Write the failing wiring test**

Assertions:
- `ChatPane.tsx` contains `groupTurnsByEpisode`, `EpisodeHeader`, `collapsedEpisodes`, `renderTurn`.
- `EpisodeHeader.tsx` contains `mafw-episode-header`, `ButtonV2`, `TextInputV2`, `已关闭`, `重新打开`, no raw `<button>`.
- `chat-episodes.css` has the block and uses `var(--`.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/chat-episodes-wiring.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the header and transcript grouping**

Keep the existing turn markup verbatim inside `renderTurn`. Do not change flow-card placement or pagination.

- [ ] **Step 4: Run it to verify it passes and type gate**

Same command plus `npx tsgo --noEmit -p tsconfig.json`; expected PASS, rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/EpisodeHeader.tsx packages/desktop/src/renderer/mafw/chat-episodes.css packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/tests/chat-episodes-wiring.test.ts
git commit -m "feat(chat): group transcripts into episodes"
```

---

### Task 8: Close an episode into a decision draft

**Files:**
- Modify: `gateway/src/core/decision/decision-record.ts`
- Modify: `gateway/src/core/decision/decision-record-service.ts`
- Test: `gateway/tests/unit/decision-record-service.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/EpisodeHeader.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/gateway-sdk/src/types.ts`
- Test: `packages/desktop/tests/episode-decision-wiring.test.ts`

**Interfaces:**
- Consumes: `window.api.mafw.decisions.draft`, `ChatEpisode`.
- Produces:

```ts
// decision-record.ts
export interface DecisionDraftInput {
  /* existing */
  /** Who authored the draft; defaults to agent. */
  source?: 'agent' | 'user'
}

// ChatPane prop
onCloseEpisode?: (input: {
  episode: ChatEpisode
  summary: string
}) => Promise<string | null>
```

Behavior:
- `DecisionRecordService.draft` writes history `[{ action: 'drafted', by: source === 'user' ? 'user' : 'agent', at }]`.
- `MafwShell` implements `closeEpisodeToDecision`:
  ```ts
  const record = await window.api.mafw.decisions.draft({
    projectDir: currentProject()!,
    goalId: activeGoalIdOrNull(),
    revision: activeGoalRevisionOrNull(),
    kind: 'other',
    question: episode.title,
    rationale: summary.trim(),
    evidence: [{ kind: 'message', ref: episode.startMessageId, label: episode.title }],
    source: 'user',
  })
  return record.record.id
  ```
- `EpisodeHeader` close form: `TextInputV2` title, `TextareaV2` summary, buttons `仅关闭` and `关闭并记录决定`.
- “关闭并记录决定” calls `onCloseEpisode`, stores the returned record id on the episode, closes it, and shows a toast `已起草决定记录，去决定板确认`.
- The record is **draft**; it appears under `待确认`; the human confirms in the board. No automatic confirm.
- “仅关闭” closes without a record.
- “查看决定记录” opens the decision board (or the Goal decision face) and expands the linked record.

- [ ] **Step 1: Write the failing service test**

- `user-sourced draft records the user as author`
- `agent-sourced draft keeps the agent author`

- [ ] **Step 2: Run it to verify it fails**

```bash
cd gateway
npx jest --runInBand tests/unit/decision-record-service.test.ts
```

Expected: FAIL, `by` still agent for `source: 'user'`.

- [ ] **Step 3: Implement the source field and service history**

Do not change the MCP tool; it omits `source` and stays agent-authored.

- [ ] **Step 4: Add the desktop wiring test**

Assertions:
- `MafwShell.tsx` contains `closeEpisodeToDecision`, `source: "user"`, `decisions.draft`.
- `ChatPane.tsx` contains `onCloseEpisode`, `关闭并记录决定`, `decisionRecordId`.
- `EpisodeHeader.tsx` contains `仅关闭`, `关闭并记录决定`.

- [ ] **Step 5: Run desktop and gateway focused tests**

```bash
cd gateway && npx jest --runInBand tests/unit/decision-record-service.test.ts
cd ../packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/episode-decision-wiring.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/core/decision/decision-record.ts gateway/src/core/decision/decision-record-service.ts gateway/tests/unit/decision-record-service.test.ts packages/desktop/src/renderer/mafw/components/EpisodeHeader.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/gateway-sdk/src/types.ts packages/desktop/tests/episode-decision-wiring.test.ts
git commit -m "feat(chat): close episodes into decision drafts"
```

---

### Task 9: Regression, smoke, and delivery record

**Files:**
- Create: `docs/releases/2026-11-12-workbench-chat-modes-episodes.md`
- Modify: `docs/architecture/desktop.md`

- [ ] **Step 1: Run the focused desktop suites**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test \
  src/renderer/mafw/chat/composer-mode.test.ts \
  src/renderer/mafw/chat/use-send-message.test.ts \
  src/renderer/mafw/chat/episode-model.test.ts \
  src/renderer/mafw/chat/episode-store.test.ts \
  tests/chat-mode-bar-wiring.test.ts \
  tests/chat-mode-delegate-wiring.test.ts \
  tests/chat-mode-resolve-wiring.test.ts \
  tests/chat-episodes-wiring.test.ts \
  tests/episode-decision-wiring.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run the gateway focused suite**

```bash
cd gateway
npx jest --runInBand tests/unit/pod/pod-tech-lead-message-parts.test.ts tests/unit/decision-record-service.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run the full suites, type gates, and build**

```bash
cd packages/desktop
npm test
npx tsgo --noEmit -p tsconfig.json
node ../../node_modules/electron-vite/bin/electron-vite.js build
cd ../../gateway
npm test -- --forceExit
npx tsc --noEmit -p tsconfig.json
```

Expected: desktop full PASS, gateway full PASS, rc=0, build rc=0.

- [ ] **Step 4: Real-app smoke**

1. Open a Chat with a normal session: mode bar shows 讨论 / 提议 / 委托 / 解决.
2. Propose: send a message; transcript shows only the original text; inspect the stored user message parts and confirm one `synthetic: true` text part with `[[mode:propose]]`.
3. Delegate: type a title/objective, click 委托; the New Goal composer opens prefilled; no chat message is sent; the delegation preview still gates creation.
4. Resolve: click 解决; the Goal review lens / review context opens; no chat message is sent.
5. Mark Episode: create an episode at the current turn; send another turn; close it with 记录决定; the episode collapses; the decision board shows the new draft under 待确认.
6. Expand the closed episode: all turns and tool cards return.
7. Reload: episode boundaries and collapsed state survive per session.
8. Confirm the draft in the decision board; the episode header’s 查看决定记录 opens the record.

- [ ] **Step 5: Write the release record**

`docs/releases/2026-11-12-workbench-chat-modes-episodes.md`:
- Scope, commits, behavior changes, verification counts (new tests, desktop full, gateway full), final review findings, deferred minors.
- Explicitly note that split view / world overview / legacy cleanup / decision SSE are Plan 5.
- Name any external events / standing-goals commits that landed in the range; do not attribute them to this plan.

- [ ] **Step 6: Update `docs/architecture/desktop.md`**

Add a `Chat 模式与 Episode（2026-11-12 Plan 4）` bullet after the Plan 3 bullet: four modes, synthetic mode part, delegate/resolve routing, per-session episodes, episode→decision draft. Link the release record.

- [ ] **Step 7: Commit**

```bash
git add docs/releases/2026-11-12-workbench-chat-modes-episodes.md docs/architecture/desktop.md
git commit -m "docs: record chat modes and episodes"
```

---

## Self-Review

**Spec coverage:**
- §10.5 Composer 四模式 → Tasks 1–5.
- §10.4 Episode 分组 / 关闭成决定记录 → Tasks 6–8.
- §10.4 “活决定在 transcript 之上” → already Plan 3; episodes sit below the board and above turns.
- §7.1 模式由表面/意图派生，不改 mandate → Task 1/2; no permission changes.
- §10.6 委托单 → delegate mode reuses the existing preview (Task 4).
- §10.8 决定记录 → episode close drafts only (Task 8); human confirm remains in Plan 3’s board.
- §14.8–9 persistence/cleanup → explicitly Plan 5.

**Type consistency:** `ChatMode` used by `composer-mode`, `ChatModeBar`, `ChatPane`, `use-send-message`; `ChatEpisode` used by `episode-model`, `episode-store`, `EpisodeHeader`, `ChatPane`; `DecisionDraftInput.source` used by the service and MafwShell.

**Review Focus tests:** Task 1/3 (clean message + synthetic part), Task 4 (no create before preview), Task 5 (no agent resolve), Task 6/7 (grouping + persistence), Task 8 (draft only), Task 9 (staging isolation).

**Plan 5 note:** split view, world overview, legacy context cleanup, execution drawer removal, decision-board SSE invalidation and record virtualization are intentionally excluded; they touch a different workbench subsystem and the spec orders cleanup last.
