// duplex 语音自动发送控制器（Plan 2 D2）：final 文本追加进 composer，静默窗口
// （默认 1200ms）后自动发送。取消条件：新 partial（还想补充）/ 用户手动输入（在编辑）/
// 停止收音 / dispose。回声防线（D5）：TTS 播放期间 final 直接丢弃——AEC 已开但外放
// 不完美，防止 agent 听到自己 → 自动发送 → 无限自言自语环。
// 纯模块、timers 注入，无 Solid 依赖；ChatPane（Task 5）负责接线。

/** final 后的静默窗口：用户已经停顿约 1.2s（VAD 判停）才出 final，再等同等窗口即视为说完。 */
export const VOICE_AUTO_SEND_DELAY_MS = 1200

/**
 * `voice.duplexAutoSend` 解析：只有显式 `false` 才关闭；缺失/非布尔 fail-open 默认开。
 * ChatPane 在配置解析完成前以 false 起步（关闭启动竞态窗口），解析后经此函数落定。
 */
export function resolveDuplexAutoSend(configValue: unknown): boolean {
  return configValue !== false
}

export interface DuplexAutoSendDeps {
  /** 静默窗口；缺省 VOICE_AUTO_SEND_DELAY_MS。 */
  delayMs?: number
  /** `voice.duplexAutoSend`（缺省 true）；false = 只填输入栏不自动发送。 */
  autoSendEnabled: () => boolean
  /** TTS 正在播放（VoiceSession speaking 态）——回声防线输入。 */
  isSpeaking: () => boolean
  /** final 追加进 composer（多段累积由调用方实现）。 */
  appendFinal: (text: string) => void
  /** 触发发送（sendMessage({ voiceOrigin: true })）。 */
  send: () => void
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown
  clearTimeoutImpl?: (timer: unknown) => void
  onArmedChange?: (armed: boolean) => void
}

export interface DuplexAutoSendController {
  /** ASR final 到达：空白忽略；播放中丢弃；否则 append + （可选）计时。 */
  handleFinal(text: string): void
  /** 新 partial 出现（用户继续说话）：取消计时，文本保留。 */
  handlePartial(): void
  /** 用户手动敲键盘（编辑中）：取消计时。 */
  handleManualInput(): void
  /** 停止收音 / TTS 播放开始（spec D2 取消条件）：取消计时，文本保留。 */
  handleStop(): void
  armed(): boolean
  dispose(): void
}

export function createDuplexAutoSendController(deps: DuplexAutoSendDeps): DuplexAutoSendController {
  const delayMs = deps.delayMs ?? VOICE_AUTO_SEND_DELAY_MS
  const setTimeoutImpl = deps.setTimeoutImpl ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimeoutImpl = deps.clearTimeoutImpl ?? ((timer: unknown) => clearTimeout(timer as Parameters<typeof clearTimeout>[0]))

  let timer: unknown = null
  let armed = false

  function setArmed(next: boolean) {
    if (armed === next) return
    armed = next
    deps.onArmedChange?.(next)
  }

  function cancelPending() {
    if (timer !== null) {
      clearTimeoutImpl(timer)
      timer = null
    }
    setArmed(false)
  }

  function arm() {
    cancelPending()
    timer = setTimeoutImpl(() => {
      timer = null
      setArmed(false)
      deps.send()
    }, delayMs)
    setArmed(true)
  }

  return {
    handleFinal(text: string) {
      if (!text || !text.trim()) return
      // 回声防线：TTS 播放中的 final 大概率是 agent 自己的声音，整体丢弃。
      if (deps.isSpeaking()) return
      deps.appendFinal(text)
      if (deps.autoSendEnabled()) arm()
    },
    handlePartial: cancelPending,
    handleManualInput: cancelPending,
    handleStop: cancelPending,
    armed: () => armed,
    dispose: cancelPending,
  }
}
