import type { TurnStopStrategy } from "./types"

/**
 * SilenceTimeoutStrategy — v1 直通语义：VAD speech_stopped 即轮次结束
 * （静音宽限已由 Silero redemptionMs 在引擎内完成）。
 * 未来语义 turn detector 作为新实现挂入本接口。
 */
export class SilenceTimeoutStrategy implements TurnStopStrategy {
  constructor(_opts: { stopSecs: number; now?: () => number }) {}
  onSpeechStarted(): void {}
  onSpeechStopped(_audio: Float32Array): 'end_turn' | 'continue' { return 'end_turn' }
  reset(): void {}
}
