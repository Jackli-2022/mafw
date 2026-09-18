/**
 * PCM16 环形缓冲播放器（AudioWorkletProcessor）。
 * 主线程 port.postMessage({type:'feed', pcm: Int16Array}) 投喂；
 * {type:'flush'} 清缓冲（barge-in 即时静音）；{type:'eof'} 数据流结束标记；
 * 定期上报已渲染帧数（播放游标）。
 * 起步缓冲 STARTUP_FRAMES（~200ms）抗网络抖动；欠载自动回到起步缓冲等待。
 */
class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.capacity = sampleRate * 30 // 30s 环形缓冲
    this.ring = new Float32Array(this.capacity)
    this.readPos = 0
    this.writePos = 0
    this.buffered = 0
    this.playing = false
    this.eof = false
    this.renderedFrames = 0
    this.startupFrames = Math.floor(sampleRate * 0.2) // 200ms
    this.port.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'feed') {
        const pcm = msg.pcm // Int16Array
        for (let i = 0; i < pcm.length; i++) {
          if (this.buffered >= this.capacity) break // 满了丢弃（30s 不可能吃满）
          this.ring[this.writePos] = pcm[i] / 32768
          this.writePos = (this.writePos + 1) % this.capacity
          this.buffered++
        }
        if (!this.playing && this.buffered >= this.startupFrames) {
          this.playing = true
          this.port.postMessage({ type: 'started' })
        }
      } else if (msg.type === 'flush') {
        this.readPos = this.writePos = this.buffered = 0
        this.playing = false
        this.eof = false
        this.port.postMessage({ type: 'flushed', renderedFrames: this.renderedFrames })
      } else if (msg.type === 'eof') {
        this.eof = true
      }
    }
  }
  process(_inputs, outputs) {
    const out = outputs[0][0]
    // 空流（引擎 0 块 + eof）：不依赖 playing 态也能报 drained，否则主线程挂 60s 兜底
    if (!this.playing && this.eof && this.buffered === 0) {
      this.eof = false
      this.port.postMessage({ type: 'drained' })
    }
    if (this.playing) {
      for (let i = 0; i < out.length; i++) {
        if (this.buffered > 0) {
          out[i] = this.ring[this.readPos]
          this.readPos = (this.readPos + 1) % this.capacity
          this.buffered--
          this.renderedFrames++
        } else {
          out[i] = 0
          if (this.eof) {
            this.playing = false
            this.eof = false
            this.port.postMessage({ type: 'drained' })
          } else {
            this.playing = false // 欠载：回到起步缓冲等待
            this.port.postMessage({ type: 'underrun' })
          }
          break
        }
      }
      if (this.renderedFrames % sampleRate < 128) {
        this.port.postMessage({ type: 'cursor', renderedFrames: this.renderedFrames })
      }
    }
    return true
  }
}
registerProcessor('pcm-player', PcmPlayerProcessor)
