import { test } from "node:test"
import assert from "node:assert/strict"
import { createDirWatchPool } from "./dir-watch-pool"

function fakeApi() {
  const calls: string[] = []
  return {
    calls,
    watchDir: (root: string, rel: string) => { calls.push(`watch:${root}:${rel}`) },
    unwatchDir: (root: string, rel: string) => { calls.push(`unwatch:${root}:${rel}`) },
  }
}

test("first acquire watches once; nested acquires reuse the watcher", () => {
  const api = fakeApi()
  const pool = createDirWatchPool(api)
  const releaseA = pool.acquire("C:\\project", "")
  const releaseB = pool.acquire("C:/project", "")
  assert.equal(pool.countFor("C:\\project", ""), 2)
  assert.deepEqual(api.calls, ["watch:C:\\project:"])

  releaseA()
  assert.equal(pool.countFor("C:\\project", ""), 1)
  assert.deepEqual(api.calls, ["watch:C:\\project:"])

  releaseB()
  assert.equal(pool.countFor("C:\\project", ""), 0)
  assert.deepEqual(api.calls, ["watch:C:\\project:", "unwatch:C:\\project:"])
})

test("releases are idempotent and do not unwatch a live sibling", () => {
  const api = fakeApi()
  const pool = createDirWatchPool(api)
  const releaseA = pool.acquire("/p", "src")
  const releaseB = pool.acquire("/p", "src")
  releaseA()
  releaseA()
  assert.equal(pool.countFor("/p", "src"), 1)
  assert.equal(api.calls.filter((call) => call.startsWith("unwatch:")).length, 0)

  releaseB()
  releaseB()
  assert.equal(pool.countFor("/p", "src"), 0)
  assert.equal(api.calls.filter((call) => call.startsWith("unwatch:")).length, 1)
})

test("re-acquiring after the last release watches again", () => {
  const api = fakeApi()
  const pool = createDirWatchPool(api)
  pool.acquire("/p", "src")()
  assert.deepEqual(api.calls, ["watch:/p:src", "unwatch:/p:src"])
  const release = pool.acquire("/p", "src")
  assert.equal(pool.countFor("/p", "src"), 1)
  release()
  assert.deepEqual(api.calls, [
    "watch:/p:src",
    "unwatch:/p:src",
    "watch:/p:src",
    "unwatch:/p:src",
  ])
})

test("different roots and directories keep separate counts", () => {
  const api = fakeApi()
  const pool = createDirWatchPool(api)
  pool.acquire("/a", "src")
  pool.acquire("/b", "src")
  pool.acquire("/a", "docs")
  assert.equal(pool.countFor("/a", "src"), 1)
  assert.equal(pool.countFor("/b", "src"), 1)
  assert.equal(pool.countFor("/a", "docs"), 1)
  assert.equal(api.calls.length, 3)
})
