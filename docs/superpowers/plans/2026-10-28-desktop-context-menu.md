# Desktop 右键菜单重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一套纯函数菜单模型 + 单实例菜单宿主，替换 Electron 原生右键在对象区域留下的空白，并统一修复现有 5 张手写菜单的缺陷。

**Architecture:** 每个对象区域一个 `build*Menu(target): MenuModel` 纯函数（无闭包、可单测）；全应用一个 `MenuHost` 受控渲染；右键 / `⋯` / Shift+F10 三入口都调用同一个 `menuController.request(...)`；输入框、文本选区、图片、链接继续走 Electron 原生菜单。

**Tech Stack:** Electron 42、SolidJS、Kobalte（`@mafw/ui/context-menu`）、TypeScript、`node --test` + `@mafw/test-shim`（测试文件 import `bun:test`）。

**Spec:** `docs/superpowers/specs/2026-10-28-desktop-context-menu-design.md`

## Global Constraints

- 菜单标签全部中文，集中在 `context-menu/labels.ts`；组件里不得出现 `label: "…"` 字面量。
- 动词顺序固定：主动词 → 组织 → 定位/打开方式 → 取出 → 破坏；`danger` 项必须在最后一条分隔线之后。
- 会弹确认/对话框的动作 `confirms: true` 且标签以 `…` 结尾；不弹的不加。
- 每组 ≤ 7 项、分隔线 ≤ 2 条、子菜单深度 ≤ 1；无连续/首尾分隔线。
- 模型不含闭包：`MenuItem` 只有 `id`，执行通过 `onRun(id)`。
- 原生菜单优先级：`input/textarea/contenteditable`、文本选区、`img/video/audio/a[href]`、`[data-native-menu]` → 不接管。
- 不新增 gateway 路由；只允许为已有路由补 SDK/preload 薄封装。
- 每个任务结束跑：`cd packages/desktop && npm test`，以及 `npx tsgo --noEmit -p tsconfig.json`（**必须带 `-p`**）。
- 提交信息用 `feat(desktop): …` / `refactor(desktop): …` / `test(desktop): …`。

## Review Focus

1. 在一条消息里**选中文字后右键**——必须是系统菜单（复制/查词），不能弹我们的消息菜单。
2. 在消息里的**图片或链接上右键**——只出现一张菜单（原生），不能双层。
3. **会话改名输入框内右键**——必须是原生菜单（粘贴/拼写）。
4. 在窗口**右下角边缘右键**——菜单完整可见，不越出窗口。
5. 焦点在会话行/页签上按 **Shift+F10 或菜单键**——出与右键完全相同的菜单，关闭后焦点回到原行。
6. **删除会话**——必须走确认流程，菜单点击不能直接删。
7. 聊天里的**路径在会话目录外**——不出现「在编辑器中打开」，不崩溃。

---

### Task 1: 菜单模型、构造器与约束校验

**Files:**
- Create: `packages/desktop/src/renderer/mafw/context-menu/types.ts`
- Create: `packages/desktop/src/renderer/mafw/context-menu/model.ts`
- Create: `packages/desktop/src/renderer/mafw/context-menu/labels.ts`
- Create: `packages/desktop/src/renderer/mafw/context-menu/test-helpers.ts`
- Test: `packages/desktop/src/renderer/mafw/context-menu/model.test.ts`

**Interfaces:**
- Produces:
  - `MenuSurface`（21 个字符串联合，见下）
  - `MenuItem`（item/separator/submenu/group/checkbox/radio）
  - `MenuModel = { surface: MenuSurface; items: MenuItem[] }`
  - `item(id, label, opts?)`, `sep()`, `submenu(id, label, items, opts?)`, `group(id, label, items)`, `checkbox(id, label, checked)`, `radio(id, label, checked)`
  - `validateMenu(model: MenuModel): string[]`
  - `test-helpers.ts` → `ids(model): string[]`

21 个 surface：
`rail.new`、`session.row`、`session.tab`、`project.row`、`message`、`code-block`、`file.path`、`file.tree`、`editor.tab`、`terminal`、`browser`、`panel.execution`、`panel.review`、`goal.card`、`goal.cell`、`memory.card`、`notes.card`、`approval.question`、`approval.permission`、`triage.card`、`automation.card`。

`MenuItem` 的 item 字段：`id,label,icon?,shortcut?,disabled?,disabledReason?,danger?,confirms?`；checkbox/radio 额外 `checked`。

- [ ] **Step 1: Write the failing test**

```ts
// model.test.ts
import { describe, expect, test } from "bun:test"
import { checkbox, group, item, radio, sep, submenu, validateMenu } from "./model"
import type { MenuModel } from "./types"

const m = (items: MenuModel["items"]): MenuModel => ({ surface: "session.row", items })

describe("validateMenu", () => {
  test("accepts a well-formed model", () => {
    expect(validateMenu(m([
      item("s.open", "打开"),
      item("s.copy", "复制"),
      sep(),
      item("s.delete", "删除…", { danger: true, confirms: true }),
    ]))).toEqual([])
  })

  test("reports duplicate ids and separator misuse", () => {
    const errors = validateMenu(m([
      sep(),
      item("x", "A"),
      sep(),
      sep(),
      item("x", "B"),
    ]))
    expect(errors).toContain("leading separator")
    expect(errors).toContain("consecutive separators")
    expect(errors).toContain("duplicate id: x")
  })

  test("danger must be last and confirms must use an ellipsis", () => {
    const errors = validateMenu(m([
      item("bad", "删除", { danger: true, confirms: true }),
      sep(),
      item("ok", "打开"),
    ]))
    expect(errors).toContain("danger item before last separator: bad")
    expect(errors).toContain("confirms label must end with …: bad")
    expect(validateMenu(m([item("solo", "删除…", { danger: true, confirms: true })])))
      .toContain("danger item requires a separator: solo")
  })

  test("group size, submenu depth and empty submenu", () => {
    const tooMany = validateMenu(m([
      item("a1", "1"), item("a2", "2"), item("a3", "3"), item("a4", "4"),
      item("a5", "5"), item("a6", "6"), item("a7", "7"), item("a8", "8"),
    ]))
    expect(tooMany).toContain("too many items in group: 8")

    const badSubs = validateMenu(m([
      submenu("sub", "更多", [submenu("deep", "更深", [item("d", "D")])]),
      submenu("empty", "空", []),
    ]))
    expect(badSubs).toContain("submenu depth > 1: sub")
    expect(badSubs).toContain("empty submenu: empty")
  })

  test("checkbox, radio and group are id-checked", () => {
    expect(validateMenu(m([
      group("g", "分组", [checkbox("c", "显示", true)]),
      radio("r", "紧凑", true),
    ]))).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/context-menu/model.test.ts`
