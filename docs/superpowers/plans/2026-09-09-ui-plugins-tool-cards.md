# UI 工具卡用户插件系统（ui-plugins）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面 ChatView 支持用户级 CJS 插件（`~/.mafw/ui-plugins/*.js`）自定义工具执行卡：main 进程执行插件 render → 声明式 Widget 树经 IPC → renderer 内置解释器渲染进 BasicTool。

**Architecture:** 三段式——`shared/ui-plugins.ts`（类型 + 校验纯函数，main/preload/renderer 共用）；`main/ui-plugins.ts`（加载器：扫描/校验/热重载/render 调度，fail-open）；renderer `UserPluginCards.tsx`（ToolRegistry 代理注册 + WidgetInterpreter）。优先级在 renderer 判定：无注册卡直接生效，覆盖已注册卡需插件显式 `override: true`。pending/running 走默认链，completed/error 才渲染用户卡。

**Tech Stack:** Electron（main CJS + sandboxed renderer SolidJS）、`bun:test`（desktop 包测试）、`tsgo -b` typecheck；不新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-09-ui-plugins-tool-cards-design.md`

## Global Constraints

- 测试命令在 `packages/desktop/` 下执行：`bun test <file>`（bun:test 风格，参照 `src/main/shell-env.test.ts`）；typecheck：`bun run typecheck`（= `tsgo -b`）
- renderer 只经 `window.api`（`src/preload`）访问主进程（desktop AGENTS.md 分层约定）；renderer 是 sandbox，用户代码只在 main 执行
- IPC 通道前缀 `mafw-ui-plugins-`；广播通道 `mafw-ui-plugins-changed`；不经过 `mafw-invoke` 网关代理（这是 main 本地服务，不是 gateway SDK 命名空间）
- 插件目录固定 `~/.mafw/ui-plugins/*.js`，CJS `module.exports`；信任模型 = 本机可信代码（同 gateway media-plugins）
- Widget 词汇表 v1 固定 8 种：`text/code/kv/tags/list/row/image/link`；非法 type 降级 text
- 优先级：用户插件 > MafwToolCards/session-ui 内置 仅当 `override: true`；无注册卡时直接生效
- 渲染时机：仅 `status === "completed" | "error"` 时请求用户卡；pending/running 委托原注册卡（或 GenericTool）
- 错误语义：坏插件跳过 + warn once；render 抛错/返回非法 → `{ok:false}` → renderer fail-open 回退原链；热重载失败保留旧版本
- 不新增 npm 依赖；desktop 现有测试与 typecheck 保持绿

---

### Task 1: shared 类型 + 校验纯函数

**Files:**
- Create: `packages/desktop/src/shared/ui-plugins.ts`
- Test: `packages/desktop/src/shared/ui-plugins.test.ts`

**Interfaces:**
- Produces（Task 2/3/4 依赖）:
  - `Widget`（8 种联合类型）/ `UserCard { title?, subtitle?, icon?, defaultOpen?, body: Widget[] }`
  - `PluginEntry { tool: string; override: boolean }` / `RenderRequest { tool, input, output?, metadata?, status }` / `RenderResponse { ok, card?, reason? }`
  - `validateWidget(w: unknown): Widget | null`（非法 type 降级 text；null/undefined → null）
  - `validateCard(card: unknown): UserCard | null`（缺 body 且缺 title → null）
  - `shouldUseUserCard(entry: PluginEntry | undefined, hasRegistered: boolean): boolean`

- [ ] **Step 1: 写失败测试** `packages/desktop/src/shared/ui-plugins.test.ts`

```ts
import { describe, expect, test } from "bun:test"
import { validateCard, validateWidget, shouldUseUserCard } from "./ui-plugins"

describe("validateWidget", () => {
  test("passes through the 8 vocabulary types", () => {
    expect(validateWidget({ type: "text", text: "hi" })).toEqual({ type: "text", text: "hi" })
    expect(validateWidget({ type: "code", text: "x" })).toEqual({ type: "code", text: "x" })
    expect(validateWidget({ type: "kv", rows: [["a", "1"]] })).toEqual({ type: "kv", rows: [["a", "1"]] })
    expect(validateWidget({ type: "tags", items: ["x"] })).toEqual({ type: "tags", items: ["x"] })
    expect(validateWidget({ type: "list", items: ["a"] })).toEqual({ type: "list", items: ["a"] })
    expect(validateWidget({ type: "row", children: [{ type: "text", text: "x" }] })).toEqual({ type: "row", children: [{ type: "text", text: "x" }] })
    expect(validateWidget({ type: "image", dataUrl: "data:image/png;base64,x" })).toEqual({ type: "image", dataUrl: "data:image/png;base64,x" })
    expect(validateWidget({ type: "link", text: "t", href: "https://x" })).toEqual({ type: "link", text: "t", href: "https://x" })
  })

  test("degrades unknown types to text", () => {
    expect(validateWidget({ type: "video", src: "x" })).toEqual({ type: "text", text: '{"type":"video","src":"x"}' })
  })

  test("recurses into list/row children and drops invalid entries", () => {
    const w = validateWidget({ type: "list", items: ["a", { type: "text", text: "b" }, null] })
    expect(w).toEqual({ type: "list", items: ["a", { type: "text", text: "b" }] })
  })

  test("null/undefined input returns null", () => {
    expect(validateWidget(null)).toBeNull()
    expect(validateWidget(undefined)).toBeNull()
  })
})

describe("validateCard", () => {
  test("accepts card with body and validates its widgets", () => {
    const c = validateCard({ title: "T", body: [{ type: "text", text: "x" }, { type: "bogus" }] })
    expect(c?.title).toBe("T")
    expect(c?.body).toEqual([{ type: "text", text: "x" }, { type: "text", text: '{"type":"bogus"}' }])
  })

  test("rejects card with neither body nor title", () => {
    expect(validateCard({})).toBeNull()
    expect(validateCard("str")).toBeNull()
  })

  test("accepts title-only card with empty body", () => {
    expect(validateCard({ title: "only" })).toEqual({ title: "only", body: [] })
  })
})

describe("shouldUseUserCard", () => {
  test("no entry → false", () => {
    expect(shouldUseUserCard(undefined, false)).toBe(false)
  })
  test("unregistered tool → true", () => {
    expect(shouldUseUserCard({ tool: "t", override: false }, false)).toBe(true)
  })
  test("registered tool without override → false", () => {
    expect(shouldUseUserCard({ tool: "t", override: false }, true)).toBe(false)
  })
  test("registered tool with override → true", () => {
    expect(shouldUseUserCard({ tool: "t", override: true }, true)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test src/shared/ui-plugins.test.ts`（`packages/desktop/` 下）
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** `packages/desktop/src/shared/ui-plugins.ts`

```ts
// UI 工具卡用户插件共享契约：类型 + 校验纯函数。
// main（插件 render 出口校验）与 renderer（防御性再校验 + 解释器）共用。

export type Widget =
  | { type: "text"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "kv"; rows: Array<[string, string]> }
  | { type: "tags"; items: string[] }
  | { type: "list"; items: Array<string | Widget> }
  | { type: "row"; children: Widget[] }
  | { type: "image"; dataUrl: string }
  | { type: "link"; text: string; href: string }

export interface UserCard {
  title?: string
  subtitle?: string
  icon?: string
  defaultOpen?: boolean
  body: Widget[]
}

export interface PluginEntry {
  tool: string
  override: boolean
}

export interface RenderRequest {
  tool: string
  input: unknown
  output?: string
  metadata?: unknown
  status: string
}

export interface RenderResponse {
  ok: boolean
  card?: UserCard
  reason?: string
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
}

export function validateWidget(w: unknown): Widget | null {
  if (w === null || w === undefined) return null
  if (typeof w !== "object") return { type: "text", text: String(w) }
  const o = w as Record<string, unknown>
  switch (o.type) {
    case "text":
      return { type: "text", text: typeof o.text === "string" ? o.text : safeStringify(o.text) }
    case "code": {
      const out: Extract<Widget, { type: "code" }> = { type: "code", text: typeof o.text === "string" ? o.text : safeStringify(o.text) }
      if (typeof o.language === "string") out.language = o.language
      return out
    }
    case "kv":
      return {
        type: "kv",
        rows: Array.isArray(o.rows)
          ? o.rows.filter((r): r is [string, string] => Array.isArray(r) && r.length >= 2).map((r) => [String(r[0]), String(r[1])])
          : [],
      }
    case "tags":
      return { type: "tags", items: Array.isArray(o.items) ? o.items.map(String) : [] }
    case "list":
      return {
        type: "list",
        items: Array.isArray(o.items)
          ? o.items.flatMap((i) => (typeof i === "string" ? [i] : validateWidget(i) ? [validateWidget(i)!] : []))
          : [],
      }
    case "row":
      return { type: "row", children: Array.isArray(o.children) ? o.children.flatMap((c) => (validateWidget(c) ? [validateWidget(c)!] : [])) : [] }
    case "image":
      return typeof o.dataUrl === "string" ? { type: "image", dataUrl: o.dataUrl } : null
    case "link":
      return typeof o.href === "string" && typeof o.text === "string" ? { type: "link", text: o.text, href: o.href } : null
    default:
      return { type: "text", text: safeStringify(o) }
  }
}

export function validateCard(card: unknown): UserCard | null {
  if (!card || typeof card !== "object") return null
  const o = card as Record<string, unknown>
  const body = Array.isArray(o.body) ? o.body.flatMap((w) => (validateWidget(w) ? [validateWidget(w)!] : [])) : []
  const title = typeof o.title === "string" ? o.title : undefined
  if (!title && body.length === 0) return null
  return {
    title,
    subtitle: typeof o.subtitle === "string" ? o.subtitle : undefined,
    icon: typeof o.icon === "string" ? o.icon : undefined,
    defaultOpen: typeof o.defaultOpen === "boolean" ? o.defaultOpen : undefined,
    body,
  }
}

export function shouldUseUserCard(entry: PluginEntry | undefined, hasRegistered: boolean): boolean {
  if (!entry) return false
  return hasRegistered ? entry.override : true
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test src/shared/ui-plugins.test.ts`
Expected: PASS（约 10 例）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/shared/ui-plugins.ts packages/desktop/src/shared/ui-plugins.test.ts
git commit -m "feat(desktop): shared ui-plugins widget types + validators"
```

---

### Task 2: main 加载器 UiPluginManager

**Files:**
- Create: `packages/desktop/src/main/ui-plugins.ts`
- Test: `packages/desktop/src/main/ui-plugins.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `PluginEntry/RenderRequest/RenderResponse/validateCard`
- Produces:
  - `uiPluginsDir(): string`（`~/.mafw/ui-plugins`，`MAFW_UI_PLUGINS_DIR` 环境变量可覆盖——测试注入 tmpdir 用）
  - `class UiPluginManager`：`loadAll(): { loaded: string[]; failed: Record<string, string> }`、`reload(): 同 loadAll`、`list(): PluginEntry[]`、`render(req: RenderRequest): RenderResponse`、`watch(): void`、`setOnChange(cb: () => void): void`、`dispose(): void`
  - 同一文件重复加载以文件路径为键覆盖（旧条目清除）

- [ ] **Step 1: 写失败测试** `packages/desktop/src/main/ui-plugins.test.ts`

```ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { UiPluginManager } from "./ui-plugins"

let dir: string
let mgr: UiPluginManager

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mafw-ui-plugins-"))
  process.env.MAFW_UI_PLUGINS_DIR = dir
  mgr = new UiPluginManager()
})

afterEach(() => {
  mgr.dispose()
  fs.rmSync(dir, { recursive: true, force: true })
  delete process.env.MAFW_UI_PLUGINS_DIR
})

const pluginV1 = `
module.exports = {
  name: "demo",
  tools: {
    my_tool: {
      render(ctx) {
        const d = ctx.json(ctx.output)
        return { title: "Demo", subtitle: d && d.summary, body: [{ type: "kv", rows: [["status", String(d && d.status)]] }] }
      },
    },
    bash: { override: true, render: () => ({ title: "Bash!", body: [{ type: "text", text: "overridden" }] }) },
  },
}
`

test("loadAll loads valid plugins and exposes list/render", () => {
  fs.writeFileSync(path.join(dir, "demo.js"), pluginV1)
  const res = mgr.loadAll()
  expect(res.loaded).toEqual(["demo.js"])
  expect(res.failed).toEqual({})
  expect(mgr.list().sort((a, b) => a.tool.localeCompare(b.tool))).toEqual([
    { tool: "bash", override: true },
    { tool: "my_tool", override: false },
  ])
  const rendered = mgr.render({ tool: "my_tool", input: {}, output: JSON.stringify({ summary: "s", status: "ok" }), status: "completed" })
  expect(rendered.ok).toBe(true)
  expect(rendered.card?.title).toBe("Demo")
  expect(rendered.card?.body[0]).toEqual({ type: "kv", rows: [["status", "ok"]] })
})

test("render returns ok:false for tools without a card", () => {
  mgr.loadAll()
  expect(mgr.render({ tool: "unknown", input: {}, status: "completed" }).ok).toBe(false)
})

test("render catches plugin errors and returns ok:false with reason", () => {
  fs.writeFileSync(path.join(dir, "bad-render.js"), `
module.exports = { name: "br", tools: { t: { render: () => { throw new Error("boom") } } } }
`)
  mgr.loadAll()
  const res = mgr.render({ tool: "t", input: {}, status: "completed" })
  expect(res.ok).toBe(false)
  expect(res.reason).toContain("boom")
})

test("invalid plugin file is skipped and reported in failed", () => {
  fs.writeFileSync(path.join(dir, "noexport.js"), "module.exports = 42")
  fs.writeFileSync(path.join(dir, "broken.js"), "throw new Error('syntax-ish')")
  const res = mgr.loadAll()
  expect(res.loaded).toEqual([])
  expect(Object.keys(res.failed).sort()).toEqual(["broken.js", "noexport.js"])
})

test("reload picks up changes; removed plugin disappears", () => {
  fs.writeFileSync(path.join(dir, "demo.js"), pluginV1)
  mgr.loadAll()
  expect(mgr.list().some((e) => e.tool === "my_tool")).toBe(true)

  fs.writeFileSync(path.join(dir, "demo.js"), `
module.exports = { name: "demo", tools: { other_tool: { render: () => ({ title: "V2", body: [] }) } } }
`)
  mgr.reload()
  expect(mgr.list()).toEqual([{ tool: "other_tool", override: false }])

  fs.unlinkSync(path.join(dir, "demo.js"))
  mgr.reload()
  expect(mgr.list()).toEqual([])
})

test("reload keeps old version when a changed file becomes invalid", () => {
  fs.writeFileSync(path.join(dir, "demo.js"), pluginV1)
  mgr.loadAll()
  fs.writeFileSync(path.join(dir, "demo.js"), "module.exports = 42")
  mgr.reload()
  expect(mgr.list().some((e) => e.tool === "my_tool")).toBe(true) // 旧版本保留
})

test("warns once per file (render errors do not spam)", () => {
  const logs: string[] = []
  const orig = console.warn
  console.warn = (...a: unknown[]) => { logs.push(a.join(" ")) }
  try {
    fs.writeFileSync(path.join(dir, "bad-render.js"), `
module.exports = { name: "br", tools: { t: { render: () => { throw new Error("boom") } } } }
`)
    mgr.loadAll()
    mgr.render({ tool: "t", input: {}, status: "completed" })
    mgr.render({ tool: "t", input: {}, status: "completed" })
  } finally {
    console.warn = orig
  }
  expect(logs.filter((l) => l.includes("boom")).length).toBe(1)
})

test("missing directory → empty list, no throw", () => {
  process.env.MAFW_UI_PLUGINS_DIR = path.join(dir, "nonexistent")
  const m2 = new UiPluginManager()
  expect(m2.loadAll().loaded).toEqual([])
  expect(m2.list()).toEqual([])
  m2.dispose()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test src/main/ui-plugins.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** `packages/desktop/src/main/ui-plugins.ts`

```ts
// 用户工具卡插件加载器（main 进程）。
// 信任模型：~/.mafw/ui-plugins/*.js 是本机可信代码（同 gateway media-plugins），
// 直接 require 进 main 执行；renderer（sandbox）只收声明式 Widget 树。
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { validateCard, type PluginEntry, type RenderRequest, type RenderResponse, type UserCard } from "../shared/ui-plugins"

export interface RenderContext {
  tool: string
  input: unknown
  output?: string
  metadata?: unknown
  status: string
  json(s?: string): unknown
  pretty(v: unknown): string
}

interface ToolEntry {
  plugin: string
  override: boolean
  render?: (ctx: RenderContext) => unknown
}

export function uiPluginsDir(): string {
  return process.env.MAFW_UI_PLUGINS_DIR || path.join(os.homedir(), ".mafw", "ui-plugins")
}

// electron-vite main 构建为 CJS，运行时 require 可加载任意磁盘文件。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadModule = (file: string): any => require(file)

export class UiPluginManager {
  private tools = new Map<string, ToolEntry>()
  private warned = new Map<string, Set<string>>()
  private watcher: fs.FSWatcher | null = null
  private onChangeCb: (() => void) | null = null

  list(): PluginEntry[] {
    return [...this.tools.entries()].map(([tool, t]) => ({ tool, override: t.override }))
  }

  render(req: RenderRequest): RenderResponse {
    const entry = this.tools.get(req.tool)
    if (!entry?.render) return { ok: false, reason: "no user card for tool" }
    try {
      const ctx: RenderContext = {
        tool: req.tool,
        input: req.input,
        output: req.output,
        metadata: req.metadata,
        status: req.status,
        json: (s) => { try { return JSON.parse(s ?? "") } catch { return null } },
        pretty: (v) => { try { return JSON.stringify(v, null, 2) } catch { return String(v) } },
      }
      const card: UserCard | null = validateCard(entry.render(ctx))
      if (!card) return { ok: false, reason: "plugin returned an invalid card" }
      return { ok: true, card }
    } catch (err) {
      this.warnOnce(entry.plugin, err instanceof Error ? err.message : String(err))
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  loadAll(): { loaded: string[]; failed: Record<string, string> } {
    return this.loadDir(uiPluginsDir())
  }

  reload(): { loaded: string[]; failed: Record<string, string> } {
    return this.loadAll()
  }

  private loadDir(dir: string): { loaded: string[]; failed: Record<string, string> } {
    const loaded: string[] = []
    const failed: Record<string, string> = {}
    let files: string[] = []
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"))
    } catch {
      this.tools.clear()
      return { loaded, failed } // 目录不存在 → 空清单
    }
    const stale = new Set([...this.tools.values()].map((t) => t.plugin))
    for (const file of files) {
      const full = path.join(dir, file)
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        delete require.cache[require.resolve(full)]
        const mod = loadModule(full)
        const parsed = this.parsePlugin(mod)
        if (!parsed) throw new Error("module.exports must be { name, tools }")
        // 清掉该插件旧条目（重载后工具集可能变化）
        for (const [tool, t] of this.tools) if (t.plugin === full) this.tools.delete(tool)
        stale.delete(full)
        for (const [tool, entry] of Object.entries(parsed.tools)) this.tools.set(tool, { plugin: full, ...entry })
        loaded.push(file)
      } catch (err) {
        failed[file] = err instanceof Error ? err.message : String(err)
        this.warnOnce(full, failed[file]!)
        stale.delete(full) // 加载失败时保留旧版本条目（fail-open）
      }
    }
    // 文件被删除 → 清除其条目
    for (const removed of stale) for (const [tool, t] of this.tools) if (t.plugin === removed) this.tools.delete(tool)
    if (loaded.length > 0 || Object.keys(failed).length > 0) this.onChangeCb?.()
    return { loaded, failed }
  }

  private parsePlugin(mod: unknown): { name: string; tools: Record<string, { override: boolean; render?: (ctx: RenderContext) => unknown }> } | null {
    if (!mod || typeof mod !== "object") return null
    const m = mod as Record<string, unknown>
    if (typeof m.name !== "string" || !m.name) return null
    if (!m.tools || typeof m.tools !== "object") return null
    const tools: Record<string, { override: boolean; render?: (ctx: RenderContext) => unknown }> = {}
    for (const [tool, def] of Object.entries(m.tools as Record<string, unknown>)) {
      if (!def || typeof def !== "object") continue
      const d = def as Record<string, unknown>
      tools[tool] = {
        override: d.override === true,
        render: typeof d.render === "function" ? (d.render as ToolEntry["render"]) : undefined,
      }
    }
    return { name: m.name, tools }
  }

  private warnOnce(key: string, message: string) {
    const seen = this.warned.get(key) ?? new Set<string>()
    if (seen.has(message)) return
    seen.add(message)
    this.warned.set(key, seen)
    // eslint-disable-next-line no-console
    console.warn(`[ui-plugins] ${path.basename(key)}: ${message}`)
  }

  setOnChange(cb: () => void) {
    this.onChangeCb = cb
  }

  watch() {
    const dir = uiPluginsDir()
    try { fs.mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    try {
      this.watcher?.close()
      this.watcher = fs.watch(dir, () => this.reload())
    } catch { /* 目录不可 watch → 无热重载，fail-open */ }
  }

  dispose() {
    this.watcher?.close()
    this.watcher = null
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test src/main/ui-plugins.test.ts`
Expected: PASS（8 例）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/ui-plugins.ts packages/desktop/src/main/ui-plugins.test.ts
git commit -m "feat(desktop): ui-plugins loader (scan/validate/hot-reload/render) for user tool cards"
```

---

### Task 3: IPC 接线 + preload API

**Files:**
- Modify: `packages/desktop/src/main/mafw-ipc.ts`（`registerMafwIpcHandlers` 内，`mafw-media-upload-and-create` handler 之后）
- Modify: `packages/desktop/src/preload/mafw-api.ts`（`createMafwApi` 返回对象内）
- Modify: `packages/desktop/src/preload/mafw-types.ts`（`MafwAPI` 类型）

**Interfaces:**
- Consumes: Task 1 类型；Task 2 `UiPluginManager`
- Produces（Task 4 依赖）:
  - IPC：`mafw-ui-plugins-list` → `PluginEntry[]`；`mafw-ui-plugins-render`（req: RenderRequest）→ `RenderResponse`；广播 `mafw-ui-plugins-changed`
  - `window.api.mafw.uiPlugins = { list(): Promise<PluginEntry[]>; render(req): Promise<RenderResponse>; onChange(cb: () => void): () => void }`

- [ ] **Step 1: main 侧接线** — `mafw-ipc.ts`

文件顶部 import 区加：

```ts
import { BrowserWindow } from "electron"
import { UiPluginManager } from "./ui-plugins"
```

（`BrowserWindow` 若已 import 则跳过。）`registerMafwIpcHandlers()` 内、`mafw-media-upload-and-create` handler 之后加：

```ts
  // User tool-card plugins: main-local service (fs + require), NOT part of the
  // gateway SDK namespaces — dedicated channels, sandboxed renderer receives
  // declarative widget trees only.
  const uiPluginManager = new UiPluginManager()
  uiPluginManager.loadAll()
  uiPluginManager.setOnChange(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("mafw-ui-plugins-changed")
    }
  })
  uiPluginManager.watch()

  ipcMain.handle("mafw-ui-plugins-list", () => uiPluginManager.list())
  ipcMain.handle("mafw-ui-plugins-render", (_event: IpcMainInvokeEvent, req: RenderRequest) => uiPluginManager.render(req))
```

import 类型：`import type { RenderRequest } from "../shared/ui-plugins"`。

- [ ] **Step 2: preload 接线** — `mafw-api.ts` 返回对象内（`media: {...}` 同级）加：

```ts
    uiPlugins: {
      list: () => ipcRenderer.invoke("mafw-ui-plugins-list") as Promise<PluginEntry[]>,
      render: (req: RenderRequest) => ipcRenderer.invoke("mafw-ui-plugins-render", req) as Promise<RenderResponse>,
      onChange: (cb: () => void) => {
        const handler = () => cb()
        ipcRenderer.on("mafw-ui-plugins-changed", handler)
        return () => ipcRenderer.removeListener("mafw-ui-plugins-changed", handler)
      },
    },
```

类型 import：`import type { PluginEntry, RenderRequest, RenderResponse } from "../shared/ui-plugins"`。

- [ ] **Step 3: 类型声明** — `mafw-types.ts` 的 `MafwAPI` 内加：

```ts
    uiPlugins: {
      list(): Promise<PluginEntry[]>
      render(req: RenderRequest): Promise<RenderResponse>
      onChange(cb: () => void): () => void
    }
```

文件顶部 `import type { PluginEntry, RenderRequest, RenderResponse } from "../shared/ui-plugins"`。

- [ ] **Step 4: typecheck + 相关测试**

Run: `bun run typecheck`（`packages/desktop/` 下）
Expected: 无错误

Run: `bun test src/main/ui-plugins.test.ts src/shared/ui-plugins.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/mafw-ipc.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(desktop): IPC channels + preload api for ui-plugins (list/render/onChange)"
```

---

### Task 4: renderer 代理注册 + Widget 解释器

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/UserPluginCards.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:974`（`registerMafwToolCards()` 之后）

**Interfaces:**
- Consumes: Task 1 `validateCard/shouldUseUserCard/Widget`；Task 3 `window.api.mafw.uiPlugins`；session-ui 的 `ToolRegistry, ToolProps`（`@mafw/session-ui/message-part`）、`BasicTool, GenericTool`（`@mafw/session-ui/basic-tool`）
- Produces: `registerUserPluginCards(): void`——扫描用户插件清单，对每个可覆盖工具注册代理卡；订阅热重载变更并恢复/重注册

- [ ] **Step 1: 实现** `packages/desktop/src/renderer/mafw/components/UserPluginCards.tsx`

```tsx
// 用户工具卡代理：把 ToolRegistry 中"用户插件可接管"的工具替换为代理卡。
// pending/running → 委托原注册卡（或 GenericTool）；completed/error → 经 IPC
// 请求 main 执行插件 render，用内置解释器渲染声明式 Widget 树；失败 fail-open。
import { For, Show, createResource } from "solid-js"
import type { JSX } from "solid-js"
import { ToolRegistry, type ToolProps, type ToolComponent } from "@mafw/session-ui/message-part"
import { BasicTool, GenericTool } from "@mafw/session-ui/basic-tool"
import type { Widget } from "../../../shared/ui-plugins"

// original = undefined 表示该工具本来没有注册卡（默认链是 GenericTool）
const proxied = new Map<string, ToolComponent | undefined>()

function UserPluginProxy(props: ToolProps & { pluginTool: string; original?: ToolComponent }) {
  const settled = () => props.status === "completed" || props.status === "error"
  const [result] = createResource(
    () => (settled() ? { tool: props.pluginTool, input: props.input, output: props.output, metadata: props.metadata, status: props.status } : null),
    (req) => window.api.mafw.uiPlugins.render(req),
  )
  const card = () => (result()?.ok ? result()?.card : undefined)

  return (
    <Show
      when={settled() && card()}
      fallback={props.original ? props.original(props) : <GenericTool {...props} />}
    >
      {(c) => (
        <BasicTool
          icon={(c().icon || "mcp") as any}
          trigger={{ title: c().title || props.pluginTool, subtitle: c().subtitle }}
          status={props.status}
          defaultOpen={c().defaultOpen}
        >
          <For each={c().body}>{(w) => <WidgetNode widget={w} />}</For>
        </BasicTool>
      )}
    </Show>
  )
}

function WidgetNode(props: { widget: Widget }): JSX.Element {
  const w = () => props.widget
  return (
    <Switch
      fallback={<pre class="mafw-tool-output">{JSON.stringify(w())}</pre>}
    >
      {(() => {
        switch (w().type) {
          case "text":
            return <div class="mafw-tool-result-text">{w().text}</div>
          case "code":
            return <pre class="mafw-tool-output">{w().text}</pre>
          case "kv":
            return (
              <div class="mafw-tool-meta-grid">
                <For each={w().rows}>{([label, value]) => (
                  <div class="mafw-tool-meta"><span class="mafw-tool-meta-label">{label}</span>{value}</div>
                )}</For>
              </div>
            )
          case "tags":
            return (
              <div class="mafw-tool-anchors">
                <For each={w().items}>{(t) => <span class="mafw-tool-chip">{t}</span>}</For>
              </div>
            )
          case "list":
            return (
              <div class="mafw-tool-results">
                <For each={w().items}>{(item) =>
                  typeof item === "string"
                    ? <div class="mafw-tool-result"><span class="mafw-tool-result-text">{item}</span></div>
                    : <WidgetNode widget={item} />
                }</For>
              </div>
            )
          case "row":
            return <div style={{ display: "flex", gap: "8px", "align-items": "center" }}><For each={w().children}>{(c) => <WidgetNode widget={c} />}</For></div>
          case "image":
            return (
              <a class="mafw-python-image" href={w().dataUrl} target="_blank" rel="noreferrer" title="点击查看大图">
                <img src={w().dataUrl} alt="plugin image" />
              </a>
            )
          case "link":
            return <a class="mafw-tool-link" href={w().href} target="_blank" rel="noreferrer">{w().text}</a>
          default:
            return <pre class="mafw-tool-output">{JSON.stringify(w())}</pre>
        }
      })()}
    </Switch>
  )
}

async function applyUserPluginCards() {
  // 先恢复所有被代理工具的原始卡（ToolRegistry.register 是覆盖语义）
  for (const [tool, original] of proxied) {
    ToolRegistry.register({ name: tool, render: original })
  }
  proxied.clear()
  let entries: Array<{ tool: string; override: boolean }> = []
  try {
    entries = await window.api.mafw.uiPlugins.list()
  } catch {
    return // gateway/ipc 不可用 → 全部走默认链
  }
  for (const { tool, override } of entries) {
    if (proxied.has(tool)) continue
    const original = ToolRegistry.render(tool)
    if (original && !override) continue // 不覆盖已注册卡（spec §3）
    proxied.set(tool, original)
    ToolRegistry.register({
      name: tool,
      render: (props: ToolProps) => <UserPluginProxy {...props} pluginTool={tool} original={original} />,
    })
  }
}

export function registerUserPluginCards() {
  void applyUserPluginCards()
  window.api.mafw.uiPlugins.onChange(() => void applyUserPluginCards())
}
```

> 注：`Switch/fallback` 与 `Show` 的 Solid 用法以编译为准——若 `Switch` 搭配函数子元素的写法有类型问题，可改为单个 `Match` 链或直接 `switch` 于普通函数返回 JSX（Solid 支持在组件体内条件返回）。实现时以 `bun run typecheck` 通过为准，逻辑不变。

- [ ] **Step 2: MafwShell 接线** — `MafwShell.tsx:974`

```tsx
    registerMafwToolCards()
    registerUserPluginCards()   // 必须在 registerMafwToolCards 之后（捕获 original）
```

import：`import { registerUserPluginCards } from "./components/UserPluginCards"`

- [ ] **Step 3: typecheck + 全量测试**

Run: `bun run typecheck`（`packages/desktop/` 下）
Expected: 无错误

Run: `bun test src/shared src/main`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/UserPluginCards.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): user plugin tool cards — ToolRegistry proxy + widget interpreter"
```

---

### Task 5: 示例插件 + 文档 + 回归

**Files:**
- Create: `docs/examples/ui-plugins/example-tool-cards.js`
- Modify: `AGENTS.md`（§5.14a 附近加一小节）

- [ ] **Step 1: 示例插件** `docs/examples/ui-plugins/example-tool-cards.js`

```js
// 示例：用户工具卡插件。复制到 ~/.mafw/ui-plugins/ 后桌面自动热加载。
// my_tool 未被任何内置卡注册 → 直接生效；bash 覆盖内置卡 → 需要 override: true。
module.exports = {
  name: "example-tool-cards",
  tools: {
    my_tool: {
      render(ctx) {
        const d = ctx.json(ctx.output) || {}
        return {
          title: "My Tool",
          subtitle: d.summary,
          defaultOpen: true,
          body: [
            { type: "kv", rows: [["status", String(d.status ?? "—")], ["duration", d.durationMs != null ? `${d.durationMs}ms` : "—"]] },
            { type: "tags", items: d.tags || [] },
            { type: "code", text: ctx.pretty(d), language: "json" },
          ],
        }
      },
    },
    bash: {
      override: true,
      render(ctx) {
        return {
          title: "Bash (custom)",
          subtitle: ctx.input && ctx.input.command ? String(ctx.input.command).slice(0, 80) : undefined,
          body: [{ type: "code", text: ctx.output || "(no output)" }],
        }
      },
    },
  },
}
```

- [ ] **Step 2: AGENTS.md 更新** — 在 `#### 5.14a Media Engine 插件系统` 小节之后加：

```markdown
#### 5.14b UI 工具卡插件系统（desktop）

`~/.mafw/ui-plugins/*.js`（CJS `module.exports = { name, tools }`）自定义桌面 ChatView
工具执行卡。main 进程执行插件 `render(ctx)` 返回声明式 Widget 树（8 种：text/code/kv/
tags/list/row/image/link），经 IPC 交 renderer 内置解释器渲染；sandboxed renderer
不执行用户代码。优先级：无注册卡直接生效，覆盖 MafwToolCards/session-ui 内置卡需显式
`override: true`；pending/running 走默认链，completed/error 才渲染用户卡。启动扫描 +
fs.watch 热重载，fail-open（坏插件跳过、render 抛错回退默认卡）。示例：
`docs/examples/ui-plugins/example-tool-cards.js`。
```

- [ ] **Step 3: 全量回归**

Run: `bun test src`（`packages/desktop/` 下）
Expected: PASS（含 desktop 既有测试）

Run: `bun run typecheck`
Expected: 无错误

- [ ] **Step 4: 手动验证（可选，需桌面 dev 环境）**

```bash
mkdir -p ~/.mafw/ui-plugins
cp docs/examples/ui-plugins/example-tool-cards.js ~/.mafw/ui-plugins/
cd packages/desktop; npm run dev
```

验证点：①让 agent 跑一条 bash → 卡片标题变 "Bash (custom)"（override 生效）；②改插件文件保存 → 数秒内生效（fs.watch 热重载）；③写一个 `throw` 的坏插件 → 该工具回退默认卡，其余插件不受影响。

- [ ] **Step 5: Commit**

```bash
git add docs/examples/ui-plugins/example-tool-cards.js AGENTS.md
git commit -m "docs(desktop): ui-plugins example + AGENTS.md section"
```

---

## Self-Review 记录

- **Spec 覆盖**：插件契约（T2 parsePlugin + T1 类型）/ 词汇表（T1 类型 + T4 解释器）/ 优先级与 override（T1 shouldUseUserCard + T4 applyUserPluginCards）/ 加载与热重载（T2 loadDir/watch）/ IPC（T3）/ 错误处理（T2 warnOnce+fail-open、T4 fallback）/ 测试（T1/T2 单测 + T5 手动）——全覆盖。
- **占位符**：T4 注明的 Solid `Switch` 用法按编译调整属执行期对齐，逻辑已完整给出。
- **类型一致性**：`PluginEntry/RenderRequest/RenderResponse/UserCard/Widget` 在 T1 定义，T2/T3/T4 引用一致；`registerUserPluginCards()` 在 T4 定义、T4 Step 2 消费；`window.api.mafw.uiPlugins` 在 T3 定义、T4 消费。
