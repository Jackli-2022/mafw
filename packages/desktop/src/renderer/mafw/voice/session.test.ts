import { test, expect, mock } from "bun:test"
import { createVoiceSession } from "./session"
import { SilenceTimeoutStrategy } from "./turn"
import { DEFAULT_VAD_PARAMS, type VadAnalyzer, type VadEvent } from "./types"

function fakeVad() {
  const subs = new Map<VadEvent, ((a?: Float32Array) => void)[]>()
  const counters = { starts: 0, stops: 0 }
  const vad: VadAnalyzer = {
    start: async () => { counters.starts++ },
    stop: () => { counters.stops++ },
    on: (e, cb) => { subs.set(e, [...(subs.get(e) ?? []), cb]) },
  }
  return { vad, counters, emit: (e: VadEvent, a?: Float32Array) => subs.get(e)?.forEach(cb => cb(a)) }
}

function fakePlayer() {
  return {
    feed: mock(() => {}), flush: mock(() => {}), playCursorMs: 0,
    on: () => {}, dispose: async () => {}, markEof: mock(() => {}),
  }
}

const baseDeps = (vad: VadAnalyzer) => ({
  vad,
  strategy: new SilenceTimeoutStrategy({ stopSecs: DEFAULT_VAD_PARAMS.stopSecs }),
  streamUrl: async () => "http://gw:3000/api/tts/stream",
  interrupt: async () => ({ ok: true, cancelled: 0 }),
  sessionId: () => "sess-1",
  defaultVoice: () => "茉莉",
})

test("recording: vad speech_stopped emits segment event with wav bytes", async () => {
  const { vad, emit } = fakeVad()
  const vs = createVoiceSession(baseDeps(vad))
  const segments: { wavBytes: ArrayBuffer; duration: number }[] = []
  vs.on("segment", (s) => segments.push(s))
  await vs.startRecording()
  expect(vs.state).toBe("recording")
  emit("speech_stopped", new Float32Array(16000)) // 1s @16k
  expect(segments).toHaveLength(1)
  expect(segments[0].duration).toBeCloseTo(1, 1)
  expect(segments[0].wavBytes.byteLength).toBe(44 + 16000 * 2) // RIFF 头 + pcm16
  vs.dispose()
})

test("barge-in during speaking: speech_started flushes player and interrupts gateway", async () => {
  const { vad, emit } = fakeVad()
  let interrupted = ""
  const player = fakePlayer()
  const vs = createVoiceSession({
    ...baseDeps(vad),
    interrupt: async (sid: string) => { interrupted = sid; return { ok: true, cancelled: 1 } },
  })
  vs._enterSpeakingForTest(player as any)
  emit("speech_started")
  expect(player.flush).toHaveBeenCalled()
  await new Promise(r => setTimeout(r, 0))
  expect(interrupted).toBe("sess-1")
  expect(vs.state).toBe("interrupted")
  vs.dispose()
})

const fakeCtx = () => ({ state: "running", sampleRate: 24000, close: async () => {} })

test("speakFromTool dedupes repeated identical text", async () => {
  const { vad } = fakeVad()
  let plays = 0
  const emptySse = () => new Response(new ReadableStream({ start(c) { c.close() } }), { status: 200 })
  const vs = createVoiceSession({
    ...baseDeps(vad),
    fetchImpl: (async () => emptySse()) as any,
    _makeCtx: () => fakeCtx() as any,
    _makePlayer: async () => { plays++; throw new Error("stop after count") },
  } as any)
  await vs.speakFromTool("同一段话").catch(() => {})
  await vs.speakFromTool("同一段话").catch(() => {})
  expect(plays).toBe(1)
  vs.dispose()
})

