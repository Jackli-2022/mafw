import { test, expect } from "bun:test"
import { PCM_FRAME_SAMPLES, PCM_SAMPLE_RATE, createPcmFrameBuffer, floatToPcm16 } from "./pcm-capture"

test("floatToPcm16 clamps and scales to signed 16-bit", () => {
  const out = floatToPcm16(new Float32Array([-2, -0.5, 0, 1, 2]))
  expect(Array.from(out)).toEqual([-32768, -16384, 0, 32767, 32767])
})

test("frame buffer emits 20ms frames and preserves remainder", () => {
  const b = createPcmFrameBuffer()
  expect(b.push(new Float32Array(100))).toHaveLength(0)
  const frames = b.push(new Float32Array(300))
  expect(frames).toHaveLength(1)
  expect(frames[0]).toHaveLength(320)
  expect(b.push(new Float32Array(640))).toHaveLength(2)
  b.reset()
  expect(b.push(new Float32Array(319))).toHaveLength(0)
})

test("frame buffer never splits a frame across push calls", () => {
  const b = createPcmFrameBuffer()
  const first = b.push(new Float32Array(319))
  const second = b.push(new Float32Array(1))
  expect(first).toHaveLength(0)
  expect(second).toHaveLength(1)
  expect(second[0]).toHaveLength(320)
})

test("frame buffer contract is 16 kHz mono with 20ms frames", () => {
  expect(PCM_SAMPLE_RATE).toBe(16000)
  expect(PCM_FRAME_SAMPLES).toBe(320)
  expect(PCM_FRAME_SAMPLES / PCM_SAMPLE_RATE).toBe(0.02)
})
