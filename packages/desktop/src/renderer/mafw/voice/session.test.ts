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
