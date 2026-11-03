import { describe, expect, test } from "bun:test"
import { createGenerationGuard, voiceMicAction } from "./duplex-voice-mode"

describe("voiceMicAction", () => {
  test("duplex flag controls the microphone action without breaking legacy fallback", () => {
    expect(voiceMicAction({ duplexEnabled: true, duplexActive: false, legacyRecording: false })).toBe("start_duplex")
    expect(voiceMicAction({ duplexEnabled: true, duplexActive: true, legacyRecording: false })).toBe("stop_duplex")
    expect(voiceMicAction({ duplexEnabled: false, duplexActive: false, legacyRecording: false })).toBe("start_legacy")
    expect(voiceMicAction({ duplexEnabled: false, duplexActive: false, legacyRecording: true })).toBe("stop_legacy")
  })

  test("duplex wins whenever the flag is on, even if a legacy recording is still running", () => {
    expect(voiceMicAction({ duplexEnabled: true, duplexActive: false, legacyRecording: true })).toBe("start_duplex")
    expect(voiceMicAction({ duplexEnabled: true, duplexActive: true, legacyRecording: true })).toBe("stop_duplex")
  })
})

describe("createGenerationGuard", () => {
  test("a newer generation retires every older one", () => {
    const guard = createGenerationGuard()
    const first = guard.begin()
    expect(guard.isCurrent(first)).toBe(true)
    const second = guard.begin()
    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  test("stopping bumps the generation so late callbacks are dropped", () => {
    const guard = createGenerationGuard()
    const started = guard.begin()
    guard.begin()
    // Late `asr.partial` / `onState` from the stopped start must be ignored.
    expect(guard.isCurrent(started)).toBe(false)
  })
})
