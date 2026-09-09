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