Expected: FAIL（`Cannot find module './model'`）

- [ ] **Step 3: Implement `types.ts`, `model.ts`**

`model.ts` 里 `validateMenu` 按以下规则返回错误串（顺序无关，测试用 `toContain`）：
`duplicate id: <id>`、`leading separator`、`trailing separator`、`consecutive separators`、`too many separators`、`too many items in group: <n>`、`danger item requires a separator: <id>`、`danger item before last separator: <id>`、`confirms label must end with …: <id>`、`submenu depth > 1: <id>`、`empty submenu: <id>`。
「组」= 分隔线之间的片段；checkbox/radio/submenu 都算一项。`group` 的 children 递归校验但不参与外层计数。

`labels.ts`（一次性建全，后续任务只消费）：

```ts
export const L = {
  rail: { newSession: "新建会话", newWorktree: "并行 worktree" },
  session: {
    open: "打开", rename: "重命名", fork: "分叉会话", export: "导出 Markdown…",
    copyId: "复制会话 ID", closeTab: "关闭页签", delete: "删除会话…",
  },
  project: { newSession: "新建会话", reveal: "在文件管理器中显示", copyPath: "复制项目路径" },
  message: {
    copy: "复制文本", copyMarkdown: "复制为 Markdown", quote: "引用到输入框",
    fork: "从此处分叉", readAloud: "朗读",
  },
  code: { copy: "复制代码", copyMarkdown: "复制为 Markdown" },
  filePath: {
    attach: "附加到输入框", openEditor: "在编辑器中打开", openWith: "用…打开",
    openDefault: "系统默认", vscode: "VS Code", cursor: "Cursor", zed: "Zed",
    reveal: "在文件管理器中显示", copy: "复制",
    copyAbs: "绝对路径", copyRel: "相对路径", copyName: "文件名",
  },
  fileTree: {
    open: "打开", preview: "预览", attach: "附加到输入框",
    reveal: "在文件夹中显示", copy: "复制",
  },
  editorTab: {
    close: "关闭", closeOthers: "关闭其他", closeRight: "关闭右侧",
    copyPath: "复制路径", reveal: "在文件夹中显示",
  },
  terminal: {
    copy: "复制", paste: "粘贴", selectAll: "全选", clear: "清屏",
    openExternal: "在外部终端打开", close: "关闭终端…",
  },
  browser: {
    back: "后退", forward: "前进", reload: "刷新", copyLink: "复制链接",
    openExternal: "在系统浏览器打开", pick: "点选页面元素",
  },
  panel: { openSession: "打开会话", copyId: "复制 ID", cancel: "终止" },
  review: { open: "打开", reveal: "在文件夹中显示", copy: "复制" },
  goal: {
    details: "查看详情", timeline: "在时间线打开", copyId: "复制 Goal ID",
    pause: "暂停", cancel: "取消…",
  },
  goalCell: { openSession: "打开会话", retry: "重跑此节点…", copyArtifact: "复制产物路径" },
  memory: {
    copyAbstraction: "复制摘要", copyFull: "复制全文", pin: "固定", unpin: "取消固定",
    sticky: "设为便签", renew: "续期", unsticky: "下架", delete: "删除…",
  },
  notes: { renew: "续期", unsticky: "下架", delete: "删除…" },
  approvalQ: { approve: "批准", reject: "拒绝", copyQuestion: "复制问题" },
  approvalP: {
    allowOnce: "允许一次", alwaysAllow: "始终允许", reject: "拒绝",
    rememberPrefix: "记此前缀", rememberTool: "记此工具", copyCommand: "复制命令",
  },
  triage: {
    confirm: "确认", proposeConfirm: "建议确认", proposeReject: "建议拒绝",
    viewGoal: "查看 Goal", dismiss: "忽略…",
  },
  automation: { enable: "启用", disable: "停用", copyId: "复制规则 ID", delete: "删除…" },
}
```

`test-helpers.ts`：

```ts
import type { MenuItem, MenuModel } from "./types"

export function ids(model: MenuModel): string[] {
  const out: string[] = []
  const walk = (items: MenuItem[]) => {
    for (const i of items) {
      if (i.type === "separator") continue
      out.push(i.id)
      if (i.type === "submenu" || i.type === "group") walk(i.items)
    }
  }
  walk(model.items)
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: 同上
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/context-menu
git commit -m "feat(desktop): add context menu model and validation"
```

---

### Task 2: 会话 / 项目 / rail 新建菜单

**Files:**
- Create: `context-menu/builders/session.ts`
- Create: `context-menu/builders/project.ts`
- Create: `context-menu/builders/rail.ts`
- Test: `context-menu/builders/session.test.ts`, `.../project.test.ts`, `.../rail.test.ts`

**Interfaces:**
- Produces:
  - `buildSessionMenu(t: SessionMenuTarget): MenuModel`；`SessionMenuTarget = { id: string; title: string; kind: "row" | "tab"; canFork?: boolean; canDelete?: boolean }`（缺省 true）
  - `buildProjectMenu(t: ProjectMenuTarget): MenuModel`；`ProjectMenuTarget = { id: string; path: string; name?: string }`
  - `buildRailNewMenu(t: { worktreeEnabled: boolean }): MenuModel`

- [ ] **Step 1: Write the failing tests**

