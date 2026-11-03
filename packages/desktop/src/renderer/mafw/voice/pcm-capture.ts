import type { MicInput } from "./types"

/** 采集契约：16 kHz 单声道（与 `MicInput.sampleRate` 一致）。 */
export const PCM_SAMPLE_RATE = 16000
/** 一帧 = 20ms @16kHz = 320 samples（ASR sidecar 的输入步长）。 */
export const PCM_FRAME_SAMPLES = 320

/**
 * Float32 [-1,1] → 有符号 16 位。越界值先钳制再缩放：
 * 负半轴 ×32768、正半轴 ×32767，避免 +1 溢出成 -32768。
 */
export function floatToPcm16(frames: Float32Array): Int16Array {
  const out = new Int16Array(frames.length)
  for (let i = 0; i < frames.length; i++) {
    const s = frames[i] < -1 ? -1 : frames[i] > 1 ? 1 : frames[i]
    out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff)
  }
  return out
}

export interface PcmFrameBuffer {
  /** 追加一块 Float32 采样，返回期间凑满的完整帧（每帧 320 samples）。 */
  push(frames: Float32Array): Int16Array[]
  /** 丢弃未凑满的残余（换流/重启时调用）。 */
  reset(): void
}

/**
 * 连续分帧器：跨 push 保留残余，永不把一帧拆到两次 push。
 * worklet 块大小（128 samples）与帧大小（320）不对齐，必须由这里拼齐。
 */
export function createPcmFrameBuffer(): PcmFrameBuffer {
  const block = new Float32Array(PCM_FRAME_SAMPLES)
  let filled = 0
  return {
    push(frames) {
      const out: Int16Array[] = []
      let i = 0
      while (i < frames.length) {
        const n = Math.min(PCM_FRAME_SAMPLES - filled, frames.length - i)
        block.set(frames.subarray(i, i + n), filled)
        filled += n
        i += n
        if (filled === PCM_FRAME_SAMPLES) {
          out.push(floatToPcm16(block))
          filled = 0
        }
      }
      return out
    },
    reset() {
      filled = 0
    },
  }
}

export interface VoicePcmTap {
  dispose(): Promise<void>
}

/** worklet 处理器名（与 public/voice/pcm-capture-worklet.js 的 registerProcessor 一致）。 */
const CAPTURE_WORKLET = "/voice/pcm-capture-worklet.js"

/**
 * 共享麦克风流的连续 PCM 抽头：不改动 MediaStream 归属，不关闭共享
 * AudioContext（VAD 与播放器共用）——dispose 只断开自己建的节点。
 * 帧回调在主线程按 20ms 步长触发，供 ASR 上行。
 *
 * 采样率必须与 16 kHz 契约一致：分帧按计数切（320 = 20ms），换采样率后
 * 帧长就不再是 20ms，必须在建立图之前显式失败。
 */
export async function createVoicePcmTap(
  input: MicInput,
  onFrame: (pcm: Int16Array) => void,
): Promise<VoicePcmTap> {
  const { stream, context } = input
  if (context.sampleRate !== PCM_SAMPLE_RATE) {
    throw new Error(
      `[voice] pcm tap requires a ${PCM_SAMPLE_RATE} Hz AudioContext, got ${context.sampleRate} Hz`,
    )
  }
  await context.audioWorklet.addModule(CAPTURE_WORKLET)
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, "pcm-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
  })
  const buffer = createPcmFrameBuffer()
  let disposed = false

  node.port.onmessage = (e: MessageEvent) => {
    if (disposed) return
    const data = e.data
    const block = data instanceof Float32Array ? data : data?.pcm
    if (!(block instanceof Float32Array) || block.length === 0) return
    for (const frame of buffer.push(block)) {
      try {
        onFrame(frame)
      } catch (err) {
        console.error("[voice] pcm tap frame handler error:", err)
      }
    }
  }

  // 静默消费端：Chromium 只为「通向 destination 的图」拉取渲染量子，
  // 无下游的 worklet 可能整条不跑（vad-web ScriptProcessor 路径同样注明
  // "we need to connect an output or will not work due to chrome bug"）。
  // 采集 worklet 不写输出，经 gain=0 接 destination 既保证被拉取又无回声。
  const sink = context.createGain()
  sink.gain.value = 0
  source.connect(node)
  node.connect(sink)
  sink.connect(context.destination)

  return {
    async dispose() {
      disposed = true
      buffer.reset()
      try {
        node.port.onmessage = null
      } catch { /* ignore */ }
      try {
        source.disconnect()
      } catch { /* ignore */ }
      try {
        node.disconnect()
      } catch { /* ignore */ }
      try {
        sink.disconnect()
      } catch { /* ignore */ }
    },
  }
}
