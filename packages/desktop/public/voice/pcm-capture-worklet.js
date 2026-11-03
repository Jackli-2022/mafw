/**
 * 连续麦克风 PCM 采集（AudioWorkletProcessor）。
 * 每个渲染量子把首通道拷贝成独立 Float32Array 发给主线程；
 * 主线程用 pcm-capture.ts 的帧缓冲拼成 16 kHz / 20ms（320 samples）帧。
 * 返回 true 让处理器常驻（VAD 与 ASR 共享同一条流）。
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length) this.port.postMessage(new Float32Array(channel))
    return true
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor)
