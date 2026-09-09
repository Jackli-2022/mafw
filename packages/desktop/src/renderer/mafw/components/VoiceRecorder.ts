// @ts-nocheck
import { createSignal, onCleanup } from "solid-js"
import { MicVAD } from "@ricky0123/vad-web"
import ortWasmMjs from "../../assets/vad/ort-wasm-simd-threaded.mjs?url"
import ortWasmBin from "../../assets/vad/ort-wasm-simd-threaded.wasm?url"

/**
 * VoiceRecorder — 麦克风录音 + Silero VAD 语音分段 + barge-in 语音检测监听。
 *
 * 模式（mode）：
 *  - idle:        无麦克风流
 *  - monitor:     barge-in 监听（Silero 语音检测回调 onSpeech，不保存、不分段、无监听输出）
 *  - recording:   录音（Silero 分段 → 16kHz mono WAV dataUrl → onSegment）
 *
 * VAD：Silero VAD v5（onnxruntime-web WASM，本地打包资产）。相比固定 RMS 阈值，
 * Silero 对噪声/AGC 放大鲁棒——安静环境不会误触发，真人说话帧级响应。
 * 资产路径（renderer publicDir 复制）：/vad/silero_vad_v5.onnx、
 * /vad/vad.worklet.bundle.min.js、/vad/ort-wasm-simd-threaded.wasm。
 *
 * 单一麦克风流复用：monitor ↔ recording 切换不重建 getUserMedia（避免并发流冲突）。
 * Silero 自带分段状态机（pre-roll 800ms / redemption 静音宽限 / minSpeechMs 防误触），
 * onSpeechEnd 直接给出 16kHz mono Float32Array → encodeWav 输出。
 */

const SAMPLE_RATE = 16000
// Silero 判定阈值（0.3~0.5 官方建议区间；安静桌面环境取 0.5 更保守）。
const POSITIVE_THRESHOLD = 0.5
const NEGATIVE_THRESHOLD = 0.35
const REDEMPTION_MS = 1200
const MIN_SPEECH_MS = 500
const PRE_SPEECH_PAD_MS = 800

// Silero asset layout:
//  - onnxruntime glue + wasm must sit together (the glue resolves its sibling
//    wasm via a relative `new URL(...)`). They are src assets imported with
//    `?url` (name-preserved via assetFileNames → out/renderer/assets/vad) so
//    the runtime `import()` works in dev AND build.
//  - The Silero model + AudioWorklet bundle are loaded via fetch/addModule
//    (never `import()`), so they live in the renderer public dir (/vad/) where
//    dev serves them statically and build copies them verbatim.
const ORT_BASE = ortWasmMjs.slice(0, ortWasmMjs.lastIndexOf("/")) + "/"
const MODEL_BASE = "/vad/"
interface Props {
  onSegment: (bytes: ArrayBuffer, duration: number) => void
  onStateChange?: (recording: boolean) => void
}

function encodeWavBytes(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeString = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeString(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)      // PCM
  view.setUint16(22, 1, true)      // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, "data")
  view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return buffer
}

export function VoiceRecorder(props: Props) {
  const [recording, setRecording] = createSignal(false)
  let mode: "idle" | "monitor" | "recording" = "idle"
  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let vad: InstanceType<typeof MicVAD> | null = null
  let vadReady: Promise<void> | null = null
  let onSpeech: (() => void) | null = null
  let segmentCount = 0

  // 复用同一 getUserMedia 流：Silero MicVAD 用自定义 audioContext + getStream，
  // 避免与现有流并发冲突。
  async function ensureStream(): Promise<boolean> {
    if (stream && ctx) return true
    try {
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
      return true
    } catch (e) {
      console.error("[voice] getUserMedia failed:", e)
      release()
      return false
    }
  }

  // Silero VAD 实例（懒加载：模型 + wasm 首次加载 ~数百 ms，启动时预加载一次）。
  async function ensureVad(): Promise<boolean> {
    if (vad) return true
    if (vadReady) { await vadReady; return !!vad }
    vadReady = (async () => {
      try {
        vad = await MicVAD.new({
          model: "v5",
          audioContext: ctx!,
          getStream: () => stream!,
          baseAssetPath: MODEL_BASE,
          onnxWASMBasePath: ORT_BASE,
          positiveSpeechThreshold: POSITIVE_THRESHOLD,
          negativeSpeechThreshold: NEGATIVE_THRESHOLD,
          redemptionMs: REDEMPTION_MS,
          minSpeechMs: MIN_SPEECH_MS,
          preSpeechPadMs: PRE_SPEECH_PAD_MS,
          onSpeechStart: () => {
            if (mode === "recording" && onSpeech) onSpeech()
          },
          onSpeechEnd: (audio: Float32Array) => {
            if (mode !== "recording") return
            segmentCount++
            const wavBytes = encodeWavBytes(audio, SAMPLE_RATE)
            const duration = audio.length / SAMPLE_RATE
            console.log(`[voice] segment ${segmentCount} (${duration * 1000}ms, ${wavBytes.byteLength} bytes)`)
            props.onSegment(wavBytes, duration)
          },
          onVADMisfire: () => {
            // 触发但段过短（噪声脉冲）——静默丢弃。
          },
        })
        console.debug("[voice] Silero VAD ready; ort base:", ORT_BASE, "wasm:", ortWasmBin, "model base:", MODEL_BASE)
      } catch (e) {
        console.error("[voice] Silero VAD init failed:", e)
        vad = null
      }
    })()
    await vadReady
    return !!vad
  }

  function release() {
    try { vad?.pause(); vad = null } catch { /* ignore */ }
    vadReady = null
    try { stream?.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
    try { ctx?.close() } catch { /* ignore */ }
    stream = null
    ctx = null
    onSpeech = null
    mode = "idle"
  }

  // barge-in 监听：Silero 检测到语音回调 onSpeechCb（不保存、不分段）
  async function startMonitoring(onSpeechCb: () => void): Promise<boolean> {
    onSpeech = onSpeechCb
    if (mode === "recording") return true
    const ok = await ensureStream()
    if (!ok) { onSpeech = null; return false }
    if (!await ensureVad()) { onSpeech = null; return false }
    try { await vad!.start() } catch { /* already running */ }
    mode = "monitor"
    return true
  }

  function stopMonitoring(onSpeechCb: () => void) {
    if (onSpeech === onSpeechCb) onSpeech = null
    if (mode === "monitor") release()
  }

  async function start() {
    if (mode === "recording") return
    const ok = await ensureStream()
    if (!ok) return
    if (!await ensureVad()) return
    try { await vad!.start() } catch { /* already running */ }
    mode = "recording"
    segmentCount = 0
    setRecording(true)
    props.onStateChange?.(true)
  }

  function stop() {
    if (mode === "recording") {
      setRecording(false)
      props.onStateChange?.(false)
    }
    // 录音结束但 barge-in 监听仍需要流 → 回 monitor 模式
    if (onSpeech && mode === "recording") {
      mode = "monitor"
      return
    }
    release()
  }

  onCleanup(release)

  return {
    start,
    stop,
    startMonitoring,
    stopMonitoring,
    isRecording: recording,
  }
}
