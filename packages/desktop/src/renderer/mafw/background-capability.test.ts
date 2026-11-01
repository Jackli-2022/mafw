import { expect, test } from "bun:test"
import { createRestProbe, createActionProbe, outputPlaceholder, shouldShowRestUnavailableHint } from "./background-capability"

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

test("retry window starts at probe start (first 60s tick re-probes)", async () => {
  let t = 0
  let calls = 0
  const p = createRestProbe(async () => {
    calls++
    t = 50 // probe completes 50ms after start
    throw new Error("502")
  }, () => t)
  await p.probe()
  t = 60_000
  await p.probe()
  expect(calls).toBe(2)
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

test("output placeholder reflects REST state", () => {
  expect(outputPlaceholder("available")).toContain("刷新")
  expect(outputPlaceholder("checking")).toContain("不可用")
  expect(outputPlaceholder("unavailable")).toContain("不可用")
})

test("runtime probe: success sticky, failure retries after 60s", async () => {
  let t = 0
  let calls = 0
  let ok = false
  const p = createActionProbe(async () => {
    calls++
    if (!ok) throw new Error("x")
    return { enabled: true }
  }, () => t)
  expect(await p.available()).toBe(false)
  expect(await p.available()).toBe(false)
  expect(calls).toBe(1)
  t += 60_000
  ok = true
  expect(await p.available()).toBe(true)
  expect(calls).toBe(2)
  t += 120_000
  expect(await p.available()).toBe(true)
  expect(calls).toBe(2)
})

test("runtime probe: in-flight dedupe", async () => {
  let calls = 0
  const p = createActionProbe(async () => {
    calls++
    await new Promise(r => setTimeout(r, 5))
    return { enabled: true }
  })
  await Promise.all([p.available(), p.available()])
  expect(calls).toBe(1)
})

test("runtime probe: reset discards a stale in-flight result", async () => {
  let calls = 0
  let resolveFirst: (v: any) => void = () => {}
  const first = new Promise<any>(r => { resolveFirst = r })
  const p = createActionProbe(() => {
    calls++
    if (calls === 1) return first
    return Promise.resolve({ enabled: true })
  })
  const stale = p.available()
  p.reset()
  resolveFirst({ enabled: false })
  expect(await stale).toBe(false)
  expect(await p.available()).toBe(true)
  expect(calls).toBe(2)
})