```ts
// session.test.ts
import { describe, expect, test } from "bun:test"
import { buildSessionMenu } from "./session"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

const row = { id: "s1", title: "会话", kind: "row" as const, canFork: true, canDelete: true }

test("row menu is open/rename/fork/export/copyId then delete", () => {
  const m = buildSessionMenu(row)
  expect(ids(m)).toEqual([
    "session.open", "session.rename", "session.fork", "session.export",
    "session.copyId", "session.delete",
  ])
  expect(validateMenu(m)).toEqual([])
})

test("tab menu swaps delete for close", () => {
  const m = buildSessionMenu({ ...row, kind: "tab" })
  expect(ids(m)).toEqual([
    "session.open", "session.rename", "session.fork", "session.export",
    "session.copyId", "session.closeTab",
  ])
})

test("fork is disabled with a reason when unavailable; delete is danger", () => {
  const m = buildSessionMenu({ ...row, canFork: false })
  const fork = m.items.find((i) => i.type === "item" && i.id === "session.fork") as any
  const del = m.items.find((i) => i.type === "item" && i.id === "session.delete") as any
  expect(fork.disabled).toBe(true)
  expect(fork.disabledReason).toBe("当前运行时不支持分叉")
  expect(del.danger).toBe(true)
  expect(del.confirms).toBe(true)
})
```

```ts
// project.test.ts
test("project menu is new session / reveal / copy path", () => {
  expect(ids(buildProjectMenu({ id: "p", path: "C:/work/x" }))).toEqual([
    "project.newSession", "project.reveal", "project.copyPath",
  ])
})
```

```ts
// rail.test.ts
test("worktree item is hidden when unsupported", () => {
  expect(ids(buildRailNewMenu({ worktreeEnabled: true }))).toEqual(["rail.newSession", "rail.newWorktree"])
  expect(ids(buildRailNewMenu({ worktreeEnabled: false }))).toEqual(["rail.newSession"])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test "src/renderer/mafw/context-menu/builders/*.test.ts"`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement the three builders**

- 标签进 `labels.ts`：`session.{open,rename,fork,export,copyId,closeTab,delete}`、`project.{newSession,reveal,copyPath}`、`rail.{newSession,newWorktree}`。
- 会话行/页签共用 1–5 项，第 6 项按 `kind` 二选一；`session.delete` 用 `{ danger: true, confirms: true }`；`session.closeTab` 不加 danger、不加省略号。
- `session.fork` 在 `!canFork` 时 `disabled: true, disabledReason: "当前运行时不支持分叉"`；`session.delete` 在 `!canDelete` 时 `disabled: true, disabledReason: "会话正在运行"`。
- 项目菜单 3 项；rail 菜单 2 项，`!worktreeEnabled` 时**不生成**该项。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/context-menu
git commit -m "feat(desktop): add session, project and rail menu builders"
```

---

### Task 3: 消息 / 代码块 / 文件路径菜单

**Files:**
- Create: `context-menu/builders/message.ts`
- Create: `context-menu/builders/file-path.ts`
- Test: `context-menu/builders/message.test.ts`, `.../file-path.test.ts`

**Interfaces:**
- Produces:
  - `buildMessageMenu(t: MessageMenuTarget): MenuModel`；`MessageMenuTarget = { id: string; role: "user" | "assistant"; hasText: boolean; canFork: boolean; tts: boolean }`
  - `buildCodeBlockMenu(t: { code: string }): MenuModel`
  - `buildFilePathMenu(t: FilePathMenuTarget): MenuModel`；`FilePathMenuTarget = { root: string; rel: string; inRoot: boolean; canOpenEditor: boolean }`

- [ ] **Step 1: Write the failing tests**

```ts
test("user message: copy, copy markdown, quote, fork", () => {
  expect(ids(buildMessageMenu({ id: "m", role: "user", hasText: true, canFork: true, tts: false })))
    .toEqual(["message.copy", "message.copyMarkdown", "message.quote", "message.fork"])
})

test("assistant message substitutes read-aloud for fork when TTS is available", () => {
  expect(ids(buildMessageMenu({ id: "m", role: "assistant", hasText: true, canFork: false, tts: true })))
    .toEqual(["message.copy", "message.copyMarkdown", "message.quote", "message.readAloud"])
  expect(ids(buildMessageMenu({ id: "m", role: "assistant", hasText: true, canFork: false, tts: false })))
    .toEqual(["message.copy", "message.copyMarkdown", "message.quote"])
})

test("code block: copy code, copy markdown", () => {
  expect(ids(buildCodeBlockMenu({ code: "x" }))).toEqual(["code.copy", "code.copyMarkdown"])
})

test("file path has open-with and copy submenus", () => {
  const m = buildFilePathMenu({ root: "C:/r", rel: "a/b.ts", inRoot: true, canOpenEditor: true })
  expect(ids(m)).toEqual([
    "filePath.attach", "filePath.openEditor", "filePath.openWith",
    "filePath.openWith.default", "filePath.openWith.vscode", "filePath.openWith.cursor", "filePath.openWith.zed",
    "filePath.reveal", "filePath.copy",
    "filePath.copy.abs", "filePath.copy.rel", "filePath.copy.name",
  ])
  expect(validateMenu(m)).toEqual([])
})

test("outside-root paths lose the editor item", () => {
  expect(ids(buildFilePathMenu({ root: "C:/r", rel: "../x.ts", inRoot: false, canOpenEditor: true })))
    .not.toContain("filePath.openEditor")
})
```

- [ ] **Step 2: Run to fail**

Run: `... --test "src/renderer/mafw/context-menu/builders/*.test.ts"`
Expected: FAIL

- [ ] **Step 3: Implement**

- 消息：`hasText=false` 时 `message.copy` / `message.copyMarkdown` disabled（reason「没有可复制的文本」）。
- 代码块两项。
- 文件路径：`inRoot && canOpenEditor` 才生成 `filePath.openEditor`；`openWith` 子菜单固定 4 项；`copy` 子菜单固定 3 项；`filePath.copy` 自身是 submenu（不是 item）。
- 标签进 `labels.ts`（`message.*`、`code.*`、`filePath.*`）。

- [ ] **Step 4: Run to pass**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(desktop): add message, code block and file path menu builders"
```

---

### Task 4: 文件树 / 编辑器页签 / 终端 / 浏览器菜单

**Files:**
- Create: `context-menu/builders/file-tree.ts`
- Create: `context-menu/builders/editor-tab.ts`
- Create: `context-menu/builders/terminal.ts`
- Create: `context-menu/builders/browser.ts`
- Test: 同目录四个 `.test.ts`

