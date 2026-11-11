# Project Agent Workbench — Shell IA (Plan D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把右工作台从「工作 / 工作台 / 执行 / 审阅」四个平级工具 Tab，改成以项目、Goal、内容、审阅为上下文的单一工作台面，让 Chat 与右侧内容成为同一条工作闭环。

**Architecture:** 引入 `WorkbenchContext = "project" | "goal" | "content" | "review"`，替换现有 `WorkbenchView`。右侧只保留一个上下文头：项目 / 当前 Goal / 内容作用域 / 审阅；`文件 / 浏览器 / 终端 / 插件` 仍是内容上下文内的二级 surface；执行详情改为可开合的抽屉，不再是一级目的地。现有 `ProjectWorkView`、`GoalDetailPanel`、`WorkbenchCodeView`、`ChangesDock`、`ExecutionView` 全部复用，只重新归位和补上下文头。

**Tech Stack:** Electron + SolidJS + `@mafw/ui/v2`；现有 `window.api` / content scope / terminal / plugin surfaces；`node --test` + `@mafw/test-shim`；TypeScript。

**Spec:** `docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md` §5.1–§5.3、§6.1–§6.5、§8.2、§10

## Global Constraints

- 这不是换皮：`工作 / 工作台 / 执行 / 审阅` 不再作为四个平级一级目的地；能力按当前上下文重新归位。
- Chat 与右侧内容互不销毁。打开 Goal、文件、审阅、Focus、窄窗切换都不能丢 Chat、Goal、文件树、草稿或终端状态。
- 项目是默认上下文。Goal 是受管执行上下文；Goal 上下文只显示当前 Goal，不要求用户先理解 Pod/Phase/Loop。
- 文件树、内容面、Tab 三者职责分离：普通打开不创建持久 Tab；只有显式保持/分屏/直接修改现场才进入并行工作 Tab。
- 执行详情默认隐藏；`概览 / 待办 / 子代理 / 后台 / 轨迹 / 团队` 进入可开合抽屉，不再占一级导航。
- 审阅只是当前 Goal 结果或当前会话变更的上下文，不是独立工作空间。
- 保持人类专属验收、PASS 不自动合并、worktree revision 隔离、评审项状态权责不变。
- 不新增裸 `<button>` / `<input>` / 裸 `title`；使用 `@mafw/ui/v2`、`TooltipV2`（`openDelay: 300`）与现有主题 token。
- 不新增硬编码色值；新样式使用 `mafw.css` 现有 token。
- 每个任务先写失败测试、确认 RED、再实现 GREEN、最后提交；提交只包含该任务文件。

## Review Focus

1. **Goal 打开的返回路径**：从项目首页、Triage、托盘、attention 打开 Goal 后，返回必须回到原来的项目上下文；不能把 Chat 切走或丢失文件/草稿。
2. **内容与 Goal 的切换**：从 Goal 结果打开本版文件、再返回 Goal，文件树/编辑器/终端与 Goal 结果都不能被销毁或重置。
3. **审阅入口**：Chat 的 diff 入口、编辑器批注反馈、Goal 结果的评审项都必须落到同一个审阅/Goal 上下文，不能出现第四个“审阅空间”。
4. **执行抽屉**：打开/关闭执行抽屉不改变当前项目/Goal/内容上下文；刷新或项目切换后不留下幽灵抽屉。
5. **焦点与窄窗**：Focus 快照必须恢复上下文 + surface + 抽屉状态；窄窗只切换 Chat/工作台可见性，不改变逻辑上下文。
6. **旧状态迁移**：旧 `mafw-workbench-view=work/workbench/execution/review` 必须映射到新上下文；旧 `execution` 不产生幽灵抽屉。
7. **插件 surface**：插件 rail/tab 只在内容上下文存在；插件被删除时回退到文件 surface，不改变上下文。

---

### Task 1: Context model and legacy migration

**Files:**
- Create: `packages/desktop/src/renderer/mafw/workbench-context.ts`
- Test: `packages/desktop/src/renderer/mafw/workbench-context.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type WorkbenchContext = "project" | "goal" | "content" | "review"
  export const WORKBENCH_CONTEXTS: readonly WorkbenchContext[]
  export function normalizeWorkbenchContext(value: string | null | undefined): WorkbenchContext
  export function workbenchContextFromLegacyView(value: string | null | undefined): WorkbenchContext
  export function persistedWorkbenchContext(value: WorkbenchContext): Exclude<WorkbenchContext, "goal">
  ```
