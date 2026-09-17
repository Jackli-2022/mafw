// @ts-nocheck
import type { TtsPlayer, VadAnalyzer, VoiceState } from "./types"
import type { TurnStopStrategy } from "./types"
import { createAudioWorkletPlayer, alignPcmChunks } from "./worklet-player"

export interface VoiceSessionDeps {
  vad: VadAnalyzer
  strategy: TurnStopStrategy
  streamUrl: () => Promise<string>
  interrupt: (sessionId: string) => Promise<unknown>
  sessionId: () => string | null
  defaultVoice: () => string
  /** 测试注入点；生产缺省 = createAudioWorkletPlayer */
  _makePlayer?: (ctx: AudioContext) => Promise<TtsPlayer>
  /** 测试注入点；生产缺省 = 全局 fetch */
  fetchImpl?: typeof fetch
  /** 测试注入点；生产缺省 = 手势内新建 AudioContext（采样率 = 引擎声明） */
  _makeCtx?: (sampleRate: number) => AudioContext
}

type Handler = (data?: any) => void

const WAV_SAMPLE_RATE = 16000
const DEDUP_TTL_MS = 60_000

function encodeWavBytes(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeString = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  writeString(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, "WAVE"); writeString(12, "fmt "); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  writeString(36, "data"); view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, Math.round(s * (s < 0 ? 0x8000 : 0x7fff)), true); off += 2
  }
  return buffer
}

function hashText(t: string): string {
  let h = 0
  for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0
  return String(h)
}

/**
 * VoiceSession — 桌面语音唯一入口。显式状态机：
 *   idle → recording（VAD 分段 → segment 事件）
 *   idle → speaking ⇄ interrupted（barge-in：flush + gateway interrupt）
 * 播放互斥、speak 去重（TTL hash）、打断传播全部收敛在这里。
 * VAD 信号按状态路由：recording → 轮次分段；speaking → barge-in。
 */
