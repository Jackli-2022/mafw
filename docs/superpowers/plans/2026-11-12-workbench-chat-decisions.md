# Workbench Chat Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Chat the decision surface of the workbench: a decision board projected from existing attention and review records, human-confirmed decision records, a delegation preview before a Goal starts, a visible agent contract, and execution status in the frame.

**Architecture:** The board is a projection, not a new truth store. `GET /api/attention` is extended to include unresolved review items; the desktop `decisionStore` is the single source for the rail badge and the Chat board. Decision records are append-only JSON files under the project's `.mafw/decisions/` directory, drafted by an MCP tool and confirmed only by a human route. Delegation is a preview step in `PodGoalComposer`; the agent contract and execution badge are pure view models over existing `PodGoal` facts.

**Tech Stack:** Electron 42, SolidJS, TypeScript, `@mafw/ui` v2, better-sqlite3 (existing), `node:test` + `@mafw/test-shim`, electron-vite.

**Spec:** `docs/superpowers/specs/2026-11-12-workbench-stage-first-design.md`
**Predecessor:** `docs/superpowers/plans/2026-11-12-workbench-goal-review-focus.md`

## Global Constraints

- 一个仓库 = 一个世界；Goal 不跨世界。
- 人类专属验收、评审项状态权威、revision 隔离、PASS 不自动合并，不得退化。
- Agent 不能自己把决定标成已定；确认 / 搁置 / 重开只由人触发。
- 决定板是现有 attention / review / acceptance 记录的投影，不是第二套真相；rail badge 与决定板必须读同一个 `decisionStore`。
- 委托单预览只是 Goal 的承诺视图；未确认不得创建或启动 Goal。
- 执行状态进入框与 Goal 总览；任何浮层不得覆盖框。
- 桌面 UI 只用 `@mafw/ui` v2 组件；禁止新增裸 `<button>` / `<input>` / 裸 `title`。
- Tooltip `openDelay={300}`；颜色只用主题 token。
- 单文件测试必须带 `--conditions=browser`；gateway 测试用 `npm test -- --runInBand`。
- 新持久化 fail-open：决定记录读写失败不得阻塞 Chat / Goal 操作。
- 本地 `main`，未 push；外部视觉语言工作区的未提交改动不得被本 plan 触碰。

## Review Focus

- **决定板不撒谎。** 计划待批准 / 方向待裁定 / 待答问题 / 结果待验收 / 未解决评审项都要出现在正确分组；已解决评审项不得出现。
- **单一计数。** rail 的 Pod badge 与 Chat 决定板的“需要你”计数来自同一个 `decisionStore`，刷新后同步。
- **人保留最终权威。** 决定记录只能由 MCP 起草；确认 / 搁置 / 重开接口拒绝 `actorSessionID`，Agent 无确认路径。
- **委托不越权。** 预览未确认时不调用 `onCreate`；预览必须显示授权级别、升级条件与 human-only 边界。
- **执行不遮框。** Goal frame 显示执行 badge；legacy execution drawer 在 focus 态仍隐藏。
- **外部工作区隔离。** 并行视觉语言任务的未提交文件（`mafw.css`、`GoalUserHero.tsx`、相关测试）不得进入本 plan 的提交。

## Not in this plan

- Chat 的讨论 / 提议 / 委托 / 解决四模式选择器（Plan 4）。
- Chat episode 分组与折叠（Plan 4）。
- 分屏、世界总览 subject、legacy context 删除（Plan 4）。
- 运行时 policy engine；授权级别只做显示与委托单约束，不新增强制拦截。
- 工具审批（permission card / ApprovalsPage）并入决定板；审批仍是独立实时表面。

---

### Task 1: Decision and attention contracts + pure board model

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`
- Create: `packages/desktop/src/renderer/mafw/focus/decision-model.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/decision-model.test.ts`

**Interfaces:**
- Consumes: nothing at runtime.
- Produces:

```ts
// packages/gateway-sdk/src/types.ts
export type DecisionKind =
  | 'direction' | 'plan' | 'scope' | 'authorization'
  | 'acceptance' | 'priority' | 'disposition' | 'other'
export type DecisionRecordStatus = 'draft' | 'decided' | 'shelved'
export interface DecisionRecordOption { id: string; title: string; summary?: string; risks?: string[] }
export interface DecisionRecordEvidence {
  kind: 'message' | 'file' | 'change' | 'review_item' | 'goal'
  ref: string
  label?: string
}
export interface DecisionRecordHistoryEntry {
  action: 'drafted' | 'confirmed' | 'shelved' | 'reopened'
  by: 'agent' | 'user'
  at: string
  note?: string
}
export interface DecisionRecord {
  id: string
  projectDir: string
  goalId: string | null
  revision: number | null
  kind: DecisionKind
  status: DecisionRecordStatus
  question: string
  options: DecisionRecordOption[]
  evidence: DecisionRecordEvidence[]
  rationale: string | null
  consequences: string | null
  reviewAt: string | null
  decidedBy: string | null
  decidedAt: string | null
  createdAt: string
  updatedAt: string
  history: DecisionRecordHistoryEntry[]
}
export interface AttentionItem {
  id: string
  goalId: string
  revision: number
  kind: 'answer' | 'plan_approval' | 'review' | 'review_item' | 'blocked' | 'failed' | 'direction_review'
  priority: number
  coalesceKey: string
  title: string
  action: {
    type: string
    goalId: string
    questionId?: string
    itemId?: string
    rel?: string
    line?: number
  }
}
export interface AttentionList { items: AttentionItem[] }
export interface DecisionList { items: DecisionRecord[] }
```

```ts
// packages/desktop/src/renderer/mafw/focus/decision-model.ts
export type DecisionStatus = 'needs_you' | 'pending' | 'decided' | 'shelved'
export type DecisionAction =
  | { kind: 'goal'; goalId: string; target: 'timeline' | 'plan' | 'question' | 'direction' | 'result' }
  | { kind: 'reviewItem'; goalId: string; itemId: string; rel: string; line?: number }
  | { kind: 'record'; recordId: string }
  | { kind: 'none' }