**Interfaces:**
- `buildFileTreeMenu(t: { rel: string; kind: "file" | "dir"; previewable: boolean }): MenuModel`
- `buildEditorTabMenu(t: { rel: string; index: number; count: number }): MenuModel`
- `buildTerminalMenu(t: { hasSelection: boolean; canClose: boolean }): MenuModel`
- `buildBrowserMenu(t: { url: string; canBack: boolean; canForward: boolean; started: boolean; canPick: boolean }): MenuModel`

- [ ] **Step 1: Write the failing tests**

```ts
test("file tree: file preview vs directory", () => {
  expect(ids(buildFileTreeMenu({ rel: "a.ts", kind: "file", previewable: true })))
    .toEqual(["fileTree.open", "fileTree.preview", "fileTree.attach", "fileTree.reveal", "fileTree.copy"])
  expect(ids(buildFileTreeMenu({ rel: "src", kind: "dir", previewable: false })))
    .toEqual(["fileTree.open", "fileTree.attach", "fileTree.reveal", "fileTree.copy"])
})

test("editor tab: close family then copy/reveal", () => {
  const m = buildEditorTabMenu({ rel: "a.ts", index: 0, count: 3 })
  expect(ids(m)).toEqual([
    "editorTab.close", "editorTab.closeOthers", "editorTab.closeRight",
    "editorTab.copyPath", "editorTab.reveal",
  ])
  const single = buildEditorTabMenu({ rel: "a.ts", index: 0, count: 1 })
  expect((single.items[1] as any).disabled).toBe(true)   // closeOthers
  expect((single.items[2] as any).disabled).toBe(true)   // closeRight
})

test("terminal: copy disabled without selection; close is danger last", () => {
  const m = buildTerminalMenu({ hasSelection: false, canClose: true })
  expect(ids(m)).toEqual([
    "terminal.copy", "terminal.paste", "terminal.selectAll", "terminal.clear",
    "terminal.openExternal", "terminal.close",
  ])
  expect((m.items[0] as any).disabled).toBe(true)
  const close = m.items.at(-1) as any
  expect(close.danger).toBe(true)
  expect(close.confirms).toBe(true)
})

test("browser: disabled states follow capabilities", () => {
  const m = buildBrowserMenu({ url: "", canBack: false, canForward: false, started: false, canPick: false })
  expect(ids(m)).toEqual([
    "browser.back", "browser.forward", "browser.reload",
    "browser.copyLink", "browser.openExternal", "browser.pick",
  ])
  expect((m.items[0] as any).disabled).toBe(true)
  expect((m.items[3] as any).disabled).toBe(true)
})
```

- [ ] **Step 2–4: fail → implement → pass**

实现要点：文件树 `preview` 仅在 `kind === "file" && previewable`；编辑器页签 `closeOthers` 在 `count <= 1` 禁用、`closeRight` 在 `index >= count - 1` 禁用；终端 6 项、`terminal.close` danger + confirms；浏览器 6 项，`copyLink` 在空 URL 禁用、`pick` 在 `!canPick` 时**不生成**。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(desktop): add file tree, editor tab, terminal and browser menu builders"
```

---

### Task 5: 面板行与卡片菜单

**Files:**
- Create: `context-menu/builders/panel.ts`
- Create: `context-menu/builders/card.ts`
- Test: `context-menu/builders/panel.test.ts`, `.../card.test.ts`, `context-menu/invariants.test.ts`

**Interfaces:**

```ts
// panel.ts
buildExecutionRowMenu(t: { sessionID?: string; taskID?: string; kind: "subagent" | "background" | "trajectory"; canCancel: boolean }): MenuModel
buildReviewRowMenu(t: { rel: string }): MenuModel

// card.ts
buildGoalCardMenu(t: { goalId: string; running: boolean; canPause: boolean }): MenuModel
buildGoalCellMenu(t: { goalId: string; runId: string; sessionID?: string; artifact?: string; canRetry: boolean }): MenuModel
buildMemoryCardMenu(t: { id: string; pinned: boolean; sticky: boolean }): MenuModel
buildNotesCardMenu(t: { id: string }): MenuModel
buildApprovalQuestionMenu(t: { id: string }): MenuModel
buildApprovalPermissionMenu(t: { id: string; command?: string }): MenuModel
buildTriageCardMenu(t: { id: string; goalId: string }): MenuModel
buildAutomationCardMenu(t: { id: string; enabled: boolean }): MenuModel
```

- [ ] **Step 1: Write the failing tests（表驱动）**

```ts
test("execution rows", () => {
  expect(ids(buildExecutionRowMenu({ sessionID: "s", kind: "background", canCancel: true })))
    .toEqual(["panel.openSession", "panel.copyId", "panel.cancel"])
  expect(ids(buildExecutionRowMenu({ sessionID: "s", kind: "trajectory", canCancel: false })))
    .toEqual(["panel.openSession", "panel.copyId"])
})

test("review row", () => {
  expect(ids(buildReviewRowMenu({ rel: "a.ts" })))
    .toEqual(["review.open", "review.reveal", "review.copy"])
})

test("goal card omits resume entirely and pause only while running", () => {
  expect(ids(buildGoalCardMenu({ goalId: "g", running: true, canPause: true })))
    .toEqual(["goal.details", "goal.timeline", "goal.copyId", "goal.pause", "goal.cancel"])
  expect(ids(buildGoalCardMenu({ goalId: "g", running: false, canPause: false })))
    .toEqual(["goal.details", "goal.timeline", "goal.copyId", "goal.cancel"])
  expect(ids(buildGoalCardMenu({ goalId: "g", running: true, canPause: true }))).not.toContain("goal.resume")
})

test("goal cell", () => {
  expect(ids(buildGoalCellMenu({ goalId: "g", runId: "r", canRetry: false })))
    .toEqual(["goalCell.openSession", "goalCell.retry", "goalCell.copyArtifact"])
})

test("memory card sticky variants", () => {
  expect(ids(buildMemoryCardMenu({ id: "m", pinned: false, sticky: false })))
    .toEqual(["memory.copyAbstraction", "memory.copyFull", "memory.pin", "memory.sticky", "memory.delete"])
  expect(ids(buildMemoryCardMenu({ id: "m", pinned: true, sticky: true })))
    .toEqual(["memory.copyAbstraction", "memory.copyFull", "memory.pin", "memory.sticky", "memory.unsticky", "memory.delete"])
})

