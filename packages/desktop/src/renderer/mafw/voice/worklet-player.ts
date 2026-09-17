// @ts-nocheck
import type { TtsPlayer } from "./types"

/** SSE chunk 边界可能切半个 sample：残余字节留到下一块拼齐。 */
export function alignPcmChunks(remainder: Uint8Array, bytes: Uint8Array): { aligned: Uint8Array; remainder: Uint8Array } {
  const combined = new Uint8Array(remainder.length + bytes.length)
  combined.set(remainder)
  combined.set(bytes, remainder.length)
  const alignedLen = combined.length - (combined.length % 2)
  return {
    aligned: combined.subarray(0, alignedLen),
    remainder: combined.subarray(alignedLen),
  }
}

export type AudioWorkletPlayer = TtsPlayer & { markEof(): void }

/**
 * AudioWorklet 环形缓冲播放器。ctx 由调用方在用户手势内创建
 * （Chromium autoplay 策略），采样率 = 引擎声明采样率（SSE 响应头）。
 * 无 BufferSource 回退——Electron Chromium 必有 AudioWorklet（spec 决策）。
 */
export async function createAudioWorkletPlayer(ctx: AudioContext): Promise<AudioWorkletPlayer> {
  await ctx.audioWorklet.addModule("/voice/pcm-worklet.js")
  const node = new AudioWorkletNode(ctx, "pcm-player", { outputChannelCount: [1] })
  node.connect(ctx.destination)

  const listeners = new Map<string, Set<() => void>>()
  let renderedFrames = 0

  node.port.onmessage = (e: MessageEvent) => {
    const msg = e.data
    if (msg.type === "cursor" || msg.type === "flushed") {
      renderedFrames = msg.renderedFrames
    }
    for (const cb of listeners.get(msg.type) ?? []) {
      try { cb() } catch { /* ignore */ }
    }
  }

  return {
    feed(pcm: Int16Array) { node.port.postMessage({ type: "feed", pcm }, [pcm.buffer]) },
    flush() { node.port.postMessage({ type: "flush" }) },
    markEof() { node.port.postMessage({ type: "eof" }) },
    get playCursorMs() { return Math.round((renderedFrames / ctx.sampleRate) * 1000) },
    on(event, cb) {
      let set = listeners.get(event)
      if (!set) { set = new Set(); listeners.set(event, set) }
      set.add(cb)
    },
    async dispose() {
      node.disconnect()
      await ctx.close().catch(() => {})
    },
  }
}
