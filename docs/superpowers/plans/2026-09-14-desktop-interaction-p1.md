# Desktop 交互 P1 批次：输入/阅读回路五件套实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 desktop 输入回路（@file 文件引用、↑↓ 输入历史、draft 跨 tab 持久化）与阅读回路（会话内搜索、压缩分割线复活）五项 P1 缺陷。

**Architecture:** 四个纯逻辑模块（input-history / session-drafts / transcript-search / file-fuzzy）+ 一个注入 fs 的 main 侧 walker（file-listing）走 `bun:test` TDD；组件接线集中在 ChatPane（picker 复用 PopoverShell 模式，跳转复用 `data-turn-id` + scrollIntoView 机制）；压缩分割线复用现有死组件 CompressionDivider，数据源接 MafwShell 的 `session.compacted` SSE 事件。

**Tech Stack:** SolidJS、PopoverShell、Electron ipcMain、`@mafw/sdk` `project.current()`（`Project.worktree`）、bun:test。

**调研依据:** `docs/research/2026-09-14-desktop-interaction-survey.md` §3 P1-5/6；opencode `@` fuzzy 文件引用语义（opencode.ai/docs）。

## Global Constraints

- 命令在仓库根执行；desktop 包命令 `cd packages/desktop`。
- 单测 `bun:test`，运行 `bun test <file>`；全量门禁：`npx tsgo -b` + `npx electron-vite build`。
- 新纯模块不加 `@ts-nocheck`；UI 一律 ButtonV2/TextInputV2（AGENTS.md §5.10）。
- @file 语义 = Claude Code 式文本引用（消息携带 `@relpath`，模型用 read 工具读取），不做 file part 展开零安全面扩大。
- 提交直接进 main；每任务一个 commit。

---

### Task 1: input-history 纯模块（TDD）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/input-history.ts`
- Test: `packages/desktop/src/renderer/mafw/components/input-history.test.ts`

**Interfaces:**
- Produces（Task 6 消费）:
  ```ts
  export type InputHistory = { entries: string[]; cursor: number } // cursor = -1 表示不在历史中
  export function createInputHistory(max = 50): {
    push(text: string): void          // 空白不入栈；与栈顶相同不入栈
    up(current: string): string | null // 从 live 输入进入历史取最后一条；越界返回 null
    down(): string | null              // 向 newer 方向；到底返回 ""（回到 live）
  }
  ```

- [ ] **Step 1: 失败测试**

```ts
import { describe, expect, test } from "bun:test"
import { createInputHistory } from "./input-history"

describe("input history", () => {
  test("push stores entries and skips blank/duplicate", () => {
    const h = createInputHistory()
    h.push("a"); h.push("   "); h.push("a"); h.push("b")
    expect(h.up("x")).toBe("b")
    expect(h.up("b")).toBe("a")
    expect(h.up("a")).toBe(null)
  })

  test("up enters history from live input, down returns to live", () => {
    const h = createInputHistory()
    h.push("one"); h.push("two")
    expect(h.up("draft")).toBe("two")
    expect(h.up("two")).toBe("one")
    expect(h.down()).toBe("two")
    expect(h.down()).toBe("")   // back to live
    expect(h.down()).toBe(null) // already at live
  })

  test("push while browsing resets the cursor to live", () => {
    const h = createInputHistory()
    h.push("a"); h.push("b")
    h.up("x"); h.up("b")
    h.push("c")
    expect(h.up("x")).toBe("c") // newest first after a fresh push
  })

  test("caps at max entries (oldest dropped)", () => {
    const h = createInputHistory(2)
    h.push("a"); h.push("b"); h.push("c")
    expect(h.up("x")).toBe("c")
    expect(h.up("c")).toBe("b")
    expect(h.up("b")).toBe(null) // "a" was dropped
  })
})
```

- [ ] **Step 2: 确认失败** — `bun test src/renderer/mafw/components/input-history.test.ts` → FAIL（模块不存在）
- [ ] **Step 3: 实现**

```ts
// Composer ↑/↓ input history. Module-level per-PaneInner instance; pure
// state machine so it is testable without SolidJS.
export function createInputHistory(max = 50) {
  let entries: string[] = []
  let cursor = -1 // -1 = at live input

  return {
    push(text: string) {
      const t = text.trim()
      cursor = -1
      if (!t) return
      if (entries[entries.length - 1] === t) return
      entries.push(t)
      if (entries.length > max) entries = entries.slice(entries.length - max)
    },
    up(_current: string): string | null {
      if (entries.length === 0) return null
      const next = cursor < 0 ? entries.length - 1 : cursor - 1
      if (next < 0) return null
      cursor = next
      return entries[next]
    },
    down(): string | null {
      if (cursor < 0) return null
      if (cursor >= entries.length - 1) { cursor = -1; return "" }
      cursor = cursor + 1
      return entries[cursor]
    },
  }
}
```

