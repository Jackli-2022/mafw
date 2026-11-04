import { describe, expect, test } from "bun:test"
import {
  VOICE_AUTO_SEND_DELAY_MS,
  createDuplexAutoSendController,
  resolveDuplexAutoSend,
  type DuplexAutoSendDeps,
} from "./duplex-auto-send"

/** fake timer：记录所有 setTimeout，可按 cleared 标记过滤后统一触发。 */
function fakeClock() {
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = []
  return {
    setTimeoutImpl: (fn: () => void, ms: number) => {
      const t = { fn, ms, cleared: false }
      timers.push(t)
      return t
    },
    clearTimeoutImpl: (t: unknown) => {
      ;(t as { cleared: boolean }).cleared = true
    },
    fire: () => {
      for (const t of timers) {
        if (!t.cleared) {
          t.cleared = true
          t.fn()
        }
      }
    },
    liveCount: () => timers.filter((t) => !t.cleared).length,
  }
}

function makeDeps(overrides: Partial<DuplexAutoSendDeps> = {}) {
  const clock = fakeClock()
  const appended: string[] = []
  let sends = 0
  let speaking = false
  let autoSend = true
  const armedChanges: boolean[] = []
  const deps: DuplexAutoSendDeps = {
    autoSendEnabled: () => autoSend,
    isSpeaking: () => speaking,
    appendFinal: (text) => appended.push(text),
    send: () => {
      sends += 1
    },
    onArmedChange: (armed) => armedChanges.push(armed),
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    ...overrides,
  }
  const controller = createDuplexAutoSendController(deps)
  return {
    clock, deps, controller, appended, sends: () => sends,
    setSpeaking: (v: boolean) => (speaking = v),
    setAutoSend: (v: boolean) => (autoSend = v),
    armedChanges,
  }
}

describe("resolveDuplexAutoSend（配置解析）", () => {
  test("只有显式 false 关闭；缺失/true/异常值 fail-open 默认开", () => {
    expect(resolveDuplexAutoSend(false)).toBe(false)
    expect(resolveDuplexAutoSend(undefined)).toBe(true)
    expect(resolveDuplexAutoSend(null)).toBe(true)
    expect(resolveDuplexAutoSend(true)).toBe(true)
    expect(resolveDuplexAutoSend("false")).toBe(true) // 非布尔不猜
  })
})

describe("createDuplexAutoSendController", () => {
  test("final → append + 计时（默认 1200ms）", () => {
    const t = makeDeps()
    t.controller.handleFinal("你好")
    expect(t.appended).toEqual(["你好"])
    expect(t.controller.armed()).toBe(true)
    expect(t.clock.liveCount()).toBe(1)
    // 通过延迟常量断言默认值（不依赖实现内部结构）
    expect(VOICE_AUTO_SEND_DELAY_MS).toBe(1200)
  })

  test("计时到期 → send 恰好一次并解除 armed", () => {
    const t = makeDeps()
    t.controller.handleFinal("你好")
    t.clock.fire()
    expect(t.sends()).toBe(1)
    expect(t.controller.armed()).toBe(false)
    expect(t.clock.liveCount()).toBe(0)
  })

  test("新 partial 取消计时（文本保留，不发送）", () => {
    const t = makeDeps()
    t.controller.handleFinal("第一段")
    t.controller.handlePartial()
    expect(t.controller.armed()).toBe(false)
    t.clock.fire()
    expect(t.sends()).toBe(0)
    expect(t.appended).toEqual(["第一段"])
  })

  test("用户手动输入取消计时", () => {
    const t = makeDeps()
    t.controller.handleFinal("你好")
    t.controller.handleManualInput()
    t.clock.fire()
    expect(t.sends()).toBe(0)
  })

  test("停止取消计时，文本不撤回", () => {
    const t = makeDeps()
    t.controller.handleFinal("你好")
    t.controller.handleStop()
    t.clock.fire()
    expect(t.sends()).toBe(0)
    expect(t.appended).toEqual(["你好"])
  })

  test("回声防线：TTS 播放中 final 丢弃（不进输入栏、不计时）", () => {
    const t = makeDeps()
    t.setSpeaking(true)
    t.controller.handleFinal("agent 的回声")
    expect(t.appended).toEqual([])
    expect(t.controller.armed()).toBe(false)
    t.clock.fire()
    expect(t.sends()).toBe(0)
  })

  test("autoSendEnabled=false → 只 append 不计时", () => {
    const t = makeDeps()
    t.setAutoSend(false)
    t.controller.handleFinal("你好")
    expect(t.appended).toEqual(["你好"])
    expect(t.controller.armed()).toBe(false)
    expect(t.clock.liveCount()).toBe(0)
    t.clock.fire()
    expect(t.sends()).toBe(0)
  })

  test("partial 取消后新 final 重新计时，只发一次", () => {
    const t = makeDeps()
    t.controller.handleFinal("第一段")
    t.controller.handlePartial()
    t.controller.handleFinal("第二段")
    expect(t.appended).toEqual(["第一段", "第二段"])
    expect(t.clock.liveCount()).toBe(1)
    t.clock.fire()
    expect(t.sends()).toBe(1)
  })

  test("空/空白 final 忽略", () => {
    const t = makeDeps()
    t.controller.handleFinal("")
    t.controller.handleFinal("   ")
    expect(t.appended).toEqual([])
    expect(t.controller.armed()).toBe(false)
    expect(t.clock.liveCount()).toBe(0)
  })

  test("dispose 清掉计时器", () => {
    const t = makeDeps()
    t.controller.handleFinal("你好")
    t.controller.dispose()
    expect(t.controller.armed()).toBe(false)
    t.clock.fire()
    expect(t.sends()).toBe(0)
  })

  test("onArmedChange 随 arm/fire/cancel 翻转", () => {
    const t = makeDeps()
    t.controller.handleFinal("你好")
    expect(t.armedChanges).toEqual([true])
    t.controller.handlePartial()
    expect(t.armedChanges).toEqual([true, false])
    t.controller.handleFinal("再来")
    t.clock.fire()
    expect(t.armedChanges).toEqual([true, false, true, false])
  })

  test("delayMs 覆盖默认延迟", () => {
    const seen: number[] = []
    const clock = fakeClock()
    const controller = createDuplexAutoSendController({
      delayMs: 500,
      autoSendEnabled: () => true,
      isSpeaking: () => false,
      appendFinal: () => {},
      send: () => {},
      setTimeoutImpl: (fn, ms) => {
        seen.push(ms)
        return clock.setTimeoutImpl(fn, ms)
      },
      clearTimeoutImpl: clock.clearTimeoutImpl,
    })
    controller.handleFinal("你好")
    expect(seen).toEqual([500])
  })
})
