import { expect, test } from "bun:test"
import { createRestProbe, shouldShowRestUnavailableHint } from "./background-capability"

test("starts checking", () => {
  const p = createRestProbe(async () => ({}))
  expect(p.state()).toBe("checking")
})

test("success -> available (sticky)", async () => {
  let t = 0
  const p = createRestProbe(async () => ({}), () => t)
  expect(await p.probe()).toBe("available")
  t += 120_000
  expect(await p.probe()).toBe("available")
})

test("failure -> unavailable; retries after 60s", async () => {
  let t = 0
  let ok = false
  const p = createRestProbe(async () => {
    if (!ok) throw new Error("502")
    return {}
  }, () => t)
  expect(await p.probe()).toBe("unavailable")
  expect(await p.probe()).toBe("unavailable") // fresh within 60s, no new call
  t += 60_000
  ok = true
  expect(await p.probe()).toBe("available")
})

test("in-flight dedupe", async () => {
  let calls = 0
  const p = createRestProbe(async () => {
    calls++
    await new Promise(r => setTimeout(r, 5))
    return {}
  })
  await Promise.all([p.probe(), p.probe()])
  expect(calls).toBe(1)
})

test("reset -> checking", async () => {
  const p = createRestProbe(async () => ({}))
  await p.probe()
  p.reset()
  expect(p.state()).toBe("checking")
})

test("hint predicate", () => {
  expect(shouldShowRestUnavailableHint("unavailable", true)).toBe(true)
  expect(shouldShowRestUnavailableHint("unavailable", false)).toBe(false)
  expect(shouldShowRestUnavailableHint("checking", true)).toBe(false)
  expect(shouldShowRestUnavailableHint("available", true)).toBe(false)
})