- [ ] **Step 4: 确认通过** → 4 tests PASS
- [ ] **Step 5: Commit** — `feat(desktop): composer input-history state machine with tests`

---

### Task 2: session-drafts 纯模块（TDD）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/session-drafts.ts`
- Test: `packages/desktop/src/renderer/mafw/components/session-drafts.test.ts`

**Interfaces:**
- Produces（Task 6 消费）: `getDraft(sid): string` / `setDraft(sid, text): void` / `clearDraft(sid): void` —— 模块级 Map，keyed Show 销毁重建后草稿仍在。

- [ ] **Step 1: 失败测试**

```ts
import { describe, expect, test } from "bun:test"
import { getDraft, setDraft, clearDraft } from "./session-drafts"

describe("session drafts", () => {
  test("set then get returns the draft per session", () => {
    setDraft("s1", "hello")
    setDraft("s2", "world")
    expect(getDraft("s1")).toBe("hello")
    expect(getDraft("s2")).toBe("world")
  })

  test("missing draft returns empty string", () => {
    expect(getDraft("nope")).toBe("")
  })

  test("clear removes the draft", () => {
    setDraft("s1", "x")
    clearDraft("s1")
    expect(getDraft("s1")).toBe("")
  })

  test("overwrite keeps the latest", () => {
    setDraft("s1", "old"); setDraft("s1", "new")
    expect(getDraft("s1")).toBe("new")
  })
})
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**

```ts
// Per-session composer drafts. ChatPane is a keyed Show per sessionID, so
// switching tabs destroys and recreates the pane; this module-level map is
// where the draft survives. In-memory only (cleared on app restart).
const drafts = new Map<string, string>()

export function getDraft(sid: string): string {
  return drafts.get(sid) || ""
}

export function setDraft(sid: string, text: string): void {
  if (!sid) return
  drafts.set(sid, text)
}

export function clearDraft(sid: string): void {
  drafts.delete(sid)
}
```

- [ ] **Step 4: 确认通过** → 4 tests PASS
- [ ] **Step 5: Commit** — `feat(desktop): per-session composer draft store with tests`

---

### Task 3: transcript-search 纯模块（TDD）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/transcript-search.ts`
- Test: `packages/desktop/src/renderer/mafw/components/transcript-search.test.ts`

**Interfaces:**
- Produces（Task 7 消费）:
  ```ts
  export type SearchableTurn = { id: string; role: string; text: string }
  export type SearchHit = { id: string; role: string; snippet: string }
  export function searchTurns(turns: SearchableTurn[], query: string, maxHits = 30): SearchHit[]
  // 大小写不敏感子串匹配；snippet = 命中处 ±40 字符；按 turn 顺序返回。
  ```

- [ ] **Step 1: 失败测试**

```ts
import { describe, expect, test } from "bun:test"
import { searchTurns } from "./transcript-search"

const turns = [
  { id: "u1", role: "user", text: "重构一下认证逻辑" },
  { id: "a1", role: "assistant", text: "认证由 gateway/src/auth.ts 处理" },
  { id: "u2", role: "user", text: "顺便看看 AUTH 的测试" },
]

describe("transcript search", () => {
  test("case-insensitive match across roles", () => {
    const hits = searchTurns(turns, "auth")
    expect(hits.map(h => h.id)).toEqual(["a1", "u2"])
  })

  test("snippet centers on the match", () => {
    const [hit] = searchTurns(turns, "auth")
    expect(hit.snippet.toLowerCase()).toContain("auth")
    expect(hit.role).toBe("assistant")
  })

  test("empty query returns no hits", () => {
    expect(searchTurns(turns, "")).toEqual([])
    expect(searchTurns(turns, "   ")).toEqual([])
  })

  test("caps results at maxHits in turn order", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, role: "user", text: "needle" }))
    expect(searchTurns(many, "needle")).toHaveLength(30)
    expect(searchTurns(many, "needle")[0].id).toBe("t0")
  })

  test("snippet truncated around long text keeps the match visible", () => {
    const long = { id: "x", role: "user", text: "A".repeat(100) + "needle" + "B".repeat(100) }
    const [hit] = searchTurns([long], "needle")
    expect(hit.snippet).toContain("needle")
    expect(hit.snippet.length).toBeLessThanOrEqualTo(100)
  })
})
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**

```ts
// In-session transcript search: pure matcher over turn records; the overlay
// (Task 7) renders hits and jumps via data-turn-id anchors.
export type SearchableTurn = { id: string; role: string; text: string }
export type SearchHit = { id: string; role: string; snippet: string }