export type DecisionItem = {
  id: string
  status: DecisionStatus
  kind: DecisionKind
  title: string
  detail: string | null
  goalId: string | null
  revision: number | null
  source: 'attention' | 'review' | 'record'
  action: DecisionAction
}
export type DecisionBoardGroup = {
  status: DecisionStatus
  label: string
  items: readonly DecisionItem[]
}
export type DecisionBoardView = {
  groups: readonly DecisionBoardGroup[]
  counts: { needsYou: number; pending: number; decided: number; shelved: number }
}
export function buildDecisionBoard(input: {
  attention: readonly AttentionItem[]
  records: readonly DecisionRecord[]
  goalId?: string | null
}): DecisionBoardView
export function decisionActionForAttention(item: AttentionItem): DecisionAction
```

Behavior:
- Attention kinds map to: `plan_approval` → plan / `needs_you`; `direction_review` → direction / `needs_you`; `answer` → other / `needs_you`; `review` → acceptance / `needs_you`; `review_item` → other / `needs_you`; `blocked` / `failed` → other / `needs_you`.
- `review_item` attention action is `{ kind: 'reviewItem', goalId, itemId, rel, line }`; `rel` defaults to the item title if absent; missing `itemId` → `{ kind: 'none' }`.
- Records map `draft` → `pending`, `decided` → `decided`, `shelved` → `shelved`; action is `{ kind: 'record', recordId }`.
- `goalId` filter applies to both attention and records; `null` / `undefined` shows all.
- Groups are always present and ordered `needs_you`, `pending`, `decided`, `shelved`; labels are `需要你定`, `待确认`, `已定`, `已搁置`.
- Sort within a group by kind priority (`plan`, `direction`, `acceptance`, `authorization`, `scope`, `priority`, `disposition`, `other`) then by title.
- Counts are the filtered item counts.

- [ ] **Step 1: Write the failing tests**

Test names and assertions:
- `attention maps to decision kinds and the four groups` — plan approval first, then direction, then acceptance; empty groups present.
- `unresolved review items are decisions and resolved ones are absent` — `review_item` appears, a `review` result acceptance is a separate item.
- `records map to pending decided and shelved` — three records, three groups.
- `goal filter keeps only that goal` — attention + record for `g1`, record for `g2`; result only `g1`.
- `review item without itemId has no action` — `action.kind === 'none'`.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/decision-model.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Add the SDK contracts and implement `decision-model.ts`**

Types only in the SDK; pure functions only in the desktop model. No Solid, DOM, or API calls.

- [ ] **Step 4: Run it to verify it passes**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/types.ts packages/desktop/src/renderer/mafw/focus/decision-model.ts packages/desktop/src/renderer/mafw/focus/decision-model.test.ts
git commit -m "feat(sdk): add decision contracts and board model"
```

---

### Task 2: Attention includes review items; desktop decision store and rail badge

**Files:**
- Modify: `gateway/src/core/lead/attention.ts`
- Modify: `gateway/src/routes/attention.ts`
- Modify: `gateway/src/subsystems/api-routes.ts`
- Create: `gateway/src/core/lead/attention.test.ts`
- Create: `gateway/src/routes/attention.test.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Create: `packages/desktop/src/renderer/mafw/decision-store.ts`
- Test: `packages/desktop/src/renderer/mafw/decision-store.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pod-rail-badge.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-rail-badge.test.ts`
- Test: `packages/desktop/tests/decision-store-wiring.test.ts`

**Interfaces:**
- Consumes: `AttentionItem`, `AttentionList`, `deriveAttention`, `PodReviewService.unresolved`.
- Produces:

```ts
// gateway/src/core/lead/attention.ts
export interface ReviewAttentionInput {
  id: string
  goalId: string
  revision: number
  title: string
  rel: string
  line?: number
  comment: string
}
export function appendReviewAttention(
  items: readonly AttentionItem[],
  reviews: readonly ReviewAttentionInput[],
): AttentionItem[]

// gateway/src/routes/attention.ts
export interface AttentionRouteDeps {
  views(projectDir: string): PodGoalView[]
  reviews?(projectDir: string, views: readonly PodGoalView[]): ReviewAttentionInput[]
}
```

```ts
// packages/gateway-sdk/src/types.ts
export interface AttentionNamespace {
  list(projectDir?: string): Promise<AttentionList>
}
export interface MafwSDK { attention: AttentionNamespace /* existing fields */ }
```

```ts
// packages/desktop/src/renderer/mafw/decision-store.ts
export function createDecisionStore(deps: {
  api: { attention(projectDir: string): Promise<AttentionList> }
  projectDir(): string | null
}): {
  items(): readonly AttentionItem[]
  revision(): number
  refresh(): Promise<void>
  board(goalId?: string | null): DecisionBoardView
  counts(): DecisionBoardView['counts']
}
```

Behavior:
- `appendReviewAttention` adds one `kind: 'review_item'` item per unresolved review item, `priority: 75`, `coalesceKey: review_item:${goalId}:r${revision}:${id}`, `action.type: 'open_review_item'` with `itemId`, `rel`, `line`.
- The route deps `reviews` are wired in `api-routes.ts` from `podReviewService.unresolved(pod.id, view.goalId, view.revision)`; if the Pod or review service is unavailable, return `[]`.
- `handleAttention` appends reviews after `deriveAttention` and returns `{ items }` unchanged.
- SDK client `attention.list(projectDir?)` performs `GET /api/attention?projectDir=...`.
- Preload `window.api.mafw.attention.list(projectDir?)` invokes `attention.list`.
- `decisionStore` fetches attention for the current project, keeps the last good list on failure (fail-open), and exposes a Solid signal. `board(goalId?)` calls `buildDecisionBoard` with `records: []` for now (records arrive in Task 7).
- `podRailBadge` gains an optional `needsYou?: number`; when provided it uses that count, otherwise the old attention-length behavior remains.
- `MafwShell` creates one `decisionStore` with `projectDir: currentProject`, refreshes it when `podStore.revision()` / `podStore.reviewRevision()` changes, and uses `decisionStore.counts().needsYou` for `podBadge`.

- [ ] **Step 1: Write the failing gateway tests**

- `appendReviewAttention adds one decision per unresolved item` — two reviews → two items, unique ids, action carries `itemId` / `rel` / `line`.
- `appendReviewAttention keeps existing attention untouched` — plan approval remains first after sort.
- `handleAttention appends reviews from deps` — fake views + fake reviews → body items include `review_item`.

- [ ] **Step 2: Run gateway tests to verify they fail**

```bash
cd gateway
npm test -- --runInBand src/core/lead/attention.test.ts src/routes/attention.test.ts
```

Expected: FAIL, missing exports.

- [ ] **Step 3: Implement the gateway attention changes**

Keep `deriveAttention` behavior unchanged for existing kinds. Review items are appended, not merged into `deriveAttention`, so existing tests stay valid.

- [ ] **Step 4: Run gateway tests to verify they pass**

Same command; expected PASS.

- [ ] **Step 5: Write the failing desktop store tests**

- `decision store exposes attention items and counts` — fake API returns plan approval + review item; `counts().needsYou === 2`.
- `decision store keeps the last list on failure` — first refresh succeeds, second rejects; items stay.
- `decision store filters by goal` — `board('g1')` excludes `g2`.
- `pod rail badge prefers the decision count` — `needsYou: 3` with attention length 1 → 3.

- [ ] **Step 6: Run desktop store tests to verify they fail**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/decision-store.test.ts src/renderer/mafw/pod-rail-badge.test.ts
```

