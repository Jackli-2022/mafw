import { test, expect } from "bun:test"
import { VOICE_BACKPRESSURE, bufferedMsOf } from "./backpressure"

test("bufferedMsOf: fed minus played in ms", () => {
  // 已投喂 10s，游标 3s → 缓冲 7s
  expect(bufferedMsOf(24000 * 10, 3000, 24000)).toBe(7000)
})

test("bufferedMsOf: never negative when cursor runs ahead (stale/incoherent)", () => {
  expect(bufferedMsOf(24000, 5000, 24000)).toBe(0)
})

test("bufferedMsOf: zero fed → zero buffered", () => {
  expect(bufferedMsOf(0, 0, 24000)).toBe(0)
})

test("watermarks are ordered high > low > 0", () => {
  expect(VOICE_BACKPRESSURE.highWaterMs).toBeGreaterThan(VOICE_BACKPRESSURE.lowWaterMs)
  expect(VOICE_BACKPRESSURE.lowWaterMs).toBeGreaterThan(0)
})
