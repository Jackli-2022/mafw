import { test } from "node:test"
import assert from "node:assert/strict"
import { createEpisodeStore } from "./episode-store"
import { createEpisode, type ChatEpisode } from "./episode-model"

function fakeStorage(overrides: { throwOnSet?: boolean } = {}) {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (overrides.throwOnSet) throw new Error("quota")
      map.set(key, value)
    },
  }
}

function episode(id: string, overrides: Partial<ChatEpisode> = {}): ChatEpisode {
  return createEpisode({
    sessionID: "s1",
    title: `讨论 ${id}`,
    startMessageId: `u_${id}`,
    now: "2026-11-12T00:00:00.000Z",
    id,
    ...overrides,
  })
}

test("store round-trips episodes", () => {
  const storage = fakeStorage()
  const store = createEpisodeStore(storage as any, "s1")
  store.upsert(episode("ep1"))
  store.upsert(episode("ep2"))
  const loaded = store.load()
  assert.deepEqual(loaded.map((item) => item.id), ["ep1", "ep2"])
  assert.equal(store.remove("ep1").map((item) => item.id).join(","), "ep2")
})

test("bad JSON and bad rows are dropped", () => {
  const storage = fakeStorage()
  const store = createEpisodeStore(storage as any, "s1")
  storage.map.set("mafw-episodes:v1:s1", "{bad")
  assert.deepEqual(store.load(), [])

  storage.map.set("mafw-episodes:v1:s1", JSON.stringify([
    episode("ok"),
    { id: "bad", status: "nope" },
    { id: "other-session", ...episode("x"), sessionID: "s2" },
  ]))
  assert.deepEqual(store.load().map((item) => item.id), ["ok"])
})

test("store caps at 100 episodes", () => {
  const storage = fakeStorage()
  const store = createEpisodeStore(storage as any, "s1")
  const all = Array.from({ length: 105 }, (_, i) => episode(`ep${i}`))
  store.save(all)
  assert.equal(store.load().length, 100)
  assert.equal(store.load()[0]!.id, "ep5")
})

test("save failure is fail-open", () => {
  const storage = fakeStorage({ throwOnSet: true })
  const store = createEpisodeStore(storage as any, "s1")
  assert.doesNotThrow(() => store.save([episode("ep1")]))
  assert.deepEqual(store.load(), [])
})
