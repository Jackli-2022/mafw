import { test, expect } from "bun:test"
import { SilenceTimeoutStrategy } from "./turn"

test("speech_stopped ends turn when silence exceeds stopSecs", () => {
  let now = 1000
  const s = new SilenceTimeoutStrategy({ stopSecs: 1.2, now: () => now })
  s.onSpeechStarted()
  now += 2000 // 说了 2s
  expect(s.onSpeechStopped(new Float32Array(100))).toBe("end_turn")
})

test("continues when speech resumes within stopSecs (strategy-level no-op for silero, contract test)", () => {
  const s = new SilenceTimeoutStrategy({ stopSecs: 1.2, now: () => Date.now() })
  expect(s.onSpeechStopped(new Float32Array(10))).toBe("end_turn")
})

test("reset clears state", () => {
  const s = new SilenceTimeoutStrategy({ stopSecs: 1.2, now: () => 0 })
  s.onSpeechStarted()
  s.reset()
  expect(s.onSpeechStopped(new Float32Array(1))).toBe("end_turn")
})
