# Agent Workbench 一期（文件浏览器 + 协同编辑器）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（用户既定执行方式：inline 主会话逐 Task 推进，每 Task 一 commit，结束前独立 reviewer 全分支终审）to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RightDock 新增「文件」「编辑器」两个 tab——浏览当前会话目录、打开编辑文件（Ctrl+S 保存 + 外部改动冲突保护）、选中代码一句话直发 agent（人标出→agent 改）、编辑器内嵌 diff 原地验收。

**Architecture:** 纯 desktop 工程。main 进程新增 fs-workspace 纯模块（io 注入可测，jail 防路径逃逸）+ IPC；renderer 新增 file-tree / editor-state / editor-annotation 三个纯模块 + FilesDock/EditorDock 两个组件；编辑器内核用 CodeMirror 6（懒加载分包）；diff 验收复用已接线的 DiffReviewPanel。

**Tech Stack:** Electron main（node fs/watch）+ preload contextBridge + SolidJS renderer + CodeMirror 6 + 既有 @pierre/diffs（DiffReviewPanel 内部）。

**Spec:** `docs/superpowers/specs/2026-10-22-agent-workbench-design.md`（57e03f9c 已确认）

## Global Constraints

- 不动 gateway、不动 runtime、不动词汇；不动 SDK。
- desktop AGENTS.md：renderer 只经 `window.api`；main 的 IPC handler 一律注册在 `src/main/ipc.ts`。
- UI 约定（AGENTS §5.10）：禁裸 `<button>`/`<input>`/裸 `title`，一律 ButtonV2/TextInputV2/TooltipV2；CSS 全 token（三主题），禁硬编码颜色。
- 中文 UI 文案；commit message 英文 conventional。
- TDD：每 Task 先写失败测试再实现；测试命令（工作目录 `packages/desktop`）：
  - 单文件：`node --import tsx --import ../../packages/test-shim/register.mjs --test <path>`
  - 全量：`npm test`；类型：`npx tsgo --noEmit -p tsconfig.json`；构建：`npx electron-vite build`
- 新依赖（仅 Task 5）：`codemirror`、`@codemirror/language-data` 加进 `packages/desktop` **devDependencies**（与 @solidjs/* 等 renderer 库同组，vite 打包）；**必须动态 import 分包**，不进主 bundle。
- 基线：desktop 全量 **1131/1131**（e7f803cd 后）；每个 Task 结束保持全绿。

## Review Focus

以下输入类/失败模式 spec 暗示但单测容易漏，逐条钉到所属 Task 的步骤里：

1. **路径越狱**（`../..`、绝对路径、Windows 盘符跳转、rel 中混 `\` 与 `/`）→ jail 必须拒绝且**不抛异常**（返回 null/错误对象）。→ Task 1 Step 1 测试钉死。
2. **二进制 / 超大文件**（null 字节、>1MB）→ 拒绝打开并给中文原因，编辑器不得渲染乱码或卡死。→ Task 1 + Task 5 降级测试。
3. **用户编辑途中 agent 改了同一文件**（dirty + 外部改动）→ 状态机进冲突态、横幅保留用户编辑，绝不静默覆盖；缓冲区干净时才允许静默刷新。→ Task 4 状态机测试。
4. **会话/项目切换导致 root 变化**（含 worktree 会话）→ 打开的文件全部关闭，不展示别树旧内容；file tree 重新加载。→ Task 4 `onRootChange` 测试。
5. **标注选区边界**（跨多行、选区在文件末尾无换行、光标零宽 selection）→ 行范围与引用文本精确；零宽 selection 不出现批注入口。→ Task 6 测试。

---

### Task 1: fs-workspace 纯模块（main 进程文件原语 + jail）

**Files:**
- Create: `packages/desktop/src/main/fs-workspace.ts`
- Modify: `packages/desktop/src/main/file-listing.ts`（导出 `IGNORED_DIRS`，行为不变）
- Test: `packages/desktop/src/main/fs-workspace.test.ts`

**Interfaces:**
- Consumes: `IGNORED_DIRS`（file-listing.ts，既有私有常量 → 导出复用）
- Produces:
  ```ts
  export interface FsEntry { name: string; kind: "file" | "dir" }
  export interface FsIO {
    readdir(abs: string): Promise<{ name: string; isDirectory(): boolean }[]>
    readFile(abs: string): Promise<Buffer>
    writeFile(abs: string, data: string): Promise<void>
    stat(abs: string): Promise<{ mtimeMs: number }>
  }
  /** rel 统一正斜杠；越界/绝对路径/盘符跳转 → null（不抛）。 */
  export function resolveInRoot(root: string, rel: string): string | null
  /** 单层列举：目录在前、名称排序、IGNORED_DIRS 与隐藏文件（.开头，.mafw 除外）过滤。 */
  export function shapeEntries(entries: { name: string; isDirectory(): boolean }[]): FsEntry[]
  export const MAX_READ_BYTES = 1_048_576
  export type ReadResult =
    | { ok: true; content: string; mtimeMs: number }
    | { ok: false; reason: "too-large" | "binary" | "not-found" | "io" }
  export type WriteResult = { ok: true } | { ok: false; reason: "jail" | "not-found" | "conflict" | "io" }
  export function sniffBinary(buf: Buffer): boolean  // 前 512 字节含 \0
  ```

- [ ] **Step 1: Write the failing test**

`fs-workspace.test.ts`（纯函数，io 用内存 stub）：

```ts
import { describe, expect, test } from "bun:test"
import { resolveInRoot, shapeEntries, sniffBinary, MAX_READ_BYTES } from "./fs-workspace"