- `normalizeWorkbenchContext` accepts only the four values; unknown → `"project"`.
- Legacy mapping: `work → project`, `workbench → content`, `execution → project`, `review → review`, unknown → `project`.
- `persistedWorkbenchContext("goal") === "project"`; other values unchanged.

- [x] **Step 1: Write the failing test**

```ts
test("normalizes only the four contexts", () => {
  assert.equal(normalizeWorkbenchContext("goal"), "goal");
  assert.equal(normalizeWorkbenchContext("execution"), "project");
  assert.equal(normalizeWorkbenchContext("nope"), "project");
});

test("maps every legacy B1 view", () => {
  assert.equal(workbenchContextFromLegacyView("work"), "project");
  assert.equal(workbenchContextFromLegacyView("workbench"), "content");
  assert.equal(workbenchContextFromLegacyView("execution"), "project");
  assert.equal(workbenchContextFromLegacyView("review"), "review");
});

test("goal context is transient and persists as project", () => {
  assert.equal(persistedWorkbenchContext("goal"), "project");
  assert.equal(persistedWorkbenchContext("content"), "content");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-context.test.ts`
Expected: FAIL because `workbench-context.ts` does not exist.

- [x] **Step 3: Implement `workbench-context.ts`**

Use `WORKBENCH_CONTEXTS = ["project", "goal", "content", "review"] as const`, a Set for normalization, and a legacy map.

- [x] **Step 4: Run test to verify it passes**

Run the same command; expected PASS.

- [x] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/workbench-context.ts packages/desktop/src/renderer/mafw/workbench-context.test.ts
git commit -m "feat(desktop): add workbench context model"
```

---

### Task 2: Focus snapshot carries context and execution drawer

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/workbench-focus.ts`
- Modify: `packages/desktop/src/renderer/mafw/workbench-focus.test.ts`

**Interfaces:**
- `WorkbenchFocusSnapshot` becomes:
  ```ts
  type WorkbenchFocusSnapshot = {
    detent: WorkbenchDetent
    context: WorkbenchContext
    surface: WorkbenchSurface
    previousSurface: "code" | "browser"
    executionOpen: boolean
    executionSection: ExecutionSection
  }
  ```
- `captureWorkbenchFocusSnapshot` / `restoreWorkbenchFocusSnapshot` unchanged in behavior.

- [x] **Step 1: Rewrite the focus test fixture with `context` and `executionOpen` and assert a full round-trip.**
- [x] **Step 2: Run test to verify RED** (`workbench-focus.test.ts`).
- [x] **Step 3: Update the type and capture/restore implementation.**
- [x] **Step 4: Run test to verify GREEN.**
- [x] **Step 5: Commit** `feat(desktop): include context and execution drawer in focus snapshot`.

---