test("speak starts vad while speaking and stops it after playback ends", async () => {
  const { vad, counters } = fakeVad()
  // 完整走通 playStream：空 SSE → markEof → drained 立即触发
  const emptySse = () => new Response(new ReadableStream({ start(c) { c.close() } }), { status: 200 })
  const player = {
    ...fakePlayer(),
    on: (event: string, cb: () => void) => { if (event === "drained") setTimeout(cb, 0) },
  }
  const vs = createVoiceSession({
    ...baseDeps(vad),
    fetchImpl: (async () => emptySse()) as any,
    _makeCtx: () => fakeCtx() as any,
    _makePlayer: async () => player as any,
  } as any)
  await vs.speak("一段播报")
  expect(counters.starts).toBeGreaterThanOrEqual(1) // speaking 期间启动 VAD（barge-in 前提）
  expect(counters.stops).toBeGreaterThanOrEqual(1) // 播完且非录音态 → 释放麦克风
  expect(vs.state).toBe("idle")
  vs.dispose()
})

test("stopSpeaking from interrupted state returns to idle", async () => {
  const { vad, emit } = fakeVad()
  const player = fakePlayer()
  const vs = createVoiceSession(baseDeps(vad))
  vs._enterSpeakingForTest(player as any)
  emit("speech_started")
  expect(vs.state).toBe("interrupted")
  vs.stopSpeaking("manual")
  expect(vs.state).toBe("idle")
  vs.dispose()
})

// ── 播放端背压：SSE 读流在缓冲超水位时暂停，降到低水位后恢复 ──
// 背景：小米流式 TTS 实测 ~5x 实时速率，无背压时 30s 环形缓冲吃满后
// worklet 静默丢帧 → 极速乱读。读流按水位暂停 = TCP/流队列蓄水，一帧不丢。
test("backpressure: SSE reads pause above high-water and resume after playback drains", async () => {
  const { vad } = fakeVad()
  const CHUNK_FRAMES = 12000 // 0.5s @24k
  const TOTAL_CHUNKS = 400 // 200s 音频，远超 12s 高水位
  const sseChunk = new TextEncoder().encode(
    `data: ${JSON.stringify({ data: Buffer.alloc(CHUNK_FRAMES * 2, 0).toString("base64"), voice: "茉莉" })}\n\n`,
  )
  let pulls = 0
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulls >= TOTAL_CHUNKS) { c.close(); return }
      pulls++
      c.enqueue(sseChunk.slice())
    },
  })
  let playedMs = 0
  let fedFrames = 0
  const registered: string[] = []
  const player = {
    feed: mock((pcm: Int16Array) => { fedFrames += pcm.length }),
    flush: mock(() => {}),
    get playCursorMs() { return playedMs },
    on: (event: string, cb: () => void) => {
      registered.push(event)
      if (event === "drained") setTimeout(cb, 0) // 红态（无背压跑完整流）也能终止
    },
    dispose: async () => {},
    markEof: mock(() => {}),
  }
  const vs = createVoiceSession({
    ...baseDeps(vad),
    fetchImpl: (async () => new Response(body, { status: 200, headers: { "x-tts-sample-rate": "24000" } })) as any,
    _makeCtx: () => fakeCtx() as any,
    _makePlayer: async () => player as any,
  } as any)
  const done = vs.speak("长文本").catch(() => {})
  try {
    await new Promise(r => setTimeout(r, 900))
    const pausedPulls = pulls
    expect(fedFrames).toBeGreaterThan(0)
    // 高水位 12s，0.5s/块 → 读到 ~24 块（+ 流预读 1-2 块）即暂停
    expect(pausedPulls).toBeLessThanOrEqual(30)
    // 游标冻结（播放未推进）→ 不再读取
    await new Promise(r => setTimeout(r, 400))
    expect(pulls).toBe(pausedPulls)
    // 播放推进到缓冲低于低水位（4s）→ 恢复读流
    playedMs = (fedFrames / 24000) * 1000 - 2000
    await new Promise(r => setTimeout(r, 700))
    expect(pulls).toBeGreaterThan(pausedPulls)
    // 溢出可观测性：播放器注册了 overflow 监听（不再静默丢帧）
    expect(registered).toContain("overflow")
  } finally {
    vs.stopSpeaking("manual")
    await done
    vs.dispose()
  }
})