export function searchTurns(turns: SearchableTurn[], query: string, maxHits = 30): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const t of turns) {
    const text = t.text || ""
    const idx = text.toLowerCase().indexOf(q)
    if (idx < 0) continue
    const start = Math.max(0, idx - 40)
    const end = Math.min(text.length, idx + q.length + 40)
    const prefix = start > 0 ? "…" : ""
    const suffix = end < text.length ? "…" : ""
    hits.push({ id: t.id, role: t.role, snippet: prefix + text.slice(start, end) + suffix })
    if (hits.length >= maxHits) break
  }
  return hits
}
```

- [ ] **Step 4: 确认通过** → 5 tests PASS
- [ ] **Step 5: Commit** — `feat(desktop): transcript search matcher with tests`

---

### Task 4: file-fuzzy 纯模块（TDD）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/file-fuzzy.ts`
- Test: `packages/desktop/src/renderer/mafw/components/file-fuzzy.test.ts`

**Interfaces:**
- Produces（Task 6 消费）:
  ```ts
  export function fuzzyMatchFiles(files: string[], query: string, limit = 20): string[]
  // subsequence 匹配（大小写不敏感）；score = 连续命中奖励 + 路径短奖励；
  // 空 query 返回前 limit 个（字母序）。
  ```

- [ ] **Step 1: 失败测试**

```ts
import { describe, expect, test } from "bun:test"
import { fuzzyMatchFiles } from "./file-fuzzy"

const files = [
  "src/index.ts",
  "src/renderer/mafw/MafwShell.tsx",
  "gateway/src/core/memory/harmonic-index.ts",
  "docs/research/survey.md",
]

describe("file fuzzy matcher", () => {
  test("empty query returns alphabetical head", () => {
    const out = fuzzyMatchFiles(files, "")
    expect(out).toHaveLength(4)
    expect(out[0]).toBe("docs/research/survey.md")
  })

  test("substring match ranks first", () => {
    const out = fuzzyMatchFiles(files, "harmonic")
    expect(out).toEqual(["gateway/src/core/memory/harmonic-index.ts"])
  })

  test("subsequence match across path segments", () => {
    // "mfs" matches MafwShell.tsx as subsequence
    const out = fuzzyMatchFiles(files, "mfs")
    expect(out).toContain("src/renderer/mafw/MafwShell.tsx")
  })

  test("no match returns empty", () => {
    expect(fuzzyMatchFiles(files, "zzzzz")).toEqual([])
  })

  test("respects the limit", () => {
    const many = Array.from({ length: 50 }, (_, i) => `dir/file${i}.ts`)
    expect(fuzzyMatchFiles(many, "file", 10)).toHaveLength(10)
  })
})
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**

```ts
// Fuzzy file matcher for the @file mention picker (opencode-style).
// Subsequence scoring: consecutive-character runs and shorter paths win.
export function fuzzyMatchFiles(files: string[], query: string, limit = 20): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...files].sort().slice(0, limit)
  const scored: { path: string; score: number }[] = []
  for (const f of files) {
    const lower = f.toLowerCase()
    const idx = lower.indexOf(q)
    if (idx >= 0) {
      // substring: strongest signal; earlier + shorter is better
      scored.push({ path: f, score: 1000 - idx - f.length })
      continue
    }
    // subsequence walk
    let qi = 0, run = 0, score = 0
    for (let i = 0; i < lower.length && qi < q.length; i++) {
      if (lower[i] === q[qi]) {
        run++
        score += 10 + run * 2 // consecutive hits compound
        qi++
      } else {
        run = 0
      }
    }
    if (qi === q.length) scored.push({ path: f, score: score - f.length })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.path)
}
```

- [ ] **Step 4: 确认通过** → 5 tests PASS
- [ ] **Step 5: Commit** — `feat(desktop): fuzzy file matcher for @file mentions with tests`

---

### Task 5: main 侧项目文件列表（注入 fs walker，TDD）+ IPC

**Files:**
- Create: `packages/desktop/src/main/file-listing.ts`
- Test: `packages/desktop/src/main/file-listing.test.ts`
- Modify: `packages/desktop/src/main/mafw-ipc.ts`（`mafw-list-files` handler，30s 缓存）
- Modify: `packages/desktop/src/preload/mafw-api.ts` + `mafw-types.ts`（`window.api.mafw.files.list()`）

**Interfaces:**
- Produces（Task 6 消费）: `window.api.mafw.files.list(): Promise<string[]>` —— 当前项目相对路径（`/` 分隔，`/` 开头），上限 2000 个，忽略 node_modules/.git/dist/out/build/.venv*/__pycache__/target/.next，深度 ≤8。
- walker 核心 `walkProjectFiles(root, io)` 注入 `readdir(dir): Promise<{name, isDirectory}[]>` 可测。

- [ ] **Step 1: 失败测试**（用内存 fake fs）

```ts
import { describe, expect, test } from "bun:test"
import { walkProjectFiles } from "./file-listing"

