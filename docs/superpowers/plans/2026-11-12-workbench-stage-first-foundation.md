# Workbench Focus Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the content workbench's four-context navigation with a focus stack and the frame / lens / stage / picker primitives, starting with the file read / edit / changes / review path.

**Architecture:** This is a strangler slice. The content context is replaced by a focus shell: `FrameBar` + `LensBar` + `FocusStage` + `SubjectPicker`, backed by a pure `focus-model` and per-world persistence. `project` / `goal` / `review` contexts remain legacy until the next plan, so Goal / review / acceptance semantics are untouched. Existing `EditorDock`, `BrowserDock`, `TerminalSurface`, `content-scope-state`, `editor-drafts`, diff and annotation plumbing are reused.

**Tech Stack:** Electron 42, SolidJS, TypeScript, `@mafw/ui` v2, `node:test` + `@mafw/test-shim`, electron-vite.

**Spec:** `docs/superpowers/specs/2026-11-12-workbench-stage-first-design.md`

**Plan series:**
1. **This plan** — workbench focus foundation, file read path.
2. Goal / review scope + instrument rail + decision surface.
3. Agent / user contract + execution status + project home cleanup.

## Global Constraints

- 一个仓库 = 一个世界；`worldId` 是焦点栈的根，Goal 不跨世界。
- 本 plan 只替换 `content` context；`project` / `goal` / `review` 继续走 legacy panes。不要删除 `WorkbenchContext`、`Goal`、评审项或验收门禁。
- Plan 1 保留 `EditorDock` 现有的内部 Tab 与工具栏；kept-subject Tab 条留到 Plan 2。不要为了视觉提前拆掉可用的编辑行为。
- 人类专属验收、评审项状态权威、revision 隔离、PASS 不自动合并，不得退化。
- 客户端不暴露 runtime 名、session id、capability flag。
- 桌面 UI 只用 `@mafw/ui` v2 组件；禁止新增裸 `<button>` / `<input>` / 裸 `title`。
- Tooltip 统一 `openDelay={300}`；颜色只用主题 token，不硬编码。
- 单文件测试必须带 `--conditions=browser`，否则 Solid effect 是 no-op。
- 所有持久化 fail-open；localStorage 被禁用或超配额时不能抛到 UI。
- 工作区在本地 `main`；本 plan 不 push、不发布。
- 不改变 `SessionCreateOpts.directory` 绝对路径、runtime facade、gateway DTO 契约。

## Review Focus

- **返回必须恢复 place。** 从读文件切到变更 / 审阅 / 决定，再按返回，scroll、selection、lens 必须回到原处；同一 subject 重复打开不能堆重复栈。
- **框不能出现两套真相。** 新 frame bar 与 legacy context 标题不能同时显示；任何浮层、picker、split 都不能盖住框。
- **Picker scope 正确。** 文件、最近内容打开的 subject 必须携带当前 world + scope；切换世界后不能打开旧世界的文件。
- **持久化损坏 / 被禁用。** 无效 JSON、缺字段、quota 异常都必须回退空栈，不阻塞启动。
- **Legacy 回归。** `project` / `goal` / `review` 的现有入口、Goal 详情、评审项、验收在 content 走新路径后仍可用。
- **窄窗。** Frame bar 面包屑可截断；Lens bar 可横向滚动；picker 覆盖层可键盘关闭。

---

### Task 1: Focus model types and pure transitions

