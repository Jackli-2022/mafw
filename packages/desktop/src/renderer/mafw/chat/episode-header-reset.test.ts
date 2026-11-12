import { test } from "node:test"
import assert from "node:assert/strict"
import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js"

test("memoized episode id suppresses same-id object updates", () => {
  const [episode, setEpisode] = createSignal({ id: "ep1", title: "a" })
  const episodeId = createMemo(() => episode().id)
  let runs = 0
  const dispose = createRoot((dispose) => {
    createEffect(on(episodeId, () => { runs++ }, { defer: true }))
    return dispose
  })
  setEpisode({ id: "ep1", title: "b" })
  assert.equal(runs, 0)
  setEpisode({ id: "ep2", title: "b" })
  assert.equal(runs, 1)
  dispose()
})

test("a direct object getter reruns on same-id replacement (regression guard)", () => {
  const [episode, setEpisode] = createSignal({ id: "ep1", title: "a" })
  let runs = 0
  const dispose = createRoot((dispose) => {
    createEffect(on(() => episode().id, () => { runs++ }, { defer: true }))
    return dispose
  })
  setEpisode({ id: "ep1", title: "b" })
  assert.equal(runs, 1)
  dispose()
})