### Task 3: MafwShell context state and open paths

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/workbench-views.ts`
- Test: `packages/desktop/src/renderer/mafw/workbench-context-wiring.test.ts`

**Interfaces:**
- Replace `workbenchView` with `workbenchContext` (`Signal<WorkbenchContext>`).
- New state `executionOpen: Signal<boolean>` (default `false`).
- `applyWorkbenchContext(context: WorkbenchContext): void` persists `mafw-workbench-context` with `persistedWorkbenchContext`.
- `openWorkbenchContext(context, opts?: { surface?: WorkbenchSurface; executionSection?: ExecutionSection })` opens dock and narrow workbench.
- `applyWorkbenchSurface(surface)` sets context `content` and persists surface.
- `applyExecutionSection(section)` sets `executionOpen=true`, does **not** change context.
- `openGoalDetail(goalId, focus)` sets `podGoalId` + context `goal`.
- `onCloseGoal` returns context `project`.
- `openGoalContent` sets context `content` after worktree validation.
- `openWorkbench("review")` becomes `openWorkbenchContext("review")`.
- Remove `workbenchView` from `WorkbenchState`; add `context`.

- [x] **Step 1: Write source-contract tests**

Assert `MafwShell.tsx` contains `workbenchContext`, `openWorkbenchContext`, `executionOpen`, and no `WORKBENCH_VIEWS` / `applyWorkbenchView("work")`.

- [x] **Step 2: Run test to verify RED.**
- [x] **Step 3: Refactor state and all call sites.**

Specific call-site changes:
- `openProjectWork()` → `openWorkbenchContext("project")` + `setActiveTab("chat")`.
- `openGoalDetail()` → `openWorkbenchContext("goal")`, keep `podGoalId`.
- `openWorkbenchSurface()` → context `content`.
- `openPodPanelTab()` / `openExecutionUsage()` / background / todos → `applyExecutionSection()` (drawer).
- `openPluginSurface()` → context `content` + surface.
- `openWorkbench("review")` → context `review`.
- Ctrl+`` → context `content` + terminal surface.
- Deep link/legacy `goals` → project context.

- [x] **Step 4: Update `workbench-views.ts`**

Remove `WorkbenchView`, `WORKBENCH_VIEWS`, `nextWorkbenchView`. Keep `WorkbenchSurface`, `ExecutionSection`, migrations. `WorkbenchState` = `{ context, surface, executionSection }`. `migrateWorkbenchStorage` maps old view via `workbenchContextFromLegacyView`.

- [x] **Step 5: Run focused tests and commit** `refactor(desktop): switch right workbench to context state`.

---

### Task 4: WorkbenchShell context header and panes

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Test: `packages/desktop/tests/workbench-shell-wiring.test.ts`
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Props replace `view`/`onView` with:
  ```ts
  context: WorkbenchContext
  onContext: (context: WorkbenchContext) => void
  contextLabel: string
  onBackToProject: () => void
  executionOpen: boolean
  onExecutionOpen: (open: boolean) => void
  ```
- Header `.mafw-rw-head`:
  - Context label (`项目` / Goal 标题 / 内容作用域 / `变更审阅`).
  - `项目` button when not project.
  - `执行` button (opens drawer) and Focus button.
- No L1 `role="tablist"` / `.mafw-rw-tabs`.
- Panes: project (workView), goal (goalView), content (WorkbenchCodeView), review (reviewView). All mounted; `.is-active` switches.
- L2 `文件 / 浏览器 / 终端 + 插件` only when `context === "content"`.
- `ContentScopeHeader` only when content.
- Execution drawer rendered when `executionOpen`, with section dropdown and close button.

- [x] **Step 1: Update the wiring test to require `.mafw-rw-head`, `context`, `executionOpen`, `onExecutionOpen`, and to forbid `WORKBENCH_VIEWS` / `.mafw-rw-tabs`.**
- [x] **Step 2: Run test to verify RED.**
- [x] **Step 3: Implement header, panes, conditional L2/ContentScopeHeader, drawer shell.**
- [x] **Step 4: Run focused tests and commit** `refactor(desktop): replace right dock L1 tabs with context header`.

---

### Task 5: Project and Goal contexts

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/tests/project-work-view.test.ts`
- Test: `packages/desktop/tests/goal-detail-inline.test.ts`

**Interfaces:**
- `ProjectWorkView` no longer owns inline Goal detail; remove `selectedGoalId`, `detailFocus`, `onCloseGoal`, `onOpenGoalWorktree`.
- `ProjectWorkView` still owns priority list, full Goal list, standing goals, composer, and `onOpenGoal(goal, focus)`.
- New `goalView` JSX in `MafwShell`: `<GoalDetailPanel goalId={podGoalId()} podId={podIdForCurrentProject()} ... onClose={() => setPodGoalId(null); applyWorkbenchContext("project")} />`.
- `openGoalDetail` sets context goal; `onGoalAccepted` still returns Chat to Lead.

- [x] **Step 1: Update tests to assert project view has no inline Goal detail and shell passes a `goalView`.**
- [x] **Step 2: Run RED.**
- [x] **Step 3: Remove inline detail logic from ProjectWorkView; add goal pane wiring.**
- [x] **Step 4: Update focus restore to return to the project list (no old row focus assumptions).**
- [x] **Step 5: Run focused tests and commit** `refactor(desktop): separate project home and goal context`.

