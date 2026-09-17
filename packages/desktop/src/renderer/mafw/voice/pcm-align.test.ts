import { test, expect } from "bun:test"
import { alignPcmChunks } from "./worklet-player"

test("odd bytes carry over to next chunk as remainder", () => {
  const r1 = alignPcmChunks(new Uint8Array(0), new Uint8Array([1, 2, 3]))
  expect([...r1.aligned]).toEqual([1, 2])
  expect([...r1.remainder]).toEqual([3])
  const r2 = alignPcmChunks(r1.remainder, new Uint8Array([4]))
  expect([...r2.aligned]).toEqual([3, 4])
  expect(r2.remainder.length).toBe(0)
})

test("even chunk passes through with empty remainder", () => {
  const r = alignPcmChunks(new Uint8Array(0), new Uint8Array([1, 2, 3, 4]))
  expect(r.aligned.length).toBe(4)
  expect(r.remainder.length).toBe(0)
})