test("approval question and notes cards", () => {
  expect(ids(buildApprovalQuestionMenu({ id: "q" })))
    .toEqual(["approvalQ.approve", "approvalQ.reject", "approvalQ.copyQuestion"])
  expect(ids(buildNotesCardMenu({ id: "n" }))).toEqual(["notes.renew", "notes.unsticky", "notes.delete"])
})

test("approval permission hides copy when there is no command", () => {
  expect(ids(buildApprovalPermissionMenu({ id: "a" })))
    .toEqual(["approvalP.allowOnce", "approvalP.alwaysAllow", "approvalP.reject", "approvalP.rememberPrefix", "approvalP.rememberTool"])
})

test("triage has all three decisions", () => {
  expect(ids(buildTriageCardMenu({ id: "t", goalId: "g" })))
    .toEqual(["triage.confirm", "triage.proposeConfirm", "triage.proposeReject", "triage.viewGoal", "triage.dismiss"])
})

test("automation toggle label follows state", () => {
  const on = buildAutomationCardMenu({ id: "r", enabled: true })
  expect((on.items[0] as any).label).toBe("停用")
  const off = buildAutomationCardMenu({ id: "r", enabled: false })
  expect((off.items[0] as any).label).toBe("启用")
  expect(ids(off)).toEqual(["automation.toggle", "automation.copyId", "automation.delete"])
})
```

```ts
// invariants.test.ts —— 所有 surface 的样板 target 都过语法约束
import { validateMenu } from "./model"
import type { MenuModel } from "./types"

const fixtures: MenuModel[] = [
  buildSessionMenu({ id: "s", title: "t", kind: "row", canFork: true }),
  buildSessionMenu({ id: "s", title: "t", kind: "tab", canFork: true }),
  buildProjectMenu({ id: "p", path: "C:/r" }),
  buildRailNewMenu({ worktreeEnabled: true }),
  buildMessageMenu({ id: "m", role: "user", hasText: true, canFork: true, tts: true }),
  buildMessageMenu({ id: "m", role: "assistant", hasText: true, canFork: false, tts: true }),
  buildCodeBlockMenu({ code: "x" }),
  buildFilePathMenu({ root: "C:/r", rel: "a.ts", inRoot: true, canOpenEditor: true }),
  buildFileTreeMenu({ rel: "a.ts", kind: "file", previewable: true }),
  buildFileTreeMenu({ rel: "d", kind: "dir", previewable: false }),
  buildEditorTabMenu({ rel: "a.ts", index: 1, count: 3 }),
  buildTerminalMenu({ hasSelection: true, canClose: true }),
  buildBrowserMenu({ url: "https://x", canBack: true, canForward: true, started: true, canPick: true }),
  buildExecutionRowMenu({ sessionID: "s", kind: "background", canCancel: true }),
  buildReviewRowMenu({ rel: "a.ts" }),
  buildGoalCardMenu({ goalId: "g", running: true, canPause: true }),
  buildGoalCellMenu({ goalId: "g", runId: "r", sessionID: "s", artifact: "a.json", canRetry: true }),
  buildMemoryCardMenu({ id: "m", pinned: true, sticky: true }),
  buildNotesCardMenu({ id: "n" }),
  buildApprovalQuestionMenu({ id: "q" }),
  buildApprovalPermissionMenu({ id: "p", command: "rm -rf x" }),
  buildTriageCardMenu({ id: "t", goalId: "g" }),
  buildAutomationCardMenu({ id: "r", enabled: true }),
]

test("every builder output satisfies the grammar", () => {
  for (const m of fixtures) expect({ surface: m.surface, errors: validateMenu(m) }).toEqual({ surface: m.surface, errors: [] })
})

test("models contain no functions", () => {
  const hasFn = (v: unknown): boolean =>
    typeof v === "function" ? true
      : Array.isArray(v) ? v.some(hasFn)
      : v && typeof v === "object" ? Object.values(v).some(hasFn)
      : false
  for (const m of fixtures) expect(hasFn(m)).toBe(false)
})
```

- [ ] **Step 2–4: fail → implement → pass**

实现要点：
- **每个 danger 项前必须有一条 `sep()`**（invariants 会检查）；
- `panel.openSession` 仅在 `sessionID` 存在时生成；`panel.cancel` 仅在 `canCancel && kind !== "trajectory"` 时生成；
- `goal.pause` 仅在 `running && canPause` 时生成；`goal.cancel` danger + confirms；
- `goalCell.retry` 在 `!canRetry` 时 disabled（reason「节点不可重跑」）；`copyArtifact` 在无 artifact 时 disabled；
- `memory.pin` 标签随 `pinned` 在「固定 / 取消固定」切换；`memory.sticky` 标签随 `sticky` 在「设为便签 / 续期」切换；`memory.unsticky` 仅在 `sticky` 时生成；`memory.delete` danger + confirms；
- `approvalP.copyCommand` 仅在 `command` 非空时生成；批准/拒绝**不加 danger**；
- `triage.dismiss` danger + confirms；
- `automation.delete` danger + confirms。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(desktop): add panel and card menu builders"
```

---

### Task 6: 原生回落、键盘判定与边缘夹取

**Files:**
- Create: `context-menu/guard.ts`
- Create: `context-menu/keyboard.ts`
- Create: `context-menu/clamp.ts`
- Test: `context-menu/guard.test.ts`, `.../keyboard.test.ts`, `.../clamp.test.ts`

**Interfaces:**
- `GuardFacts = { tagName: string; isEditable: boolean; hasSelection: boolean; isMediaOrLink: boolean; forceNative: boolean }`
- `shouldUseNativeMenu(f: GuardFacts): boolean`
- `guardFactsFromEvent(e: MouseEvent): GuardFacts`（DOM 适配，薄）
- `isMenuKey(e: { key: string; shiftKey: boolean }): boolean`
- `clampMenuPoint(p: { x: number; y: number }, viewport: { width: number; height: number }, size?: { width: number; height: number }): { x: number; y: number }`

- [ ] **Step 1: Write the failing tests**

