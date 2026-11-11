import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MAX_RECENT_CONTENT,
  parseRecentContent,
  pushRecentContent,
  readRecentContent,
  recentContentStorageKey,
  recordRecentContent,
  splitRelPath,
  type RecentContentEntry,
} from "./recent-content"

function entry(rel: string, at = 1): RecentContentEntry {
  return {
    rel,
    scopeKey: "project:C:/work/demo",
    scopeKind: "project",
    scopeLabel: "项目文件",
    at,
  }
}

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    data,
  }
}

test("push keeps newest first, dedupes by scope and rel, and caps the list", () => {
  const first = pushRecentContent([], entry("src/a.ts", 1))
  const second = pushRecentContent(first, entry("src/b.ts", 2))
  assert.deepEqual(second.map((item) => item.rel), ["src/b.ts", "src/a.ts"])

  const again = pushRecentContent(second, { ...entry("src/a.ts", 3) })
  assert.deepEqual(again.map((item) => item.rel), ["src/a.ts", "src/b.ts"])
  assert.equal(again[0]!.at, 3)
  assert.equal(again.length, 2)

  const sameRelOtherScope = pushRecentContent(again, {
    ...entry("src/a.ts", 4),
    scopeKey: "goal:C:/work/demo:g1:r1",
    scopeKind: "goal",
  })
  assert.equal(sameRelOtherScope.length, 3)

  const many = Array.from({ length: MAX_RECENT_CONTENT + 3 }, (_, index) =>
    pushRecentContent([], entry(`src/${index}.ts`, index)),
  )
  const capped = many.reduce((list, next) => pushRecentContent(list, next[0]!), [])
  assert.equal(capped.length, MAX_RECENT_CONTENT)
})

test("parse rejects malformed payloads and entries", () => {
  assert.deepEqual(parseRecentContent(null), [])
  assert.deepEqual(parseRecentContent("not json"), [])
  assert.deepEqual(parseRecentContent("{}"), [])
  assert.deepEqual(parseRecentContent('[{"rel":"a.ts"}]'), [])
  assert.deepEqual(
    parseRecentContent(JSON.stringify([
      entry("ok.ts", 5),
      { rel: 1, scopeKey: "s", scopeKind: "project", scopeLabel: "x", at: 1 },
      { rel: "bad.ts", scopeKey: "s", scopeKind: "other", scopeLabel: "x", at: 1 },
      { rel: "bad2.ts", scopeKey: "s", scopeKind: "project", scopeLabel: "x", at: "now" },
    ])),
    [entry("ok.ts", 5)],
  )
})

test("storage key is per normalized project", () => {
  assert.equal(
    recentContentStorageKey("C:\\Work\\Demo\\"),
    recentContentStorageKey("c:/work/demo"),
  )
  assert.match(recentContentStorageKey("C:\\Work\\Demo"), /^mafw-recent-content:c:\/work\/demo$/)
})

test("record reads, prepends and persists the list", () => {
  const io = storage()
  const next = recordRecentContent("C:\\Work\\Demo", entry("src/a.ts", 10), io)
  assert.deepEqual(next.map((item) => item.rel), ["src/a.ts"])
  assert.deepEqual(readRecentContent("c:/work/demo", io).map((item) => item.rel), ["src/a.ts"])

  recordRecentContent("C:\\Work\\Demo", entry("src/b.ts", 11), io)
  assert.deepEqual(readRecentContent("C:\\Work\\Demo", io).map((item) => item.rel), [
    "src/b.ts",
    "src/a.ts",
  ])
})

test("read fails open when storage throws", () => {
  const io = {
    getItem: () => { throw new Error("blocked") },
    setItem: () => { throw new Error("blocked") },
  }
  assert.deepEqual(readRecentContent("C:\\Work\\Demo", io), [])
  assert.doesNotThrow(() => recordRecentContent("C:\\Work\\Demo", entry("a.ts"), io))
})

test("splitRelPath separates directory and file name", () => {
  assert.deepEqual(splitRelPath("src/a/b.ts"), { dir: "src/a", name: "b.ts" })
  assert.deepEqual(splitRelPath("README.md"), { dir: "", name: "README.md" })
  assert.deepEqual(splitRelPath("src\\win.ts"), { dir: "src", name: "win.ts" })
})
