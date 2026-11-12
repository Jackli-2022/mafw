# Workbench World Overview & Legacy Cleanup Implementation Plan (Plan 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the stage-first workbench by making the world overview a real focus subject, removing the execution drawer and the four-context shell, and making decision updates live without polling.

**Architecture:** This is the final strangler slice. The focus stack (`Focus`, `FrameBar`, `LensBar`, `FocusStage`, `SubjectPicker`) becomes the only workbench navigation. `WorkbenchContext`, the legacy content shell, the execution drawer, and split view are deleted. World overview is a fallback subject, not a page; with no focus the workbench opens the picker. Decision records become SSE-invalidated and batch-rendered.

**Tech Stack:** Electron 42, SolidJS, TypeScript, `@mafw/ui` v2, `node:test` + `@mafw/test-shim`, electron-vite, Jest for gateway.

**Spec:** `docs/superpowers/specs/2026-11-12-workbench-stage-first-design.md`

**Plan series:** Plan 1 (focus foundation), Plan 2 (Goal/review focus), Plan 3 (Chat decisions), Plan 4 (Chat modes/episodes), **Plan 5 (this plan)**.

**User decision (supersedes spec):** Split view is **not wanted**. Do not implement it. Remove the existing latent/legacy split affordances. Spec §12.8 and §15.11 are replaced by this decision.

## Global Constraints

- 一个仓库 = 一个世界；`worldId` 是焦点栈的根，Goal 不跨世界。
- 工作台只有一条导航：焦点栈。不得保留 `WorkbenchContext`、四个 context 的持久化或第二套标题栏。
- 世界总览是**兜底 subject**，不是默认页；没有焦点时优先打开取景器。
- 执行状态只出现在框 / Goal 总览；不得恢复右侧执行抽屉。
- 人类专属验收、评审项状态权威、revision 隔离、PASS 不自动合并，不得退化。
- 决定记录只能起草，确认 / 搁置 / 重开仍由人完成。
- 桌面 UI 只用 `@mafw/ui` v2 组件；禁止新增裸 `<button>` / `<input>` / 裸 `title`。
- Tooltip 统一 `openDelay={300}`；颜色只用主题 token，不硬编码。
- 所有持久化 fail-open；localStorage 被禁用或超配额时不能抛到 UI。
- 单文件测试必须带 `--conditions=browser`；gateway 全量测试带 `--forceExit`。
- 工作区在本地 `main`；本 plan 不 push、不发布。
- 不改变 `SessionCreateOpts.directory` 绝对路径、runtime facade、gateway DTO 契约。

## Review Focus