export function createVoiceSession(deps: VoiceSessionDeps) {
  let state: VoiceState = "idle"
  const listeners = new Map<string, Set<Handler>>()
  const recentSpeaks = new Map<string, number>() // hash → ts（TTL 去重）
  let activePlayer: (TtsPlayer & { markEof?(): void }) | null = null
  let activeAbort: AbortController | null = null

  const emit = (event: string, data?: any) => {
    for (const cb of listeners.get(event) ?? []) {
      try { cb(data) } catch (e) { console.error("[voice] listener error:", e) }
    }
  }
  const setState = (s: VoiceState) => { state = s; emit("state", s) }

  // VAD 信号按状态路由
  deps.vad.on("speech_started", () => {
    if (state === "speaking") bargeIn()
    else if (state === "recording") deps.strategy.onSpeechStarted()
  })
  deps.vad.on("speech_stopped", (audio?: Float32Array) => {
    if (state !== "recording" || !audio) return
    if (deps.strategy.onSpeechStopped(audio) !== "end_turn") return
    const wavBytes = encodeWavBytes(audio, WAV_SAMPLE_RATE)
    const duration = audio.length / WAV_SAMPLE_RATE
    console.log(`[voice] segment (${Math.round(duration * 1000)}ms, ${wavBytes.byteLength} bytes)`)
    emit("segment", { wavBytes, duration })
  })

  function bargeIn() {
    const cursor = activePlayer?.playCursorMs ?? 0
    console.log(`[voice] barge-in: flushed at ${cursor}ms`)
    activePlayer?.flush()
    activeAbort?.abort()
    const sid = deps.sessionId()
    if (sid) void deps.interrupt(sid).catch(e => console.warn("[voice] interrupt failed:", e))
    setState("interrupted")
    emit("barge_in", { playCursorMs: cursor })
  }

  async function startRecording() {
    if (state === "recording") return
    if (state === "speaking") stopSpeaking("manual")
    try {
      await deps.vad.start()
    } catch (e: any) {
      emit("error", { message: e?.message || String(e) })
      return
    }
    deps.strategy.reset()
    setState("recording")
  }

  function stopRecording() {
    if (state === "recording") setState("idle")
    // 不 stop VAD：speaking 的 barge-in 监听复用同一 analyzer；dispose 时统一释放
  }

  async function playStream(text: string, voice: string, signal: AbortSignal): Promise<void> {
    const streamUrl = await deps.streamUrl()
    const doFetch = deps.fetchImpl ?? fetch
    const res = await doFetch(streamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, sessionId: deps.sessionId() ?? undefined }),
      signal,
    })
    if (!res.ok || !res.body) throw new Error(`TTS stream HTTP ${res.status}`)
    const sampleRate = parseInt(res.headers.get("x-tts-sample-rate") || "24000", 10)
    const makeCtx = deps._makeCtx ?? ((sr: number) => {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      return new AudioCtx({ sampleRate: sr })
    })
    const ctx = makeCtx(sampleRate)
    if (ctx.state === "suspended") {
      try { await ctx.resume() } catch { void ctx.close().catch(() => {}); throw new Error("AudioContext resume failed") }
    }
    try {
      const sid = (ctx as any).setSinkId
      if (typeof sid === "function") void sid.call(ctx, "default").catch(() => {})
    } catch { /* ignore */ }
    const makePlayer = deps._makePlayer ?? createAudioWorkletPlayer
    const player = await makePlayer(ctx) as TtsPlayer & { markEof?(): void }
    activePlayer = player
    setState("speaking")
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let remainder = new Uint8Array(0)
    let buf = ""
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (signal.aborted || ctx.state === "closed") throw new DOMException("aborted", "AbortError")
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() || ""
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith("data:")) continue
          let j: any
          try { j = JSON.parse(t.slice(5).trim()) } catch { continue }
          if (!j.data) continue
          const bin = atob(j.data)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          const { aligned, remainder: rem } = alignPcmChunks(remainder, bytes)
          remainder = rem
          if (aligned.length === 0) continue
          player.feed(new Int16Array(aligned.buffer, aligned.byteOffset, aligned.length / 2))
        }
      }
      player.markEof?.()
      await new Promise<void>(r => {
        const t = setTimeout(r, 60_000)
        player.on("drained", () => { clearTimeout(t); r() })
      })
    } finally {
      reader.releaseLock()
      await player.dispose()
      if (activePlayer === player) activePlayer = null
    }
  }

  async function speak(text: string, voice?: string) {
    const t = (text || "").trim()
    if (!t || state === "speaking") return
    stopSpeaking("manual")
    const abort = new AbortController()
    activeAbort = abort
    try {
      await playStream(t, voice || deps.defaultVoice(), abort.signal)
    } finally {
      if (activeAbort === abort) activeAbort = null
      if (state === "speaking") setState("idle")
    }
  }

  async function speakFromTool(text: string, voice?: string) {
    const clean = (text || "").trim()
    if (!clean) return
    const h = hashText(clean)
    const now = Date.now()
    for (const [k, ts] of recentSpeaks) if (now - ts > DEDUP_TTL_MS) recentSpeaks.delete(k)
    if (recentSpeaks.has(h)) return
    recentSpeaks.set(h, now)
    await speak(clean, voice)
  }

  function stopSpeaking(_reason: "user_barge_in" | "manual") {
    activePlayer?.flush()
    activeAbort?.abort()
    if (state === "speaking" || state === "interrupted") setState("idle")
  }

  return {
    get state() { return state },
    startRecording, stopRecording, speak, speakFromTool, stopSpeaking,
    on(event: string, cb: Handler) {
      let set = listeners.get(event)
      if (!set) { set = new Set(); listeners.set(event, set) }
      set.add(cb)
    },
    dispose() {
      stopSpeaking("manual")
      deps.vad.stop()
      listeners.clear()
    },
    // 测试钩子：不经真实 fetch 直接触发 speaking 态
    _enterSpeakingForTest(player: TtsPlayer) { activePlayer = player; setState("speaking") },
  }
}

export type VoiceSession = ReturnType<typeof createVoiceSession>