function fakeFs(tree: Record<string, string[]>) {
  return async (dir: string) =>
    (tree[dir] || []).map(name => ({
      name,
      isDirectory: () => !name.includes("."),
    }))
}

describe("project file walker", () => {
  test("collects relative paths with forward slashes", async () => {
    const io = fakeFs({
      root: ["src", "README.md"],
      "root/src": ["index.ts"],
    })
    const out = await walkProjectFiles("root", io, 100, 8)
    expect(out).toEqual(["/README.md", "/src/index.ts"])
  })

  test("skips ignored directories entirely", async () => {
    const io = fakeFs({
      root: ["src", "node_modules", ".git"],
      "root/src": ["a.ts"],
      "root/node_modules": ["junk.js"],
      "root/.git": ["config"],
    })
    const out = await walkProjectFiles("root", io, 100, 8)
    expect(out).toEqual(["/src/a.ts"])
  })

  test("respects the file cap", async () => {
    const io = fakeFs({ root: Array.from({ length: 10 }, (_, i) => `f${i}.ts`) })
    const out = await walkProjectFiles("root", io, 3, 8)
    expect(out).toHaveLength(3)
  })

  test("respects the depth cap", async () => {
    let depth = 0
    const io = async (dir: string) => {
      depth = dir.split("/").length
      return depth <= 10 ? ["sub", "f.ts"] : []
    }
    const out = await walkProjectFiles("root", io, 100, 3)
    expect(out.every(p => p.split("/").length <= 4)).toBe(true)
  })
})
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**

```ts
// Walks the current project directory for the @file mention picker.
// `io` is injected (readdir with dirent-like {name, isDirectory}) so the
// traversal logic stays testable without touching the real filesystem.
const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "out", "build", "coverage",
  ".next", ".venv", "__pycache__", "target", ".turbo", ".cache",
])

export async function walkProjectFiles(
  root: string,
  io: (dir: string) => Promise<{ name: string; isDirectory(): boolean }[]>,
  maxFiles = 2000,
  maxDepth = 8,
): Promise<string[]> {
  const files: string[] = []
  const queue: string[] = [root]
  while (queue.length > 0 && files.length < maxFiles) {
    const dir = queue.shift()!
    const depth = dir === root ? 0 : dir.slice(root.length + 1).split("/").length
    if (depth >= maxDepth) continue
    let entries: { name: string; isDirectory(): boolean }[]
    try { entries = await io(dir) } catch { continue }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (files.length >= maxFiles) break
      const full = dir === root ? e.name : `${dir}/${e.name}`
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) queue.push(full)
      } else {
        files.push("/" + full.slice(root.length + 1))
      }
    }
  }
  return files.sort()
}
```

- [ ] **Step 4: 确认通过** → 4 tests PASS
- [ ] **Step 5: IPC + preload**

`mafw-ipc.ts` 顶部 import 加：

```ts
import { walkProjectFiles } from "./file-listing"
import { readdir } from "node:fs/promises"
```

`registerMafwIpcHandlers()` 内（`mafw-notify` handler 之后）加（30s 缓存，fail-open 空数组）：

```ts
  let fileListCache: { at: number; root: string; files: string[] } | null = null
  ipcMain.handle("mafw-list-files", async () => {
    try {
      if (!mafwClient) return []
      const project = await mafwClient.project.current()
      const root = project?.worktree
      if (!root) return []
      if (fileListCache && fileListCache.root === root && Date.now() - fileListCache.at < 30_000) {
        return fileListCache.files
      }
      const io = async (dir: string) => {
        const dirents = await readdir(dir, { withFileTypes: true })
        return dirents.map(d => ({ name: d.name, isDirectory: () => d.isDirectory() }))
      }
      const files = await walkProjectFiles(root, io)
      fileListCache = { at: Date.now(), root, files }
      writeLog("utility", "mafw-list-files ok", { root, count: files.length })
      return files
    } catch (err) {
      writeLog("utility", "mafw-list-files failed", { err: String(err) }, "warn")
      return []
    }
  })
```

`mafw-api.ts` 返回对象加命名空间（`sessions` 之前）：

```ts
    files: {
      list: () => ipcRenderer.invoke("mafw-list-files") as Promise<string[]>,
    },
```

`mafw-types.ts` 加：

```ts
  files: {
    list: () => Promise<string[]>
  }
```

- [ ] **Step 6: 验证** — `bun test src/main/file-listing.test.ts` 4 PASS + `npx tsgo -b` 0 error
- [ ] **Step 7: Commit** — `feat(desktop): project file listing IPC for @file mentions (walker tested)`

---

