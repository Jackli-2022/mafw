# Project Agent Workbench — Project Home (Plan D2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让“项目”上下文成为真正的项目首页：直接看到项目文件、最近内容和团队，而不是只有 Goal 工作列表；同时把 Pod 从平行工作区降为项目属性。

**Architecture:** `ProjectWorkView` 仍是项目首页容器，但组合三个新组件：`ProjectTeamStrip`（Lead / Tech Lead / 团队 / 邮箱 / 记忆）、`ProjectFilesCard`（复用 `FilesDock`，项目根 scope）、`RecentContentList`（按项目持久化的最近打开文件）。左栏删除 `pod` face，图标轨的 Pod 目的地改成“团队”快捷入口，点击打开项目首页并定位团队条；`PodDock` 仍留在执行抽屉。两棵文件树可能同时挂载，`FilesDock` 的目录监听改走引用计数池，避免一方卸载误关另一方的 watcher。

**Tech Stack:** Electron + SolidJS + `@mafw/ui/v2`；现有 `contentScope` / `contentScopeState` / `podStore`；`node --test` + `@mafw/test-shim`；TypeScript。

**Spec:** `docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md` §5.1、§5.2、§5.3、§6.1、§7.5、§8.1

## Global Constraints

- 项目首页不是执行 Dashboard：工作与注意力优先，文件和最近内容直接可达但不抢占主视觉。
- Pod 不再是平行工作空间；团队状态与成员入口是项目属性。执行抽屉里的 `PodDock` 保留。
- 文件树、内容面、Tab 三者职责不变；项目首页只提供项目主目录的浏览入口，不创建持久 Tab。
- 从项目首页打开文件必须落到项目主目录 scope；不能沿用当前 Goal revision scope。
- 两棵文件树同时存在时，目录 watcher 必须引用计数；任何一方卸载不能关闭另一方的监听。
- 最近内容按项目持久化；只展示项目主目录条目，Goal revision 最近项留给 D3。
- 不新增裸 `<button>` / `<input>` / 裸 `title`；使用 `@mafw/ui/v2`、`TooltipV2`（`openDelay: 300`）与现有 token。
- 每个任务先写失败测试、确认 RED、再实现 GREEN、最后提交；提交只包含该任务文件。

## Review Focus

1. **项目首页打开文件**：当前内容 scope 是 Goal revision 时，从项目首页点文件必须回到项目根，并保留 Chat/Goal 状态。
2. **双文件树 watcher**：项目首页树与内容树同时挂载，任一方收起/切 surface/卸载都不能让另一方停止刷新。
3. **最近内容**：刷新/切项目后仍按项目恢复；同文件重复打开只保留一条并置顶；文件在 scope 内不存在时点击要有可理解的失败。
4. **团队入口**：左栏不再有 Pod face；点击图标轨“团队”打开项目首页并定位团队条，不切走 Chat 会话；Lead/Tech Lead/团队/邮箱/记忆入口仍可用。
5. **空状态**：无 Pod / worktree / gateway 不支持时，团队条给出可行动的空状态而不是空白。
6. **窄容器**：项目首页文件/最近内容两列在容器变窄时堆叠，不出现横向溢出。

---

### Task 1: Recent content model and per-project persistence

**Files:**
- Create: `packages/desktop/src/renderer/mafw/recent-content.ts`
- Test: `packages/desktop/src/renderer/mafw/recent-content.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RecentContentEntry = {
    rel: string
    scopeKey: string
    scopeKind: "project" | "goal"
    scopeLabel: string
    at: number
  }
  export const MAX_RECENT_CONTENT = 8
  export function pushRecentContent(
    list: readonly RecentContentEntry[],
    entry: RecentContentEntry,
    max?: number,
  ): RecentContentEntry[]
  export function parseRecentContent(raw: string | null): RecentContentEntry[]
  export function recentContentStorageKey(projectDir: string): string
  export function readRecentContent(
    projectDir: string | null | undefined,
    storage: RecentContentStorage,
  ): RecentContentEntry[]
  export function recordRecentContent(
    projectDir: string | null | undefined,
    entry: RecentContentEntry,
    storage: RecentContentStorage,
  ): RecentContentEntry[]
  export function splitRelPath(rel: string): { dir: string; name: string }
  ```
- `pushRecentContent`: dedupe by `scopeKey + "\0" + rel`; newest entry first; cap at `max ?? MAX_RECENT_CONTENT`.
- `parseRecentContent`: invalid JSON / non-array / invalid entries → `[]`; drop entries missing string fields or finite `at`.
- Key: `mafw-recent-content:<normalized projectDir>` with backslashes → `/`, trailing slashes removed, lowercased.
- `recordRecentContent` reads current list, pushes, writes JSON, returns the new list.

- [x] **Step 1: Write the failing test**

Cover: dedupe/order/cap; invalid parse; per-project key normalization; record round-trip; `splitRelPath("src/a/b.ts")` → `{ dir: "src/a", name: "b.ts" }` and `"README.md"` → `{ dir: "", name: "README.md" }`.