**Files:**
- Create: `packages/desktop/src/renderer/mafw/focus/focus-model.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/focus-model.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type WorldId = string

export type Scope =
  | { kind: "world"; worldId: WorldId }
  | { kind: "goal"; worldId: WorldId; goalId: string; revision: number; worktreeDir: string }

export type SubjectRef =
  | { kind: "world" }
  | { kind: "goal"; goalId: string }
  | { kind: "file"; root: string; rel: string; version?: string }
  | { kind: "changeSet"; scope: "project" | "goal"; goalId?: string; revision?: number; baseline?: string }
  | { kind: "reviewItem"; id: string; anchor?: { rel: string; line?: number } }
  | { kind: "evidence"; id: string }
  | { kind: "web"; url: string }
  | { kind: "terminal"; id: string }
  | { kind: "plugin"; package: string; panel: string }

export type Lens = "orient" | "read" | "edit" | "changes" | "evidence" | "review" | "decide" | "interact"

export type Place = {
  scroll?: number
  selection?: { anchor: number; head: number }
  split?: SubjectRef
  filter?: string
}

export type Focus = { scope: Scope; subject: SubjectRef; lens: Lens; place: Place }
export type WorkbenchState = { worldId: WorldId; stack: Focus[]; kept: SubjectRef[] }

export function createWorkbenchState(worldId: WorldId): WorkbenchState
export function subjectKey(subject: SubjectRef): string
export function sameSubject(a: SubjectRef, b: SubjectRef): boolean
export function defaultLensFor(subject: SubjectRef): Lens
export function lensesFor(subject: SubjectRef): readonly Lens[]
export function isLensApplicable(subject: SubjectRef, lens: Lens): boolean
export function openSubject(state: WorkbenchState, scope: Scope, subject: SubjectRef, lens?: Lens): WorkbenchState
export function replaceLens(state: WorkbenchState, lens: Lens): WorkbenchState
export function updatePlace(state: WorkbenchState, place: Place): WorkbenchState
export function popFocus(state: WorkbenchState): WorkbenchState
export function jumpTo(state: WorkbenchState, index: number): WorkbenchState
export function keepSubject(state: WorkbenchState, subject: SubjectRef): WorkbenchState
export function unkeepSubject(state: WorkbenchState, subject: SubjectRef): WorkbenchState
```

Behavior pinned by tests:
- `openSubject` pushes when the top subject differs; when the top subject is the same, it replaces the top focus's lens / place instead of pushing a duplicate.
- `replaceLens` only touches the top focus; inapplicable lens returns the same state object.
- `popFocus` is a no-op when the stack has one entry; the shell closes focus instead.
- `jumpTo` clamps and truncates the stack to `index + 1`.
- `keepSubject` dedupes by `subjectKey`; `unkeepSubject` removes by key.
- Lens matrix: `world -> orient`; `goal -> orient, review, decide`; `file -> read, edit, changes, review`; `changeSet -> changes, evidence, review, decide`; `reviewItem -> review, decide`; `evidence -> evidence`; `web|terminal|plugin -> interact`.

- [ ] **Step 1: Write the failing test**

Create `focus-model.test.ts` with tests named:
- `openSubject pushes a new focus and defaults to the subject lens`
- `opening the same subject replaces lens and place instead of pushing`
- `replaceLens refuses an inapplicable lens`
- `popFocus restores the previous focus and is a no-op at root`
- `jumpTo truncates the stack`
- `keepSubject dedupes by subject identity`
- `lens matrix is pinned per subject kind`

Use exact assertions, for example:

```ts
const world = createWorkbenchState("w1")
const scope: Scope = { kind: "world", worldId: "w1" }
const file: SubjectRef = { kind: "file", root: "C:/repo", rel: "src/a.ts" }
const next = openSubject(world, scope, file)
assert.equal(next.stack.length, 1)
assert.equal(next.stack[0]!.lens, "read")

const changed = replaceLens(next, "changes")
assert.equal(changed.stack[0]!.lens, "changes")
assert.equal(changed.stack.length, 1)
```

- [ ] **Step 2: Run the test to verify it fails**

Run in `packages/desktop`:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/focus-model.test.ts
```

Expected: FAIL because `focus/focus-model.ts` does not exist.

- [ ] **Step 3: Implement `focus-model.ts`**

Create the types and functions exactly as listed in Interfaces. Keep all functions pure; no Solid imports, no storage access.

- [ ] **Step 4: Run the test to verify it passes**

Run the same command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/focus/focus-model.ts packages/desktop/src/renderer/mafw/focus/focus-model.test.ts
git commit -m "feat(desktop): add workbench focus model"
```

---

### Task 2: Per-world focus persistence

**Files:**
- Create: `packages/desktop/src/renderer/mafw/focus/focus-persistence.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/focus-persistence.test.ts`

**Interfaces:**
- Consumes: `WorkbenchState`, `Focus`, `SubjectRef` from `./focus-model`.
- Produces:

```ts
export type FocusStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export function configureFocusStorage(next: FocusStorage | null): void
export function loadFocusState(worldId: string): WorkbenchState | null
export function saveFocusState(state: WorkbenchState): void
export function flushFocusPersistence(worldId?: string): void
export function clearFocusPersistence(): void
```

