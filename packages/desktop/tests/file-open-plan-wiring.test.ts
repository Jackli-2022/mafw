import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("MafwShell dispatches file opens by fileOpenPlan (html → browser)", () => {
  const src = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(src, /fileOpenPlan\(rel\)/)
  assert.match(src, /ensureRootToken\(/)
  assert.match(src, /requestBrowserNavigate\(/)
  assert.match(src, /openWorkbenchSurface\("browser"\)/)
})

test("BrowserDock consumes the browser nav store", () => {
  const src = read("src/renderer/mafw/components/BrowserDock.tsx")
  // 必须是 effect 里真正读取信号并导航（import 不算）
  assert.match(src, /createEffect\(\(\) => \{\s*const req = browserNavRequest\(\)\s*if \(!req\) return\s*load\(req\.url\)/)
})

test("browser nav store delivers a navigate request", async () => {
  const { browserNavRequest, requestBrowserNavigate } = await import("../src/renderer/mafw/browser-nav")
  assert.equal(browserNavRequest(), null)
  requestBrowserNavigate("mafw-file://ab12cd34/index.html")
  const req = browserNavRequest()
  assert.equal(req?.url, "mafw-file://ab12cd34/index.html")
  assert.ok(typeof req?.at === "number")
})
