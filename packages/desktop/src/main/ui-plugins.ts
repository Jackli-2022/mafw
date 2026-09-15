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
  /** Last loadAll/reload outcome (Config 管理卡展示用). */
  lastLoad: { loaded: string[]; failed: Record<string, string> } = { loaded: [], failed: {} }

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
    const out = this.loadDir(uiPluginsDir())
    this.lastLoad = out
    return out
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

    // Phase 1: parse every file (no registration yet — deps may arrive in
    // any file order).
    type Parsed = { file: string; full: string; name: string; requires: string[]; tools: Record<string, { override: boolean; render?: (ctx: RenderContext) => unknown }> }
    const parsed: Parsed[] = []
    for (const file of files) {
      const full = path.join(dir, file)
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        delete require.cache[require.resolve(full)]
        const mod = loadModule(full)
        const p = this.parsePlugin(mod)
        if (!p) throw new Error("module.exports must be { name, tools }")
        parsed.push({ file, full, ...p })
      } catch (err) {
        failed[file] = err instanceof Error ? err.message : String(err)
        this.warnOnce(full, failed[file]!)
        stale.delete(full) // 加载失败时保留旧版本条目（fail-open）
      }
    }

    // Phase 2: dependency resolution. Build the satisfied set FORWARD from
    // empty (repeatedly add plugins whose requires are all satisfied) —
    // this drops cycles and chains rooted at missing deps. An unsatisfied
    // plugin is treated as failed; its previous tools stay (fail-open).
    const ok = new Set<string>()
    let changed = true
    while (changed) {
      changed = false
      for (const p of parsed) {
        if (ok.has(p.name)) continue
        if (p.requires.every((r) => ok.has(r))) {
          ok.add(p.name)
          changed = true
        }
      }
    }
    for (const p of parsed) {
      if (ok.has(p.name)) continue
      const missing = p.requires.filter((r) => !ok.has(r))
      failed[p.file] = `missing dependency: ${missing.join(", ")}`
      this.warnOnce(p.full, failed[p.file]!)
    }

    // Phase 3: register tools of satisfied plugins.
    for (const p of parsed) {
      if (!ok.has(p.name)) continue
      // 清掉该插件旧条目（重载后工具集可能变化）
      for (const [tool, t] of this.tools) if (t.plugin === p.full) this.tools.delete(tool)
      stale.delete(p.full)
      for (const [tool, entry] of Object.entries(p.tools)) this.tools.set(tool, { plugin: p.full, ...entry })
      loaded.push(p.file)
    }
    // 文件被删除 → 清除其条目
    for (const removed of stale) for (const [tool, t] of this.tools) if (t.plugin === removed) this.tools.delete(tool)
    if (loaded.length > 0 || Object.keys(failed).length > 0) this.onChangeCb?.()
    return { loaded, failed }
  }

  private parsePlugin(mod: unknown): { name: string; requires: string[]; tools: Record<string, { override: boolean; render?: (ctx: RenderContext) => unknown }> } | null {
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
    const requires = Array.isArray(m.requires)
      ? m.requires.filter((r): r is string => typeof r === "string" && r.length > 0)
      : []
    return { name: m.name, requires, tools }
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