---

### Task 6: Content context and review context

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Test: `packages/desktop/tests/workbench-browser-wiring.test.ts`
- Test: `packages/desktop/tests/terminal-scoping.test.ts`
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Content context owns `WorkbenchCodeView`, `ContentScopeHeader`, L2 surfaces, terminal active state, plugin tabs.
- Review context owns `ChangesDock`; Chat diff command, editor annotation feedback, and `onOpenReview` switch to `review`.
- Goal review items remain inside `GoalDetailPanel`/`PodResultView`, not a separate context.

- [x] **Step 1: Update source tests to pin `context === "content"` for L2/terminal/ContentScopeHeader and `context === "review"` for ChangesDock.**
- [x] **Step 2: Run RED.**
- [x] **Step 3: Move wiring accordingly; keep all panes mounted.**
- [x] **Step 4: Run content/review focused tests and commit** `refactor(desktop): rehome content and review surfaces`.

---

### Task 7: Execution drawer

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/ExecutionDrawer.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Test: `packages/desktop/tests/execution-view-wiring.test.ts`
- Test: `packages/desktop/tests/pod-panel-wiring.test.ts`

**Interfaces:**
- `ExecutionDrawer` props: `{ open, section, onSection, onClose, children }`.
- Header: `执行` label + `DropdownMenu` of `EXECUTION_SECTIONS` + close button.
- `openExecutionSection(section)` sets `executionOpen=true` and section, preserving context.
- `PodDock` remains an execution section; LeftDock/Pod/usage/background/todos all open the drawer.

- [x] **Step 1: Write a source test for `ExecutionDrawer` and for openers not changing context.**
- [x] **Step 2: Run RED.**
- [x] **Step 3: Implement drawer and wire openers.**
- [x] **Step 4: Run focused tests and commit** `feat(desktop): move execution details into a drawer`.

---

### Task 8: Focus, narrowing, persistence, CSS, and full gates

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/tests/design-contract.test.ts`
- Test: `packages/desktop/tests/workbench-shell-css.test.ts`
- Test: `packages/desktop/tests/workbench-layout-css.test.ts`

**Interfaces:**
- Focus snapshot captures/restores `context`, `surface`, `executionOpen`, `executionSection`.
- Closing dock restores focus snapshot; project switch exits focus and clears goal/execution drawer.
- New CSS: `.mafw-rw-head`, `.mafw-rw-context`, `.mafw-rw-actions`, `.mafw-rw-exec-drawer`, `.mafw-rw-exec-head`; remove dead `.mafw-rw-l1` / `.mafw-rw-tabs` / `.mafw-rw-tab`.
- Narrow switch still only toggles Chat/Workbench visibility.

- [x] **Step 1: Update CSS/design-contract tests for the new header and drawer; forbid L1 tabs.**
- [x] **Step 2: Run RED.**
- [x] **Step 3: Implement CSS and focus/restore changes.**
- [x] **Step 4: Run full desktop tests**

Run: `npm test` (desktop). Expected: 0 failures.

- [x] **Step 5: Type/build gates**

Run: `npx tsgo --noEmit -p tsconfig.json`, then `node ../../node_modules/electron-vite/bin/electron-vite.js build`. Expected rc=0.

- [x] **Step 6: Commit** `refactor(desktop): finish right workbench shell ia`.

---

## Self-review notes

- Spec §5.1: four L1 destinations removed; Chat + content workbench become the main pair.
- §5.2: project context still exposes project work, attention, new Goal, standing goals; Lead chat remains the Chat column.
- §5.3: content context keeps file tree + intent surfaces; L2 tabs remain explicit content surfaces.
- §6.1–6.5: Goal opens as a context, Chat stays; execution details move behind a drawer.
- §7: content scope/return/history from Plan B are preserved; this plan changes the container, not the scope model.
- §8.2: Goal detail remains the existing inline panel, now a context pane; stage Tab removal can follow in D2.
- D2/D3 still needed for project homepage polish, Pod-as-project-attribute, content intent modes, and Goal detail attention order. This plan deliberately stops at the shell IA so it can ship and be reviewed.
