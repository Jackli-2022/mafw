// @ts-nocheck
import { MicVAD } from "@ricky0123/vad-web"
import ortWasmMjs from "../../assets/vad/ort-wasm-simd-threaded.mjs?url"
import ortWasmBin from "../../assets/vad/ort-wasm-simd-threaded.wasm?url"
import type { VadAnalyzer, VadEvent, VadParams } from "./types"

const SAMPLE_RATE = 16000
// vite `?url` 构建期给出字符串；bun test 下导入的是模块命名空间 → 守卫后回退空串
// （MicVAD.new 仅在真实 runtime 调用，测试只覆盖事件 hub 纯逻辑）。
const ORT_BASE = typeof ortWasmMjs === "string" ? ortWasmMjs.slice(0, ortWasmMjs.lastIndexOf("/")) + "/" : ""
const MODEL_BASE = "/vad/"

/** 事件 hub：VAD 信号多播（录音消费者 + barge-in 消费者共享单 VAD 实例）。 */
export function createVadEventHub() {
  const subs = new Map<VadEvent, Set<(audio?: Float32Array) => void>>()
  return {
    on(event: VadEvent, cb: (audio?: Float32Array) => void) {
      let set = subs.get(event)
      if (!set) { set = new Set(); subs.set(event, set) }
      set.add(cb)
    },
    emit(event: VadEvent, audio?: Float32Array) {
      for (const cb of subs.get(event) ?? []) {
        try { cb(audio) } catch (e) { console.error("[voice] vad subscriber error:", e) }
      }
    },
    clear() { subs.clear() },
  }
}

/**
 * Silero VAD v5（onnxruntime-web WASM，本地打包资产）。
 * 单一 getUserMedia 流（echoCancellation/noiseSuppression/autoGainControl），
 * start() 幂等；事件经 hub 多播，不再有 monitor/recording 模式切换。
 * 资产布局沿用旧 VoiceRecorder：ort wasm 走构建产物 URL，模型/worklet 在 publicDir /vad/。
 */
export function createSileroVadAnalyzer(params: VadParams): VadAnalyzer {
  const hub = createVadEventHub()
  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let vad: InstanceType<typeof MicVAD> | null = null
  let starting: Promise<void> | null = null

  async function ensureStream(): Promise<void> {
    if (stream && ctx) return
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  }

  async function ensureVad(): Promise<void> {
    if (vad) return
    vad = await MicVAD.new({
      model: "v5",
      audioContext: ctx!,
      getStream: () => stream!,
      baseAssetPath: MODEL_BASE,
      onnxWASMBasePath: ORT_BASE,
      positiveSpeechThreshold: params.confidence,
      negativeSpeechThreshold: params.negativeConfidence,
      redemptionMs: params.stopSecs * 1000,
      minSpeechMs: params.minSpeechMs,
      preSpeechPadMs: params.preSpeechPadMs,
      onSpeechStart: () => hub.emit("speech_started"),
      onSpeechEnd: (audio: Float32Array) => hub.emit("speech_stopped", audio),
      onVADMisfire: () => hub.emit("misfire"),
    })
  }

  return {
    async start() {
      if (starting) return starting
      starting = (async () => {
        await ensureStream()
        await ensureVad()
        try { await vad!.start() } catch { /* already running */ }
        console.debug("[voice] Silero VAD ready; ort base:", ORT_BASE, "wasm:", ortWasmBin, "model base:", MODEL_BASE)
      })()
      try { await starting } finally { starting = null }
    },
    stop() {
      try { vad?.pause() } catch { /* ignore */ }
      vad = null
      try { stream?.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
      try { ctx?.close() } catch { /* ignore */ }
      stream = null
      ctx = null
    },
    on: (event, cb) => hub.on(event, cb),
  }
}