- **无焦点启动**：首次启动 / 升级后没有焦点时打开取景器；用户关闭取景器后不反复弹出；切换项目后重新判定。
- **重启恢复**：焦点栈、scope、lens、scroll / selection、文件草稿跨重启恢复；旧 `mafw-content-scope` 只迁移一次。
- **世界总览**：不再显示文件 / 最近内容卡片；New Goal、standing、团队、全部 Goal、继续 / 需要你仍可达；空项目不崩。
- **旧键升级**：`mafw-workbench-context` / `mafw-workbench-surface` / `mafw-execution-section` / `mafw-content-scope:*` 迁移或清理，不阻塞启动。
- **决定板**：第一页之外的决定记录仍能通过 Episode「查看决定记录」展开；MCP 起草的决定的 SSE 更新可见；human-only 确认不变。

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/desktop/src/renderer/mafw/WorldOverviewStage.tsx` (new) | World overview subject: continue / needs you / all Goals / standing / team / New Goal. No files or recents cards. |
| `packages/desktop/src/renderer/mafw/components/PluginSurfaceStage.tsx` (new) | Keeps visited plugin web pages alive; renders the active web surface or declarative panel. |
| `packages/desktop/src/renderer/mafw/plugins/surface-id.ts` (new) | `PluginSurfaceId` parse/build helpers moved out of `workbench-views.ts`. |
| `packages/desktop/src/renderer/mafw/focus/landing.ts` (new) | Pure `shouldAutoOpenPicker` decision. |
| `packages/desktop/src/renderer/mafw/focus/legacy-migration.ts` | Extend with one-time `mafw-content-scope` parsing. |
| `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx` | Focus-only shell. Legacy context panes / L2 / execution drawer removed. |
| `packages/desktop/src/renderer/mafw/components/FocusStage.tsx` | Stage dispatch; plugin stage; world / goal / changeSet render slots. |
| `packages/desktop/src/renderer/mafw/MafwShell.tsx` | Focus actions, landing, old-key cleanup, decision SSE wiring. |
| `packages/desktop/src/renderer/mafw/components/ChatPane.tsx` | Inline background runs panel (replaces execution drawer entry). |
| `packages/desktop/src/renderer/mafw/components/DecisionBoard.tsx` | Per-group batch rendering. |
| `packages/desktop/src/renderer/mafw/focus/decision-model.ts` | Pure batch helpers. |
| `gateway/src/core/decision/decision-record-service.ts` | Decision write notifications. |
| `packages/desktop/src/renderer/mafw/sse/dispatcher.ts` | `decision.updated` routing. |

---

### Task 1: Remove split-view remnants

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/focus/focus-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/focus-persistence.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/LensBar.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ContentScopeHeader.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Delete: `packages/desktop/src/renderer/mafw/components/SplitDocumentPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/src/renderer/mafw/focus/focus-persistence.test.ts`
- Test: `packages/desktop/src/renderer/mafw/split-removal-wiring.test.ts` (new)

**Interfaces:**
- Consumes: none.
- Produces: `Place` without `split`:
  ```ts
  export type Place = {
    scroll?: number
    selection?: { anchor: number; head: number }
    filter?: string
  }
  ```

- [ ] **Step 1: Write the failing persistence test**

Add to `focus-persistence.test.ts`:

```ts
test("drops the retired split subject from loaded places", () => {
  const io = fakeStorage()
  io.data.set("mafw-focus:v1:w1", JSON.stringify({
    v: 1,
    stack: [{
      scope: { kind: "world", worldId: "w1" },
      subject: { kind: "file", root: "C:/repo", rel: "src/a.ts" },
      lens: "read",
      place: { scroll: 10, split: { kind: "file", root: "C:/repo", rel: "src/b.ts" } },
    }],
    kept: [],
  }))
  resetFocusPersistence()
  configureFocusStorage(io)
  const loaded = loadFocusState("w1")
  assert.ok(loaded)
  assert.equal(loaded.stack[0]!.place.scroll, 10)
  assert.equal("split" in loaded.stack[0]!.place, false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run in `packages/desktop`:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/focus-persistence.test.ts
```

Expected: FAIL because `place.split` is retained today.

- [ ] **Step 3: Remove split from the model and persistence**

In `focus-model.ts`, delete `split?: SubjectRef` from `Place`. In `focus-persistence.ts`, delete the `value.split` validation and the `cloneFocus` split branch. In `LensBar.tsx`, delete `splitOpen` / `onToggleSplit` props, the split `ButtonV2`, and the now-unused `TooltipV2` import. In `ContentScopeHeader.tsx` and `WorkbenchCodeView.tsx`, delete `splitOpen` / `onToggleSplit` / `onSplitOpen`, `splitRel`, `SplitDocumentPane`, and `is-split` class usage. Delete `SplitDocumentPane.tsx`.

In `MafwShell.tsx`, delete `const [contentSplit, setContentSplit] = createSignal(false)` and the `contentSplit` / `onContentSplit` props passed to `WorkbenchShell`. Remove `.mafw-lens-split`, `.mafw-content-scope-split`, `.mafw-rw-code-main.is-split`, and split-document CSS blocks from `mafw.css`.

- [ ] **Step 4: Write the wiring guard**

Create `split-removal-wiring.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")

test("no split affordance remains in the workbench", () => {
  for (const file of [
    "components/LensBar.tsx",
    "components/ContentScopeHeader.tsx",
    "components/WorkbenchCodeView.tsx",
    "MafwShell.tsx",
  ]) {
    const source = read(file)
    assert.doesNotMatch(source, /contentSplit|onToggleSplit|onContentSplit|splitOpen/)
  }
})
```

- [ ] **Step 5: Run the tests**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test \
  src/renderer/mafw/focus/focus-persistence.test.ts \
  src/renderer/mafw/split-removal-wiring.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/focus/focus-model.ts \
  packages/desktop/src/renderer/mafw/focus/focus-persistence.ts \
  packages/desktop/src/renderer/mafw/focus/focus-persistence.test.ts \
  packages/desktop/src/renderer/mafw/components/LensBar.tsx \
  packages/desktop/src/renderer/mafw/components/ContentScopeHeader.tsx \
  packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx \
  packages/desktop/src/renderer/mafw/components/SplitDocumentPane.tsx \
  packages/desktop/src/renderer/mafw/MafwShell.tsx \
  packages/desktop/src/renderer/mafw/mafw.css \
  packages/desktop/src/renderer/mafw/split-removal-wiring.test.ts
git commit -m "refactor(workbench): remove split view"
```

---

### Task 2: Extract the world overview stage

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/WorldOverviewStage.tsx`
- Delete: `packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx`
- Delete: `packages/desktop/src/renderer/mafw/components/ProjectFilesCard.tsx`
- Delete: `packages/desktop/src/renderer/mafw/components/RecentContentList.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/src/renderer/mafw/world-overview-wiring.test.ts` (new)

**Interfaces:**
- Consumes: `PodGoal`, `PodWorkOverview`, `PodDetail`, `RecentContentEntry`, `WorkFilter`, `GoalDetailFocus`.
- Produces:

```ts
export type WorldTeamProps = {
  detail: PodDetail | null
  loading: boolean
  error: string | null
  unsupported: boolean
  isWorktree: boolean
  onRefresh: () => void
  onOpenLead: () => void
  onOpenTechLead: (goalId: string) => void
  onOpenPanel: (tab: "team" | "memory", target?: "members" | "inbox") => void
  onCreate: () => void
}

export function WorldOverviewStage(props: {
  projectDir: string | null
  projectName?: string | null
  refreshTick: () => number
  composerRequest?: number
  composerInitial?: { title: string; objective?: string } | null
  onComposerToggle?: () => void
  active: boolean
  team?: WorldTeamProps
  teamFocusRequest?: number
  onOpenGoal: (goal: PodGoal, focus?: GoalDetailFocus) => void
  onGoalCreated?: (goalId: string, goal?: PodGoal) => void
}): JSX.Element
```

- [ ] **Step 1: Write the failing wiring test**

Create `world-overview-wiring.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")
const stage = read("components/WorldOverviewStage.tsx")
const shell = read("MafwShell.tsx")

test("WorldOverviewStage keeps world actions and drops file cards", () => {
  assert.match(stage, /WorkPriorityList/)
  assert.match(stage, /StandingGoalsPanel/)
  assert.match(stage, /ProjectTeamStrip/)
  assert.match(stage, /WorkOverview/)
  assert.match(stage, /新建 Goal/)
  assert.match(stage, /世界总览/)
  assert.doesNotMatch(stage, /ProjectFilesCard|RecentContentList|项目文件|最近内容/)
})

test("MafwShell renders the world stage for world focus", () => {
  assert.match(shell, /WorldOverviewStage/)
  assert.match(shell, /renderWorld/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/world-overview-wiring.test.ts
```

Expected: FAIL because `WorldOverviewStage.tsx` does not exist.

- [ ] **Step 3: Create `WorldOverviewStage` from `ProjectWorkView`**

Copy the existing `ProjectWorkView` implementation, then:

- Remove the `files` and `recents` props and the `ProjectFilesCard` / `RecentContentList` imports and JSX.
- Remove the `mafw-project-home-grid` two-column wrapper; render `WorkOverview` directly under `WorkPriorityList`.
- Remove the now-unused `projectScopeKey` memo from `MafwShell.tsx`.
- Change the title copy to `世界总览` (keep `projectName` as the subtitle when present).
- Change the hint copy to `继续 / 需要你 / 全部 Goal / 团队都在这里`.
- Keep `StandingGoalsPanel`, `WorkPriorityList`, `ProjectTeamStrip`, `WorkOverview`, `PodGoalComposer`, `teamFocusRequest`, `composerRequest`, `active`, and the 15s overview refresh.
- Keep the existing CSS class names `mafw-project-work*` to limit churn.

- [ ] **Step 4: Wire it from MafwShell**

Import `WorldOverviewStage` instead of `ProjectWorkView`. Replace the legacy `workView` prop and the `renderWorld` prop with the same element:

```tsx
const worldOverview = (
  <WorldOverviewStage
    projectDir={currentProject()}
    projectName={railProjectName(currentProject(), true)}
    refreshTick={() => Math.max(goalsRev(), podStore.revision())}
    composerRequest={goalComposerRequest()}
    composerInitial={goalComposerInitial()}
    onComposerToggle={() => setGoalComposerInitial(null)}
    active={dockPresent() && (activeFocus()?.subject.kind === "world" || workbenchContext() === "project")}
    team={{ /* existing team props unchanged */ }}
    teamFocusRequest={teamFocusRequest()}
    onOpenGoal={(goal, focus) => openGoalFocus(goal.goalId, focus)}
    onGoalCreated={(goalId) => { setGoalComposerInitial(null); openGoalFocus(goalId, "timeline") }}
  />
)
```

Pass `workView={worldOverview}` and `renderWorld={() => worldOverview}` while the legacy shell still exists. Delete `ProjectWorkView.tsx`, `ProjectFilesCard.tsx`, and `RecentContentList.tsx`. Delete `openProjectFile`, `openProjectContent`, and `openRecentContent` from `MafwShell.tsx`; picker file/recent items already call `openContentFile`.

- [ ] **Step 5: Trim the project-home CSS**

Remove `.mafw-project-home-grid`, `.mafw-project-home-content`, and related grid rules from `mafw.css`. Keep `.mafw-project-work*`, `.mafw-project-team-slot`, and `.mafw-project-work-composer`.

- [ ] **Step 6: Run the tests**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test \
  src/renderer/mafw/world-overview-wiring.test.ts \
  src/renderer/mafw/focus/picker-model.test.ts
```

Expected: PASS. The picker tests prove files and recents remain reachable.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/WorldOverviewStage.tsx \
  packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx \
  packages/desktop/src/renderer/mafw/components/ProjectFilesCard.tsx \
  packages/desktop/src/renderer/mafw/components/RecentContentList.tsx \
  packages/desktop/src/renderer/mafw/MafwShell.tsx \
  packages/desktop/src/renderer/mafw/mafw.css \
  packages/desktop/src/renderer/mafw/world-overview-wiring.test.ts
git commit -m "feat(workbench): add world overview stage"
```

---

### Task 3: Remove the execution drawer

**Files:**
- Delete: `packages/desktop/src/renderer/mafw/components/ExecutionView.tsx`
- Delete: `packages/desktop/src/renderer/mafw/components/UsageDock.tsx`
- Delete: `packages/desktop/src/renderer/mafw/execution-usage.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/TaskList.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/workbench-views.ts`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/src/renderer/mafw/execution-drawer-removal.test.ts` (new)

**Interfaces:**
- Consumes: `BackgroundDock`.
- Produces:
  - `ChatPane` owns `runsOpen` locally; no new external prop.
  - `MafwShell` no longer owns `executionSection`, `executionOpen`, `applyExecutionSection`, `applyExecutionOpen`, or `openExecutionDrawer`.
  - `usage` action opens `Config > Usage`.

- [ ] **Step 1: Write the failing wiring test**

Create `execution-drawer-removal.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")
const shell = read("MafwShell.tsx")
const chat = read("components/ChatPane.tsx")
const shellUi = read("components/WorkbenchShell.tsx")

test("ChatPane hosts background runs inline", () => {
  assert.match(chat, /BackgroundDock/)
  assert.match(chat, /runsOpen/)
  assert.match(chat, /mafw-chat-runs/)
})

test("the execution drawer is gone", () => {
  for (const source of [shell, shellUi]) {
    assert.doesNotMatch(source, /ExecutionView|executionOpen|executionSection|openExecutionDrawer|applyExecutionSection|applyExecutionOpen|mafw-rw-exec-drawer/)
  }
})

test("usage opens the config usage page", () => {
  assert.match(shell, /setConfigSection\("usage"\)/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/execution-drawer-removal.test.ts
```

Expected: FAIL because the drawer and execution state still exist.

- [ ] **Step 3: Add the inline background panel**

In `ChatPane.tsx`:

- Add `const [runsOpen, setRunsOpen] = createSignal(false)`.
- Change `<BackgroundWorkBar ... onOpenDock={() => props.onOpenBackgroundDock?.()} />` to `onOpenDock={() => setRunsOpen((open) => !open)}`.
- Render above the composer, inside the composer shell:
  ```tsx
  <Show when={runsOpen()}>
    <div class="mafw-chat-runs" aria-label="后台任务">
      <BackgroundDock
        activeSessionId={props.sessionID}
        onOpenSession={(id) => props.onOpenSubagent?.(id)}
      />
    </div>
  </Show>
  ```
- Import `BackgroundDock`.
- Add `.mafw-chat-runs` CSS with `max-height: 240px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--r-md); background: var(--bg-inset);` and token-only colors.

- [ ] **Step 4: Remove execution state and views**

In `WorkbenchShell.tsx`, delete `executionSection`, `executionOpen`, `onExecutionSection`, `onExecutionOpen`, `executionView`, the `mafw-rw-exec-toggle` button, and the `mafw-rw-exec-drawer` region. Delete `ExecutionView.tsx`, `UsageDock.tsx`, and `execution-usage.ts`.

In `MafwShell.tsx`:

- Delete `executionSection` / `executionOpen` signals and all `applyExecution*` / `openExecutionDrawer` functions.
- Remove `ExecutionView`, `UsageDock`, and `executionUsageOpen` imports and the `executionView={...}` prop.
- Replace `onOpenBackgroundDock={() => openExecutionDrawer("background")}` with nothing (ChatPane owns it).
- Replace `onOpenUsage` with `() => { setShowConfig(true); setConfigSection("usage") }`.
- Replace the command-palette `open-usage` action with the same Config navigation.
- Remove `onPin` from the inline `TaskList` and delete the pin button from `TaskList.tsx`.
- Leave `ExecutionSection` / `EXECUTION_SECTIONS` / `executionSectionLabel` in `workbench-views.ts` for now: `workbench-focus.ts` still types the full-width snapshot, and Task 7 deletes both. Remove only their import/use from `MafwShell.tsx` and `WorkbenchShell.tsx`.
- Remove `.mafw-rw-exec-*`, `.mafw-rw-overview*`, and `.mafw-rw-usage*` CSS blocks.

- [ ] **Step 5: Run the tests**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test \
  src/renderer/mafw/execution-drawer-removal.test.ts \
  src/renderer/mafw/components/context-menu-wiring.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ExecutionView.tsx \
  packages/desktop/src/renderer/mafw/components/UsageDock.tsx \
  packages/desktop/src/renderer/mafw/execution-usage.ts \
  packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx \
  packages/desktop/src/renderer/mafw/components/ChatPane.tsx \
  packages/desktop/src/renderer/mafw/components/TaskList.tsx \
  packages/desktop/src/renderer/mafw/MafwShell.tsx \
  packages/desktop/src/renderer/mafw/workbench-views.ts \
  packages/desktop/src/renderer/mafw/mafw.css \
  packages/desktop/src/renderer/mafw/execution-drawer-removal.test.ts
git commit -m "refactor(workbench): remove execution drawer"
```

---

### Task 4: Make focus the only navigation entry

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Test: `packages/desktop/src/renderer/mafw/focus-navigation-wiring.test.ts` (new)

**Interfaces:**
- Consumes: `openSubject`, `focusScopeFromContent`, `parsePluginSurfaceId`, `requestBrowserNavigate`.
- Produces these MafwShell functions (exact names):
  ```ts
  const revealWorkbench = (): void
  const openWorldOverview = (): void
  const openGoalFocus = (goalId: string, focus?: GoalDetailFocus): void
  const openBrowserFocus = (url: string, opts?: { newTab?: boolean }): void
  const openTerminalFocus = (): void
  const openPluginFocus = (surfaceId: string): void
  const openProjectChangeSetFocus = (lens?: "changes" | "review" | "decide"): void
  const showWorkbenchLanding = (): void
  ```

- [ ] **Step 1: Write the failing wiring test**

Create `focus-navigation-wiring.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const shell = readFileSync(new URL("./MafwShell.tsx", import.meta.url), "utf8")

test("workbench entry points go through focus actions", () => {
  for (const name of [
    "revealWorkbench",
    "openWorldOverview",
    "openGoalFocus",
    "openBrowserFocus",
    "openTerminalFocus",
    "openPluginFocus",
    "openProjectChangeSetFocus",
    "showWorkbenchLanding",
  ]) {
    assert.match(shell, new RegExp(name))
  }
  assert.doesNotMatch(shell, /openWorkbenchContext\(/)
  assert.doesNotMatch(shell, /openWorkbenchSurface\(/)
  assert.doesNotMatch(shell, /applyWorkbenchContext\(/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus-navigation-wiring.test.ts
```

Expected: FAIL because legacy context helpers are still used.

- [ ] **Step 3: Add the focus actions**

Implement these helpers in `MafwShell.tsx` next to the existing focus functions:

```ts
const revealWorkbench = () => {
  closeLeftDockIfOverlay()
  setShowConfig(false)
  setActiveTab("chat")
  applyRightDock(true)
  if (narrowZone()) setNarrowView("workbench")
}

const openWorldOverview = () => {
  revealWorkbench()
  setFocusState((state) =>
    openSubject(
      { ...state, worldId: currentProject() ?? "unscoped" },
      { kind: "world", worldId: currentProject() ?? "unscoped" },
      { kind: "world" },
      "orient",
    ),
  )
}

const openBrowserFocus = (url: string, opts?: { newTab?: boolean }) => {
  revealWorkbench()
  requestBrowserNavigate(url, opts)
  setFocusState((state) =>
    openSubject(state, focusScope(), { kind: "web", url }, "interact"),
  )
}

const openTerminalFocus = () => {
  revealWorkbench()
  setFocusState((state) =>
    openSubject(state, focusScope(), { kind: "terminal", id: "local" }, "interact"),
  )
}

const openPluginFocus = (surfaceId: string) => {
  const parsed = parsePluginSurfaceId(surfaceId)
  if (!parsed) return
  revealWorkbench()
  setFocusState((state) =>
    openSubject(
      state,
      focusScope(),
      { kind: "plugin", package: parsed.package, panel: parsed.panel },
      "interact",
    ),
  )
}

const openProjectChangeSetFocus = (lens: "changes" | "review" | "decide" = "changes") => {
  revealWorkbench()
  setFocusState((state) =>
    openSubject(
      state,
      { kind: "world", worldId: currentProject() ?? "unscoped" },
      { kind: "changeSet", scope: "project", baseline: "HEAD" },
      lens,
    ),
  )
}

const showWorkbenchLanding = () => {
  setFocusState(createWorkbenchState(currentProject() ?? "unscoped"))
  setPickerOpen(true)
  revealWorkbench()
}
```

- [ ] **Step 4: Convert every call site**

Replace:

- `openProjectWork()` → `openWorldOverview()` (command palette, `openProjectTeam`, `openGoalComposer`, titlebar `onOpenWork`, `TriagePage onOpenGoals`, legacy compatibility).
- `openGoalDetail(goalId, focus)` body → set `podGoalId`, `goalDetailFocus`, then `openGoalFocus(goalId, focus)`.
- `openGoalFocus` must call `revealWorkbench()` before setting focus.
- `openPluginSurface(surfaceId)` → `openPluginFocus(surfaceId)`.
- External-link `openWorkbenchSurface("browser")` → `openBrowserFocus(url, { newTab: true })` (keep `requestBrowserNavigate` inside the helper only once).
- Terminal hotkey → if active focus is terminal, `focusBack()`, else `openTerminalFocus()`. Delete `terminalSurfaceHotkeyAction` usage.
- `openReviewFromChat` fallback → `openProjectChangeSetFocus("review")`.
- `onOpenReview` fallbacks → `openProjectChangeSetFocus("review")`.
- `GoalDetailPanel onClose` → `focusBack()`.
- `returnToProjectContent` → `openWorldOverview()`.
- `openGoalContent` → push a file subject in the goal scope, call `revealWorkbench()`, and do not set `contentReturnGoalId`.
- `openContentFile` → push a file/web subject and call `revealWorkbench()`.
- `applyWorkbenchSnapshot` / `currentWorkbenchSnapshot` remain temporarily for full-width detent restore; they are removed in Task 7.

Keep `openWorkbenchContext`, `applyWorkbenchSurface`, `applyWorkbenchContext` declarations temporarily if a legacy branch still needs them, but no call sites may use them. Task 5 deletes the declarations.

- [ ] **Step 5: Run the test**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test \
  src/renderer/mafw/focus-navigation-wiring.test.ts \
  src/renderer/mafw/goal-workbench-wiring.test.ts \
  src/renderer/mafw/goal-content-entry.test.ts
```

Expected: PASS after updating `goal-content-entry.test.ts` assertions to look for `openGoalFocus` / `openSubject` instead of `rememberContentLocation`.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx \
  packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx \
  packages/desktop/src/renderer/mafw/focus-navigation-wiring.test.ts \
  packages/desktop/src/renderer/mafw/goal-content-entry.test.ts \
  packages/desktop/src/renderer/mafw/goal-workbench-wiring.test.ts
git commit -m "refactor(workbench): route navigation through focus"
```

---

### Task 5: Make WorkbenchShell focus-only

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/FocusStage.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/PluginSurfaceStage.tsx`
- Delete: `packages/desktop/src/renderer/mafw/components/ContentScopeHeader.tsx`
- Delete: `packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Delete: `packages/desktop/src/renderer/mafw/content-scope-wiring.test.ts`
- Delete: `packages/desktop/src/renderer/mafw/content-history-wiring.test.ts`
- Test: `packages/desktop/src/renderer/mafw/workbench-shell-focus.test.ts` (new)
- Test: `packages/desktop/src/renderer/mafw/plugin-web-wiring.test.ts` (update)

**Interfaces:**
- Consumes: `Focus`, `Lens`, `FrameView`, `FocusOpenRequest`, `PickerItem`, `PluginWebSurfaceView`, `PluginSurfaceId` (still from `workbench-views.ts`; Task 7 moves it).
- Produces:

```ts
// PluginSurfaceStage.tsx
export function PluginSurfaceStage(props: {
  activeSurfaceId: PluginSurfaceId | null
  sessionID: string | null
  projectDir: string | null
  gatewayUrl?: string
  webSurfaces?: readonly PluginWebSurfaceView[]
  onBadge?: (surfaceId: string, count: number) => void
  onTitle?: (surfaceId: string, title: string) => void
  onError?: (surfaceId: string, message: string) => void
}): JSX.Element
```

- [ ] **Step 1: Write the failing shell test**

Create `workbench-shell-focus.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")
const shell = read("components/WorkbenchShell.tsx")
const stage = read("components/FocusStage.tsx")
const plugin = read("components/PluginSurfaceStage.tsx")

test("WorkbenchShell is focus-only", () => {
  assert.match(shell, /FocusStage/)
  assert.match(shell, /FrameBar/)
  assert.match(shell, /LensBar/)
  assert.match(shell, /SubjectPicker/)
  for (const legacy of [
    "WorkbenchContext",
    "ContentScopeHeader",
    "WorkbenchCodeView",
    "ExecutionView",
    "mafw-rw-l2",
    "mafw-rw-exec-drawer",
    "onExecutionOpen",
    "contentSplit",
  ]) {
    assert.doesNotMatch(shell, new RegExp(legacy))
  }
})

test("FocusStage dispatches world, goal, changeSet and plugin", () => {
  assert.match(stage, /kind\(\) === "world"/)
  assert.match(stage, /kind\(\) === "goal"/)
  assert.match(stage, /kind\(\) === "changeSet"/)
  assert.match(stage, /kind\(\) === "plugin"/)
  assert.match(stage, /PluginSurfaceStage|renderPluginSurface/)
})

test("PluginSurfaceStage keeps visited web surfaces mounted", () => {
  assert.match(plugin, /PluginWebSurfaceHost/)
  assert.match(plugin, /visited/)
  assert.match(plugin, /display/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-shell-focus.test.ts
```

Expected: FAIL because the legacy shell and files still exist.

- [ ] **Step 3: Keep plugin surface ids in place**

Do not move `PluginSurfaceId` yet. `workbench-focus.ts` and `workbench-views.ts` are deleted together in Task 7, so moving the id helpers now would leave a broken import in between. `PluginSurfaceStage` and `FocusStage` import `PluginSurfaceId` / `pluginSurfaceId` from `workbench-views.ts` for this task.

- [ ] **Step 4: Build `PluginSurfaceStage`**

Create `PluginSurfaceStage.tsx`:

- Track `visited` surface ids in a signal.
- When `props.activeSurfaceId` matches a web surface view, add it to `visited`.
- Render every visited view through `PluginWebSurfaceHost`, with `display: contents` for the active one and `display: none` for the rest.
- Pass `projectDir`, `sessionID`, `gatewayUrl`, and badge/title/error callbacks.
- Keep the host mounted when focus changes to another subject, so returning does not reload the page.

- [ ] **Step 5: Reduce `WorkbenchShell` to focus primitives**

Delete the legacy branch (`!props.focusView` head/L2/content/panes), the execution drawer region, and these props: `context`, `contextLabel`, `surface`, `executionSection`, `executionOpen`, `onContext`, `onBackToProject`, `onSurface`, `onExecutionSection`, `onExecutionOpen`, `contentScopeLabel`, `contentScopeIsGoal`, `contentIntent`, `onContentIntent`, `contentDocument`, `onContentDocument`, `contentSplit`, `onContentSplit`, `canReview`, `onContentReview`, `canGoBack`, `backLabel`, `onBack`, `onReturnToProjectContent`, `workView`, `goalView`, `executionView`, `reviewView`, `pluginSurfaces`, `focus`, `onToggleFocus`.

Keep `pluginProjectDir`, `webSurfaces`, `gatewayUrl`, `onWebBadge`, `onWebTitle`, and `onWebError` and pass them to `PluginSurfaceStage`.

When `focusView` is null, render:

```tsx
<DockEmpty
  icon="layout-right"
  text="选择一个对象"
  hint="文件、Goal、变更或世界总览"
  action={{ label: "打开取景器", onClick: props.onOpenPicker }}
/>
```

Render `FocusStage` for non-null focus, then `<PluginSurfaceStage activeSurfaceId={activePluginSurfaceId()} ... />`, then the instrument rail, then `SubjectPicker`.

Define the active id inside `WorkbenchShell`:

```ts
const activePluginSurfaceId = (): PluginSurfaceId | null => {
  const subject = props.focusView?.subject
  return subject?.kind === "plugin"
    ? pluginSurfaceId(subject.package, subject.panel)
    : null
}
```

- [ ] **Step 6: Update `FocusStage`**

- `FocusStage` already declares `webSurfaces`, `gatewayUrl`, `onWebBadge`, `onWebTitle`, and `onWebError`; keep them and pass `webSurfaces` through from `WorkbenchShell`.
- Plugin branch: compute `surfaceId = pluginSurfaceId(subject.package, subject.panel)`. If a matching web surface exists, render nothing (the cache shows it); otherwise render `renderPluginSurface?.(surfaceId)`.
- Keep `renderWorld`, `renderGoal`, `renderChangeSet`.

- [ ] **Step 7: Update MafwShell wiring**

- Import `parsePluginSurfaceId` from `workbench-views` (Task 7 moves it to `plugins/surface-id`).
- Pass `focusView`, frame, lenses, instrument rail, picker, stage renderers, and plugin cache props to the new `WorkbenchShell`.
- `renderWorld={() => worldOverview}`, and change the world stage `active` prop to `dockPresent() && activeFocus()?.subject.kind === "world"`.
- `renderGoal={() => <GoalDetailPanel goalId={activeFocusGoalId()} ... />}` where `activeFocusGoalId` is `activeFocus()?.subject.kind === "goal" ? subject.goalId : null`.
- `renderPluginSurface={(id) => <PluginSurfaceHost ... />}`.
- Remove `pluginTabList`, `pluginWebSurfaceTabs`, `applyPluginTabTitles`, and the `pluginSurfaces` L2 prop. Keep `pluginSurfaceRuntime`, `pluginRailItems`, `pluginSurfaceIdList` for rail badges.
- Leave the `workbenchContext` / `workbenchSurface` / `previousSurface` signals and the full-width snapshot functions in place until Task 7; they are no longer passed to `WorkbenchShell`, so the tree stays green while `workbench-focus.ts` still exists.
- `pluginActiveSurface` = active focus plugin surface id when the dock is open, else null.
- Remove `openPluginSurface` legacy use; `openPluginFocus` handles it.

- [ ] **Step 8: Update tests and CSS**

- Delete `content-scope-wiring.test.ts` and `content-history-wiring.test.ts` (both read the deleted `ContentScopeHeader`).
- Update `plugin-web-wiring.test.ts`: replace `WorkbenchCodeView` assertions with `PluginSurfaceStage` / `FocusStage`; keep rail assertions.
- Update `goal-workbench-wiring.test.ts` if it asserts legacy WorkbenchShell props.
- Remove `.mafw-rw-head`, `.mafw-rw-context`, `.mafw-rw-actions`, `.mafw-rw-l2*`, `.mafw-rw-content`, `.mafw-rw-pane`, `.mafw-rw-code*`, `.mafw-content-scope*`, `.mafw-rw-files*`, `.mafw-rw-exec*` CSS blocks.

- [ ] **Step 9: Run the focused tests**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test \
  src/renderer/mafw/workbench-shell-focus.test.ts \
  src/renderer/mafw/plugin-web-wiring.test.ts \
  src/renderer/mafw/goal-workbench-wiring.test.ts \
  src/renderer/mafw/plugin-web-surface.test.ts \
  src/renderer/mafw/plugins/plugin-view-model.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A packages/desktop/src/renderer/mafw
git commit -m "refactor(workbench): make the shell focus-only"
```

---

### Task 6: Derive content scope and intent from focus

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/focus/legacy-migration.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/legacy-migration.test.ts`
- Delete: `packages/desktop/src/renderer/mafw/content-history.ts`
- Delete: `packages/desktop/src/renderer/mafw/content-history.test.ts`
- Delete: `packages/desktop/src/renderer/mafw/content-scope-persistence.ts`
- Delete: `packages/desktop/src/renderer/mafw/content-scope-persistence.test.ts`
- Test: `packages/desktop/src/renderer/mafw/content-scope-focus.test.ts` (new)

**Interfaces:**
- Consumes: `activeFocus`, `contentScopeFromFocus`, `projectContentScope`, `contentScopeRoot`, `contentScopeKey`, `contentScopeStateFor`.
- Produces:

```ts
// focus/legacy-migration.ts
export function retiredContentScopeKey(projectDir: string): string

export function migrateLegacyContentScope(input: {
  worldId: string
  projectDir: string
  rawScope: string | null
  readState: (scopeKey: string) => ContentScopeState
}): WorkbenchState | null
```

- [ ] **Step 1: Write the failing migration test**

Add to `focus/legacy-migration.test.ts`:

```ts
test("migrates the retired content-scope key once", () => {
  const raw = JSON.stringify({ kind: "project", projectDir: "C:/repo" })
  const migrated = migrateLegacyContentScope({
    worldId: "C:/repo",
    projectDir: "C:/repo",
    rawScope: raw,
    readState: () => ({
      treeExpanded: [],
      treeSelected: null,
      openFiles: ["src/a.ts"],
      activeFile: "src/a.ts",
      readingPositions: { "src/a.ts": 88 },
      selections: {},
      filesOpen: true,
    }),
  })
  assert.ok(migrated)
  assert.equal(migrated.stack.length, 1)
  assert.equal((migrated.stack[0]!.subject as { rel: string }).rel, "src/a.ts")
  assert.equal(migrated.stack[0]!.place.scroll, 88)
})

test("ignores a malformed retired content scope", () => {
  assert.equal(migrateLegacyContentScope({
    worldId: "w1",
    projectDir: "C:/repo",
    rawScope: "{bad",
    readState: () => ({} as any),
  }), null)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/legacy-migration.test.ts
```

Expected: FAIL because `migrateLegacyContentScope` is missing.

- [ ] **Step 3: Implement the one-time migration**

Add `migrateLegacyContentScope` to `focus/legacy-migration.ts`:

- Parse `rawScope` as JSON.
- Accept `{ kind: "project", projectDir }` → `Scope = { kind: "world", worldId }`.
- Accept `{ kind: "goal", goalId, revision, worktreeDir }` → `Scope = { kind: "goal", worldId, goalId, revision, worktreeDir }` after validating the worktree belongs to the project via `goalContentScope`.
- Derive the old scope key with `contentScopeKey(scope)` and call `input.readState(key)`.
- Set `root = contentScopeRoot(scope)` and call `migrateContentScopeState({ worldId, root, scope, state: readState(key) })`.
- Return `null` for invalid JSON or invalid scope.
- Export `retiredContentScopeKey(projectDir)` returning `mafw-content-scope:<normalized projectDir>` (lowercase, forward slashes, no trailing slash), copied from the retired persistence module.

- [ ] **Step 4: Replace content signals with derived values**

In `MafwShell.tsx`:

- Replace `const [contentScope, setContentScope] = createSignal(...)` with:
  ```ts
  const contentScope = createMemo<ContentScope | null>(() => {
    const focus = activeFocus()
    return focus ? contentScopeFromFocus(focus.scope) : projectContentScope(currentProject())
  })
  ```
- `contentRoot` and `currentContentScopeKey` stay memos over `contentScope()`.
- Delete `contentIntent` signal and `setContentIntent` calls. Derive editor intent:
  ```ts
  const contentIntent = (): ContentIntent =>
    activeFocus()?.lens === "edit" ? "editing" : "reading"
  ```
- Delete `activeContentDocument`, `contentHistory`, `contentReturnGoalId`, `setContentReturnGoalId`, `rememberContentLocation`, `backContent`, `returnToProjectContent`, `pushContentHistory`, `popContentHistory`, and the `content-scope-persistence` imports.
- `openContentFile` uses `activeFocus()?.scope ?? { kind: "world", worldId: currentProject() ?? "unscoped" }` and pushes a file subject. It must not call `setContentScope`.
- `openGoalContent` pushes a file subject in the goal scope and must not call `setContentScope`.
- `openRecentContent` already routes through `openContentFile`; keep it if the picker uses it, otherwise delete it with the recents card.
- `syncStageToFocus` only requests editor/browser navigation; it no longer writes `contentIntent`.
- On boot, when no focus state exists, read `retiredContentScopeKey(currentProject())` once and call `migrateLegacyContentScope({ worldId, projectDir, rawScope, readState: (key) => contentScopeStateFor(key) })`. Save the result and remove the old key. If migration returns null, start empty (picker landing).

- [ ] **Step 5: Write the derived-scope wiring test**

Create `content-scope-focus.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const shell = readFileSync(new URL("./MafwShell.tsx", import.meta.url), "utf8")

test("content scope is derived from focus", () => {
  assert.match(shell, /const contentScope = createMemo<ContentScope \| null>/)
  assert.match(shell, /contentScopeFromFocus\(focus\.scope\)/)
  assert.doesNotMatch(shell, /content-scope-persistence/)
  assert.doesNotMatch(shell, /contentHistory|rememberContentLocation|backContent|contentReturnGoalId/)
})

test("editor intent is derived from the focus lens", () => {
  assert.match(shell, /activeFocus\(\)\?\.lens === "edit" \? "editing" : "reading"/)
  assert.doesNotMatch(shell, /const \[contentIntent, setContentIntent\]/)
})
```

- [ ] **Step 6: Delete retired modules and update tests**

Delete `content-history.ts`, `content-history.test.ts`, `content-scope-persistence.ts`, and `content-scope-persistence.test.ts`. Update `goal-content-entry.test.ts` to assert focus transitions instead of content history. Update any test that imports `contentScopeStorageKey` / `readPersistedContentScope`.

- [ ] **Step 7: Run the focused tests**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test \
  src/renderer/mafw/content-scope-focus.test.ts \
  src/renderer/mafw/focus/legacy-migration.test.ts \
  src/renderer/mafw/goal-content-entry.test.ts \
  src/renderer/mafw/focus/focus-persistence.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A packages/desktop/src/renderer/mafw
git commit -m "refactor(workbench): derive content scope from focus"
```

---

### Task 7: Remove workbench storage and add picker landing

**Files:**
- Create: `packages/desktop/src/renderer/mafw/plugins/surface-id.ts`
- Modify: `packages/desktop/src/renderer/mafw/plugins/plugin-view-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/plugins/plugin-web-surface.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/IconRail.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PluginSurfaceStage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/FocusStage.tsx`
- Delete: `packages/desktop/src/renderer/mafw/workbench-context.ts`
- Delete: `packages/desktop/src/renderer/mafw/workbench-context.test.ts`
- Delete: `packages/desktop/src/renderer/mafw/workbench-views.ts`
- Delete: `packages/desktop/src/renderer/mafw/workbench-views.test.ts`
- Delete: `packages/desktop/src/renderer/mafw/workbench-focus.ts`
- Delete: `packages/desktop/src/renderer/mafw/workbench-focus.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Create: `packages/desktop/src/renderer/mafw/focus/landing.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/landing.test.ts` (new)
- Modify: `packages/desktop/src/renderer/mafw/focus/picker-model.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/picker-model.test.ts`
- Test: `packages/desktop/src/renderer/mafw/workbench-storage-cleanup.test.ts` (new)

**Interfaces:**
- Consumes: `WorldId`, `PickerItem`, `Scope`.
- Produces:

```ts
// focus/landing.ts
export function shouldAutoOpenPicker(input: {
  worldId: string | null
  focusCount: number
  pickerOpen: boolean
  rightDockOpen: boolean
  lastAutoPickerWorld: string | null
}): boolean

// focus/picker-model.ts
export function buildWorldPickerItem(worldId: WorldId): PickerItem
```

- [ ] **Step 1: Write the failing landing and picker tests**

Add to `focus/landing.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldAutoOpenPicker } from "./landing"

test("opens the picker once when a world has no focus", () => {
  const base = { worldId: "w1", focusCount: 0, pickerOpen: false, rightDockOpen: true, lastAutoPickerWorld: null }
  assert.equal(shouldAutoOpenPicker(base), true)
  assert.equal(shouldAutoOpenPicker({ ...base, lastAutoPickerWorld: "w1" }), false)
  assert.equal(shouldAutoOpenPicker({ ...base, focusCount: 1 }), false)
  assert.equal(shouldAutoOpenPicker({ ...base, rightDockOpen: false }), false)
})
```

Add to `picker-model.test.ts`:

```ts
test("world overview is a picker item", () => {
  const item = buildWorldPickerItem("C:/repo")
  assert.equal(item.kind, "world")
  assert.equal(item.label, "世界总览")
  assert.deepEqual(item.scope, { kind: "world", worldId: "C:/repo" })
  assert.deepEqual(item.subject, { kind: "world" })
  assert.equal(item.lens, "orient")
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test \
  src/renderer/mafw/focus/landing.test.ts \
  src/renderer/mafw/focus/picker-model.test.ts
```

Expected: FAIL because both helpers are missing.

- [ ] **Step 3: Implement landing and world picker item**

Create `focus/landing.ts` with the exact predicate. Add `"world"` to `PickerKind` and implement `buildWorldPickerItem` in `picker-model.ts`.

- [ ] **Step 3b: Move plugin surface ids and delete retired modules**

Create `plugins/surface-id.ts` with `PluginSurfaceId`, `pluginSurfaceId`, `parsePluginSurfaceId`, and `isPluginSurfaceId`, copied from `workbench-views.ts`. Update imports in `plugin-view-model.ts`, `plugin-web-surface.ts`, `IconRail.tsx`, `FocusStage.tsx`, `PluginSurfaceStage.tsx`, `MafwShell.tsx`, and `plugin-web-wiring.test.ts`.

Delete `workbench-context.ts`, `workbench-context.test.ts`, `workbench-views.ts`, `workbench-views.test.ts`, `workbench-focus.ts`, and `workbench-focus.test.ts`. The `WorkbenchFocusSnapshot` fields are reduced to the detent signal in Step 4.

- [ ] **Step 4: Wire landing and remove retired keys**

In `MafwShell.tsx`:

- Add `let lastAutoPickerWorld: string | null = null`.
- Add an effect. Guard on `lastFocusWorld === worldId` so the picker does not open before the persisted focus stack has loaded:
  ```ts
  createEffect(() => {
    const worldId = currentProject()
    if (!worldId || lastFocusWorld !== worldId) return
    if (!shouldAutoOpenPicker({
      worldId,
      focusCount: focusState().stack.length,
      pickerOpen: pickerOpen(),
      rightDockOpen: rightDockOpen(),
      lastAutoPickerWorld,
    })) return
    lastAutoPickerWorld = worldId
    setPickerOpen(true)
  })
  ```
- Prepend `buildWorldPickerItem(currentProject() ?? "unscoped")` to `pickerItems`.
- `pickSubject` handles `item.subject.kind === "world"` by `openWorldOverview()`.
- `focusBack` at root (stack length ≤1) clears focus and calls `showWorkbenchLanding()` instead of setting a legacy context.
- `validateFocusStack` when no valid focus remains calls `showWorkbenchLanding()`.
- On project switch reset `lastAutoPickerWorld = null` so the new world lands once.
- Remove `migrateWorkbenchStorage`, `clearLegacyWorkbenchKeys`, `bootWorkbench`, `bootView`, `persistedWorkbenchContext`, `normalizeWorkbenchContext`, `workbenchContext`, `workbenchSurface`, `previousSurface`, `applyWorkbenchContext`, `persistWorkbenchContext`, `applyWorkbenchSurface`, `applyWorkbenchSnapshot`, `currentWorkbenchSnapshot`, `WorkbenchFocusSnapshot`, and `workbench-focus` imports.
- Add a boot cleanup that removes the retired keys:
  ```ts
  for (const key of [
    "mafw-workbench-context",
    "mafw-workbench-surface",
    "mafw-execution-section",
    "mafw-workbench-view",
    "mafw-right-dock-tab",
    "mafw-workbench-tab",
    "mafw-tasks-placement",
  ]) {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
  }
  ```
- Replace the full-width snapshot with a single detent snapshot:
  ```ts
  let focusDetentSnapshot: WorkbenchDetent | null = null
  // enter: focusDetentSnapshot = detent()
  // exit: if (focusDetentSnapshot) applyDetent(focusDetentSnapshot)
  ```

- [ ] **Step 5: Write the storage cleanup test**

Create `workbench-storage-cleanup.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const shell = readFileSync(new URL("./MafwShell.tsx", import.meta.url), "utf8")

test("retired workbench keys are cleared and not read", () => {
  for (const key of [
    "mafw-workbench-context",
    "mafw-workbench-surface",
    "mafw-execution-section",
    "mafw-workbench-view",
  ]) {
    assert.match(shell, new RegExp(key))
  }
  assert.doesNotMatch(shell, /workbenchContext|applyWorkbenchContext|persistedWorkbenchContext|migrateWorkbenchStorage/)
})
```

- [ ] **Step 6: Run the focused tests**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test \
  src/renderer/mafw/focus/landing.test.ts \
  src/renderer/mafw/focus/picker-model.test.ts \
  src/renderer/mafw/workbench-storage-cleanup.test.ts \
  src/renderer/mafw/focus/focus-persistence.test.ts \
  src/renderer/mafw/plugin-web-wiring.test.ts \
  src/renderer/mafw/plugins/plugin-view-model.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A packages/desktop/src/renderer/mafw
git commit -m "refactor(workbench): land on the picker and drop legacy storage"
```

---

### Task 8: Invalidate the decision board over SSE

**Files:**
- Modify: `gateway/src/core/decision/decision-record.ts`
- Modify: `gateway/src/core/decision/decision-record-service.ts`
- Modify: `gateway/src/kernel.ts`
- Test: `gateway/tests/unit/decision-record-service.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`
- Test: `packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/src/renderer/mafw/decision-sse-wiring.test.ts` (new)

**Interfaces:**
- Consumes: `DecisionRecordService`, `broadcast`.
- Produces:

```ts
// decision-record.ts
export type DecisionRecordEvent = {
  action: 'drafted' | 'confirmed' | 'shelved' | 'reopened'
  projectDir: string
  goalId: string | null
  revision: number | null
  recordId: string
}

// decision-record-service.ts
export interface DecisionRecordServiceDeps {
  /* existing */
  notify?: (event: DecisionRecordEvent) => void
}
```

- [ ] **Step 1: Write the failing gateway test**

Add to `decision-record-service.test.ts`:

```ts
test("writes notify the decision event stream", () => {
  const { root, cleanup } = setup()
  try {
    const notify = jest.fn()
    const service = new DecisionRecordService({
      mafwDir: () => root,
      now: () => new Date(2026, 10, 12, 0, 0, 0).toISOString(),
      id: () => 'dec_notify',
      notify,
    })
    const record = service.draft({ projectDir: 'C:/repo', goalId: 'g1', revision: 1, kind: 'plan', question: 'Q' } as any)
    expect(notify).toHaveBeenLastCalledWith({
      action: 'drafted', projectDir: 'C:/repo', goalId: 'g1', revision: 1, recordId: record.id,
    })
    service.confirm(record.id, { projectDir: 'C:/repo', rationale: 'R', consequences: 'C' })
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'confirmed', recordId: record.id }))
  } finally {
    cleanup()
  }
})
```

- [ ] **Step 2: Run the gateway test to verify it fails**

```bash
cd gateway
npx jest --runInBand tests/unit/decision-record-service.test.ts
```

Expected: FAIL because `notify` is not called.

- [ ] **Step 3: Emit from the service**

Add `notify?: (event: DecisionRecordEvent) => void` to `DecisionRecordServiceDeps`. Add a private `emit(action, record)` that calls `this.deps.notify?.({ action, projectDir: record.projectDir, goalId: record.goalId, revision: record.revision, recordId: record.id })`. Call it after each successful `write` in `draft`, `confirm`, `shelve`, and `reopen`.

In `kernel.ts`, construct the service with:

```ts
this.decisionRecords = new DecisionRecordService({
  mafwDir: (projectDir) => findMafwDirForProject(this.registeredProjects, projectDir, canonicalProjectDir),
  warn: (message) => log.warn(message),
  notify: (event) => this.broadcast({ type: 'decision.updated', properties: event }),
});
```

- [ ] **Step 4: Route the event in the desktop dispatcher**

Add to `ShellEventDeps`:

```ts
decisions: { onEvent(event: unknown): void }
```

In `dispatchShellEvent`, before the `sid` dispatch:

```ts
if (event.type === "decision.updated") {
  deps.core.trace(event, "decisions:updated")
  deps.decisions.onEvent(event)
  return
}
```

Add a `makeDeps` entry and a test in `dispatcher.test.ts`:

```ts
test("decision.updated reaches the decision store", () => {
  const { deps, decisionEvents, calls } = makeDeps()
  const event = { type: "decision.updated", properties: { action: "drafted", projectDir: "C:/repo", recordId: "dec_1" } }
  dispatchShellEvent(event, deps)
  expect(decisionEvents).toEqual([event])
  expect(calls.some(c => c.name === "trace" && c.args[1] === "decisions:updated")).toBe(true)
})
```

- [ ] **Step 5: Wire the desktop refresh**

In `MafwShell.tsx`:

- Keep the existing project/Pod-triggered `decisionStore.refresh()` effect.
- Delete the 15s `setInterval` fallback.
- Add:
  ```ts
  let decisionRefreshTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleDecisionRefresh = () => {
    if (decisionRefreshTimer) return
    decisionRefreshTimer = setTimeout(() => {
      decisionRefreshTimer = null
      void decisionStore.refresh()
    }, 200)
  }
  onCleanup(() => {
    if (decisionRefreshTimer) clearTimeout(decisionRefreshTimer)
  })
  ```
- Pass `decisions: { onEvent: scheduleDecisionRefresh }` in `sseDeps`.

- [ ] **Step 6: Write the desktop wiring test**

Create `decision-sse-wiring.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")
const shell = read("MafwShell.tsx")
const dispatcher = read("sse/dispatcher.ts")

test("decision updates refresh the board without polling", () => {
  assert.match(dispatcher, /decision\.updated/)
  assert.match(shell, /scheduleDecisionRefresh/)
  assert.match(shell, /decisions: \{ onEvent: scheduleDecisionRefresh \}/)
  assert.doesNotMatch(shell, /setInterval\(\(\) => \{ void decisionStore\.refresh\(\) \}, 15000\)/)
})
```

- [ ] **Step 7: Run the focused tests**

```bash
cd gateway
npx jest --runInBand tests/unit/decision-record-service.test.ts

cd ../packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test \
  src/renderer/mafw/sse/dispatcher.test.ts \
  src/renderer/mafw/decision-sse-wiring.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add gateway/src/core/decision/decision-record.ts \
  gateway/src/core/decision/decision-record-service.ts \
  gateway/src/kernel.ts \
  gateway/tests/unit/decision-record-service.test.ts \
  packages/desktop/src/renderer/mafw/sse/dispatcher.ts \
  packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts \
  packages/desktop/src/renderer/mafw/MafwShell.tsx \
  packages/desktop/src/renderer/mafw/decision-sse-wiring.test.ts
git commit -m "feat(decisions): invalidate the board over SSE"
```

---

### Task 9: Batch-render decision records

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/focus/decision-model.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/decision-model.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/DecisionBoard.tsx`
- Modify: `packages/desktop/src/renderer/mafw/decision-board.css`
- Test: `packages/desktop/src/renderer/mafw/decision-board-wiring.test.ts` (new)

**Interfaces:**
- Consumes: `DecisionItem`, `DecisionBoardView`.
- Produces:

```ts
export const DECISION_PAGE_SIZE = 25

export function visibleDecisionItems(
  items: readonly DecisionItem[],
  limit: number,
): readonly DecisionItem[]

export function decisionLimitToInclude(
  items: readonly DecisionItem[],
  itemId: string,
  page?: number,
): number
```

- [ ] **Step 1: Write the failing pure tests**

Add to `focus/decision-model.test.ts`:

```ts
test("visibleDecisionItems caps a group and keeps the remainder countable", () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ id: `d${i}` } as any))
  assert.equal(visibleDecisionItems(items, 25).length, 25)
  assert.equal(visibleDecisionItems(items, 0).length, 0)
  assert.equal(visibleDecisionItems(items, 100).length, 60)
})

test("decisionLimitToInclude expands to the focused record", () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ id: `d${i}` } as any))
  assert.equal(decisionLimitToInclude(items, "d40"), 50)
  assert.equal(decisionLimitToInclude(items, "missing"), 25)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/decision-model.test.ts
```

Expected: FAIL because the helpers are missing.

- [ ] **Step 3: Implement the batch helpers**

Add `DECISION_PAGE_SIZE = 25`, `visibleDecisionItems` (`items.slice(0, Math.max(0, limit))`), and `decisionLimitToInclude` (return `page` when missing; otherwise `Math.ceil((index + 1) / page) * page`).

- [ ] **Step 4: Use batches in `DecisionBoard`**

- Add `const page = DECISION_PAGE_SIZE`.
- Add `const [limits, setLimits] = createSignal<Record<DecisionStatus, number>>({ needs_you: page, pending: page, decided: page, shelved: page })`.
- For each group, render `visibleDecisionItems(group.items, limits()[group.status])`.
- Add a `ButtonV2` after the list when `group.items.length > shown.length`: label `显示更多（剩余 N）`, onClick bumps that group's limit by `page`.
- In the `focusRecord` effect, find the group containing the record id and set its limit to `decisionLimitToInclude(group.items, focus.id)` before setting `expandedRecordId`.
- Keep the counts showing the full totals.

- [ ] **Step 5: Write the wiring test**

Create `decision-board-wiring.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const board = readFileSync(new URL("./components/DecisionBoard.tsx", import.meta.url), "utf8")

test("DecisionBoard renders records in batches", () => {
  assert.match(board, /DECISION_PAGE_SIZE/)
  assert.match(board, /visibleDecisionItems/)
  assert.match(board, /decisionLimitToInclude/)
  assert.match(board, /显示更多/)
})
```

- [ ] **Step 6: Add CSS**

Add `.mafw-decision-more` with token-only colors, `align-self: flex-start`, and `margin-top: 6px`.

- [ ] **Step 7: Run the focused tests**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test \
  src/renderer/mafw/focus/decision-model.test.ts \
  src/renderer/mafw/decision-board-wiring.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/renderer/mafw/focus/decision-model.ts \
  packages/desktop/src/renderer/mafw/focus/decision-model.test.ts \
  packages/desktop/src/renderer/mafw/components/DecisionBoard.tsx \
  packages/desktop/src/renderer/mafw/decision-board.css \
  packages/desktop/src/renderer/mafw/decision-board-wiring.test.ts
git commit -m "perf(decisions): batch-render decision records"
```

---

### Task 10: Regression, live smoke, and delivery record

**Files:**
- Create: `docs/releases/2026-11-12-workbench-world-overview-cleanup.md`
- Modify: `docs/architecture/desktop.md`

- [ ] **Step 1: Run the focused desktop suites**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test \
  src/renderer/mafw/focus/focus-model.test.ts \
  src/renderer/mafw/focus/focus-persistence.test.ts \
  src/renderer/mafw/focus/landing.test.ts \
  src/renderer/mafw/focus/picker-model.test.ts \
  src/renderer/mafw/focus/decision-model.test.ts \
  src/renderer/mafw/focus/legacy-migration.test.ts \
  src/renderer/mafw/world-overview-wiring.test.ts \
  src/renderer/mafw/workbench-shell-focus.test.ts \
  src/renderer/mafw/execution-drawer-removal.test.ts \
  src/renderer/mafw/content-scope-focus.test.ts \
  src/renderer/mafw/decision-sse-wiring.test.ts \
  src/renderer/mafw/decision-board-wiring.test.ts \
  src/renderer/mafw/plugin-web-wiring.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run the focused gateway suite**

```bash
cd gateway
npx jest --runInBand tests/unit/decision-record-service.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full regression**

```bash
cd packages/desktop
npm test

cd ../../gateway
npm test -- --forceExit
```

Expected: 0 failures. Record the desktop and gateway totals; they include Plan 5 additions plus any external commits that landed meanwhile. Do not attribute external commits to Plan 5.

- [ ] **Step 4: Run type gates and builds**

```bash
cd packages/desktop
npx tsgo --noEmit -p tsconfig.json
node ../../node_modules/electron-vite/bin/electron-vite.js build

cd ../../gateway
npx tsc --noEmit -p tsconfig.json
npm run build
```

Expected: all `rc=0`.

- [ ] **Step 5: Live smoke test**

Verify in the desktop app:

1. Start with no focus: the picker opens once; closing it leaves the empty "选择一个对象" state, not the old project dashboard.
2. Open `世界总览` from the picker: New Goal, standing, team, all Goals, continue / needs you are present; no files/recents cards.
3. Open a Goal from the world overview: frame shows world / Goal; back returns to the world overview; closing at root returns to the picker.
4. Open a file from the picker: frame shows world / file; back returns to the previous subject; editor scroll/selection survives a lens switch.
5. Verify there is no split button anywhere and no execution drawer; background runs open inline above the composer; usage opens Config > Usage.
6. Draft a decision from an Episode, confirm it in the board; verify the board updates without waiting 15s.
7. With more than 25 records in a group, verify `显示更多` renders the next batch and Episode「查看决定记录」 expands a record beyond the first page.
8. Reload: the focus stack, closed Episodes, decision board, file drafts, scroll and selection restore.

- [ ] **Step 6: Write the release record**

Create `docs/releases/2026-11-12-workbench-world-overview-cleanup.md` with:

- Base commit (the commit before Task 1), delivery HEAD, Plan 5 commit list.
- Scope: world overview subject, focus-only shell, split removal, execution drawer removal, decision SSE, decision batching.
- Explicit note: split view was cancelled by user decision on 2026-11-12; spec §12.8 / §15.11 superseded.
- New test count and full suite totals.
- Deferred minors (e.g. plugin config pages stay in Config; plugin web page cache mounts only visited pages; any residual legacy keys).
- External commits landed during the plan, explicitly excluded.

- [ ] **Step 7: Update `docs/architecture/desktop.md`**

Replace the Plan 4 bullet tail with a Plan 5 bullet:

- Workbench is focus-only; `WorkbenchContext` and the four-context shell are gone.
- World overview is a fallback subject; no focus opens the picker.
- Split view removed.
- Execution status lives in the frame / Goal overview; no execution drawer.
- Decision SSE (`decision.updated`) invalidates the board; records render in batches.

- [ ] **Step 8: Commit**

```bash
git add docs/releases/2026-11-12-workbench-world-overview-cleanup.md docs/architecture/desktop.md
git commit -m "docs: record world overview and workbench cleanup"
```

---

## Self-Review

- **Spec coverage:** World overview subject (§9.1, §12.1, §13), picker landing (§12.1, §15.1), execution drawer removal (§12.7, §14.5, §15.9), legacy cleanup (§13, §14.9), decision SSE / record virtualization (Plan 4 deferred items). Split view is explicitly cancelled by user decision.
- **Step scan:** Each task has a failing test, a run step, a concrete implementation step, a passing run, and a commit. No TBD or "handle edge cases" steps.
- **Type consistency:** `PluginSurfaceId` moved once and used by `PluginSurfaceStage`, `plugin-view-model`, `plugin-web-surface`, `IconRail`, and `MafwShell`. `DecisionRecordEvent` is defined once in the gateway and consumed by the kernel and desktop dispatcher. `WorldTeamProps` is the single team prop shape.
- **Review Focus:** Each line maps to a task test: landing (Task 7), restart restore (Tasks 6–7), world overview (Task 2), legacy upgrade (Tasks 6–7), decision board (Tasks 8–9).
- **Proportion:** Tasks specify signatures, test names/assertions, and only the algorithms that are not obvious; no full component bodies.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-12-workbench-world-overview-cleanup.md`.

**Recommended execution:** Subagent-driven. The plan has several sequential refactors that move shared types (`PluginSurfaceId`, `WorkbenchShell` props, `DecisionRecordEvent`), so an independent reviewer per task is worth the context cost.

Please review the plan and choose an execution method before implementation:
- **Subagent-driven** — fresh implementer + reviewer per task, whole-branch review at the end.
- **Native** — implement every task in this session, then one fresh branch review.