Behavior:
- Storage key: `mafw-focus:v1:<worldId>`.
- Serialize `{ v: 1, stack, kept }`.
- Validate every focus on read: valid scope, subject, lens, place; drop invalid entries.
- Cap stack at 50 and kept at 20.
- Debounce writes by 300ms; `flushFocusPersistence` writes immediately.
- No storage configured = in-memory only, no throw.

- [ ] **Step 1: Write the failing test**

Tests named:
- `focus state round-trips per world`
- `invalid or partial payload falls back to null`
- `debounced writes flush on demand`
- `no storage keeps the in-memory behavior`
- `stack and kept lists are capped`
- `worlds do not share stacks`

Use a fake storage with `getItem` / `setItem` / `removeItem` backed by a `Map`.

- [ ] **Step 2: Run it to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/focus-persistence.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement `focus-persistence.ts`**

Use a module-level `Map<WorldId, WorkbenchState>` plus a `Map<WorldId, timer>`. On read, load once from storage. On write, update the Map, schedule a persist. All storage calls are inside `try/catch`.

- [ ] **Step 4: Run it to verify it passes**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/focus/focus-persistence.ts packages/desktop/src/renderer/mafw/focus/focus-persistence.test.ts
git commit -m "feat(desktop): persist workbench focus per world"
```

---

### Task 3: Frame view and FrameBar

**Files:**
- Create: `packages/desktop/src/renderer/mafw/focus/frame-view.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/frame-view.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/FrameBar.tsx`
- Test: `packages/desktop/tests/frame-bar-wiring.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: `Focus`, `WorkbenchState`.
- Produces:

```ts
export type FrameCrumb = {
  label: string
  kind: "world" | "scope" | "subject" | "anchor"
  stackIndex?: number
}

export type FrameBadge = {
  id: "dirty" | "stale" | "unresolved" | "revision" | "external" | "verdict"
  label: string
  tone: "neutral" | "amber" | "red" | "green"
}

export type FrameView = {
  crumbs: FrameCrumb[]
  badges: FrameBadge[]
}

export type FrameInput = {
  worldName: string
  scopeLabel: string
  subjectLabel: string
  anchorLabel?: string
  scopeStartIndex?: number
  subjectIndex?: number
  dirty?: boolean
  stale?: boolean
  unresolved?: number
  revision?: number
  external?: boolean
  verdict?: string
}

export function frameView(input: FrameInput): FrameView
```

`FrameBar` props:

```ts
export function FrameBar(props: {
  crumbs: readonly FrameCrumb[]
  badges: readonly FrameBadge[]
  canBack: boolean
  onBack: () => void
  onCrumb: (index: number) => void
  onOpenPicker: () => void
}): JSX.Element
```

Behavior:
- One row only: back button, breadcrumb, badges, `⌘P` hint.
- Crumbs: world `stackIndex: 0`; scope `scopeStartIndex ?? 0`; subject `subjectIndex`; anchor has no index.
- `FrameBar` calls `onCrumb(crumb.stackIndex)` only when `stackIndex` is defined.
- Badges order: dirty, stale, unresolved, revision, external, verdict.
- `unresolved` uses red tone; `dirty` / `stale` amber; `revision` / `external` neutral; verdict uses the provided tone mapping (`PASS` green, `FAIL` red, otherwise neutral).
- Uses `ButtonV2`, `Icon`, `TooltipV2`; no raw `<button>`.

- [ ] **Step 1: Write the failing pure test**

`frame-view.test.ts` tests:
- `crumbs include world, scope, subject and optional anchor`
- `badges are ordered and toned`
- `revision and unresolved labels are stable`
- `verdict tone maps PASS to green and FAIL to red`

Exact assertions:

