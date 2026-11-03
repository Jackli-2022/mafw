export interface VadParams {
  confidence: number
  negativeConfidence: number
  /** 静音宽限（秒）：VAD 判停后多久仍无人声算轮次结束 */
  stopSecs: number
  minSpeechMs: number
  preSpeechPadMs: number
}

/** 与旧 VoiceRecorder.ts 常量完全一致（行为等价）。 */
export const DEFAULT_VAD_PARAMS: VadParams = {
  confidence: 0.5,
  negativeConfidence: 0.35,
  stopSecs: 1.2,
  minSpeechMs: 500,
  preSpeechPadMs: 800,
}

export type VadEvent = 'speech_started' | 'speech_stopped' | 'misfire'

/** 共享麦克风输入（VAD 拥有 MediaStream/AudioContext，其他消费者只读借道）。 */
export interface MicInput {
  stream: MediaStream
  context: AudioContext
  sampleRate: 16000
}

/** VAD 只发原始信号，不决定轮次（Pipecat VADAnalyzer 分层）。 */
export interface VadAnalyzer {
  start(): Promise<void>
  stop(): void
  on(event: VadEvent, cb: (audio?: Float32Array) => void): void
  /** 已启动时返回同一 stream/context；未启动或已 stop 返回 null。 */
  getInput?(): MicInput | null
}

export interface TurnStopStrategy {
  onSpeechStopped(audio: Float32Array): 'end_turn' | 'continue'
  onSpeechStarted(): void
  reset(): void
}

export type VoiceState = 'idle' | 'recording' | 'speaking' | 'interrupted'

export interface TtsPlayer {
  feed(pcm: Int16Array): void
  flush(): void
  readonly playCursorMs: number
  on(event: 'started' | 'drained' | 'flushed' | 'overflow', cb: () => void): void
  dispose(): Promise<void>
}