### Task 6: ChatPane 输入三件接线（↑↓ 历史 / draft / @file）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/pickers/FilePicker.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（信号区 / onInput / onKeyDown / sendMessage / chips / pickers 区）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（文件 chip 样式）

**Interfaces:**
- Consumes: Task 1 `createInputHistory`、Task 2 `getDraft/setDraft/clearDraft`、Task 4 `fuzzyMatchFiles`、Task 5 `window.api.mafw.files.list()`
- Produces: FilePicker 组件（`open/trigger/agents/files/onSelectFile/onSelectAgent/onClose`）

- [ ] **Step 1: FilePicker 组件**

```tsx
// @ts-nocheck
import { createSignal, createMemo, createEffect, For, Show } from "solid-js"
import { PopoverShell } from "./PopoverShell"
import { fuzzyMatchFiles } from "../file-fuzzy"

// @-mention picker: fuzzy project files (primary) + matching agents. Files
// insert an @relpath mention; agents reuse the existing mention flow.
export function FilePicker(props: {
  open: boolean
  trigger: HTMLElement | null
  files: string[]
  agents: { name: string }[]
  query: string
  onSelectFile: (rel: string) => void
  onSelectAgent: (name: string) => void
  onClose: () => void
}) {
  const [hi, setHi] = createSignal(0)

  const fileHits = createMemo(() => fuzzyMatchFiles(props.files, props.query, 12))
  const agentHits = createMemo(() => {
    const q = props.query.trim().toLowerCase()
    return props.agents.filter(a => !q || a.name.toLowerCase().includes(q)).slice(0, 5)
  })
  const flat = createMemo(() => [
    ...agentHits().map(a => ({ kind: "agent" as const, label: a.name, value: a.name })),
    ...fileHits().map(f => ({ kind: "file" as const, label: f, value: f })),
  ])

  createEffect(() => { if (props.open) setHi(0); flat() })

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, flat().length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === "Enter") {
      e.preventDefault()
      const item = flat()[hi()]
      if (!item) return
      if (item.kind === "agent") props.onSelectAgent(item.value)
      else props.onSelectFile(item.value)
    } else if (e.key === "Escape") { e.preventDefault(); props.onClose() }
  }

  return (
    <PopoverShell open={props.open} trigger={props.trigger} anchor="bl" width={420} onClose={props.onClose} onKey={onKey}>
      <div class="mafw-file-picker">
        <Show when={flat().length === 0}>
          <div class="mafw-picker-empty">无匹配文件</div>
        </Show>
        <For each={flat()}>
          {(item, i) => (
            <div
              class="mafw-file-row"
              classList={{ sel: i() === hi() }}
              onClick={() => item.kind === "agent" ? props.onSelectAgent(item.value) : props.onSelectFile(item.value)}
            >
              <span class={"mafw-file-icon"}>{item.kind === "agent" ? "🤖" : "📄"}</span>
              <span class="mafw-file-label">{item.kind === "agent" ? `@${item.label}（agent）` : item.label}</span>
            </div>
          )}
        </For>
      </div>
    </PopoverShell>
  )
}
```

（若 PopoverShell 无 `onKey` prop，检查其签名；没有则把键盘处理留在 ChatPane 的 textarea onKeyDown 中做——pickerOpen === "file" 时拦截 ↑↓/Enter/Esc。以实际签名为准调整。）

- [ ] **Step 2: ChatPane 接线**

1. import 加：`import { createInputHistory } from "./input-history"`、`import { getDraft, setDraft, clearDraft } from "./session-drafts"`、`import { FilePicker } from "./pickers/FilePicker"`
2. pickerOpen 类型加 `"file"`
3. 信号区（queuedItems 之后）加：

```ts
  const history = createInputHistory(50)
  const [mentionedFiles, setMentionedFiles] = createSignal<{ rel: string }[]>([])
  const [projectFiles, setProjectFiles] = createSignal<string[]>([])
```

4. 恢复 draft：`canUnrevert` onMount 之前加

```ts
  // Draft restore: keyed Show destroys the pane on tab switch; the draft
  // survives in the module-level store.
  onMount(() => {
    const d = getDraft(sidProp())
    if (d) { setInput(d); queueMicrotask(() => { const ta = textareaEl(); if (ta) autoGrow(ta) }) }
  })
```

5. @ 触发 + draft 写入：TextareaV2 `onInput` 追加（现有 / 命令检测逻辑后）：

```ts
              setDraft(sidProp(), v)
              const atMention = /(?:^|\s)@(\S*)$/.exec(v.slice(0, e.currentTarget.selectionStart || v.length))
              if (atMention) {
                if (pickerOpen() !== "file") {
                  setPickerTrigger(e.currentTarget)
                  setPickerOpen("file")
                  if (projectFiles().length === 0) {
                    void window.api.mafw.files.list().then(setProjectFiles).catch(() => {})
                  }
                }
              } else if (pickerOpen() === "file") setPickerOpen(null)
```

