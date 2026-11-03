/**
 * 播放端背压水位（ms）。
 *
 * 背景（2026-11-03 实测）：小米流式 TTS 以 ~5x 实时速率吐 PCM；无背压时
 * worklet 30s 环形缓冲写满后静默丢帧 → 时间压缩 + 爆音（"极速乱读"）。
 * 读 SSE 循环按水位暂停 = TCP/流队列蓄水，一帧不丢。
 *
 * 迟滞：超过 highWater 才暂停，掉到 lowWater 以下才恢复（避免抖动）。
 */
export const VOICE_BACKPRESSURE = {
  highWaterMs: 12_000,
  lowWaterMs: 4_000,
  pollMs: 250,
} as const

/** 已投喂但尚未播放的音频时长（ms）。playedMs 来自播放游标（~1s 上报粒度）。 */
export function bufferedMsOf(fedFrames: number, playedMs: number, sampleRate: number): number {
  const playedFrames = (Math.max(0, playedMs) / 1000) * sampleRate
  return Math.max(0, ((fedFrames - playedFrames) / sampleRate) * 1000)
}