```ts
test("editable, selection, media/link and forced targets use the native menu", () => {
  const base = { tagName: "DIV", isEditable: false, hasSelection: false, isMediaOrLink: false, forceNative: false }
  expect(shouldUseNativeMenu(base)).toBe(false)
  expect(shouldUseNativeMenu({ ...base, isEditable: true })).toBe(true)
  expect(shouldUseNativeMenu({ ...base, hasSelection: true })).toBe(true)
  expect(shouldUseNativeMenu({ ...base, isMediaOrLink: true })).toBe(true)
  expect(shouldUseNativeMenu({ ...base, forceNative: true })).toBe(true)
})

test("menu key is Shift+F10 or the ContextMenu key", () => {
  expect(isMenuKey({ key: "F10", shiftKey: true })).toBe(true)
  expect(isMenuKey({ key: "ContextMenu", shiftKey: false })).toBe(true)
  expect(isMenuKey({ key: "F10", shiftKey: false })).toBe(false)
})

test("clamps a menu that would overflow the viewport", () => {
  expect(clampMenuPoint({ x: 990, y: 590 }, { width: 1000, height: 600 })).toEqual({ x: 752, y: 372 })
  expect(clampMenuPoint({ x: 10, y: 10 }, { width: 1000, height: 600 })).toEqual({ x: 10, y: 10 })
})
```

`clampMenuPoint` 默认菜单尺寸 `{ width: 240, height: 220 }`，留 8px 边距：`x = min(x, viewport.width - width - 8)`，`y = min(y, viewport.height - height - 8)`，且不小于 8。

- [ ] **Step 2–4: fail → implement → pass**

`guardFactsFromEvent` 读取 `e.target.closest(...)`：`input, textarea, [contenteditable='true'], [data-native-menu]` → `isEditable`/`forceNative`；`img, video, audio, a[href]` → `isMediaOrLink`；`window.getSelection()?.isCollapsed === false` → `hasSelection`。此函数不写单测（依赖 DOM），由 GUI 冒烟覆盖；纯判定函数必须有测试。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(desktop): add native-menu guard, menu key and edge clamp"
```

---

### Task 7: 菜单宿主、渲染模型与样式

**Files:**
- Create: `context-menu/controller.ts`
- Create: `context-menu/render-model.ts`
- Create: `context-menu/MenuHost.tsx`
- Create: `context-menu/context-menu.css`
- Test: `context-menu/render-model.test.ts`, `context-menu/context-menu-css.test.ts`

**Interfaces:**
- `RenderRow` 联合类型
- `toRenderRows(model: MenuModel): RenderRow[]`
- `createMenuController()` → `{ request, close, current }`
- `menuController`（模块单例）
- `MenuHost(props: { controller })`
- `request` 签名：`request<T>(build: (t: T) => MenuModel, target: T, run: (id: string) => void, opts?: { point?: { x: number; y: number }; from?: "contextmenu" | "ellipsis" | "keyboard" })`

- [ ] **Step 1: Write the failing tests**

```ts
// render-model.test.ts
test("groups and submenus flatten into render rows", () => {
  const m: MenuModel = {
    surface: "file.path",
    items: [
      item("a", "A"),
      group("g", "分组", [item("b", "B")]),
      submenu("s", "更多", [item("c", "C")]),
      sep(),
      item("d", "删除…", { danger: true }),
    ],
  }
  const rows = toRenderRows(m)
  expect(rows.map((r) => r.kind)).toEqual(["item", "group", "submenu", "separator", "item"])
  expect(rows[1]).toMatchObject({ kind: "group", rows: [{ kind: "item" }] })
})