6. ↑↓ 历史（textarea onKeyDown，Backspace 分支后加；仅输入为空且无 pending chip 删除时生效）：

```ts
              else if (e.key === "ArrowUp" && !e.currentTarget.value) {
                const prev = history.up(input())
                if (prev !== null) { e.preventDefault(); setInput(prev); queueMicrotask(() => { const ta = textareaEl(); if (ta) autoGrow(ta) }) }
              }
              else if (e.key === "ArrowDown" && !e.currentTarget.value) {
                const next = history.down()
                if (next !== null) { e.preventDefault(); setInput(next); queueMicrotask(() => { const ta = textareaEl(); if (ta) autoGrow(ta) }) }
              }
```

7. picker 键盘转发：`sendMessage` 里 `history.push(text)`（`setInput("")` 旁）+ `clearDraft(sidProp())`；Backspace 删 file chip 分支（agents 之后）：

```ts
              else if (e.key === "Backspace" && !e.currentTarget.value && mentionedFiles().length > 0 && mentionedAgents().length === 0) {
                e.preventDefault()
                setMentionedFiles(prev => prev.slice(0, -1))
              }
```

8. `sendMessage` 开头：`sid` 确定后，`const filePrefix = mentionedFiles().map(f => "@" + f.rel).join(" ")`；`message: [filePrefix, text.trim()].filter(Boolean).join("\n")` 替换原 `message: text.trim() || failureNote`；`bodyMessage` 同样 prepend filePrefix；`setMentionedFiles([])` 加入清空行。slash 命令检测保持原样（有 file mention 时跳过命令检测已在 `agents.length === 0` 条件——改为 `atts.length === 0 && agents.length === 0 && mentionedFiles().length === 0`）。
9. 选中回调：

```ts
  const addFileMention = (rel: string) => {
    setMentionedFiles(prev => prev.some(f => f.rel === rel) ? prev : [...prev, { rel }])
    // strip the trailing "@query" token from the input
    const ta = textareaEl()
    const v = input()
    const sel = ta?.selectionStart ?? v.length
    const before = v.slice(0, sel).replace(/@(\S*)$/, "")
    const after = v.slice(sel)
    const next = before + after
    setInput(next)
    setDraft(sidProp(), next)
    setPickerOpen(null)
  }
```

10. chips 行（mentionedAgents For 之后）加 file chips；pickers 区（CommandPicker 之后）加：

```tsx
        <FilePicker
          open={pickerOpen() === "file"}
          trigger={pickerTrigger()}
          files={projectFiles()}
          agents={props.primaryAgents()}
          query={(matchAtMention(input()) || { 1: "" })[1]}
          onSelectFile={addFileMention}
          onSelectAgent={(name) => { addAgent(name); setPickerOpen(null) }}
          onClose={() => setPickerOpen(p => p === "file" ? null : p)}
        />
```

`matchAtMention` 为本地 helper：`const matchAtMention = (v: string) => /(?:^|\s)@(\S*)$/.exec(v)`（与 onInput 同一正则，抽成模块级 const `AT_MENTION_RE`）。

11. keyhint 文案更新为 `↑ 历史 · Enter 发送 · Shift+Enter 换行`。

- [ ] **Step 3: CSS**

```css
/* File mention picker + chips (P1) */
.mafw-file-picker { max-height: 320px; overflow-y: auto; }
.mafw-file-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.mafw-file-row.sel, .mafw-file-row:hover { background: var(--surface-base-hover); }
.mafw-file-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
```

（`direction: rtl` 让长路径尾部——文件名——保持可见。）

- [ ] **Step 4: 验证** — `bun test src/renderer/mafw/components/`（全部纯模块）+ `npx tsgo -b` + `npx electron-vite build`
- [ ] **Step 5: Commit** — `feat(desktop): @file mentions, input history, per-session drafts in composer`

---

### Task 7: 会话内搜索 overlay（Ctrl+F）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/TranscriptSearchOverlay.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（信号 + keydown + 渲染）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: Task 3 `searchTurns`、现有 `visibleTurns()` / `containerRef()` / `data-turn-id` 机制
- Produces: overlay 组件（输入即搜、↑↓ 选择、Enter 跳转、Esc 关闭）

- [ ] **Step 1: 组件**