describe("resolveInRoot（jail）", () => {
  const root = "C:\\proj"
  test("正常相对路径 → root 下绝对路径", () => {
    expect(resolveInRoot(root, "src/a.ts")).toBe("C:\\proj\\src\\a.ts")
    expect(resolveInRoot(root, "a.ts")).toBe("C:\\proj\\a.ts")
  })
  test("越界/绝对/盘符/反斜杠混合 → null", () => {
    expect(resolveInRoot(root, "../outside.ts")).toBeNull()
    expect(resolveInRoot(root, "../../etc/passwd")).toBeNull()
    expect(resolveInRoot(root, "C:\\Windows\\x")).toBeNull()
    expect(resolveInRoot(root, "D:\\other")).toBeNull()
    expect(resolveInRoot(root, "src\\..\\..\\out")).toBeNull()
    expect(resolveInRoot(root, "")).toBeNull()
  })
  test("root 内但名字含 .. 片段不误判（如 a..b.ts）", () => {
    expect(resolveInRoot(root, "a..b.ts")).toBe("C:\\proj\\a..b.ts")
  })
})

describe("shapeEntries", () => {
  test("目录在前 + 名称排序 + IGNORED_DIRS/隐藏文件过滤", () => {
    const ents = [
      { name: "b.ts", isDirectory: () => false },
      { name: "node_modules", isDirectory: () => true },
      { name: ".git", isDirectory: () => true },
      { name: "src", isDirectory: () => true },
      { name: "a.ts", isDirectory: () => false },
    ]
    expect(shapeEntries(ents)).toEqual([
      { name: "src", kind: "dir" },
      { name: "a.ts", kind: "file" },
      { name: "b.ts", kind: "file" },
    ])
  })
})

describe("sniffBinary / MAX_READ_BYTES", () => {
  test("前 512 字节含 \\0 → binary；纯文本 → false", () => {
    expect(sniffBinary(Buffer.from([0x89, 0x00, 0x50]))).toBe(true)
    expect(sniffBinary(Buffer.from("hello 世界"))).toBe(false)
  })
  test("MAX_READ_BYTES = 1MB", () => { expect(MAX_READ_BYTES).toBe(1_048_576) })
})