Expected: FAIL, module not found / signature mismatch.

- [ ] **Step 7: Implement the SDK client, preload, store, and rail badge wiring**

Add the `attention` namespace to the SDK types and client, add the preload namespace and `MafwWindow` type, implement `createDecisionStore`, and switch `MafwShell`'s Pod badge to the store count. Keep `podRailBadge` backward-compatible.

- [ ] **Step 8: Run desktop tests to verify they pass**

Same command; expected PASS. Add `tests/decision-store-wiring.test.ts` asserting `MafwShell` imports `createDecisionStore`, constructs it once, and passes `decisionStore.counts().needsYou` to the rail.

- [ ] **Step 9: Commit**

```bash
git add gateway/src/core/lead/attention.ts gateway/src/core/lead/attention.test.ts gateway/src/routes/attention.ts gateway/src/routes/attention.test.ts gateway/src/subsystems/api-routes.ts packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/renderer/mafw/decision-store.ts packages/desktop/src/renderer/mafw/decision-store.test.ts packages/desktop/src/renderer/mafw/pod-rail-badge.ts packages/desktop/src/renderer/mafw/pod-rail-badge.test.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/decision-store-wiring.test.ts
git commit -m "feat(gateway): project review items into attention"
```

---

### Task 3: Chat decision board

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/DecisionBoard.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/tests/decision-board-wiring.test.ts`

**Interfaces:**
- Consumes: `DecisionBoardView`, `DecisionItem`, `decisionStore`.
- Produces:

```ts
export function DecisionBoard(props: {
  board: DecisionBoardView
  collapsed: boolean
  onToggle: (collapsed: boolean) => void
  onAction: (item: DecisionItem) => void
}): JSX.Element
```

Behavior:
- Render only when at least one item exists.
- Header: `决定` plus four count chips (`需要你 N`, `待确认 N`, `已定 N`, `已搁置 N`) and a collapse button.
- Groups render in the order from `board.groups`; each item is a `ButtonV2` row with title, optional detail, and a source label (`Goal` / `评审` / `记录`).
- Clicking an item calls `onAction(item)`.
- Collapsed state shows only the header and counts; expanded shows groups.
- Empty groups are hidden; the four groups still exist in the model.
- `ChatPane` gains props:
  ```ts
  decisionBoard?: () => DecisionBoardView
  decisionBoardCollapsed?: () => boolean
  onToggleDecisionBoard?: (collapsed: boolean) => void
  onDecisionAction?: (item: DecisionItem) => void
  ```
- The board is rendered after the session titlebar and before the transcript turns. When it has no items, it renders nothing.
- `MafwShell` passes `decisionStore.board(activeTechLeadGoalId())`; `activeTechLeadGoalId` is `techLeadGoalBySession[activeSessionId()]` (undefined for Lead → whole project).
- CSS block `/* ── decision board ── */` uses only `var(--...)` tokens, no absolute positioning.

- [ ] **Step 1: Write the failing wiring test**

Assertions:
- `DecisionBoard.tsx` contains `mafw-decision-board`, `ButtonV2`, `TooltipV2` with `openDelay={300}`, `onAction(item)`, and no raw `<button`.
- `ChatPane.tsx` contains `DecisionBoard`, `decisionBoard`, `onDecisionAction`.
- `MafwShell.tsx` contains `decisionStore.board`, `activeTechLeadGoalId`, `onDecisionAction`.
- `mafw.css` contains the decision-board block and uses `var(--` in it.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/decision-board-wiring.test.ts
```

Expected: FAIL, files missing.

- [ ] **Step 3: Implement `DecisionBoard.tsx`, ChatPane props, and shell wiring**

Do not add a second data fetch inside the component; it receives the board projection.

- [ ] **Step 4: Run it to verify it passes**

Same command; expected PASS.

- [ ] **Step 5: Run the full desktop type gate**

```bash
cd packages/desktop
npx tsgo --noEmit -p tsconfig.json
```

Expected: rc=0.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/DecisionBoard.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/decision-board-wiring.test.ts
git commit -m "feat(desktop): add chat decision board"
```

---

### Task 4: Decision actions open the workbench

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/focus/decision-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx` only if the goal view prop needs threading
- Test: `packages/desktop/src/renderer/mafw/focus/decision-model.test.ts`
- Test: `packages/desktop/tests/decision-board-wiring.test.ts`

**Interfaces:**
- Consumes: `DecisionAction`, `GoalDetailFocus`, `openGoalFocus`, `resolveGoalWorktreeDir`, `applyReviewFocus`, `syncStageToFocus`.
- Produces:

```ts
// decision-model.ts
export function decisionGoalFocus(action: DecisionAction): 'timeline' | 'plan' | 'question' | 'direction' | 'result' | null
```

Behavior:
- `decisionGoalFocus` returns the Goal detail face for `goal` actions; `reviewItem` returns `'timeline'` (the anchor is handled separately); other actions return `null`.
- `MafwShell` adds:
  ```ts
  const openDecisionGoal = (goalId: string, target: GoalDetailFocus) => {
    setShowConfig(false)
    applyRightDock(true)
    if (narrowZone()) applyNarrowView('workbench')
    openGoalFocus(goalId, target)
    if (target === 'plan') setGoalPlanOpenRequest((n) => n + 1)
  }
  ```
- `handleDecisionAction(item)`:
  - `goal` → `openDecisionGoal(action.goalId, action.target)`
  - `reviewItem` → `openReviewAnchorToFocus({ goalId, itemId, rel, line })`
  - `record` → no shell action (the board expands the record locally)
  - `none` → no-op
- Refactor `openReviewItemToFocus(item: PodReviewItem)` to call a new `openReviewAnchorToFocus(input: { goalId, itemId, rel, line? })`; the latter resolves the worktree and applies `openReviewItemFocus` + `syncStageToFocus`.
- `GoalDetailPanel` gains `planOpenRequest?: number`; an effect opens `PlanReviewOverlay` when the nonce changes and `planEntry()` exists.
- `MafwShell` passes `planOpenRequest={goalPlanOpenRequest()}` to `GoalDetailPanel`.

- [ ] **Step 1: Write the failing pure test**

- `decisionGoalFocus maps plan and review actions` — plan → `plan`, direction → `direction`, acceptance → `result`, reviewItem → `timeline`, record → `null`.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/decision-model.test.ts
```

Expected: FAIL, missing export.

- [ ] **Step 3: Implement the mapping and shell wiring**

Keep `openGoalFocus` as the only Goal entry; do not call the legacy `openGoalDetail` for decision actions.

- [ ] **Step 4: Extend the wiring test**

Assertions:
- `MafwShell.tsx` contains `openDecisionGoal`, `handleDecisionAction`, `openReviewAnchorToFocus`, `setGoalPlanOpenRequest`.
- `GoalDetailPanel.tsx` contains `planOpenRequest` and calls `setPlanOpen(true)`.

- [ ] **Step 5: Run the focused tests and type gate**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/decision-model.test.ts tests/decision-board-wiring.test.ts
npx tsgo --noEmit -p tsconfig.json
```

Expected: PASS, rc=0.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/focus/decision-model.ts packages/desktop/src/renderer/mafw/focus/decision-model.test.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/tests/decision-board-wiring.test.ts
git commit -m "feat(desktop): route decision board actions into the workbench"
```

---

### Task 5: Decision record store and human-only routes

**Files:**
- Create: `gateway/src/core/decision/decision-record.ts`
- Create: `gateway/src/core/decision/decision-record-service.ts`
- Test: `gateway/src/core/decision/decision-record-service.test.ts`
- Create: `gateway/src/routes/decisions.ts`
- Test: `gateway/src/routes/decisions.test.ts`
- Modify: `gateway/src/subsystems/api-routes.ts`
- Modify: `gateway/src/kernel.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`

**Interfaces:**
- Consumes: `DecisionRecord`, `DecisionRecordStatus`, `DecisionKind` from Task 1.
- Produces:

```ts
// decision-record.ts
export interface DecisionDraftInput {
  projectDir: string
  goalId?: string | null
  revision?: number | null
  kind: DecisionKind
  question: string
  options?: DecisionRecordOption[]
  evidence?: DecisionRecordEvidence[]
  rationale?: string | null
  consequences?: string | null
  reviewAt?: string | null
}
export interface DecisionConfirmInput {
  projectDir: string
  rationale?: string
  consequences?: string
  reviewAt?: string
}
export interface DecisionShelveInput {
  projectDir: string
  reviewAt: string
  note?: string
}
export interface DecisionReopenInput { projectDir: string; note?: string }

// decision-record-service.ts
export interface DecisionRecordServiceDeps {
  mafwDir(projectDir: string): string | null
  now?: () => string
  id?: () => string
}
export class DecisionRecordService {
  constructor(deps: DecisionRecordServiceDeps)
  list(projectDir: string, goalId?: string): DecisionRecord[]
  draft(input: DecisionDraftInput): DecisionRecord
  confirm(id: string, input: DecisionConfirmInput): DecisionRecord
  shelve(id: string, input: DecisionShelveInput): DecisionRecord
  reopen(id: string, input: DecisionReopenInput): DecisionRecord
}
```

Behavior:
- Files live at `<mafwDir>/decisions/<id>.json`; writes use `writeFileSync(tmp)` then `renameSync(tmp, path)`.
- `draft` writes `status: 'draft'`, `decidedBy: null`, `decidedAt: null`, history `[{ action: 'drafted', by: 'agent', at }]`.
- `confirm` requires `status === 'draft'`, sets `status: 'decided'`, `decidedBy: 'user'`, `decidedAt`, optional rationale/consequences/reviewAt, history entry `confirmed`.
- `shelve` requires `status === 'draft'`, requires `reviewAt`, sets `status: 'shelved'`, history entry `shelved` with `note`.
- `reopen` requires `decided` or `shelved`, sets `status: 'draft'`, clears `decidedBy`/`decidedAt`, history entry `reopened`.
- `list` reads the project's decision directory, filters optional `goalId`, and sorts by `updatedAt` descending; a missing directory is `[]`.
- Validation: question 1–500 chars, options ≤ 8, evidence ≤ 12, rationale/consequences ≤ 4000, reviewAt must parse as a date when present.
- Routes:
  - `GET /api/decisions?projectDir=&goalId=` → `{ items }`
  - `POST /api/decisions` → draft (agent-allowed)
  - `POST /api/decisions/:id/confirm` → human-only; non-empty `actorSessionID` in body → 403 `decision confirmation is human-only`
  - `POST /api/decisions/:id/shelve` → human-only
  - `POST /api/decisions/:id/reopen` → human-only
- `api-routes.ts` consumes `deps.decisionRecords` and resolves `projectDir` from the query/body or `MAFW_PROJECT_DIR`; the service itself is instantiated once in `kernel.ts` with `mafwDir: (projectDir) => registeredProjects.get(canonicalProjectDir(projectDir))?.mafwDir ?? null`.
- `kernel.ts` adds `decisionRecords` to the MCP services bundle and passes the same instance to `attachAllRoutes`.
- SDK `decisions` namespace:
  ```ts
  export interface DecisionsNamespace {
    list(query?: { projectDir?: string; goalId?: string }): Promise<DecisionList>
    draft(body: DecisionDraftInput): Promise<{ record: DecisionRecord }>
    confirm(id: string, body: DecisionConfirmInput & { actorSessionID?: string }): Promise<{ record: DecisionRecord }>
    shelve(id: string, body: DecisionShelveInput & { actorSessionID?: string }): Promise<{ record: DecisionRecord }>
    reopen(id: string, body: DecisionReopenInput & { actorSessionID?: string }): Promise<{ record: DecisionRecord }>
  }
  ```

- [ ] **Step 1: Write the failing service tests**

- `draft writes a draft record and lists it` — temp dir, one draft, `list` returns it with `status: 'draft'`.
- `confirm is human-only at the route and sets decided` — service confirm; route test with `actorSessionID` → 403.
- `shelve requires a review date` — missing `reviewAt` throws 400.
- `reopen returns a shelved record to draft` — clears decided fields.
- `list filters by goal and sorts by updatedAt` — two goals, newer first.
- `records survive a second service instance` — write, construct new service, list.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd gateway
npm test -- --runInBand src/core/decision/decision-record-service.test.ts src/routes/decisions.test.ts
```

Expected: FAIL, files missing.

- [ ] **Step 3: Implement the store, service, and routes**

Use `node:fs` and `node:path`; no database. Keep the service synchronous like `LeadTopicStore`.

- [ ] **Step 4: Add route catalog entries, SDK client, and preload**

Catalog entries:
```ts
{ method: 'GET', path: '/api/decisions', operationId: 'decisions.list', tags: ['internal'] },
{ method: 'POST', path: '/api/decisions', operationId: 'decisions.draft', tags: ['internal'] },
{ method: 'POST', path: '/api/decisions/:id/confirm', operationId: 'decisions.confirm', tags: ['internal'] },
{ method: 'POST', path: '/api/decisions/:id/shelve', operationId: 'decisions.shelve', tags: ['internal'] },
{ method: 'POST', path: '/api/decisions/:id/reopen', operationId: 'decisions.reopen', tags: ['internal'] },
```

- [ ] **Step 5: Run the tests and the gateway type gate**

```bash
cd gateway
npm test -- --runInBand src/core/decision/decision-record-service.test.ts src/routes/decisions.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: PASS, rc=0.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/core/decision gateway/src/routes/decisions.ts gateway/src/routes/decisions.test.ts gateway/src/subsystems/api-routes.ts gateway/src/kernel.ts gateway/src/routes/route-catalog.ts packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(gateway): persist human-confirmed decision records"
```

---

### Task 6: Agent decision draft tool

**Files:**
- Modify: `gateway/src/mcp/tool-registry.ts`
- Create: `gateway/src/mcp/handlers/decision-draft.ts`
- Test: `gateway/src/mcp/handlers/decision-draft.test.ts`
- Modify: `docs/reference/tools.md` (add the tool after implementation)

**Interfaces:**
- Consumes: `DecisionRecordService.draft`, `ProjectDir`.
- Produces:

```ts
export interface DecisionDraftToolDeps {
  draft(input: DecisionDraftInput): DecisionRecord
  projectDir(): string | null
}
export const handleDecisionDraft: ToolHandler
```

Behavior:
- Tool name `mafw_decision_draft`.
- Args: `goalId?`, `kind`, `question`, `options?`, `evidence?`, `rationale?`, `consequences?`, `reviewAt?`, `projectDir?`.
- `projectDir` resolves from `args.projectDir` then `deps.projectDir()`; missing → 503.
- Never accept or write `status`, `decidedBy`, `decidedAt`; the handler ignores unknown fields and always drafts.
- Return `{ success: true, record }`; validation errors return `isError: true` with `status` and `error`.
- Tool description: “Draft a decision record for human confirmation. Never marks it decided; only the human UI can confirm or shelve.”

- [ ] **Step 1: Write the failing handler tests**

- `drafts a decision with the current project` — fake service captures input, returns record; result has `success: true`.
- `rejects a missing question` — 400.
- `does not let the agent confirm` — passing `status: 'decided'` still produces a draft (or is ignored).
- `returns 503 without a project` — no projectDir and no dep → 503.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd gateway
npm test -- --runInBand src/mcp/handlers/decision-draft.test.ts
```

Expected: FAIL, file missing.

- [ ] **Step 3: Implement the handler and register the tool**

Add the definition near `mafw_pod_goal_direction`, import the handler, and register it in `createToolRegistry().handlers`.

- [ ] **Step 4: Run it to verify it passes**

Same command; expected PASS.

- [ ] **Step 5: Update `docs/reference/tools.md`**

Add one row: tool name, purpose, “draft only; human confirms”.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/mcp/tool-registry.ts gateway/src/mcp/handlers/decision-draft.ts gateway/src/mcp/handlers/decision-draft.test.ts docs/reference/tools.md
git commit -m "feat(mcp): draft decision records for human confirmation"
```

---

### Task 7: Decision records in the board and Goal overview

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/decision-store.ts`
- Test: `packages/desktop/src/renderer/mafw/decision-store.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/DecisionRecordCard.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/DecisionBoard.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/tests/decision-record-wiring.test.ts`

**Interfaces:**
- Consumes: `DecisionRecord`, `window.api.mafw.decisions.*`.
- Produces:

```ts
// decision-store.ts (extended)
export function createDecisionStore(deps: {
  api: {
    attention(projectDir: string): Promise<AttentionList>
    decisions(projectDir: string, goalId?: string): Promise<DecisionList>
  }
  projectDir(): string | null
}): {
  items(): readonly AttentionItem[]
  records(): readonly DecisionRecord[]
  revision(): number
  refresh(): Promise<void>
  board(goalId?: string | null): DecisionBoardView
  counts(): DecisionBoardView['counts']
  confirm(id: string, input: { rationale: string; consequences: string; reviewAt?: string }): Promise<void>
  shelve(id: string, input: { reviewAt: string; note?: string }): Promise<void>
  reopen(id: string): Promise<void>
}
```

```ts
export function DecisionRecordCard(props: {
  record: DecisionRecord
  busy: boolean
  onConfirm: (input: { rationale: string; consequences: string; reviewAt?: string }) => void
  onShelve: (input: { reviewAt: string; note?: string }) => void
  onReopen: () => void
}): JSX.Element
```

Behavior:
- `decisionStore.refresh()` fetches attention and decisions in parallel; records are filtered by `goalId` in `board`.
- `confirm` / `shelve` / `reopen` call the matching API, then `refresh()`; failures rethrow after the store keeps the last list.
- `DecisionBoard` renders record items through `DecisionRecordCard`; clicking a record expands it in place instead of calling the shell action.
- `DecisionRecordCard` shows question, options, evidence, rationale, consequences, review point, decision history. Drafts show confirm/shelve forms; decided/shelved show details and a reopen button.
- `GoalDetailPanel` loads records for its `goalId` from `decisionStore` (or a local `window.api.mafw.decisions.list` effect), and renders a compact `决定记录` section when records exist. It does not duplicate the board; it shows the Goal-scoped history.
- `MafwShell` handles `decisionStore.confirm/shelve/reopen` errors with `showToastV2`, and passes the store callbacks to the board.

- [ ] **Step 1: Write the failing store tests**

- `decision store fetches attention and records together` — fake API returns one attention + one decided record; `board().counts` includes both.
- `confirm refreshes the record list` — fake confirm resolves, list returns decided; `records()[0].status === 'decided'`.
- `refresh failure keeps previous records` — second list rejects; records stay.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/decision-store.test.ts
```

Expected: FAIL, missing methods.

- [ ] **Step 3: Extend the store and implement `DecisionRecordCard`**

Reuse `TextareaV2` / `TextInputV2` / `ButtonV2`; no raw inputs. Use `showToastV2` in the shell for failures.

- [ ] **Step 4: Wire the board and Goal overview**

`DecisionBoard` keeps a local `expandedRecordId` signal; record items render `DecisionRecordCard` when expanded. `GoalDetailPanel` imports `decisionStore` directly, matching the existing `podStore` import style.

- [ ] **Step 5: Add the wiring test**

Assertions:
- `DecisionRecordCard.tsx` contains `mafw-decision-record`, `mafw-decision-record-confirm`, `mafw-decision-record-shelve`, `ButtonV2`.
- `DecisionBoard.tsx` imports `DecisionRecordCard` and tracks `expandedRecordId`.
- `GoalDetailPanel.tsx` contains `决定记录` and `decisionStore.records`.
- `mafw.css` has the record card block with tokens.

- [ ] **Step 6: Run focused tests and type gate**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/decision-store.test.ts tests/decision-record-wiring.test.ts
npx tsgo --noEmit -p tsconfig.json
```

Expected: PASS, rc=0.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/decision-store.ts packages/desktop/src/renderer/mafw/decision-store.test.ts packages/desktop/src/renderer/mafw/components/DecisionRecordCard.tsx packages/desktop/src/renderer/mafw/components/DecisionBoard.tsx packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/decision-record-wiring.test.ts
git commit -m "feat(desktop): show and confirm decision records"
```

---

### Task 8: Delegation preview before Goal creation

**Files:**
- Create: `packages/desktop/src/renderer/mafw/delegation-preview.ts`
- Test: `packages/desktop/src/renderer/mafw/delegation-preview.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/DelegationPreview.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodGoalComposer.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/tests/delegation-preview-wiring.test.ts`

**Interfaces:**
- Consumes: composer fields (title, objective, acceptance, boundaries, planReview), project name.
- Produces:

```ts
export type DelegationPreviewInput = {
  projectName: string
  title: string
  objective: string
  acceptance: readonly string[]
  boundaries: readonly string[]
  planReview: 'auto' | 'manual'
}
export type DelegationPreview = {
  principal: string
  agent: string
  scope: string
  intent: string
  constraints: string
  acceptance: string
  discretion: string
  escalation: string
  budget: string
  evidence: string
  termination: string
  audit: string
  autonomy: { level: 3 | 5; label: string; note: string }
}
export function buildDelegationPreview(input: DelegationPreviewInput): DelegationPreview
```

Behavior:
- `principal` = `你（项目所有者）`; `agent` = `Tech Lead`.
- `scope` = `${projectName} · 当前项目 · 不跨世界`.
- `intent` = `${title}：${objective}`.
- `constraints` = boundaries joined or `未声明（计划批准时确认）`.
- `acceptance` = acceptance joined or `由 Tech Lead 提议，计划批准时确认`.
- `discretion` = `计划内自主；计划外写、删除、网络与超预算必须升级`.
- `escalation` = `计划外写 / 删除 / 网络 / 超预算 / 验收 / 合并 / 解决评审项`.
- `budget` = `未设置`.
- `evidence` = `计划、变更集、评审项、Goal Eval`.
- `termination` = `结果待验收，或你中止`.
- `audit` = `决定记录 + Goal 历史`.
- `autonomy` = level 3, label `批准后执行`, note `计划批准后 Tech Lead 才执行；验收、合并与评审项解决永远由人完成。`
- `PodGoalComposer` adds a `preview` signal and a `projectName?: string` prop (default `当前项目`). The primary button becomes `预览委托单`; pressing it builds the preview and renders `DelegationPreview`. Only the preview's `确认并创建` calls `props.onCreate`; `返回修改` clears the preview. The composer never calls `onCreate` from the first step.
- `ProjectWorkView` passes the current project name (or directory basename) to `PodGoalComposer`.
- `DelegationPreview` renders all 12 fields plus the autonomy block; it uses v2 components and tokens.

- [ ] **Step 1: Write the failing pure tests**

- `preview contains all twelve delegation fields` — every key is non-empty.
- `empty acceptance and boundaries are explicit` — fallbacks contain `计划批准时确认` and `未声明`.
- `autonomy is level three and never five` — `level === 3`, label `批准后执行`, note mentions human-only acceptance.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/delegation-preview.test.ts
```

Expected: FAIL, module missing.

- [ ] **Step 3: Implement the builder and preview component**

Keep the builder pure; the component only renders.

- [ ] **Step 4: Update the composer flow**

`PodGoalComposer` keeps its existing fields; after preview, the `DelegationPreview` replaces the form until confirmed or dismissed. Preserve `submitting` / `submitError` behavior on the confirm step.

- [ ] **Step 5: Add the wiring test**

Assertions:
- `PodGoalComposer.tsx` contains `buildDelegationPreview`, `DelegationPreview`, `确认并创建`, and does not call `props.onCreate` before the preview branch.
- `DelegationPreview.tsx` contains `mafw-delegation-preview`, `批准后执行`, `验收、合并`, `ButtonV2`.
- `mafw.css` has the preview block with tokens.

- [ ] **Step 6: Run focused tests and type gate**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/delegation-preview.test.ts tests/delegation-preview-wiring.test.ts
npx tsgo --noEmit -p tsconfig.json
```

Expected: PASS, rc=0.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/delegation-preview.ts packages/desktop/src/renderer/mafw/delegation-preview.test.ts packages/desktop/src/renderer/mafw/components/DelegationPreview.tsx packages/desktop/src/renderer/mafw/components/PodGoalComposer.tsx packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/delegation-preview-wiring.test.ts
git commit -m "feat(desktop): preview the delegation before creating a goal"
```

---

### Task 9: Agent contract and execution frame badge

**Files:**
- Create: `packages/desktop/src/renderer/mafw/agent-contract.ts`
- Test: `packages/desktop/src/renderer/mafw/agent-contract.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/AgentContractCard.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/goal-user-view.ts`
- Test: `packages/desktop/src/renderer/mafw/goal-user-view.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/frame-view.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/frame-view.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/tests/agent-contract-wiring.test.ts`

**Interfaces:**
- Consumes: `PodGoal` (`goalMode`, `stage`, `progress`, `lastError`, `accepted`).
- Produces:

```ts
// agent-contract.ts
export type AgentContract = {
  level: 3 | 4
  levelLabel: string
  mandate: string
  discretion: string
  escalation: readonly string[]
  audit: readonly string[]
  humanOnly: readonly string[]
}
export function agentContractFor(
  goal: Pick<PodGoal, 'goalMode' | 'stage' | 'progress' | 'lastError' | 'accepted'>,
): AgentContract

// goal-user-view.ts
export function executionBadgeFor(
  goal: PodGoal,
): { label: string; tone: 'neutral' | 'amber' | 'red' | 'green' } | null

// frame-view.ts
export type FrameBadge = {
  id: 'dirty' | 'stale' | 'unresolved' | 'revision' | 'execution' | 'version' | 'external' | 'verdict'
  label: string
  tone: 'neutral' | 'amber' | 'red' | 'green'
}
export type FrameInput = {
  /* existing */
  execution?: { label: string; tone: 'neutral' | 'amber' | 'red' | 'green' }
}
```

Behavior:
- `agentContractFor`: `goalMode === 'quick'` or `'standing'` → level 4; otherwise level 3. Labels `授权内自主` / `批准后执行`.
- `mandate` = `在 ${goalMode ?? 'standard'} 范围内推进当前 Goal`.
- `discretion` = level 4 `可逆、低风险步骤自主，事后报告`; level 3 `计划内自主，计划批准后执行`.
- `escalation` = `计划外写`, `删除`, `网络 / 外部副作用`, `超预算`, `验收`, `合并`, `解决评审项`.
- `audit` = `计划与 Goal Eval`, `变更集`, `评审项`, `决定记录`.
- `humanOnly` = `验收`, `合并`, `解决评审项`; always include `5 自决永远不允许`.
- `executionBadgeFor` order:
  1. `lastError` → `{ label: 'blocked', tone: 'red' }`
  2. `stage.kind === 'blocked'` → `{ label: 'blocked', tone: 'red' }`
  3. `resultReady && !accepted` → `{ label: '待验收', tone: 'amber' }`
  4. `accepted` or `endedAt` → `{ label: 'done', tone: 'green' }`
  5. `progress.total > 0` → `{ label: `${done}/${total}`, tone: 'neutral' }`
  6. `stage.kind` present → `{ label: stageLabel, tone: 'neutral' }`
  7. otherwise `null`.
- `frameView` pushes the execution badge after `revision` and before `version`; tests assert the order.
- `MafwShell.focusFrame` resolves the focused Goal (`focus.scope.kind === 'goal'`) and passes `execution: executionBadgeFor(goal) ?? undefined`.
- `AgentContractCard` renders in `GoalDetailPanel` after `GoalUserHero`: level chip, mandate, discretion, escalation list, audit list, human-only banner. It is collapsed by default and uses `ButtonV2` + `aria-expanded`.

- [ ] **Step 1: Write the failing pure tests**

- `standard goals use level three and quick goals use level four` — `agentContractFor({ goalMode: 'quick', ... })` level 4; standard level 3.
- `human-only boundaries are always present` — includes `验收`, `合并`, `解决评审项`, `5 自决永远不允许`.
- `execution badge prefers blockers over progress` — lastError → blocked red.
- `execution badge shows result acceptance and done` — resultReady → 待验收 amber; accepted → done green.
- `frame includes execution after revision` — badges order `revision`, `execution`, `version`.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/agent-contract.test.ts src/renderer/mafw/goal-user-view.test.ts src/renderer/mafw/focus/frame-view.test.ts
```

Expected: FAIL, missing exports / badge order.

- [ ] **Step 3: Implement the pure models and frame badge**

Keep the contract text short and literal; no model calls.

- [ ] **Step 4: Add the card and shell wiring**

`AgentContractCard` receives `contract` and `title`; `GoalDetailPanel` derives it from `podGoal()`. `MafwShell.focusFrame` adds the execution badge.

- [ ] **Step 5: Add the wiring test**

Assertions:
- `GoalDetailPanel.tsx` imports `AgentContractCard` and renders it after `GoalUserHero`.
- `AgentContractCard.tsx` contains `mafw-agent-contract`, `批准后执行` / `授权内自主`, `humanOnly`.
- `MafwShell.tsx` contains `executionBadgeFor` and passes `execution:` to `frameView`.

- [ ] **Step 6: Run focused tests and type gate**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/agent-contract.test.ts src/renderer/mafw/goal-user-view.test.ts src/renderer/mafw/focus/frame-view.test.ts tests/agent-contract-wiring.test.ts
npx tsgo --noEmit -p tsconfig.json
```

Expected: PASS, rc=0.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/agent-contract.ts packages/desktop/src/renderer/mafw/agent-contract.test.ts packages/desktop/src/renderer/mafw/components/AgentContractCard.tsx packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx packages/desktop/src/renderer/mafw/goal-user-view.ts packages/desktop/src/renderer/mafw/goal-user-view.test.ts packages/desktop/src/renderer/mafw/focus/frame-view.ts packages/desktop/src/renderer/mafw/focus/frame-view.test.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/agent-contract-wiring.test.ts
git commit -m "feat(desktop): expose agent contract and execution state"
```

---

### Task 10: Regression, smoke, and delivery record

**Files:**
- Create: `docs/releases/2026-11-12-workbench-chat-decisions.md`
- Modify: `docs/architecture/desktop.md`

- [ ] **Step 1: Run the focused suites**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test \
  src/renderer/mafw/focus/decision-model.test.ts \
  src/renderer/mafw/decision-store.test.ts \
  src/renderer/mafw/delegation-preview.test.ts \
  src/renderer/mafw/agent-contract.test.ts \
  src/renderer/mafw/goal-user-view.test.ts \
  src/renderer/mafw/focus/frame-view.test.ts \
  tests/decision-board-wiring.test.ts \
  tests/decision-record-wiring.test.ts \
  tests/delegation-preview-wiring.test.ts \
  tests/agent-contract-wiring.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run the gateway focused suites**

```bash
cd gateway
npm test -- --runInBand \
  src/core/lead/attention.test.ts \
  src/routes/attention.test.ts \
  src/core/decision/decision-record-service.test.ts \
  src/routes/decisions.test.ts \
  src/mcp/handlers/decision-draft.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run the desktop full suite, type gate, and build**

```bash
cd packages/desktop
npm test
npx tsgo --noEmit -p tsconfig.json
node ../../node_modules/electron-vite/bin/electron-vite.js build
```

Expected: full suite PASS, rc=0, build rc=0. If the external visual-language WIP is still uncommitted and makes CSS tests fail, record the excluded count and do not stage those files.

- [ ] **Step 4: Real-app smoke**

With the dev app running:
1. Open a Goal with a pending plan: the Chat decision board shows `批准计划` under `需要你定`; clicking opens the Goal plan overlay.
2. Open a Goal with a pending question / direction review: the board item opens the matching Goal face.
3. Review a Goal with unresolved review items: the board shows `rel:Lx`; clicking opens the anchored file.
4. Rail Pod badge count equals the board's `需要你` count.
5. New Goal composer: `预览委托单` shows all 12 fields; `返回修改` preserves the form; `确认并创建` creates the Goal.
6. Goal overview shows the agent contract level and human-only banner; the frame shows the execution badge (`3/7`, `blocked`, `待验收`, or `done`).
7. A drafted decision record appears under `待确认`; confirming it moves it to `已定`; reopening returns it to `待确认`.

- [ ] **Step 5: Write the release record**

`docs/releases/2026-11-12-workbench-chat-decisions.md`:
- Scope, commits, behavior changes, verification counts, final review findings, deferred minors, known boundaries.
- Explicitly name any external visual-language commits that landed in the range; do not attribute them to this plan.
- Record new test count and full-suite pass count.

- [ ] **Step 6: Update `docs/architecture/desktop.md`**

Add a `Chat 决定面（2026-11-12 Plan 3）` bullet after the Plan 2 bullet: decision store, board, decision records, delegation preview, agent contract, execution frame. Keep it to 4–6 lines and link the release record.

- [ ] **Step 7: Commit**

```bash
git add docs/releases/2026-11-12-workbench-chat-decisions.md docs/architecture/desktop.md
git commit -m "docs: record chat decisions delivery"
```

---

## Self-Review

**Spec coverage:**
- §10.1–10.3 decision definition / seven kinds / lifecycle → Task 1 model + Task 3 board.
- §10.4 Chat information architecture / single source → Task 2 store + Task 3 board.
- §10.5 Composer modes → intentionally deferred; delegation preview covers the create/confirm half (Task 8).
- §10.6 delegation form → Task 8.
- §10.7 ceremony threshold → Task 8 autonomy block + Task 9 contract.
- §10.8 decision records → Tasks 5–7.
- §11.3–11.4 agency / autonomy ladder → Task 9 contract.
- §11.5 user modes → deferred with composer modes; the contract card still shows authority level.
- §11.7–11.9 responsibility / human-only / failure modes → Task 9 human-only banner; Task 5 route checks.
- §12.6 decision / inspection → Tasks 3, 4, 8.
- §12.7 execution → Task 9 frame badge + existing GoalUserHero.
- Acceptance #5, #6, #9 → Tasks 3, 8, 9; #7, #8 remain guarded by existing gateway routes and are re-run in Task 10.

**Type consistency:** `AttentionItem` (SDK) matches `buildDecisionBoard`; `DecisionRecord` (SDK) matches the service and store; `DecisionAction` is used by the board and shell; `FocusOpenRequest` is unchanged.

**Review Focus tests:** each Review Focus line has an owning task test (Task 1/2 grouping, Task 2 single count, Task 5 human-only, Task 8 preview confirmation, Task 9 frame badge, Task 10 staging rule).