```tsx
// @ts-nocheck
import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js"
import { TextInputV2 } from "@mafw/ui/v2/textinput-v2"
import { searchTurns, type SearchableTurn } from "./transcript-search"

// In-session transcript search: filter-as-you-type over visible turns,
// ↑/↓ to select, Enter jumps to the turn anchor (data-turn-id).
export function TranscriptSearchOverlay(props: {
  open: boolean
  turns: () => SearchableTurn[]
  container: () => HTMLDivElement | null
  onClose: () => void
}) {
  const [query, setQuery] = createSignal("")
  const [hi, setHi] = createSignal(0)
  let inputEl: HTMLInputElement | undefined

  const hits = createMemo(() => searchTurns(props.turns(), query()))

  const jump = (id: string) => {
    const el = props.container()
    const anchor = el?.querySelector(`[data-turn-id="${id}"]`) as HTMLElement | null
    if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.open) return
      if (e.key === "Escape") { e.preventDefault(); props.onClose() }
      else if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, hits().length - 1)) }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
      else if (e.key === "Enter") {
        e.preventDefault()
        const hit = hits()[hi()]
        if (hit) jump(hit.id)
      }
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  return (
    <Show when={props.open}>
      <div class="mafw-tsearch">
        <TextInputV2
          ref={inputEl}
          value={query()}
          placeholder="搜索会话内容…"
          onInput={e => { setQuery(e.currentTarget.value); setHi(0) }}
        />
        <span class="mafw-tsearch-count">{hits().length ? `${hits().length} 处` : "无匹配"}</span>
        <Show when={query()}>
          <div class="mafw-tsearch-hits">
            <For each={hits()}>
              {(h, i) => (
                <div class="mafw-tsearch-hit" classList={{ sel: i() === hi() }} onClick={() => { setHi(i()); jump(h.id) }}>
                  <span class="mafw-tsearch-role">{h.role === "user" ? "你" : "AI"}</span>
                  <span class="mafw-tsearch-snippet">{h.snippet}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}
```

- [ ] **Step 2: ChatPane 接线**

1. import 加 TranscriptSearchOverlay
2. 信号区加 `const [searchOpen, setSearchOpen] = createSignal(false)`
3. ESC/Ctrl+C onMount 里追加（interrupt 判断之后）：

```ts
    const onSearchKey = (e: KeyboardEvent) => {
      if (!props.focused || pickerOpen()) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault()
        setSearchOpen(o => !o)
      }
    }
    window.addEventListener("keydown", onSearchKey)
```

（onCleanup 里同样移除；注意与现有 onKey 的 cleanup 并列。）

4. searchable turns memo（navTurns 附近）：

```ts
  const searchableTurns = createMemo(() => visibleTurns().map((m: any) => ({
    id: m.id, role: m.role || "user",
    text: [m.text, ...(props.store.part[m.id] || []).map((p: any) => typeof p.text === "string" ? p.text : "")].join(" "),
  })))
```

5. transcript 容器内（MessageNav 旁）渲染：

```tsx
        <TranscriptSearchOverlay
          open={searchOpen()}
          turns={searchableTurns}
          container={containerRef}
          onClose={() => setSearchOpen(false)}
        />
```

- [ ] **Step 3: CSS**

```css
/* Transcript search overlay (P1) */
.mafw-tsearch { position: absolute; top: 48px; right: 16px; z-index: 60; width: min(380px, 80%); display: flex; flex-direction: column; gap: 6px; }
.mafw-tsearch-count { font-size: 10px; color: var(--text-base); padding-left: 4px; }
.mafw-tsearch-hits { max-height: 260px; overflow-y: auto; background: var(--surface-base); border: 0.5px solid var(--border-base, rgba(255,255,255,0.12)); border-radius: 8px; }
.mafw-tsearch-hit { display: flex; gap: 8px; padding: 6px 10px; cursor: pointer; font-size: 11px; align-items: baseline; }
.mafw-tsearch-hit.sel, .mafw-tsearch-hit:hover { background: var(--surface-base-hover); }
.mafw-tsearch-role { flex-shrink: 0; font-size: 9px; padding: 1px 4px; border-radius: 3px; background: var(--surface-base-active); }
.mafw-tsearch-snippet { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

（`.mafw-tsearch` 定位要求 transcript 容器 `position: relative`——检查 `.mafw-chat-scroll` 或容器类，若无则在 CSS 中补 `position: relative`。）

- [ ] **Step 4: 验证** — `npx tsgo -b` + `npx electron-vite build`
- [ ] **Step 5: Commit** — `feat(desktop): in-session transcript search overlay (Ctrl+F)`

---

### Task 8: CompressionDivider 复活（session.compacted）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（`session.compacted` 事件 → compactionMarks signal → ChatPane props）
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（props + transcript 顶部渲染）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（divider 样式——若 `.mafw-compression-*` 类缺失则补）

**Interfaces:**
- Consumes: 现有 `CompressionDivider`（components/CompressionDivider.tsx，死代码复活）；SSE `session.compacted`（properties.sessionID，opencode/pi 双 runtime 归一）
- Produces: `ChatPaneProps.compactionMark?: { at: number; summary?: string } | null`

- [ ] **Step 1: MafwShell 事件处理**

1. 信号区（lastIdleNotify 旁）加：

```ts
  const [compactionMarks, setCompactionMarks] = createSignal<Record<string, { at: number; summary?: string }>>({})
