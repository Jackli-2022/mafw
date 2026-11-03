import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
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

test("frames from one push never alias each other's buffers", () => {
  const b = createPcmFrameBuffer()
  const frames = b.push(new Float32Array(640))
  expect(frames).toHaveLength(2)
  expect(frames[0] === frames[1]).toBe(false)
  expect(frames[0].buffer === frames[1].buffer).toBe(false)
})

// 浏览器图无法在 node 里跑（需要真实 AudioWorklet/Chromium）；这条源码契约
// 钉住「静默 sink」接线，防回归成无人拉取的孤立 worklet 或直连 destination 的回声路径。
test("tap wires a zero-gain sink to destination and disconnects it", () => {
  const src = readFileSync(new URL("./pcm-capture.ts", import.meta.url), "utf8")
  expect(src).toContain("context.createGain()")
  expect(src).toContain("sink.gain.value = 0")
  expect(src).toContain("node.connect(sink)")
  expect(src).toContain("sink.connect(context.destination)")
  expect(src).toContain("sink.disconnect()")
  expect(src).not.toContain("node.connect(context.destination)")
})