describe("writeTextFile（保存时版本校验，调研 §3）", () => {
  // io stub：files 表 + mtime 表
  const mkIo = (files: Record<string, { buf: Buffer; mtime: number }>): FsIO => ({
    readdir: async () => [],
    readFile: async (abs) => files[abs]!.buf,
    writeFile: async (abs, data) => { files[abs] = { buf: Buffer.from(data), mtime: 999 } },
    stat: async (abs) => { if (!files[abs]) throw Object.assign(new Error("x"), { code: "ENOENT" }); return { mtimeMs: files[abs].mtime } },
  })
  test("ifMtimeMs 匹配 → 写入；不匹配 → conflict 不落盘", async () => {
    const io = mkIo({ "C:\\proj\\a.ts": { buf: Buffer.from("v1"), mtime: 100 } })
    expect(await writeTextFile(io, "C:\\proj", "a.ts", "v2", { ifMtimeMs: 100 })).toEqual({ ok: true })
    expect(await writeTextFile(io, "C:\\proj", "a.ts", "v3", { ifMtimeMs: 100 })).toEqual({ ok: false, reason: "conflict" })
  })
  test("目标不存在 → not-found（不创建新文件）；jail 外 → jail", async () => {
    const io = mkIo({})
    expect(await writeTextFile(io, "C:\\proj", "new.ts", "x")).toEqual({ ok: false, reason: "not-found" })
    expect(await writeTextFile(io, "C:\\proj", "../x.ts", "x")).toEqual({ ok: false, reason: "jail" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/fs-workspace.test.ts`（cwd `packages/desktop`）
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement `fs-workspace.ts` + 导出 IGNORED_DIRS**

- `file-listing.ts`：`const IGNORED_DIRS` → `export const IGNORED_DIRS`（其余不动）。
- `resolveInRoot`：rel 先把 `\` 归一为 `/`，拒绝空串/以 `/` 或盘符开头；`path.resolve(root, rel)` 后要求结果 === root 前缀 + 分隔符（大小写不敏感比较盘符）。
- `shapeEntries`：过滤 IGNORED_DIRS、`.` 开头（`.mafw` 放行——项目内 agent 产物用户可能要验收）；目录优先，`localeCompare` 排序。
- 组合 API（Task 2 的 IPC handler 直接用，本 Task 一并实现并各配一条用例）：
  ```ts
  export async function listDir(io: FsIO, root: string, rel: string): Promise<FsEntry[] | null>
  export async function readTextFile(io: FsIO, root: string, rel: string): Promise<ReadResult>
  /** ifMtimeMs 提供时先 stat 比对：磁盘 mtime 不同 → conflict（不覆盖）——保存时版本校验，
   *  补死 watch 防抖窗口内的静默覆盖（调研 §3 防线②，Aura/Paseo expected_revision 模式）。 */
  export async function writeTextFile(io: FsIO, root: string, rel: string, content: string, opts?: { ifMtimeMs?: number }): Promise<WriteResult>
  ```
  readTextFile：jail → Buffer 长度 > MAX_READ_BYTES → too-large → sniffBinary → binary → utf8 解码 + stat 取 mtimeMs；readdir/readFile 抛错含 ENOENT → not-found，其余 → io。writeTextFile：jail 失败 → `{ok:false,reason:"jail"}`，不创建新文件（只覆盖已存在文件——stat 验证目标存在，防 agent 诱导写任意新路径）；`ifMtimeMs` 校验失败 → `{ok:false,reason:"conflict"}`。

- [ ] **Step 4: Run test to verify it passes**

Run: 同 Step 2 命令
Expected: PASS（7 例）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/fs-workspace.ts packages/desktop/src/main/fs-workspace.test.ts packages/desktop/src/main/file-listing.ts
git commit -m "feat(desktop): fs-workspace main-process primitives with path jail"
```

---

### Task 2: fs IPC + preload `fs` 分组

**Files:**
- Modify: `packages/desktop/src/main/ipc.ts`（注册 5 个 handler + watcher 注册表）
- Create: `packages/desktop/src/main/fs-watcher.ts`（watcher 注册表纯逻辑）
- Modify: `packages/desktop/src/preload/index.ts`（api 增 `fs` 分组）
- Modify: `packages/desktop/src/preload/types.ts`（ElectronAPI 增 fs 类型）
- Test: `packages/desktop/src/main/fs-watcher.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `listDir/readTextFile/writeTextFile/resolveInRoot`；真实 io 用 `node:fs/promises`。
- Produces（renderer 经 `window.api.fs.*` 消费，Task 3/5 全靠它）:
  ```ts
  fs: {
    listDir(root: string, rel: string): Promise<FsEntry[] | null>
    readFile(root: string, rel: string): Promise<ReadResult>
    writeFile(root: string, rel: string, content: string, opts?: { ifMtimeMs?: number }): Promise<WriteResult>
    watch(root: string, rel: string): Promise<void>
    unwatch(root: string, rel: string): Promise<void>
    onChanged(cb: (e: { root: string; rel: string }) => void): () => void
    /** 外部编辑器逃生口（调研 §5）：main 经 shell.openPath 打开，jail 校验后调用。 */
    openExternal(root: string, rel: string): Promise<{ ok: boolean }>
  }
  ```

- [ ] **Step 1: Write the failing test**

`fs-watcher.test.ts`（注册表纯逻辑：debounce 合并、key 规范、unwatch 幂等）：

```ts
import { describe, expect, test } from "bun:test"
import { watchKey, planWatchEvent, WATCH_DEBOUNCE_MS } from "./fs-watcher"

describe("fs-watcher 注册表纯逻辑", () => {
  test("watchKey 归一（root\\rel 反斜杠归一为正斜杠）", () => {
    expect(watchKey("C:\\proj", "src\\a.ts")).toBe("C:/proj::src/a.ts")
  })
  test("debounce 窗口内重复事件合并为一次推送", () => {
    expect(WATCH_DEBOUNCE_MS).toBe(300)
    expect(planWatchEvent({ lastSentAt: 1000, now: 1200 })).toBe("debounce")
    expect(planWatchEvent({ lastSentAt: 1000, now: 1400 })).toBe("send")
    expect(planWatchEvent({ lastSentAt: 0, now: 100 })).toBe("send")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 fs-watcher.ts + ipc.ts 注册 + preload**

- `fs-watcher.ts`：上述纯函数 + main 侧 watcher 注册表（Map<key, FSWatcher>，`fs.watch` 事件经 `planWatchEvent` 节流，`webContents.send("fs-file-changed", {root, rel})`）。
- `ipc.ts`（在既有 deps 注入模式上新增；fs API 不依赖 gateway deps，直接实现）：`fs-list-dir` / `fs-read-file` / `fs-write-file`（透传 ifMtimeMs）/ `fs-watch` / `fs-unwatch` / `fs-open-external`（jail 后 `shell.openPath`）六个 handler，全部先经 Task 1 jail/原语，handler 本身不含逻辑。
- `preload/index.ts`：仿 `wslServers` 分组加 `fs`（`onChanged` 仿 `updater.subscribe` 的 ipcRenderer.on + 返回退订函数模式，但不自动 invoke——watch 由调用方显式发起）。
- `preload/types.ts`：ElectronAPI 增 `fs` 类型（签名见 Interfaces）。

- [ ] **Step 4: Run test + 类型检查**

Run: 单测命令 + `npx tsgo --noEmit -p tsconfig.json`
Expected: 测试 PASS；tsgo rc=0

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/ipc.ts packages/desktop/src/main/fs-watcher.ts packages/desktop/src/main/fs-watcher.test.ts packages/desktop/src/preload/index.ts packages/desktop/src/preload/types.ts
git commit -m "feat(desktop): fs IPC channels + preload fs group with file watcher"
```

---

### Task 3: file-tree 纯模块 + FilesDock 组件 +「文件」tab

**Files:**
- Create: `packages/desktop/src/renderer/mafw/file-tree.ts`
- Test: `packages/desktop/src/renderer/mafw/file-tree.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/FilesDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/dock-tab.ts`（+ `"files"` `"editor"`）
- Modify: `packages/desktop/tests/dock-tab.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/RightDock.tsx`（两个 trigger）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（两个 dock 分支 + sessionDirectory 传递）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（tree 样式）

**Interfaces:**
- Consumes: `window.api.fs.listDir`（Task 2）；dock-tab 既有 `DockTab/DOCK_TABS/normalizeDockTab` 模式（P0-3 先例：测试先行改契约再改实现）。
- Produces:
  ```ts
  export interface TreeRow { rel: string; name: string; kind: "file" | "dir"; depth: number }
  /** children: rel → 已加载子项；expanded: rel 集合。visibleRows 深度优先展开。 */
  export function visibleRows(rootEntries: FsEntry[], expanded: ReadonlySet<string>, children: Record<string, FsEntry[]>): TreeRow[]
  ```
  FilesDock props：
  ```ts
  { sessionDirectory: string | null; onOpenFile: (rel: string) => void }
  ```

- [ ] **Step 1: Write the failing test（dock-tab 契约 + file-tree 纯逻辑）**

- `tests/dock-tab.test.ts`：DOCK_TABS 期望改为 `[..., "background", "files", "editor"]`（九栏）+ 两个 normalize 直通用例。
- `file-tree.test.ts`：
  ```ts
  import { describe, expect, test } from "bun:test"
  import { visibleRows } from "./file-tree"

  const root = [{ name: "src", kind: "dir" as const }, { name: "a.ts", kind: "file" as const }]
  test("折叠态只出根层；展开目录插入其子项（depth+1）；未加载子项的展开目录不出子行", () => {
    expect(visibleRows(root, new Set(), {}).map(r => r.rel)).toEqual(["src", "a.ts"])
    const withKids = { src: [{ name: "b.ts", kind: "file" as const }] }
    expect(visibleRows(root, new Set(["src"]), withKids)).toEqual([
      { rel: "src", name: "src", kind: "dir", depth: 0 },
      { rel: "src/b.ts", name: "b.ts", kind: "file", depth: 1 },
      { rel: "a.ts", name: "a.ts", kind: "file", depth: 0 },
    ])
    expect(visibleRows(root, new Set(["src"]), {}).map(r => r.rel)).toEqual(["src", "a.ts"])
  })
  test("多层展开深度正确", () => {
    const children = {
      src: [{ name: "mafw", kind: "dir" as const }],
      "src/mafw": [{ name: "x.ts", kind: "file" as const }],
    }
    const rows = visibleRows(root, new Set(["src", "src/mafw"]), children)
    expect(rows[2]).toEqual({ rel: "src/mafw/x.ts", name: "x.ts", kind: "file", depth: 2 })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL（dock-tab 2 例 + file-tree 模块不存在）

- [ ] **Step 3: 实现 file-tree.ts + dock-tab.ts + FilesDock.tsx + 接线 + CSS**

- `file-tree.ts` 按测试语义实现。
- `dock-tab.ts`：DockTab 联合类型 + DOCK_TABS 末尾加 `"files" | "editor"`。
- `FilesDock.tsx`：
  - `root = props.sessionDirectory`；null → 空态「没有打开的会话」。
  - mount / root 变化 → `fs.listDir(root, "")` 填 rootEntries + 清空 expanded/children（root 变化重置，Review Focus #4）。
  - 行渲染：dir 行点击 → 未展开则 `fs.listDir(root, rel)` 缓存进 children 并展开；file 行点击 → `props.onOpenFile(rel)`。
  - 目录行前缀 `▸/▾`，文件行 📄；加载失败 toast（showToastV2）。
- RightDock：triggers 加 `📁 文件`（value files）与 `📝 编辑器`（value editor）。
- MafwShell：两个 display 分支（仿 BackgroundDock 接线），`sessionDirectory` 取法同 BackgroundDock（`store.session.find(s => s.id === currentSessionID())?.directory ?? null`）；FilesDock 的 `onOpenFile` → 调 EditorDock 的打开入口（Task 5 落 `openEditorFile(rel)` 函数 + `applyRightDock(true, "editor")`；本 Task 先接线到一个 `openEditorFile` 占位实现——写进 workspace 级 signal `pendingEditorOpen`，Task 5 消费）。
- CSS：`.mafw-file-tree` / 行 hover / kind 图标 / 缩进（`padding-left: calc(depth * 14px)`）全 token。

- [ ] **Step 4: Run test + 全量**

Run: file-tree/dock-tab 单测 + `npm test`（全量绿）
Expected: 新增 2+2=4 例 PASS；全量 1135/1135

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/file-tree.ts packages/desktop/src/renderer/mafw/file-tree.test.ts packages/desktop/src/renderer/mafw/components/FilesDock.tsx packages/desktop/src/renderer/mafw/components/dock-tab.ts packages/desktop/tests/dock-tab.test.ts packages/desktop/src/renderer/mafw/components/RightDock.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): files dock tab with lazy file tree"
```

---

### Task 4: editor-state 纯状态机（打开/脏/保存/外部改动冲突/root 切换）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/editor-state.ts`
- Test: `packages/desktop/src/renderer/mafw/editor-state.test.ts`

**Interfaces:**
- Consumes: 无（纯模块）。
- Produces（Task 5 的 EditorDock 全靠它驱动 UI）:
  ```ts
  export interface OpenFile {
    rel: string
    savedContent: string     // 磁盘基准（保存/加载后刷新）
    dirty: boolean
    readOnly: boolean        // too-large/binary 打开降级
    conflict: boolean        // dirty 时收到外部改动 → 冲突横幅
    staleClean: boolean      // 干净时收到外部改动 → 待静默刷新
  }
  export interface EditorModel { root: string | null; files: OpenFile[]; active: string | null }
  export function createEditorModel(): EditorModel
  export function onRootChange(m: EditorModel, root: string | null): EditorModel   // root 变 → files/active 全清
  export function openFile(m: EditorModel, rel: string, content: string, readOnly?: boolean): EditorModel  // 幂等：已打开仅激活
  export function closeFile(m: EditorModel, rel: string): EditorModel              // 关闭 active 时激活最近一个
  export function setActive(m: EditorModel, rel: string): EditorModel
  export function markDirty(m: EditorModel, rel: string): EditorModel
  export function markSaved(m: EditorModel, rel: string, content: string): EditorModel
  export function onExternalChange(m: EditorModel, rel: string): EditorModel       // dirty→conflict；干净→staleClean
  export function resolveConflict(m: EditorModel, rel: string, action: "keep-mine" | "reload", diskContent?: string): EditorModel
  export function applyCleanReload(m: EditorModel, rel: string, diskContent: string): EditorModel  // staleClean 消费
  ```

- [ ] **Step 1: Write the failing test**

`editor-state.test.ts`（核心用例，每行一个行为）：

```ts
import { describe, expect, test } from "bun:test"
import { createEditorModel as create, onRootChange, openFile, closeFile, markDirty, markSaved, onExternalChange, resolveConflict, applyCleanReload } from "./editor-state"

describe("editor-state", () => {
  test("openFile 建行并激活；重复打开仅激活不重置内容", () => {
    let m = openFile(create(), "a.ts", "v1")
    m = openFile(m, "b.ts", "v2")
    m = openFile(m, "a.ts", "IGNORED")
    expect(m.active).toBe("a.ts")
    expect(m.files.find(f => f.rel === "a.ts")!.savedContent).toBe("v1")
  })
  test("dirty + 外部改动 → conflict；干净 + 外部改动 → staleClean", () => {
    let m = openFile(create(), "a.ts", "v1")
    m = markDirty(m, "a.ts")
    m = onExternalChange(m, "a.ts")
    expect(m.files[0]).toMatchObject({ conflict: true, staleClean: false })
    let m2 = openFile(create(), "b.ts", "v1")
    m2 = onExternalChange(m2, "b.ts")
    expect(m2.files[0]).toMatchObject({ conflict: false, staleClean: true })
  })
  test("resolveConflict keep-mine 清冲突保 dirty；reload 用磁盘内容重置", () => {
    let m = markDirty(openFile(create(), "a.ts", "v1"))
    m = onExternalChange(m, "a.ts")
    const keep = resolveConflict(m, "a.ts", "keep-mine")
    expect(keep.files[0]).toMatchObject({ conflict: false, dirty: true, savedContent: "v1" })
    const rel = resolveConflict(m, "a.ts", "reload", "v2-disk")
    expect(rel.files[0]).toMatchObject({ conflict: false, dirty: false, savedContent: "v2-disk" })
  })
  test("applyCleanReload 清 staleClean 并换基准", () => {
    let m = onExternalChange(openFile(create(), "a.ts", "v1"), "a.ts")
    m = applyCleanReload(m, "a.ts", "v2")
    expect(m.files[0]).toMatchObject({ staleClean: false, savedContent: "v2" })
  })
  test("markSaved 换基准清 dirty；onRootChange 清空全部", () => {
    let m = markSaved(markDirty(openFile(create(), "a.ts", "v1"), "a.ts"), "a.ts", "v1.5")
    expect(m.files[0]).toMatchObject({ dirty: false, savedContent: "v1.5" })
    m = onRootChange(m, "D:\\other")
    expect(m.files).toEqual([]); expect(m.active).toBeNull(); expect(m.root).toBe("D:\\other")
  })
  test("closeFile 关闭 active → 激活剩余最近打开项", () => {
    let m = openFile(openFile(create(), "a.ts", "1"), "b.ts", "2")
    m = closeFile(m, "b.ts")
    expect(m.active).toBe("a.ts")
    expect(closeFile(m, "a.ts").active).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 editor-state.ts**

纯不可变更新（返回新 model，数组 map/filter，与 background-tracker 同风格）；`openFile` 重复打开保留 savedContent/dirty。

- [ ] **Step 4: Run test to verify it passes**

Expected: 6 例 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/editor-state.ts packages/desktop/src/renderer/mafw/editor-state.test.ts
git commit -m "feat(desktop): editor state machine with external-change conflict semantics"
```

---

### Task 5: EditorDock 组件（CodeMirror 6 懒加载 + 保存 + 冲突横幅 + watch 接线）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/editor/cm-setup.ts`（CM6 懒加载工厂）
- Create: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（editor 分支接线 + watch/onChanged + pendingEditorOpen 消费）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（编辑器/横幅/文件 tab 条样式）
- Modify: `packages/desktop/package.json`（devDependencies + `codemirror` `^6`、`@codemirror/language-data` `^6`）
- Test: `packages/desktop/src/renderer/mafw/editor/cm-lang.test.ts`

**Interfaces:**
- Consumes: Task 2 `window.api.fs.*` 全部；Task 4 `EditorModel` 全部导出；Task 3 的 `pendingEditorOpen` signal。
- Produces:
  ```ts
  // cm-lang.ts（纯映射，可测）
  export function langForFile(rel: string): string | null   // "a.ts"→"typescript"；"x.unknown"→null
  // cm-setup.ts
  export async function mountEditor(host: HTMLElement, opts: {
    doc: string; readOnly: boolean; lang: string | null
    onDocChanged: () => void; onSave: () => void
  }): Promise<{ setDoc(s: string): void; getDoc(): string; destroy(): void }>
  // MafwShell 层
  export function pendingEditorOpen(): { root: string; rel: string } | null  // workspace 级 signal accessor
  ```

- [ ] **Step 1: 安装依赖 + Write the failing test**

- `npm pkg set` 或手改 package.json：`devDependencies.codemirror: ^6.0.0`、`@codemirror/language-data: ^6.5.0` → 根 `npm install`。
- `editor/cm-lang.test.ts`：
  ```ts
  import { describe, expect, test } from "bun:test"
  import { langForFile } from "./cm-lang"
  test("常见扩展名映射；未知 → null；大小写不敏感", () => {
    expect(langForFile("src/a.ts")).toBe("typescript")
    expect(langForFile("x/Component.TSX")).toBe("typescript")
    expect(langForFile("a/b.py")).toBe("python")
    expect(langForFile("README.md")).toBe("markdown")
    expect(langForFile("style.CSS")).toBe("css")
    expect(langForFile("data.json")).toBe("json")
    expect(langForFile("x.unknownext")).toBeNull()
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL（cm-lang 不存在）

- [ ] **Step 3: 实现 cm-lang/cm-setup/EditorDock + 接线 + CSS**

- `cm-lang.ts`：扩展名表（ts/tsx/js/jsx→typescript|javascript、py、md、css、json、html、yaml、rs、go、sh、sql 等十余条），`@codemirror/language-data` 的 `LanguageDescription.matchFilename` 在 cm-setup 里消费。
- `cm-setup.ts`：`await import("codemirror")` + `await import("@codemirror/language-data")`（动态分包）；`basicSetup` + 语言扩展 + `EditorView.updateListener`（docChanged → onDocChanged）+ save keymap（Mod-s → onSave，preventDefault）+ `EditorView.editable`/`EditorState.readOnly` 按 readOnly；主题：`EditorView.theme({...}, {dark:true})` 全部引用 `var(--bg-inset)/--text-1/--border/--accent` 等 token + 最小 `HighlightStyle`（keyword/string/comment/number/tag 五六条映射 token 变量，禁硬编码色值——放 mafw.css 用类名挂 token 亦可）。
- `EditorDock.tsx`：
  - 数据源：props `{ sessionDirectory: string | null; diffs?: FileDiffEntry[]; onSendAnnotation?: (text: string) => void; onSendComment?: (sid, text) => void }`（diffs/onSendComment Task 7 用，本 Task 先声明）。
  - 文件 tab 条（打开的文件横向 chips：名称 + dirty ● + ×关闭）；无文件 → 空态「从『文件』tab 选择文件打开」。
  - 激活文件 → `mountEditor` 挂 CM6；`onDocChanged` → `markDirty`；`onSave`（Ctrl+S 或 tab 条「保存」ButtonV2）→ `fs.writeFile(root, rel, getDoc(), { ifMtimeMs: 打开/上次保存时的 mtimeMs })`：
    - ok → `markSaved` + toast「已保存」；
    - **conflict（调研 §3 防线②：watch 窗口外磁盘已被改，典型是 agent 刚写了同一文件）→ 冲突横幅「磁盘已被改动（可能被 agent 修改）」+ ButtonV2×2「覆盖保存」（不带 ifMtimeMs 重写）/「放弃并重新加载」（readFile → markSaved + setDoc）**；
    - 其余失败 → error toast。readOnly 文件 tab 条显示「只读」徽标、无保存按钮。
  - tab 条右侧「在外部编辑器打开」ButtonV2 ghost（`fs.openExternal`，调研 §5 逃生口；打开失败 error toast）。
  - 外部改动：MafwShell 的 `fs.onChanged` 回调 → `onExternalChange(model, rel)`；`staleClean` → `fs.readFile` → `applyCleanReload` + `setDoc`；`conflict` → 编辑器顶部横幅（ButtonV2×2：「保留我的修改」/「放弃并重新加载」）→ `resolveConflict`（reload 时先 `fs.readFile` 取磁盘内容）。
  - root 变化 → `onRootChange`（model 清空，watch 全退订）。
  - watch 生命周期：active 文件变化 → `fs.unwatch` 旧的 + `fs.watch` 新的；组件 onCleanup 全退。
  - 打开入口：MafwShell effect 消费 `pendingEditorOpen`（Task 3 写入）→ `fs.readFile` → ReadResult ok → `openFile`；`too-large/binary` → `openFile(rel, "", true)` + tab 条「只读」+ 编辑器区显示中文原因；`not-found` → error toast。
- MafwShell：editor 分支（仿 BackgroundDock），并把 `fs.onChanged` 的订阅挂到 MafwShell onMount/onCleanup（单一订阅点，转发给 EditorDock 的 model 回调）。
- CSS：`.mafw-editor-dock` / `.mafw-editor-tabs` / `.mafw-editor-conflict`（横幅 `--accent-warning` 系 token）/ `.mafw-editor-host`（CM6 容器 100% 高）。

- [ ] **Step 4: 全量门禁**

Run: `npm test` + `npx tsgo --noEmit -p tsconfig.json` + `npx electron-vite build`
Expected: 测试全绿（+1 cm-lang 例）；tsgo rc=0；build 成功且 **editor chunk 独立分包**（build log 中 codemirror 不在 main-*.js 主包——检查产物清单断言给 reviewer）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/editor/ packages/desktop/src/renderer/mafw/components/EditorDock.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/package.json package-lock.json
git commit -m "feat(desktop): collaborative editor dock with CodeMirror 6, save and conflict guard"
```

---

### Task 6: 标注直发（选中 → 一句话 → promptAsync）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/editor-annotation.ts`
- Test: `packages/desktop/src/renderer/mafw/editor-annotation.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`（selection 批注入口 + popover）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（onSendAnnotation 接线）

**Interfaces:**
- Consumes: `LineCommentEditorV2`（`@mafw/ui/v2/line-comment-v2`，session-ui 既有引用先例）；MafwShell 既有 `window.api.mafw.sessions.promptAsync` + toast 模式（ChangesDock onSendComment 同款）。
- Produces:
  ```ts
  /** 选区字符偏移 → 1-based 行范围（含端点）；空选区 → null。 */
  export function lineRangeOf(doc: string, from: number, to: number): { startLine: number; endLine: number } | null
  /** 标注 prompt（格式由测试逐字钉死，仿 buildDiffCommentPrompt 风格）。 */
  export function buildAnnotationPrompt(rel: string, startLine: number, endLine: number, code: string, comment: string): string
  ```

- [ ] **Step 1: Write the failing test**

`editor-annotation.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { lineRangeOf, buildAnnotationPrompt } from "./editor-annotation"

describe("lineRangeOf", () => {
  const doc = "l1\nl2\nl3"  // 末尾无换行
  test("单行内选区 / 跨行选区 / 零宽 → null", () => {
    expect(lineRangeOf(doc, 0, 2)).toEqual({ startLine: 1, endLine: 1 })
    expect(lineRangeOf(doc, 3, 9)).toEqual({ startLine: 2, endLine: 3 })
    expect(lineRangeOf(doc, 4, 4)).toBeNull()
    expect(lineRangeOf(doc, 6, 8)).toEqual({ startLine: 3, endLine: 3 })
  })
})

describe("buildAnnotationPrompt", () => {
  test("格式逐字钉死（路径+行号+代码块+批注）", () => {
    expect(buildAnnotationPrompt("src/a.ts", 3, 5, "x()\ny()\nz()", "这里为什么要 await？")).toBe([
      "文件 `src/a.ts` 第 3-5 行：",
      "",
      "```",
      "x()",
      "y()",
      "z()",
      "```",
      "",
      "我的批注：这里为什么要 await？",
      "",
      "请结合批注查看这段代码并回应。",
    ].join("\n"))
  })
  test("单行范围不写成 M-N", () => {
    expect(buildAnnotationPrompt("a.ts", 3, 3, "x()", "问")).toContain("第 3 行：")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 editor-annotation.ts + EditorDock 批注入口 + 接线**

- 纯函数按测试实现。
- EditorDock：CM6 `EditorView.domEventHandlers({ mouseup })` + 选区非空（`state.selection.main` from≠to）→ 选区末尾处浮出「批注」小按钮（绝对定位 div + ButtonV2 ghost small）；点击 → popover 挂 `LineCommentEditorV2`（value/onSubmit/onCancel，引用块显示 `rel:Lx-Ly`）；submit → `buildAnnotationPrompt(rel, start, end, 选中文本, comment)` → `props.onSendAnnotation(prompt)` → 关 popover + 清选区。Esc / 点击别处 → 关 popover。零宽选区不出现按钮（Review Focus #5）。
- MafwShell：`onSendAnnotation={(text) => { void window.api.mafw.sessions.promptAsync({ sessionID: currentSessionID()!, message: text }).then(toast「批注已发送」).catch(error toast) }}`——与 ChangesDock onSendComment 完全同模式（含 busy 直发语义，与既有 diff 评论一致）。

- [ ] **Step 4: 全量门禁**

Run: 单测 + `npm test` + `npx tsgo --noEmit -p tsconfig.json`
Expected: 新增 3 例 PASS；全量绿；tsgo rc=0

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/editor-annotation.ts packages/desktop/src/renderer/mafw/editor-annotation.test.ts packages/desktop/src/renderer/mafw/components/EditorDock.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): code annotation direct-send to agent from editor selection"
```

---

### Task 7: 编辑器内 diff 原地验收 + dock 拉宽

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`（编辑/改动 模式切换）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（diffs 传递 + 宽度 clamp）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/src/renderer/mafw/editor-diff.test.ts`（纯逻辑：模式可用性判定）

**Interfaces:**
- Consumes: `DiffReviewPanel`（desktop 既有组件，embedded 模式 + `onSendComment` 已在 ChangesDock 接线使用）；MafwShell 传给 ChangesDock 的同一 `aggregateSessionDiffs((store.message as any)[sid] || [])` 数据。
- Produces:
  ```ts
  /** 当前打开文件在会话 diff 中的条目；无 → null（「改动」模式按钮隐藏，pi 降级自然成立）。 */
  export function diffEntryFor(diffs: FileDiffEntry[] | undefined, rel: string): FileDiffEntry | null
  ```

- [ ] **Step 1: Write the failing test**

`editor-diff.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { diffEntryFor } from "./editor-diff"

test("diffEntryFor：按 file 名匹配；undefined/未命中 → null", () => {
  const diffs = [{ file: "src/a.ts", additions: 3, deletions: 1 } as any]
  expect(diffEntryFor(diffs, "src/a.ts")!.additions).toBe(3)
  expect(diffEntryFor(diffs, "src/b.ts")).toBeNull()
  expect(diffEntryFor(undefined, "src/a.ts")).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 editor-diff.ts + 模式切换 + 拉宽 + CSS**

- `editor-diff.ts` 按测试实现（放 `editor-diff.ts` 独立文件，不污染 editor-state）。
- EditorDock：文件 tab 条右侧加模式切换（「编辑」/「改动」两枚 ButtonV2 ghost，「改动」仅 `diffEntryFor(props.diffs, activeRel)` 非空时显示）；改动模式 → 渲染 `<DiffReviewPanel embedded sessionID={…} diffs={props.diffs} initialFile={activeRel} onSendComment={props.onSendComment} />`（MafwShell 传入与 ChangesDock 完全相同的 onSendComment 闭包）；切回编辑 → 回 CM6。**注意**：pi 下 diffs undefined → 按钮隐藏即降级（spec §5.2，Gate Ruling A 惯例）。
- MafwShell：editor 分支传 `diffs={aggregateSessionDiffs((store.message as any)[currentSessionID()] || [])}` + `onSendComment` 同 ChangesDock。
- 拉宽：MafwShell `applyRightDockWidth`（1415-1435 行区域）的 clamp 上限在 `rightDockTab() ∈ {"files","editor"}` 时放宽到 `Math.floor(window.innerWidth * 0.5)`（其余 tab 保持现值）；首次切到 editor tab 且当前宽度 < 480 时自动设为 `min(560, floor(innerWidth/2))`（用户随后可拖）。
- CSS：`.mafw-editor-tabs` 容纳模式切换；拉宽后 tab 列表已 flex-wrap（P0-3 修过）。

- [ ] **Step 4: 全量门禁**

Run: 单测 + `npm test` + `npx tsgo --noEmit -p tsconfig.json` + `npx electron-vite build`
Expected: 新增 1 例 PASS；全量绿；tsgo rc=0；build 成功

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/editor-diff.ts packages/desktop/src/renderer/mafw/editor-diff.test.ts packages/desktop/src/renderer/mafw/components/EditorDock.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): in-editor diff acceptance mode and resizable dock for workbench tabs"
```

---

## Self-Review 记录

- **业界调研**：`docs/research/2026-10-22-ai-editor-interaction-survey.md`（Cursor/Windsurf/Zed/VSCode/Paseo/Aura/Nimbalyst + Claude Code #87056）。结论：标注直发=「Add to Chat」家族（不做 Cmd+K 内联改写，与"agent=会话"原则一致）；先落盘后审 + Git 安全网是业界收敛方向（我们不引入 VSCode 被批评的 Keep/Undo 双态）；冲突设计对齐 Nimbalyst/Paseo 并**叠加 Aura 式保存时 mtime 校验**（watch 防抖窗口的漏检补死）；「在外部编辑器打开」逃生口采纳（Paseo 模式）。
- **Spec coverage**：§5.1 文件浏览器 → Task 3；§5.2 编辑器/保存/冲突 → Task 4/5；标注直发 → Task 6；diff 原地验收 + pi 降级 → Task 7；root 跟随会话 → Task 3/4/5 贯穿；拉宽 → Task 7。验收判据 1-4 逐条有主。
- **偏差声明（spec 手段级，行为不变）**：spec 写「`line-comment*` 组件转正」——侦察发现 desktop `DiffReviewPanel` 已实现 hunk 级评论且 `onSendComment` 通路在用，本期直接复用（满足验收判据 3「逐行评论、发送」）；session-ui 的 pierre 任意行选区组件是更富形态，留后续增强，不在本期。
- **Type consistency**：`FsEntry/ReadResult/WriteResult`（T1→T2→T3/T5）、`EditorModel` 全族（T4→T5）、`pendingEditorOpen`（T3→T5）、`onSendAnnotation/onSendComment/diffs`（T5 声明→T6/T7 消费）已对齐。
- **Review Focus**：5 条分别钉在 T1（#1 越狱、#2 二进制/超大）、T4（#3 冲突、#4 root 切换）、T6（#5 选区边界）的步骤测试里；调研新增第 6 条（保存时 mtime 校验）钉在 T1 writeTextFile 测试。
- **Proportion**：plan ~360 行 vs spec ~110 行——纯模块测试代码占半，接口/命令/接线占半，无函数体转录（CM6 主题等留给实现者）。