test("checkbox and radio survive the mapping", () => {
  const rows = toRenderRows({ surface: "session.row", items: [checkbox("c", "显示", true), radio("r", "紧凑", false)] })
  expect(rows.map((r) => r.kind)).toEqual(["checkbox", "radio"])
})
```

```ts
// context-menu-css.test.ts
const css = readFileSync(join(import.meta.dirname, "context-menu.css"), "utf8")
test("danger items are visually distinct", () => {
  expect(css).toMatch(/\[data-danger\][^{]*\{[^}]*color:\s*var\(--danger/)
})
test("shortcut column and icon slot exist", () => {
  expect(css).toMatch(/\.mafw-context-menu-shortcut\s*\{/)
  expect(css).toMatch(/\.mafw-context-menu-icon\s*\{/)
})
```

- [ ] **Step 2–4: fail → implement → pass**

实现要点：
- 宿主用受控的 `ContextMenu`（`@mafw/ui/context-menu`）：`open={!!current()}`、`onOpenChange`、Trigger 为 `style={{ position: "fixed", left, top, width: 1, height: 1 }}` 的 span；`Content` Portal 到 body。
- 打开前用 `clampMenuPoint` 处理 `point`（无 point 时用触发元素 rect）。
- `MenuHost` 渲染 `item / separator / submenu / group / checkbox / radio`；`item` 带 `data-danger`、图标、`<span class="mafw-context-menu-shortcut">{shortcut}</span>`；`disabledReason` 用 `ContextMenu.ItemDescription`。
- 点击项：`run(id)` 后 `close()`；Esc/点外由 Kobalte 关闭。
- CSS：`.mafw-context-menu [data-danger]`、hover danger 背景、shortcut 右对齐、icon 16px 槽、group label 样式。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(desktop): add single menu host, render mapping and styles"
```

---

### Task 8: 迁移 shell 三处入口

**Files:**
- Modify: `components/IconRail.tsx`
- Modify: `components/LeftDock.tsx`
- Modify: `components/SessionStrip.tsx`
- Modify: `MafwShell.tsx`（挂一次 `<MenuHost controller={menuController} />`）
- Test: `components/context-menu-wiring.test.ts`

**Interfaces:**
- Consumes: `menuController.request`, `buildRailNewMenu`, `buildSessionMenu`, `guardFactsFromEvent`, `isMenuKey`.
- Produces: `handleSessionMenu(id: string)` 三处共用（放在 `MafwShell` 附近的新模块 `context-menu/session-actions.ts`，纯函数 `sessionActionKind(id)` 可测）。

- [ ] **Step 1: Write the failing contract test**

```ts
const read = (p: string) => readFileSync(join(import.meta.dirname, p), "utf8")

test("shell surfaces request menus from builders", () => {
  expect(read("IconRail.tsx")).toContain("buildRailNewMenu")
  expect(read("LeftDock.tsx")).toContain("buildSessionMenu")
  expect(read("LeftDock.tsx")).toContain("buildProjectMenu")
  expect(read("SessionStrip.tsx")).toContain("buildSessionMenu")
})

test("no synthetic contextmenu events remain", () => {
  expect(read("LeftDock.tsx")).not.toContain('new MouseEvent("contextmenu"')
})

test("rows and tabs are keyboard focusable", () => {
  expect(read("LeftDock.tsx")).toMatch(/mafw-rail-session[^>]*tabIndex=\{0\}/)
  expect(read("SessionStrip.tsx")).toMatch(/mafw-session-tab[^>]*tabIndex=\{0\}/)
})

test("session delete still goes through the confirm state", () => {
  expect(read("LeftDock.tsx")).toContain("setDeleteConfirmId")
})
```

- [ ] **Step 2: Run to fail**

Run: `... --test src/renderer/mafw/components/context-menu-wiring.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

- `MafwShell` 顶部渲染 `<MenuHost controller={menuController} />`（一次）。
- IconRail `＋`：`onContextMenu` → guard → `menuController.request(buildRailNewMenu, { worktreeEnabled: !!props.worktreeEnabled }, run, { point })`；`run` 处理 `rail.newSession` / `rail.newWorktree`。
- LeftDock 会话行：`onContextMenu` + `⋯` 按钮（同一个 request，point 取按钮 rect）+ `onKeyDown`（`isMenuKey` → point 取行 rect）；`tabIndex={0}`；`run` 处理 `session.open/rename/fork/export/copyId/delete`。删除仍走 `setDeleteConfirmId`，不直接删。新增可选 props `forkEnabled?: boolean`（MafwShell 传 `caps().sessionBranchApi`）、`onForkSession?: (id: string) => void`、`onExportSession?: (id: string) => void`（MafwShell 复用 SessionStrip 的两个处理器）；target 的 `canFork` 用 `forkEnabled`（缺省 true）。
- LeftDock 项目行：`onContextMenu` → `request(buildProjectMenu, { id, path }, run)`；`run` 处理新建会话 / `revealPath` / 复制路径。
- SessionStrip 页签：同上（`forkEnabled` / `onFork` 由 MafwShell 传，`onFork` 与 LeftDock 共用同一处理器）；`run` 额外处理 `session.closeTab`；保留原有「全部会话」溢出下拉。
- 删除 `context-menu` 之外的旧 `<ContextMenu>` 包裹；`session.rename` 触发行内改名。
- 分叉：调用现有 `window.api.mafw.sessions.fork({ path: { id }, body: {} })` 并打开新会话（复用 MafwShell 现有分叉处理；若无则 toast 错误）。

- [ ] **Step 4: Run to pass**

Run: 同上 + `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(desktop): migrate rail, session list and tabs to the menu host"
```

---

### Task 9: 迁移卡片五处并修缺陷

**Files:**
- Modify: `pages/Dashboard.tsx`
- Modify: `pages/Memory.tsx`
- Modify: `pages/ApprovalsPage.tsx`
- Modify: `pages/TriagePage.tsx`
- Modify: `pages/Automations.tsx`
- Delete: `components/MafwContextMenu.tsx`
- Test: `pages/context-menu-wiring.test.ts`

- [ ] **Step 1: Write the failing contract test**

```ts
const read = (p: string) => readFileSync(join(import.meta.dirname, p), "utf8")

test("cards no longer hand-write menus", () => {
  for (const f of ["Dashboard.tsx", "Memory.tsx", "ApprovalsPage.tsx", "TriagePage.tsx", "Automations.tsx"]) {
    const src = read(f)
    expect(src).not.toContain("MafwContextMenu")
    expect(src).toContain("menuController.request")
  }
})

test("automations has no duplicate disable and triage has all decisions", () => {
  const automations = read("Automations.tsx")
  expect(automations).not.toMatch(/label:\s*"Disable"[\s\S]*label:\s*"Disable"/)
  const triage = read("TriagePage.tsx")
  expect(triage).toContain("buildTriageCardMenu")
})

test("dashboard no longer offers resume", () => {
  expect(read("Dashboard.tsx")).not.toContain("RESUME")
})
```

- [ ] **Step 2–4: fail → implement → pass**

- 每张卡片用 `onContextMenu` + `guardFactsFromEvent` + `menuController.request`，并在 `run` 中映射既有动作（Go​​al 控制、复制、删除、审批 respond、triage act、automation toggle）。
- **删除** `components/MafwContextMenu.tsx` 与全部 import。
- 修复：Automations 重复 Disable；Approvals 用纯文本「批准/拒绝」（去 mojibake）；Triage 补三档决策；Dashboard 移除 Resume；Memory 增加固定/取消固定与便签项。
- 薄封装（网关路由已存在，按路由源码的字段名接线）：
  - SDK `packages/gateway-sdk/src/client.ts`：`memory.setPinned(id: string, pinned: boolean)` → `POST /api/memory/pin`，body `{ id, pinned }`（与现有 `setSticky` 同端点）；`automations.remove(id: string)` → `DELETE /api/automations/:id`。
  - preload `src/preload/index.ts` + `src/preload/mafw-api.ts` + `src/preload/mafw-types.ts`：补 `memory.setPinned` / `automations.remove`。
  - SDK 单测（`packages/gateway-sdk/src/client.test.ts`）加两条：方法 + URL + body；preload 不单测（薄转发）。
- `Automations` 删除项调用 `window.api.mafw.automations.remove(id)`。

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(desktop): migrate cards to menu host and fix menu defects"
```

---

### Task 10: 接线文件路径 / 文件树 / 编辑器页签

**Files:**
- Modify: `packages/session-ui/src/components/markdown.tsx`（相对链接加 `data-file-path`）
- Modify: `packages/session-ui/src/components/message-part.tsx`（路径 span 加 `data-file-path`）
- Modify: `packages/session-ui/src/components/session-turn.tsx`（`data-message-role` / `data-message-id`）
- Modify: `components/ChatPane.tsx`（委托 + 会话目录）
- Modify: `components/FilesDock.tsx`
- Modify: `components/EditorDock.tsx`
- Test: `components/context-menu-wiring.test.ts`（追加）、`context-menu/builders/file-path.test.ts`（补边界）

**Interfaces:**
- Consumes: `buildFilePathMenu`, `buildFileTreeMenu`, `buildEditorTabMenu`。
- 会话根：`props.sessionDirectory`（ChatPane 已有 session 的 directory；worktree 会话即 worktree 目录）。

- [ ] **Step 1: Write failing tests**

```ts
test("file surfaces are wired", () => {
  expect(read("../../../../../session-ui/src/components/markdown.tsx")).toContain("data-file-path")
  expect(read("../../../../../session-ui/src/components/message-part.tsx")).toContain("data-file-path")
  expect(read("../../../../../session-ui/src/components/session-turn.tsx")).toContain("data-message-role")
  expect(read("ChatPane.tsx")).toContain("buildFilePathMenu")
  expect(read("FilesDock.tsx")).toContain("buildFileTreeMenu")
  expect(read("EditorDock.tsx")).toContain("buildEditorTabMenu")
})
```

- [ ] **Step 2–4: fail → implement → pass**

- ChatPane：在 turn 容器 `onContextMenu` 中 `closest("[data-file-path]")`；无命中则交给消息菜单（Task 11）。根复用 ChatPane 现有 `sessionDirectory()`（`store.session` 里该会话的 `directory`，worktree 会话即 worktree 目录）；`inRoot = !rel.startsWith("..") && !isAbsolute(rel)`；`canOpenEditor = inRoot`。
- session-ui 增量标记：`session-turn-message-container` 加 `data-message-role="user"`；`session-turn-assistant-content` 加 `data-message-role="assistant"` 与 `data-message-id={该回合最后一条 assistant message 的 id}`。
- FilesDock：行 `onContextMenu` + 键盘；`rel` 由行数据提供；`previewable` 复用现有 `fileOpenPlan`。
- EditorDock：tab `onContextMenu`，`index`/`count` 从当前 tabs 计算；`copyPath` 复制 `root + "/" + rel` 的相对显示值（与现有路径展示一致）。
- session-ui 只加属性，不改结构/样式。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(desktop): wire file path, file tree and editor tab menus"
```

---

### Task 11: 接线消息 / 代码块 / 终端 / 浏览器 chrome

**Files:**
- Modify: `components/ChatPane.tsx`
- Modify: `components/TerminalDock.tsx`
- Modify: `components/BrowserDock.tsx`
- Test: `components/context-menu-wiring.test.ts`（追加）

- [ ] **Step 1: Write failing tests**

```ts
test("message, terminal and browser surfaces are wired", () => {
  expect(read("ChatPane.tsx")).toContain("buildMessageMenu")
  expect(read("ChatPane.tsx")).toContain("buildCodeBlockMenu")
  expect(read("TerminalDock.tsx")).toContain("buildTerminalMenu")
  expect(read("BrowserDock.tsx")).toContain("buildBrowserMenu")
})
```

- [ ] **Step 2–4: fail → implement → pass**

- ChatPane：委托顺序 code block → file path → message；`pre > code` 取 `textContent`；消息 target `role` 由 `data-message-role`（session-ui 增量标记）或 DOM 位置判定；`canFork = role === "user"`。
- TerminalDock：`onContextMenu` 挂 xterm 容器；`hasSelection = !!term.getSelection()`；复制用 `navigator.clipboard.writeText`；粘贴走现有 PTY 输入；清屏写 `\x1b[2J\x1b[H`；关闭走现有 `requestKill`。
- BrowserDock：菜单挂在 `DockPanelHeader`/地址栏容器；`canBack/canForward` 用现有 `view` 方法；`started = started()`；`canPick = true`（已有按钮）；`copyLink` 用 `address()`；webview 页面内不接管。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(desktop): wire message, terminal and browser context menus"
```

---

### Task 12: 面板行 / Goal 泳道格 / 全量门禁

**Files:**
- Modify: `components/BackgroundDock.tsx`
- Modify: `components/SubagentDock.tsx`
- Modify: `components/TrajectoryDock.tsx`
- Modify: `components/ChangesDock.tsx`
- Modify: `components/NotesDock.tsx`
- Modify: `components/GoalTimelineLane.tsx`
- Test: `components/context-menu-wiring.test.ts`（追加）

- [ ] **Step 1: Write failing tests**

```ts
test("panels and goal cells are wired", () => {
  for (const f of ["BackgroundDock.tsx", "SubagentDock.tsx", "TrajectoryDock.tsx", "ChangesDock.tsx"]) {
    expect(read(f)).toContain("menuController.request")
  }
  expect(read("NotesDock.tsx")).toContain("buildNotesCardMenu")
  expect(read("GoalTimelineLane.tsx")).toContain("buildGoalCellMenu")
})
```

- [ ] **Step 2–4: fail → implement → pass**

- 执行类行：`buildExecutionRowMenu`；打开会话、复制 ID、终止（`window.api.mafw.tasks.cancel`）。
- 审阅类行（ChangesDock）：`buildReviewRowMenu`；打开、定位、复制路径。
- Notes 卡（NotesDock）：`buildNotesCardMenu`；续期 / 下架 / 删除（复用现有 setSticky / 删除逻辑）。
- Goal 泳道格：`buildGoalCellMenu`；重跑调用现有 `goals.retryNode`。
- 全部行补 `tabIndex={0}` + `isMenuKey` 键盘入口（若已有焦点模型则复用）。

- [ ] **Step 5: Full gate**

```bash
cd packages/desktop && npm test
cd packages/desktop && npx tsgo --noEmit -p tsconfig.json
cd packages/desktop && npx electron-vite build
```

Expected: 全绿；`npm test` 输出新增用例数；tsgo rc=0；build rc=0。

- [ ] **Step 6: GUI 冒烟（dev app）**

逐项验证 Review Focus 1–7：
1. 消息选区右键 → 原生菜单；
2. 消息图片/链接右键 → 仅一张原生菜单；
3. 会话改名输入框右键 → 原生菜单；
4. 窗口右下角右键 → 菜单完整可见；
5. 会话行/页签 Shift+F10 → 同右键菜单，关闭后焦点回原行；
6. 删除会话 → 走确认；
7. 会话目录外路径 → 无「在编辑器中打开」。

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(desktop): wire panel and goal cell menus; complete context menu rollout"
```
