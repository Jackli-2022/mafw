import { test, expect } from "bun:test"
import { createVadEventHub } from "./silero"

test("event hub dispatches speech events to all subscribers", () => {
  const hub = createVadEventHub()
  const got: string[] = []
  hub.on("speech_started", () => got.push("a"))
  hub.on("speech_started", () => got.push("b"))
  hub.emit("speech_started")
  expect(got).toEqual(["a", "b"])
})

test("speech_stopped carries audio to subscribers", () => {
  const hub = createVadEventHub()
  let received: Float32Array | undefined
  hub.on("speech_stopped", (a) => { received = a })
  const audio = new Float32Array([0.1, 0.2])
  hub.emit("speech_stopped", audio)
  expect(received).toBe(audio)
})

test("subscriber throwing does not break other subscribers", () => {
  const hub = createVadEventHub()
  const got: string[] = []
  hub.on("speech_started", () => { throw new Error("boom") })
  hub.on("speech_started", () => got.push("ok"))
  hub.emit("speech_started")
  expect(got).toEqual(["ok"])
})
