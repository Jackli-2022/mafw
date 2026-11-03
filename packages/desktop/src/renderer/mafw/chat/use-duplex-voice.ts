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
import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { createSileroVadAnalyzer } from "../voice/silero"
import { createVoicePcmTap, type VoicePcmTap } from "../voice/pcm-capture"
import {
  createDuplexClient,
  type DuplexClient,
  type DuplexClientDeps,
  type DuplexClientState,
} from "../voice/duplex-client"
import { DEFAULT_VAD_PARAMS, type MicInput, type VadAnalyzer, type VadParams } from "../voice/types"
import { createGenerationGuard } from "./duplex-voice-mode"

/** 没有打开会话时的稳定错误码（surface 到 bar，不静默吞掉点击）。 */
export const VOICE_CHAT_SESSION_REQUIRED = "voice_chat_session_required"

export interface DuplexVoiceController {
  /** `voice.duplexV1 === true` 且 gateway 可用。 */
  enabled: () => boolean
  /** 麦克风按钮/pressed 语义：连接中与收音中都算「进行中」，用于 toggle 与按压态。 */
  active: () => boolean
  /**
   * 服务端已回 `ready`、麦克风真正在收音（`active()` 的子集）。
   *
   * 网关要先启动/接管 ASR sidecar 才能回 `ready`（冷启动预算 180s），所以
   * connecting 阶段可能持续很久；UI 文案必须按这个信号区分，不能提前说「正在听」。
   */
  listening: () => boolean
  partial: () => string
  finalText: () => string
  error: () => string
  toggle: () => Promise<void>
  stop: () => Promise<void>
}

/**
 * 测试/宿主注入缝（全部可选，生产默认值不变）。
 *
 * 只为让编排行为可在无浏览器媒体栈的环境下测：状态读取、分析器、客户端、
 * PCM 抽头、toast 出口各一个注入点。运行时（ChatPane）不传这个参数。
 */
export interface DuplexVoiceDeps {
  status?: () => Promise<{ config?: { duplexV1?: boolean } } | null | undefined>
  createAnalyzer?: (params: VadParams) => VadAnalyzer
  createClient?: (deps: DuplexClientDeps) => DuplexClient
  createTap?: (input: MicInput, onFrame: (pcm: Int16Array) => void) => Promise<VoicePcmTap>
  notify?: (options: { description: string; duration: number }) => void
}

export function useDuplexVoice(
  sid: () => string,
  ready: () => boolean,
  overrides?: DuplexVoiceDeps,
): DuplexVoiceController {
  // 默认出口全部惰性求值：`window.api` 只在真正需要时读（例如 gateway ready 后）。
  const readStatus = overrides?.status ?? (() => window.api.mafw.voice.status())
  const makeAnalyzer = overrides?.createAnalyzer ?? ((params: VadParams) => createSileroVadAnalyzer(params))
  const makeClient = overrides?.createClient ?? ((deps: DuplexClientDeps) => createDuplexClient(deps))
  const makeTap = overrides?.createTap ?? ((input: MicInput, onFrame: (pcm: Int16Array) => void) => createVoicePcmTap(input, onFrame))
  const notify = overrides?.notify ?? ((options: { description: string; duration: number }) => showToastV2(options))

  const [enabled, setEnabled] = createSignal(false)
  const [active, setActive] = createSignal(false)
  const [listening, setListening] = createSignal(false)
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
    notify({ description: `语音输入失败: ${message}`, duration: 3000 })
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

  /** flag 由开变关（配置改动/探测失败/gateway 掉线）时，正在收的音必须先停。 */
  function applyEnabled(next: boolean) {
    const was = untrack(() => enabled())
    setEnabled(next)
    if (was && !next) void stop()
  }

  // 只在 gateway ready 后取配置：断开时 fetch 必然失败，且会把"默认关"误当配置。
  // ready 每次 false→true 都重取一次（网关重启后 flag 可能变化）。
  createEffect(() => {
    const isReady = ready()
    const token = ++statusToken
    if (!isReady) {
      // 走同一条关闭路径：掉线时旧 client 不能被留在 active（否则麦克风/socket 存活）。
      applyEnabled(false)
      return
    }
    void readStatus().then(
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
      notify({ description: "请先打开一个会话再使用语音输入", duration: 3000 })
      return
    }
    if (starting) return starting

    starting = (async () => {
      const generation = guard.begin()
      // 旧 client（可能处于 error 态）先收干净，再建新的 analyzer/client。
      await teardown()
      if (!guard.isCurrent(generation)) return

      const nextAnalyzer = makeAnalyzer({ ...DEFAULT_VAD_PARAMS })
      const nextClient = makeClient({
        chatSessionId: sessionID,
        // preload 返回 Promise；client 在开 socket 前 await 它（renderer 不拼 URL）。
        wsUrl: () => window.api.mafw.voice.wsUrl(),
        vad: nextAnalyzer,
        createTap: makeTap,
        onPartial: (text) => {
          if (!guard.isCurrent(generation)) return
          // The gateway opens the next stream with `asr.partial { text: "" }`.
          // That is not a new utterance: clearing here would wipe the final
          // subtitle the moment it arrives (real-desktop smoke, Plan 1).
          if (!text) return
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
          // `ready` 之前网关可能还在冷启动 ASR sidecar（最长 180s），此时不能
          // 让字幕条显示「正在听」。
          setListening(state === "listening")
        },
        onError: (problem) => {
          if (!guard.isCurrent(generation)) return
          setActive(false)
          setListening(false)
          reportError(problem)
        },
      })

      analyzer = nextAnalyzer
      client = nextClient
      setError("")
      setPartial("")
      setFinalText("")
      setActive(true)
      setListening(false)

      let failedStart = false
      try {
        await nextClient.start()
      } catch (problem) {
        failedStart = true
        // client 已在 fail() 里回调过 onError（含 toast）；这里只兜底状态，
        // 避免同一错误弹两次。
        if (guard.isCurrent(generation)) {
          setActive(false)
          setListening(false)
          if (!error()) reportError(problem)
        }
      } finally {
        // 失败或被 stop() 作废：这一代必须收干净（client.stop 幂等），否则下一次
        // start 会捡到半个实例，analyzer 也继续占着共享 AudioContext。
        if (failedStart || !guard.isCurrent(generation)) {
          if (client === nextClient) client = null
          if (analyzer === nextAnalyzer) analyzer = null
          try {
            await nextClient.stop()
          } catch (stopProblem) {
            console.warn("[voice] duplex client stop failed:", stopProblem)
          }
          try {
            nextAnalyzer.stop()
          } catch (stopProblem) {
            console.warn("[voice] duplex vad stop failed:", stopProblem)
          }
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
    setListening(false)
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
    listening,
    partial,
    finalText,
    error,
    toggle,
    stop,
  }
}