```

2. SSE onmessage（permission.asked 分支旁，`return` 前的通用事件处理区）加：

```ts
      if (event.type === "session.compacted") {
        console.log("[mafw] SSE session.compacted", sid)
        const summary = event.properties?.summary || event.properties?.part?.text || undefined
        setCompactionMarks(prev => ({ ...prev, [sid]: { at: Date.now(), summary } }))
        return
      }
```

3. ChatPane 渲染 props（onUnregisterQueueFlush 对之后）加：

```tsx
                          compactionMark={compactionMarks()[s.id] || null}
```

- [ ] **Step 2: ChatPane props + 渲染**

1. props 类型加 `compactionMark?: { at: number; summary?: string } | null`
2. import CompressionDivider
3. transcript 内 `visibleTurns` For 之前（"加载更早" Show 之后）插入：

```tsx
            <Show when={props.compactionMark}>
              <CompressionDivider
                summary={props.compactionMark!.summary || `此分界线之前的上下文已于 ${new Date(props.compactionMark!.at).toLocaleTimeString()} 被压缩进摘要`}
              />
            </Show>
```

- [ ] **Step 3: CSS 检查/补齐**

检查 mafw.css 是否已有 `.mafw-compression-divider/.mafw-compression-line/.mafw-compression-label/.mafw-compression-summary`；缺失则补：

```css
.mafw-compression-divider { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0; cursor: pointer; }
.mafw-compression-line { height: 0.5px; width: 100%; background: var(--border-base, rgba(255,255,255,0.12)); }
.mafw-compression-label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-base); }
.mafw-compression-summary { width: 100%; box-sizing: border-box; font-size: 11px; color: var(--text-base); white-space: pre-wrap; background: var(--surface-base-hover); border-radius: 8px; padding: 8px 12px; max-height: 180px; overflow-y: auto; }
```

- [ ] **Step 4: 验证** — `npx tsgo -b` + `npx electron-vite build`
- [ ] **Step 5: Commit** — `feat(desktop): revive compression divider on session.compacted`

---

### Task 9: 全量验证与汇报

- [ ] **Step 1**: `cd packages/desktop && bun test` — 预期新增 18 例（input-history 4 + session-drafts 4 + transcript-search 5 + file-fuzzy 5 + file-listing 4 = 22；按实际计）全过，既有 168 过 + 1 pre-existing 失败不变
- [ ] **Step 2**: `npx tsgo -b` + `npx electron-vite build` — 0 error
- [ ] **Step 3**: gateway 回归 `npm test --prefix gateway` — 722/722
- [ ] **Step 4**: 手动冒烟清单：①@ 弹 picker（文件+agent），选中后 chip + 消息带 @relpath；②发送后 ↑ 取回上一条输入、↓ 回到空；③切 tab 草稿保留、发送后清空；④Ctrl+F 搜索 → 命中列表 → Enter 跳转滚动；⑤长会话触发 /compact（或等 cron）→ 分割线出现、点击展开摘要/提示
- [ ] **Step 5**: 汇报 commit 范围 + 新增测试数 + 全量通过数

---

## Self-Review 记录

- **Spec 覆盖**：survey P1-5（@file/历史/draft = Task 1/2/4/5/6）、P1-6（会话搜索 = Task 3/7；CompressionDivider = Task 8；消息复制按钮明确不做——electron 右键菜单已覆盖，理由记录）、P1-7/8/9 留待下批（会话分享/布局恢复/Triage 决策/Automations 编辑/方案确认）。
- **占位符扫描**：无 TBD/TODO；Task 6 Step 1 PopoverShell `onKey` prop 标注了"以实际签名为准调整"的降级路径（键盘留在 textarea onKeyDown 处理）。
- **类型一致性**：`createInputHistory` 返回方法在 Task 1/6 一致；`SearchableTurn/SearchHit` Task 3/7 一致；`walkProjectFiles(root, io, maxFiles, maxDepth)` Task 5 测试与实现签名一致；`compactionMark` 形状 MafwShell/ChatPane 两处一致。
- **已知风险**：① popover 键盘转发需读 PopoverShell 实际签名（降级路径已写明）；② `.mafw-tsearch` 的 absolute 定位依赖容器 relative（Task 7 Step 3 已注明检查项）；③ @file 的 `/(?:^|\s)@(\S*)$/` 与 agent mention 按钮流并存，输入 @ 自动弹文件 picker、agent 仍可从 picker 顶部选中——统一入口对标 opencode。
