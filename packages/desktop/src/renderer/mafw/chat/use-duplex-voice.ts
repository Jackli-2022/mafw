// 双工 ASR hook（Task 8）：`voice.duplexV1` 开启时，麦克风走持续 `/ws/voice`
// 上行并在 composer 里显示 partial/final；关闭时完全不参与，旧录音路径不变。
//
// 生命周期契约（来自 Task 7 client）：
// - 每次 start 新建一个 Silero analyzer + client，绝不跨 start 复用（analyzer 持有
//   共享 MediaStream/AudioContext）。
// - client 的 start() 在真实失败时 reject 且已回调 onError；这里 catch 后只做幂等收敛，
//   不重复弹 toast，也不泄漏 analyzer/client。
// - stop/cleanup 统一走 teardown()：先 client.stop()（内部按 tap → mic 顺序释放），
//   再兜底 analyzer.stop()。
// - createGenerationGuard 保证旧 start 迟到的 socket/VAD 回调写不到新的 start/会话。
import { createEffect, createSignal, onCleanup } from "solid-js"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { createSileroVadAnalyzer } from "../voice/silero"
import { createVoicePcmTap } from "../voice/pcm-capture"
import { createDuplexClient, type DuplexClient, type DuplexClientState } from "../voice/duplex-client"
import { DEFAULT_VAD_PARAMS, type VadAnalyzer } from "../voice/types"
import { createGenerationGuard } from "./duplex-voice-mode"

/** 没有打开会话时的稳定错误码（surface 到 bar，不静默吞掉点击）。 */
export const VOICE_CHAT_SESSION_REQUIRED = "voice_chat_session_required"

export interface DuplexVoiceController {
  /** `voice.duplexV1 === true` 且 gateway 可用。 */
  enabled: () => boolean
  active: () => boolean
  partial: () => string
  finalText: () => string
  error: () => string
  toggle: () => Promise<void>
  stop: () => Promise<void>
}

export function useDuplexVoice(sid: () => string, ready: () => boolean): DuplexVoiceController {
  const [enabled, setEnabled] = createSignal(false)
  const [active, setActive] = createSignal(false)
  const [partial, setPartial] = createSignal("")
  const [finalText, setFinalText] = createSignal("")
  const [error, setError] = createSignal("")

  const guard = createGenerationGuard()
  let client: DuplexClient | null = null
  let analyzer: VadAnalyzer | null = null
  let starting: Promise<void> | null = null
  let statusToken = 0

  function reportError(problem: unknown) {
    const message = problem instanceof Error ? problem.message : String(problem)
    setError(message)
    showToastV2({ description: `语音输入失败: ${message}`, duration: 3000 } as any)
  }

  /** 释放在途 client 与 analyzer（幂等；client.stop 本身 idle-safe）。 */
  async function teardown(): Promise<void> {
    const activeClient = client
    const activeAnalyzer = analyzer
    client = null
    analyzer = null
    if (activeClient) {
      try {
        await activeClient.stop()
      } catch (problem) {
        console.warn("[voice] duplex client stop failed:", problem)
      }
    }
    try {
      activeAnalyzer?.stop()
    } catch (problem) {
      console.warn("[voice] duplex vad stop failed:", problem)
    }
  }

  /** flag 由开变关（配置改动/探测失败）时，正在收的音必须先停，别留活 socket 与麦克风。 */
  function applyEnabled(next: boolean) {
    const was = enabled()
    setEnabled(next)
    if (was && !next) void stop()
  }

  // 只在 gateway ready 后取配置：断开时 fetch 必然失败，且会把"默认关"误当配置。
  // ready 每次 false→true 都重取一次（网关重启后 flag 可能变化）。
  createEffect(() => {
    const isReady = ready()
    const token = ++statusToken
    if (!isReady) {
      setEnabled(false)
      return
    }
    void window.api.mafw.voice.status().then(
      (status) => {
        if (token !== statusToken) return
        const config = status?.config
        applyEnabled(config?.duplexV1 === true)
      },
      () => {
        if (token !== statusToken) return
        // fail-open：读不到配置就保持旧路径，绝不因为探测失败锁死麦克风。
        applyEnabled(false)
      },
    )
  })

  async function start(): Promise<void> {
    // flag 关：完全交回 legacy 路径（调用方按 voiceMicAction 分流）。
    if (!enabled()) return
    // 未 ready：保持既有的 disabled 行为，不弹错。
    if (!ready()) return
    const sessionID = sid()
    if (!sessionID) {
      setError(VOICE_CHAT_SESSION_REQUIRED)
      showToastV2({ description: "请先打开一个会话再使用语音输入", duration: 3000 } as any)
      return
    }
    if (starting) return starting

    starting = (async () => {
      const generation = guard.begin()
      // 旧 client（可能处于 error 态）先收干净，再建新的 analyzer/client。
      await teardown()
      if (!guard.isCurrent(generation)) return

      const nextAnalyzer = createSileroVadAnalyzer({ ...DEFAULT_VAD_PARAMS })
      const nextClient = createDuplexClient({
        chatSessionId: sessionID,
        // preload 返回 Promise；client 在开 socket 前 await 它（renderer 不拼 URL）。
        wsUrl: () => window.api.mafw.voice.wsUrl(),
        vad: nextAnalyzer,
        createTap: createVoicePcmTap,
        onPartial: (text) => {
          if (!guard.isCurrent(generation)) return
          // 新的 partial = 新一段话开始，上一段 final 到此为止。
          setPartial(text)
          setFinalText("")
        },
        onFinal: (text) => {
          if (!guard.isCurrent(generation)) return
          // final 不自动发给 agent（Plan 1 只做字幕），保留到下一段话。
          setPartial("")
          setFinalText(text)
        },
        onState: (state: DuplexClientState) => {
          if (!guard.isCurrent(generation)) return
          setActive(state === "connecting" || state === "listening")
        },
        onError: (problem) => {
          if (!guard.isCurrent(generation)) return
          setActive(false)
          reportError(problem)
        },
      })

      analyzer = nextAnalyzer
      client = nextClient
      setError("")
      setPartial("")
      setFinalText("")
      setActive(true)

      try {
        await nextClient.start()
      } catch (problem) {
        // client 已在 fail() 里回调过 onError（含 toast）；这里只兜底状态，
        // 避免同一错误弹两次。
        if (guard.isCurrent(generation)) {
          setActive(false)
          if (!error()) reportError(problem)
        }
      } finally {
        if (!guard.isCurrent(generation)) {
          // stop()/切换会话已把这一代作废：迟到的 client 不能继续持有麦克风。
          try {
            await nextClient.stop()
          } catch (stopProblem) {
            console.warn("[voice] duplex client stop failed:", stopProblem)
          }
          nextAnalyzer.stop()
        }
      }
    })()

    try {
      await starting
    } finally {
      starting = null
    }
  }

  async function stop(): Promise<void> {
    // 先作废当前代：client 的 closed/error 回调不再写状态，用户主动停止也不报错。
    const generation = guard.begin()
    await teardown()
    // teardown 期间用户可能已重新开始：新一代拥有状态，旧 stop 不得清掉它。
    if (!guard.isCurrent(generation)) return
    setActive(false)
    setPartial("")
    setFinalText("")
    setError("")
  }

  async function toggle(): Promise<void> {
    if (active()) {
      await stop()
      return
    }
    await start()
  }

  onCleanup(() => {
    guard.begin()
    void teardown()
  })

  return {
    enabled,
    active,
    partial,
    finalText,
    error,
    toggle,
    stop,
  }
}