```ts
assert.deepEqual(frameView({
  worldName: "MAFW",
  scopeLabel: "Goal X · rev 3",
  subjectLabel: "src/a.ts",
  unresolved: 2,
  revision: 3,
  dirty: true,
}).badges.map((b) => b.id), ["dirty", "unresolved", "revision"])
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/frame-view.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement `frame-view.ts` and `FrameBar.tsx`**

Add CSS classes in `mafw.css`:

```css
.mafw-frame-bar { ... }
.mafw-frame-back { ... }
.mafw-frame-crumbs { ... }
.mafw-frame-crumb { ... }
.mafw-frame-crumb.is-current { ... }
.mafw-frame-badges { ... }
.mafw-frame-badge { ... }
.mafw-frame-badge[data-tone="amber"] { ... }
.mafw-frame-badge[data-tone="red"] { ... }
.mafw-frame-badge[data-tone="green"] { ... }
.mafw-frame-picker-hint { ... }
```

Use theme tokens only (`--text-1..5`, `--bg-*`, `--border-subtle`, `--accent`).

- [ ] **Step 4: Add the wiring test**

`tests/frame-bar-wiring.test.ts` reads `FrameBar.tsx` and `mafw.css` and asserts:
- imports `ButtonV2`, `TooltipV2`, `Icon`
- contains `mafw-frame-bar`, `mafw-frame-crumbs`, `mafw-frame-badge`
- `aria-label="返回"` and `⌘P`
- no `<button` / `<input`
- `.mafw-frame-bar` is not `position: absolute` / `fixed`; it must remain a normal flex child so no overlay covers it
- CSS uses `var(--` tokens and no hex colors

Run:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/frame-bar-wiring.test.ts src/renderer/mafw/focus/frame-view.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/focus/frame-view.ts packages/desktop/src/renderer/mafw/focus/frame-view.test.ts packages/desktop/src/renderer/mafw/components/FrameBar.tsx packages/desktop/tests/frame-bar-wiring.test.ts packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): add workbench frame bar"
```

---

### Task 4: LensBar

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/LensBar.tsx`
- Test: `packages/desktop/tests/lens-bar-wiring.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: `Lens` from `../focus/focus-model`.
- Produces:

```ts
export function LensBar(props: {
  lenses: readonly Lens[]
  active: Lens
  counts?: Partial<Record<Lens, number>>
  onLens: (lens: Lens) => void
  splitOpen?: boolean
  onToggleSplit?: () => void
}): JSX.Element
```

Behavior:
- Renders only the provided lenses, in the provided order.
- Each lens is a `ButtonV2` with `aria-pressed={active === lens}`.
- Counts render only when a finite number > 0.
- Split toggle is optional and uses `aria-pressed`.
- No navigation / context switch.

- [ ] **Step 1: Write the failing wiring test**

`tests/lens-bar-wiring.test.ts` asserts:
- imports `ButtonV2`, `TooltipV2`, `Icon`
- contains `mafw-lens-bar`, `mafw-lens-btn`, `aria-pressed`
- renders `props.lenses` with `For`
- contains `onLens` and `onToggleSplit`
- no `WorkbenchContext`, no `onContext`
- CSS uses tokens only

- [ ] **Step 2: Run it to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/lens-bar-wiring.test.ts
```

Expected: FAIL because `LensBar.tsx` is missing.

- [ ] **Step 3: Implement `LensBar.tsx` and CSS**

Add `.mafw-lens-bar`, `.mafw-lens-btn`, `.mafw-lens-btn.is-active`, `.mafw-lens-count`, `.mafw-lens-split`. Use `ButtonV2` with `variant="ghost"` and `size="small"`.

- [ ] **Step 4: Run it to verify it passes**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/LensBar.tsx packages/desktop/tests/lens-bar-wiring.test.ts packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): add workbench lens bar"
```

---

### Task 5: FocusStage file path

**Files:**
- Create: `packages/desktop/src/renderer/mafw/focus/stage-dispatch.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/stage-dispatch.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/FocusStage.tsx`
- Test: `packages/desktop/tests/focus-stage-wiring.test.ts`

**Interfaces:**
- Consumes: `Focus`, `SubjectRef`, `Lens`; `EditorDock`, `BrowserDock`, `TerminalSurface`, `SplitDocumentPane`.
- Produces:

```ts
export type StageKind = "editor" | "browser" | "terminal" | "plugin" | "changeSet" | "goal" | "world"
export function stageKindFor(focus: Focus): StageKind

export function FocusStage(props: {
  focus: Focus
  active: boolean
  sessionID: string | null
  contentRoot: string | null
  contentScopeKey: string | null
  diffs: FileDiffEntry[]
  onOpenFile: (rel: string) => void
  onActiveFileChange?: (rel: string | null) => void
  onSendAnnotation?: (text: string, opts?: { imageDataUrl?: string }) => void
  onAddAnnotation?: (a: {
    rel: string
    startLine: number
    endLine: number
    code: string
    comment: string
    anchor?: AnnotationAnchor
    imageDataUrl?: string
    scopeKey?: string
    root?: string
  }) => void
  onSendComment?: (sid: string, text: string) => void
  onOpenReview?: () => void
  renderPluginSurface?: (id: string) => JSX.Element
  webSurfaces?: readonly PluginWebSurfaceView[]
  gatewayUrl?: string
  onWebBadge?: (surfaceId: string, count: number) => void
  onWebTitle?: (surfaceId: string, title: string) => void
  onWebError?: (surfaceId: string, message: string) => void
  renderChangeSet?: () => JSX.Element
  renderGoal?: () => JSX.Element
  renderWorld?: () => JSX.Element
}): JSX.Element
```

Dispatch rules:
- `file` + `read|edit|changes|review` -> `editor`.
- `web` -> `browser`.
- `terminal` -> `terminal`.
- `plugin` -> `plugin`.
- `changeSet` -> `changeSet`.
- `goal` -> `goal`.
- `world` -> `world`.

For the editor branch, render `EditorDock` with:
- `intent={focus.lens === "edit" ? "editing" : "reading"}`
- `contentRoot={contentRoot}`
- `scopeKey={contentScopeKey}`
- existing diff / annotation / review callbacks
- a wrapper `<div class="mafw-focus-stage">`

For non-editor branches in this plan:
- browser/terminal/plugin use the existing components.
- plugin branch constructs `plugin:${subject.package}:${subject.panel}` for `renderPluginSurface`.
- web branch renders `BrowserDock`; the subject URL is informational until `BrowserDock` accepts a URL prop.
- changeSet/goal/world render the corresponding `render*` prop if provided, otherwise a `<DockEmpty>`-style fallback text.

- [ ] **Step 1: Write the failing dispatch test**

`stage-dispatch.test.ts` tests:
- `file read/edit/changes/review dispatch to editor`
- `web/terminal/plugin dispatch to their surfaces`
- `changeSet/goal/world dispatch to their stage`
- `unknown subject/lens combination falls back to world`

- [ ] **Step 2: Run it to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/stage-dispatch.test.ts
```

Expected: FAIL because `stage-dispatch.ts` is missing.

- [ ] **Step 3: Implement `stage-dispatch.ts` and `FocusStage.tsx`**

Use `Switch` / `Match` from SolidJS. Do not duplicate `EditorDock` internals; pass through existing props. The editor branch must not render `FilesDock` or `ContentScopeHeader`.

- [ ] **Step 4: Add the wiring test**

`tests/focus-stage-wiring.test.ts` asserts:
- `FocusStage.tsx` imports `EditorDock`, `BrowserDock`, `TerminalSurface`
- contains `stageKindFor`
- contains `mafw-focus-stage`
- does not contain `FilesDock` or `ContentScopeHeader`
- uses `@mafw/ui` components for fallbacks

Run:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/focus-stage-wiring.test.ts src/renderer/mafw/focus/stage-dispatch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/focus/stage-dispatch.ts packages/desktop/src/renderer/mafw/focus/stage-dispatch.test.ts packages/desktop/src/renderer/mafw/components/FocusStage.tsx packages/desktop/tests/focus-stage-wiring.test.ts
git commit -m "feat(desktop): add focus stage"
```

---

### Task 6: Subject picker

**Files:**
- Create: `packages/desktop/src/renderer/mafw/focus/picker-model.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/picker-model.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/SubjectPicker.tsx`
- Test: `packages/desktop/tests/subject-picker-wiring.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: `SubjectRef`, `Scope`, `Lens`; `RecentContentEntry`.
- Produces:

```ts
export type PickerKind = "file" | "recent" | "goal" | "change" | "review" | "command"

export type PickerItem = {
  id: string
  kind: PickerKind
  label: string
  detail?: string
  scope: Scope
  subject: SubjectRef
  lens?: Lens
}

export function buildFilePickerItems(input: {
  worldId: WorldId
  files: readonly string[]
  recent: readonly RecentContentEntry[]
  root: string
  scope: Scope
  projectScope: Scope
}): PickerItem[]

export function buildCommandPickerItems(scope: Scope): PickerItem[]

export function filterPickerItems(items: readonly PickerItem[], query: string): PickerItem[]
```

Behavior:
- Recent entries come first, mapped to `file` subjects with their scope: project entries use `projectScope` and `root`; Goal entries with `goalId / revision / worktreeDir` use a goal scope and `root = worktreeDir`; incomplete Goal entries are skipped.
- Then all files not already present by `subjectKey`.
- `filterPickerItems` is case-insensitive substring; empty query returns the first 50 items.
- No duplicate paths.
- `buildCommandPickerItems` appends `打开浏览器` (`{ kind: "web", url: "about:blank" }`) and `打开终端` (`{ kind: "terminal", id: "local" }`) as `command` items using the current scope.

`SubjectPicker` props:

```ts
export function SubjectPicker(props: {
  open: boolean
  items: readonly PickerItem[]
  onClose: () => void
  onPick: (item: PickerItem) => void
}): JSX.Element
```

Behavior:
- Overlay with a `TextInputV2` query field.
- Arrow up/down moves selection; Enter picks; Escape closes.
- `onPick` receives the item; the shell opens the subject.
- Uses `ButtonV2` / `TextInputV2` / `Icon`; no raw `<input>`.

- [ ] **Step 1: Write the failing pure test**

`picker-model.test.ts` tests:
- `recent items come first and dedupe against files`
- `file items carry the current scope and root`
- `filter is case-insensitive and capped`
- `empty query returns recent plus files`
- `commands append browser and terminal`

- [ ] **Step 2: Run it to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/picker-model.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `picker-model.ts` and `SubjectPicker.tsx`**

Use `TextInputV2` for the query. Add CSS `.mafw-subject-picker`, `.mafw-subject-picker-panel`, `.mafw-subject-picker-input`, `.mafw-subject-picker-list`, `.mafw-subject-picker-item`, `.mafw-subject-picker-item.is-active`.

- [ ] **Step 4: Add the wiring test**

`tests/subject-picker-wiring.test.ts` asserts:
- imports `TextInputV2`, `ButtonV2`, `Icon`
- contains `role="dialog"` or `aria-modal="true"`
- contains `onPick`, `onClose`
- Escape / ArrowDown / ArrowUp handling
- no raw `<input>` / `<button>`

Run:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/subject-picker-wiring.test.ts src/renderer/mafw/focus/picker-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/focus/picker-model.ts packages/desktop/src/renderer/mafw/focus/picker-model.test.ts packages/desktop/src/renderer/mafw/components/SubjectPicker.tsx packages/desktop/tests/subject-picker-wiring.test.ts packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): add subject picker"
```

---

### Task 7: Integrate the focus shell for content

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Test: `packages/desktop/tests/focus-shell-wiring.test.ts`

**Interfaces:**
- Consumes: `createWorkbenchState`, `openSubject`, `replaceLens`, `popFocus`, `jumpTo`, `lensesFor`, `frameView`, `FrameBar`, `LensBar`, `FocusStage`, `SubjectPicker`.
- Produces: `WorkbenchShell` new props:

```ts
focus: Focus | null
frame: FrameView | null
lenses: readonly Lens[]
lensCounts?: Partial<Record<Lens, number>>
onFocusLens: (lens: Lens) => void
onFocusBack: () => void
onFocusCrumb: (index: number) => void
pickerOpen: boolean
pickerItems: readonly PickerItem[]
onOpenPicker: () => void
onClosePicker: () => void
onPick: (item: PickerItem) => void
```

Behavior:
- In `MafwShell`, add `const [focusState, setFocusState] = createSignal<WorkbenchState>(createWorkbenchState(currentProject() ?? ""))`.
- `openContentFile(rel, root, ...)` opens a file subject with the active scope and `read` lens; the existing content-scope state still records tree / drafts / scroll.
- `onContentIntent` maps to `replaceLens`: `reading -> read`, `editing -> edit`.
- `WorkbenchShell` renders the focus shell when `props.focus` is non-null:
  - `<FrameBar>`
  - `<LensBar>`
  - `<FocusStage>`
  - `<SubjectPicker>`
- The content context no longer renders `ContentScopeHeader` when a focus is active.
- When `focus` is non-null it takes precedence over `props.context`; legacy `project` / `goal` / `review` panes stay mounted but hidden.
- Legacy `project` / `goal` / `review` panes remain unchanged.
- Back behavior:
  - stack length > 1 -> `popFocus`
  - stack length === 1 -> clear focus state and `applyWorkbenchContext("project")`.

- [ ] **Step 1: Write the failing wiring test**

`tests/focus-shell-wiring.test.ts` reads `MafwShell.tsx` and `WorkbenchShell.tsx` and asserts:
- imports `createWorkbenchState`, `openSubject`, `replaceLens`, `popFocus`, `jumpTo`
- MafwShell has `focusState` signal and `onFocusBack`
- WorkbenchShell renders `FrameBar`, `LensBar`, `FocusStage`, `SubjectPicker`
- focus branch does not render `ContentScopeHeader`
- legacy `WorkbenchContext` is still present (this plan is a strangler slice)
- `reading` maps to `read` and `editing` maps to `edit`

- [ ] **Step 2: Run it to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/focus-shell-wiring.test.ts
```

Expected: FAIL because the wiring is missing.

- [ ] **Step 3: Implement the MafwShell wiring**

Add the focus signal near the existing `contentScope` signals. Keep `workbenchContext` and legacy views. Add helpers:

```ts
const focusActive = () => focusState().stack.length > 0
const activeFocus = () => focusState().stack[focusState().stack.length - 1] ?? null
const focusLenses = () => activeFocus() ? lensesFor(activeFocus()!.subject) : []
```

`openContentFile` should call `setFocusState((s) => openSubject(s, scope, { kind: "file", root, rel }))`. Do not remove the existing `saveContentScopeState` / `selectTreeFile` calls.

- [ ] **Step 4: Implement the WorkbenchShell focus branch**

Add the new props. In the render, use a `<Show when={props.focus}>` branch before the legacy context header / panes. The focus branch renders FrameBar + LensBar + FocusStage + SubjectPicker. Keep the legacy path for `project` / `goal` / `review`.

- [ ] **Step 5: Run the wiring test**

Same command; expected PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/tests/focus-shell-wiring.test.ts
git commit -m "feat(desktop): wire focus shell into content context"
```

---

### Task 8: Back, breadcrumb, picker and persistence wiring

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Test: `packages/desktop/tests/focus-stack-wiring.test.ts`

**Interfaces:**
- Consumes: `configureFocusStorage`, `loadFocusState`, `saveFocusState`, `flushFocusPersistence`; `popFocus`, `jumpTo`.
- Produces: no new exported types.

Behavior:
- At renderer boot, `configureFocusStorage(window.localStorage)` next to the existing content-scope / draft storage configuration.
- On project/world switch, load the target world's focus state; if absent, `createWorkbenchState(worldId)`. Use `currentProject() ?? "unscoped"` for the id; never pass `""`.
- On load, drop Goal-scope focus entries whose `worktreeDir` no longer exists (use `window.api.fs.listDir(worktreeDir, "") === null`), then pop until a valid focus remains or the stack is empty. Fail-open.
- Save focus state on every focus mutation; flush on unmount / project switch.
- `onFocusBack`:
  - stack length > 1 -> pop.
  - stack length === 1 -> clear focus and return to legacy project context.
- `onFocusCrumb(index)` -> `jumpTo`.
- Picker:
  - `⌘P` / `Ctrl+P` opens.
  - `onPick` opens the item's subject with its scope and lens, then closes.
  - `Escape` closes.
- The frame's `canBack` is true when focus is active; the breadcrumb is clickable.

- [ ] **Step 1: Write the failing wiring test**

`tests/focus-stack-wiring.test.ts` asserts:
- `configureFocusStorage(window.localStorage)`
- `loadFocusState` and `saveFocusState`
- `flushFocusPersistence`
- `popFocus` + `jumpTo`
- `focusState().stack.length === 1` close path
- `onPick` opens the item scope / subject
- keyboard handler for `Meta+P` / `Ctrl+P` and `Escape`

- [ ] **Step 2: Run it to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/focus-stack-wiring.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the wiring**

Add a `createEffect` that saves `focusState()` when it changes. Add a project-switch effect that loads the new world's state. Add a keydown listener on `window` for the picker and `Escape`; clean it up with `onCleanup`.

- [ ] **Step 4: Run it to verify it passes**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/tests/focus-stack-wiring.test.ts
git commit -m "feat(desktop): wire focus stack, picker and persistence"
```

---

### Task 9: Migrate the last content scope state

**Files:**
- Create: `packages/desktop/src/renderer/mafw/focus/legacy-migration.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/legacy-migration.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`

**Interfaces:**
- Consumes: `ContentScopeState` from `../content-scope-state`; `WorkbenchState`, `openSubject`, `keepSubject`.
- Produces:

```ts
export function migrateContentScopeState(input: {
  worldId: string
  root: string
  scope: Scope
  state: ContentScopeState
}): WorkbenchState
```

Behavior:
- If `state.activeFile` exists, open a file subject with `read` lens and `place.scroll` / `place.selection` from the maps.
- Add every `state.openFiles` to `kept`.
- If no active file, return `createWorkbenchState(worldId)`.
- Do not mutate the input state.

- [ ] **Step 1: Write the failing test**

Tests:
- `active file becomes a read focus with scroll and selection`
- `open files become kept subjects`
- `empty state returns an empty workbench`
- `migration does not mutate the source`

- [ ] **Step 2: Run it to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/legacy-migration.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `legacy-migration.ts`**

Use `contentScopeStateFor` data passed in by the caller; do not read storage inside the pure function.

- [ ] **Step 4: Wire it in MafwShell**

On first boot for a world, if `loadFocusState(worldId)` returns null, read the current content scope state and migrate it. Then save the migrated state.

- [ ] **Step 5: Run the test and the wiring test**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/legacy-migration.test.ts tests/focus-stack-wiring.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/focus/legacy-migration.ts packages/desktop/src/renderer/mafw/focus/legacy-migration.test.ts packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): migrate content scope state into focus"
```

---

### Task 10: Regression, gates and smoke

**Files:**
- Modify: existing tests that assert the old content header / context path:
  - `packages/desktop/tests/content-intent-wiring.test.ts`
  - `packages/desktop/tests/workbench-shell-wiring.test.ts`
  - `packages/desktop/tests/workbench-shell-css.test.ts`
  - any other test that fails because `ContentScopeHeader` is no longer rendered in the focus branch
- No new production files.

- [ ] **Step 1: Update the affected tests**

For each failing test:
- Keep assertions for the legacy `project` / `goal` / `review` paths.
- Move content-specific assertions to `tests/focus-shell-wiring.test.ts` or `tests/focus-stack-wiring.test.ts`.
- Do not delete coverage; rewrite it against the new frame / lens / stage / picker classes.

- [ ] **Step 2: Run the focused tests**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/focus-shell-wiring.test.ts tests/focus-stack-wiring.test.ts tests/frame-bar-wiring.test.ts tests/lens-bar-wiring.test.ts tests/focus-stage-wiring.test.ts tests/subject-picker-wiring.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full desktop test suite**

```bash
npm test
```

Expected: all tests PASS; record the counts.

- [ ] **Step 4: Typecheck and build**

```bash
npx tsgo --noEmit -p tsconfig.json
node ../../node_modules/electron-vite/bin/electron-vite.js build
```

Expected: both exit 0.

- [ ] **Step 5: Real-app smoke**

In the dev app:
1. Open a project and a file. Confirm the frame bar shows world / scope / file / version / state, and there is no content scope header.
2. Switch lens read -> changes -> review -> back. Confirm the file stays, scroll/selection stay, and back returns to the previous subject.
3. Press `⌘P` / `Ctrl+P`, search a file, open it. Confirm the picker closes and the frame updates.
4. Reload. Confirm the focus stack and last file restore.
5. Open the legacy Goal detail and review context. Confirm they still render and acceptance gates are unchanged.
6. Narrow the window. Confirm the frame breadcrumb truncates and the lens bar scrolls horizontally.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/tests
git commit -m "test(desktop): cover focus shell and fix legacy assertions"
```

---

## Self-review notes

- **Spec coverage:** This plan covers the design's §8 (focus model), §9.2–9.4 (frame / lens / stage), §9.6–9.7 (stack / picker), and the content read path. It deliberately leaves §9.5 (instrument rail), §10 (Chat decision surface), §11 (agent/user contract), and goal/review/world scope migration to Plans 2–3.
- **Type consistency:** `Focus`, `Scope`, `SubjectRef`, `Lens`, `Place`, `WorkbenchState`, `PickerItem`, `FrameView` are defined once in Tasks 1/2/3/6 and reused by name in later tasks.
- **No hidden dependencies:** `content-scope-state`, `editor-drafts`, `EditorDock`, `BrowserDock`, `TerminalSurface`, diff and annotation props are existing modules; the plan passes them through rather than reimplementing them.
- **Review Focus tests:** Each Review Focus line has a task: back/place (Tasks 1/7/8/10), frame truth (Tasks 3/7/10), picker scope (Tasks 6/8), persistence corruption (Task 2), legacy regression (Task 10), narrow window (Task 10 smoke).