- [x] **Step 2: Run test to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/recent-content.test.ts`
Expected: FAIL because `recent-content.ts` does not exist.

- [x] **Step 3: Implement `recent-content.ts`**

Pure functions plus a `RecentContentStorage = { getItem; setItem }` adapter. Never throw on storage or JSON errors.

- [x] **Step 4: Run test to verify it passes**

Same command; expected PASS.

- [x] **Step 5: Commit** `feat(desktop): add recent content model`

---

### Task 2: Shared directory watch pool for concurrent file trees

**Files:**
- Create: `packages/desktop/src/renderer/mafw/dir-watch-pool.ts`
- Test: `packages/desktop/src/renderer/mafw/dir-watch-pool.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/FilesDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/files-dock-scope.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DirWatchApi = {
    watchDir(root: string, rel: string): void
    unwatchDir(root: string, rel: string): void
  }
  export type DirWatchPool = {
    acquire(root: string, rel: string): () => void
    countFor(root: string, rel: string): number
  }
  export function createDirWatchPool(api: DirWatchApi): DirWatchPool
  export function acquireDirWatch(root: string, rel: string): () => void
  ```
- `acquire` on first holder calls `watchDir`; nested holders don't. Release decrements; last release calls `unwatchDir`. Release is idempotent per returned function. Re-acquire after zero watches again.
- Key normalizes backslashes to `/` for root and rel.
- `acquireDirWatch` lazily resolves `window.api.fs`; if unavailable it returns a no-op release.

- [x] **Step 1: Write the failing pool test**

Fake API records calls: two acquires → one watch; one release → no unwatch; last release → one unwatch; double release → still one; re-acquire → second watch; different roots separate counts.

- [x] **Step 2: Run RED** on `dir-watch-pool.test.ts`.

- [x] **Step 3: Implement `dir-watch-pool.ts`.**

- [x] **Step 4: Update `FilesDock` to use the pool**

Replace `watched: Map<rel, root>` with `Map<rel, { root, release }>`; every `window.api.fs.watchDir?.(root, rel)` becomes `acquireDirWatch(root, rel)`; every `unwatchDir` becomes `release()`. Keep the existing watch planning / refresh behavior unchanged.

- [x] **Step 5: Update `files-dock-scope.test.ts`**

Pin `acquireDirWatch` usage and forbid direct `window.api.fs.watchDir?.` / `unwatchDir?.` calls in `FilesDock`.

- [x] **Step 6: Run focused tests and commit** `fix(desktop): share directory watches across file trees`

---

### Task 3: Project home files and recent content

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/ProjectFilesCard.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/RecentContentList.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/FilesDock.tsx` (optional header action)
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/tests/project-home-wiring.test.ts`
- Test: `packages/desktop/src/renderer/mafw/files-dock-scope.test.ts`

**Interfaces:**
- `FilesDock` gains:
  ```ts
  title?: string
  headerAction?: JSX.Element
  ```
  Default title `"文件"`; `headerAction` renders before the refresh button.
- `ProjectFilesCard`:
  ```ts
  export function ProjectFilesCard(props: {
    root: string | null
    scopeKey: string | null
    sessionID?: string | null
    onOpenFile: (rel: string) => void
    onBrowse: () => void
  }): JSX.Element
  ```
  Renders `FilesDock` with `title="项目文件"` and a ghost header action `aria-label="在内容工作台打开项目文件"` calling `onBrowse`.
- `RecentContentList`:
  ```ts
  export function RecentContentList(props: {
    items: readonly RecentContentEntry[]
    onOpen: (entry: RecentContentEntry) => void
  }): JSX.Element
  ```
  Header `最近内容`; empty text `还没有最近打开的文件`; rows use `splitRelPath`, show `name` + `dir`, call `onOpen(entry)`.
- `ProjectWorkView` gains:
  ```ts
  projectName?: string | null
  files?: ProjectFilesCardProps
  recents?: { items: readonly RecentContentEntry[]; onOpen: (entry: RecentContentEntry) => void }
  ```
  Renders a `.mafw-project-home-content` section (files + recents) after `WorkPriorityList`, before `WorkOverview`.
- `MafwShell`:
  - `recentContent` signal loaded per project; `openContentFile(rel, root)` records opens; `openProjectFile(rel)` forces project scope before opening.
  - `onBrowse` opens content context with project scope and `code` surface.

- [x] **Step 1: Write failing wiring test**

Assert `ProjectWorkView` renders `ProjectFilesCard` and `RecentContentList`; shell has `openProjectFile`, `readRecentContent`, `recordRecentContent`, and passes `files={{`/`recents={{`; `openProjectFile` resets `contentReturnGoalId` and `setContentScope(projectContentScope(...))`.

- [x] **Step 2: Run RED.**

- [x] **Step 3: Implement components and shell wiring.**

`openContentFile` carries the existing browser/editor routing and records `{ rel, scopeKey, scopeKind, scopeLabel, at: Date.now() }` only after a successful route. `openProjectFile` calls it with the project scope root.

- [x] **Step 4: Run focused tests and commit** `feat(desktop): add project files and recent content`

---

### Task 4: Team strip in project home; remove the left Pod face

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/ProjectTeamStrip.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/LeftDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/IconRail.tsx`
- Modify: `packages/desktop/src/renderer/mafw/left-dock.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Delete: `packages/desktop/src/renderer/mafw/components/ProjectResources.tsx`
- Test: `packages/desktop/tests/project-team-strip.test.ts`
- Test: `packages/desktop/tests/icon-rail-wiring.test.ts`
- Test: `packages/desktop/tests/icon-rail-pod-wiring.test.ts`
- Test: `packages/desktop/tests/left-dock-wiring.test.ts`
- Test: `packages/desktop/tests/dead-code.test.ts`
- Delete: `packages/desktop/tests/project-resources-work.test.ts`

**Interfaces:**
- `ProjectTeamStrip`:
  ```ts
  export function ProjectTeamStrip(props: {
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
  }): JSX.Element
  ```
  Label `团队` + status; Lead / Tech Lead chips via `buildPodContacts`; buttons `团队` / `邮箱` / `记忆`; empty states `创建团队` / `worktree 不绑定团队` / gateway 不支持 / error + retry.
- `ProjectWorkView` gains `team?: ProjectTeamStripProps` and renders it after the home head, before `StandingGoalsPanel`.
- `LeftDockFace = "sessions" | "search" | "notes"`; `normalizeLeftDockFace(value)` maps everything else to `"sessions"`.
- `IconRail` destination `pod` becomes `team`: label `团队`, same badge/result dot, `onClick: props.onTeam`, no `onToggleFace("pod")`.
- Shell: `openProjectTeam()` opens project context and bumps `teamFocusRequest`; ProjectWorkView scrolls the strip into view on that request.

- [x] **Step 1: Write failing tests**

`ProjectTeamStrip` renders contacts/actions/empty states. `LeftDock` has no `face === "pod"` and no `ProjectResources`. `IconRail` has `key: "team"`, `onTeam`, label `团队`, no `onToggleFace("pod")`. `normalizeLeftDockFace("pod") === "sessions"`.

- [x] **Step 2: Run RED.**

- [x] **Step 3: Implement component, remove left Pod face, wire rail shortcut and shell.**

Remove `pod*` props from `LeftDock` and the shell call site. `openPodPanelTab` remains the opener for team/inbox/memory inside the execution drawer.

- [x] **Step 4: Run focused tests and commit** `refactor(desktop): make team a project attribute`

---

### Task 5: Home layout, CSS, docs and full gates

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Modify: `docs/architecture/desktop.md`
- Create: `docs/releases/2026-11-11-project-agent-workbench-project-home.md`
- Test: `packages/desktop/tests/project-home-css.test.ts`
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- CSS: `.mafw-project-home-head`, `.mafw-project-home-title`, `.mafw-project-home-sub`, `.mafw-project-team-strip`, `.mafw-project-team-chip`, `.mafw-project-home-content`, `.mafw-project-files-card`, `.mafw-project-recent-card`, `.mafw-project-recent-list`, `.mafw-project-recent-row`, `.mafw-project-recent-empty`; container query `@container (max-width: 760px)` stacks the two-column content section.
- All colors use existing tokens; no raw hex.

- [x] **Step 1: Write failing CSS/design test**

Pin the new classes, two-column grid, narrow stack, no raw hex in new rules, and that the project home still has no L1 tabs.

- [x] **Step 2: Run RED.**

- [x] **Step 3: Implement CSS and home header.**

Home head shows project name (fallback `项目`) + hint + `新建 Goal`; keep `工作` kicker semantics.

- [x] **Step 4: Run full desktop tests**

Run: `npm test` in `packages/desktop`; expected 0 failures.

- [x] **Step 5: Type/build gates**

Run: `npx tsgo --noEmit -p tsconfig.json`, then `node ../../node_modules/electron-vite/bin/electron-vite.js build`. Expected rc=0.

- [x] **Step 6: Dev smoke + docs + commit**

Capture project home with files/recents/team, click a recent file, confirm content context opens on project scope. Update architecture + release docs. Commit `docs: record project home and team attribute`.

---

## Self-review notes

- Spec §5.2: project home directly reaches Lead chat (Chat column), current Goal/attention (priority + overview), project files and recent content (new section).
- §5.1: Pod is no longer a parallel workspace; team strip lives in the project home, PodDock stays in the execution drawer.
- §5.3: project tree is the project scope, not a new tab model; ordinary clicks open in the content context.
- §6.1: recent content persists per project; tree state remains per content scope (in-memory) and is not claimed as cross-restart in D2.
- §7.5: opening files from project home forces the project root; Chat role changes never alter it.
- D3 still owns content intent modes (`验收 / 阅读 / 修改`), explicit tabs/split, Goal detail attention order, and cross-restart tree/scroll/draft persistence.
