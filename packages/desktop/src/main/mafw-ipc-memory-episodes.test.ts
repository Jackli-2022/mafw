import assert from "node:assert/strict"
import { test } from "node:test"
import { resolveIpcMethod } from "./ipc-method"

test("memory.episodes / memory.episode resolve through the nested IPC dispatcher", async () => {
  const namespace = {
    memory: {
      episodes: async (opts: { limit?: number }) => ({ episodes: [{ episodeId: "t1ep_a", limit: opts.limit }] }),
      episode: async (id: string) => ({ episode: { episodeId: id }, members: [] }),
    },
  }
  const episodes = resolveIpcMethod(namespace as any, "memory.episodes")
  const episode = resolveIpcMethod(namespace as any, "memory.episode")
  assert.equal(typeof episodes, "function")
  assert.equal(typeof episode, "function")
  assert.deepEqual(await episodes!({ limit: 5 }), { episodes: [{ episodeId: "t1ep_a", limit: 5 }] })
  assert.deepEqual(await episode!("t1ep_a"), { episode: { episodeId: "t1ep_a" }, members: [] })
})
