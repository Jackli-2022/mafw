/**
 * E8-2: `event.url` 没有 session 维度 —— SDK 的 `events.url()` 固定返回
 * `/api/events`，旧 preload 的 `sessionID?` 参数在 main 的通用 `mafw-invoke`
 * 里被原样转发到无参 SDK 方法，属于死参数。这里钉住 preload 契约与唯一调用方。
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const preloadTypes = read("../src/preload/mafw-types.ts")
const preloadApi = read("../src/preload/mafw-api.ts")
const shell = read("../src/renderer/mafw/MafwShell.tsx")

test("preload event.url takes no session parameter", () => {
  assert.match(preloadTypes, /event:\s*\{[\s\S]*?url:\s*\(\)\s*=>\s*Promise<string>/)
  assert.doesNotMatch(preloadTypes, /url:\s*\(sessionID\?\)/)
})

test("preload event.url invokes the SDK without forwarding arguments", () => {
  assert.match(preloadApi, /url:\s*\(\)\s*=>\s*invoke\("event",\s*"url"\)/)
  assert.doesNotMatch(preloadApi, /invoke\("event",\s*"url",/)
})

test("no production caller passes a session id to event.url", () => {
  // renderer 直连 EventSource：URL 契约归 SDK，session 维度不存在。
  assert.match(shell, /await window\.api\.mafw\.event\.url\(\)/)
  assert.doesNotMatch(shell, /event\.url\([^)]/)
})
