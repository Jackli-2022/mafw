import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8")

// E6-2: one entity cache. session-store keeps ids + fetch state, tabs only keep
// a first-frame fallback title, and every surface (strip / ChatPane / export)
// reads titles through the entity cache. These guards keep a later edit from
// re-introducing the copy-per-surface writes this task removed.

test("session-store keeps ids per bucket, never an entity list", () => {
  const store = read("src/renderer/mafw/session-store.ts")
  assert.match(store, /type Bucket = \{[\s\S]*?ids: string\[\][\s\S]*?fetchedAt: number[\s\S]*?failed: boolean[\s\S]*?\}/)
  assert.doesNotMatch(store, /list: SessionInfo\[\]/)
  assert.doesNotMatch(store, /const cache = new Map<string, \{ list:/)
  assert.match(store, /sessionEntities\.upsert\(/)
  assert.match(store, /\.map\(id => sessionEntities\.get\(id\)\)/)
})

test("session.updated retitles the entity only, never a second tab write", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const retitle = shell.match(/retitleOpenTab: \(id, title\) => \{[\s\S]*?\n      \}/)?.[0] ?? ""
  assert.match(retitle, /sessionEntities\.patch\(id, \{ title \}\)/)
  assert.doesNotMatch(retitle, /setSessions|setStore/)
})

test("opening a tab upserts the entity and keeps the tab title as fallback", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const open = shell.match(/const openSessionTab[\s\S]*?\n  \}/)?.[0] ?? ""
  assert.match(open, /sessionEntities\.upsert\(\{/)
  // 持久化 resume 也走这里：{id,title} → entity。
  assert.match(open, /title: entityTitle/)
})

test("a full SSE resync clears entities together with the buckets", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const resync = shell.match(/onFullResync: \(_reason, _info\) => \{[\s\S]*?\n    \},/)?.[0] ?? ""
  const reset = resync.indexOf("sessionEntities.reset()")
  const invalidate = resync.indexOf("sessionStore.invalidate()")
  assert.ok(reset >= 0, "onFullResync must reset sessionEntities")
  assert.ok(invalidate > reset, "entity reset must precede the bucket invalidate")
})

test("the strip and ChatPane read titles from the entity cache", () => {
  const strip = read("src/renderer/mafw/components/SessionStrip.tsx")
  assert.match(strip, /titleOf\?: \(id: string, fallback: string\) => string/)
  assert.match(strip, /props\.titleOf\?\.\(s\.id, s\.title\) \?\? s\.title/)
  const labels = strip.match(/formatRailTitle\(labelOf\(s\)\)/g) ?? []
  assert.ok(labels.length >= 2, `tab label + overflow title, got ${labels.length}`)
  const chat = read("src/renderer/mafw/components/ChatPane.tsx")
  assert.match(chat, /sessionTitle\(sidProp\(\)/)
})
