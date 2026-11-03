import type { VoicePcmTap } from "./pcm-capture"
import type { MicInput, VadAnalyzer } from "./types"

export type DuplexClientState = "idle" | "connecting" | "listening" | "error" | "closed"

/**
 * WebSocket OPEN constant. Deliberately numeric so Node tests do not need the
 * browser `WebSocket` global (`readyState === 1` is what the client checks).
 */
const WS_OPEN = 1

/** Server must answer `hello` with `ready` within this window. */
export const DEFAULT_VOICE_READY_TIMEOUT_MS = 20_000

/** Minimal socket face shared by the browser WebSocket and test doubles. */
export interface DuplexSocket {
  readyState: number
  send(data: string | ArrayBufferView): void
  close(code?: number, reason?: string): void
  onopen: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
}

/** Client error carrying a stable, UI-displayable code prefix. */
export interface DuplexClientError extends Error {
  code: string
}

export function duplexClientError(code: string, message?: string): DuplexClientError {
  const error = new Error(message ? `${code}: ${message}` : code) as DuplexClientError
  error.code = code
  return error
}

export interface DuplexClientDeps {
  chatSessionId: string
  wsUrl: () => Promise<string>
  vad: VadAnalyzer
  createTap: (input: MicInput, onFrame: (pcm: Int16Array) => void) => Promise<VoicePcmTap>
  wsFactory?: (url: string) => DuplexSocket
  idFactory?: () => string
  readyTimeoutMs?: number
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onState: (state: DuplexClientState) => void
  onError: (error: Error) => void
}

export interface DuplexClient {
  start(): Promise<void>
  stop(): Promise<void>
  state(): DuplexClientState
  voiceSessionId(): string | null
}

function defaultIdFactory(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID()
  return `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function defaultWsFactory(url: string): DuplexSocket {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => unknown }).WebSocket
  if (!Ctor) throw new Error("WebSocket is not available in this environment")
  return new Ctor(url) as DuplexSocket
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function deferredVoid() {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  // Failures surface through the `start()` rejection; this keeps the gate that
  // never gets awaited from becoming an unhandled rejection.
  void promise.catch(() => {})
  return { promise, resolve, reject }
}

/**
 * Desktop continuous-ASR client for `/ws/voice`.
 *
 * Lifecycle (order is a contract — mic capture must never start before the
 * server is ready, otherwise the first words are lost):
 *   connecting → resolve wsUrl → open socket → hello → `ready`
 *   → vad.start() → require getInput() → listening → create PCM tap
 *
 * Plan 1 scope: partial/final transcripts only. No reconnect, no TTS playback,
 * no end-of-turn semantics. The instance is one-shot: after `stop()` or a
 * failure, create a new client to listen again.
 */
export function createDuplexClient(deps: DuplexClientDeps): DuplexClient {
  let current: DuplexClientState = "idle"
  let voiceId: string | null = null
  let socket: DuplexSocket | null = null
  let tap: VoicePcmTap | null = null
  let tapDisposal: Promise<void> | null = null
  let teardownPromise: Promise<void> | null = null
  let stopPromise: Promise<void> | null = null
  let startPromise: Promise<void> | null = null
  let openGate: ReturnType<typeof deferredVoid> | null = null
  let readyGate: ReturnType<typeof deferredVoid> | null = null
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  let micStarted = false
  let vadSubscribed = false
  let stopped = false
  let failed = false

  const readyTimeoutMs = deps.readyTimeoutMs ?? DEFAULT_VOICE_READY_TIMEOUT_MS
  const idFactory = deps.idFactory ?? defaultIdFactory
  const makeSocket = deps.wsFactory ?? defaultWsFactory

  function setState(next: DuplexClientState) {
    if (current === next) return
    current = next
    deps.onState(next)
  }

  function clearReadyTimer() {
    if (readyTimer === null) return
    clearTimeout(readyTimer)
    readyTimer = null
  }

  function releaseSocket() {
    const active = socket
    socket = null
    if (!active) return
    active.onopen = null
    active.onmessage = null
    active.onerror = null
    active.onclose = null
    try {
      active.close()
    } catch {
      /* already closed */
    }
  }

  function disposeTap(): Promise<void> {
    if (tapDisposal) return tapDisposal
    const active = tap
    tap = null
    tapDisposal = active
      ? active.dispose().catch((error) => console.warn("[voice] pcm tap dispose failed:", error))
      : Promise.resolve()
    return tapDisposal
  }

  /**
   * Release capture resources in a fixed order: the PCM tap must go before
   * `vad.stop()`, because Silero's stop closes the shared AudioContext.
   */
  function teardown(): Promise<void> {
    if (teardownPromise) return teardownPromise
    teardownPromise = (async () => {
      await disposeTap()
      if (!micStarted) return
      try {
        deps.vad.stop()
      } catch (error) {
        console.warn("[voice] vad stop failed:", error)
      }
    })()
    return teardownPromise
  }

  function fail(error: DuplexClientError): DuplexClientError {
    if (failed || stopped) return error
    failed = true
    clearReadyTimer()
    openGate?.reject(error)
    readyGate?.reject(error)
    releaseSocket()
    void teardown()
    setState("error")
    deps.onError(error)
    return error
  }

  function sendJson(payload: unknown) {
    const active = socket
    if (!active || active.readyState !== WS_OPEN) return
    try {
      active.send(JSON.stringify(payload))
    } catch {
      /* socket raced closed; the close handler reports it */
    }
  }

  function sendFrame(pcm: Int16Array) {
    const active = socket
    if (!active || active.readyState !== WS_OPEN || current !== "listening") return
    try {
      active.send(pcm)
    } catch {
      /* socket raced closed; the close handler reports it */
    }
  }

  function handleMessage(raw: string) {
    if (failed || stopped) return
    let message: any
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    switch (message?.type) {
      case "ready":
        readyGate?.resolve()
        break
      case "asr.partial":
        if (typeof message.text === "string") deps.onPartial(message.text)
        break
      case "asr.final":
        // Plan 1: a final transcript does not stop listening.
        if (typeof message.text === "string") deps.onFinal(message.text)
        break
      case "error":
        fail(
          duplexClientError(
            String(message.code ?? "voice_error"),
            String(message.message ?? "voice server error"),
          ),
        )
        break
      default:
        break
    }
  }

  function watchSocket(active: DuplexSocket) {
    active.onopen = () => openGate?.resolve()
    active.onmessage = (event) => {
      if (typeof event?.data === "string") handleMessage(event.data)
    }
    active.onerror = () => {
      fail(duplexClientError("voice_connection_failed", "voice socket error"))
    }
    active.onclose = () => {
      if (stopped || failed) return
      const phase = current === "connecting" ? "before ready" : "while listening"
      fail(duplexClientError("voice_connection_failed", `voice socket closed ${phase}`))
    }
  }

  async function doStart(): Promise<void> {
    if (stopped) return
    setState("connecting")

    let url: string
    try {
      url = await deps.wsUrl()
    } catch (error) {
      throw fail(
        duplexClientError("voice_connection_failed", `voice websocket URL unavailable: ${messageOf(error)}`),
      )
    }
    if (stopped || failed) return

    voiceId = idFactory()
    const opened = deferredVoid()
    const ready = deferredVoid()
    openGate = opened
    readyGate = ready

    let created: DuplexSocket
    try {
      created = makeSocket(url)
    } catch (error) {
      throw fail(duplexClientError("voice_connection_failed", `cannot open voice socket: ${messageOf(error)}`))
    }
    socket = created
    watchSocket(created)

    await opened.promise
    if (stopped || failed) return

    sendJson({
      type: "hello",
      voiceSessionId: voiceId,
      chatSessionId: deps.chatSessionId,
      mode: "continuous",
      tier: "auto",
      format: "pcm16",
      clientVad: true,
    })

    readyTimer = setTimeout(() => {
      fail(duplexClientError("voice_ready_timeout", `server did not send ready within ${readyTimeoutMs}ms`))
    }, readyTimeoutMs)
    await ready.promise
    clearReadyTimer()
    if (stopped || failed) return

    micStarted = true
    try {
      await deps.vad.start()
    } catch (error) {
      throw fail(duplexClientError("voice_mic_unavailable", messageOf(error)))
    }
    if (stopped || failed) return

    const input = deps.vad.getInput?.() ?? null
    if (!input) throw fail(duplexClientError("voice_mic_unavailable", "VAD produced no microphone input"))

    if (!vadSubscribed) {
      vadSubscribed = true
      deps.vad.on("speech_stopped", () => sendJson({ type: "end_audio" }))
    }

    setState("listening")

    let startedTap: VoicePcmTap
    try {
      startedTap = await deps.createTap(input, sendFrame)
    } catch (error) {
      throw fail(duplexClientError("voice_mic_unavailable", `PCM capture unavailable: ${messageOf(error)}`))
    }
    // stop() may have run while the tap was being created; never register it.
    if (stopped || failed) {
      try {
        await startedTap.dispose()
      } catch (error) {
        console.warn("[voice] pcm tap dispose failed:", error)
      }
      return
    }
    tap = startedTap
  }

  return {
    start(): Promise<void> {
      if (!startPromise) startPromise = doStart()
      return startPromise
    },

    async stop(): Promise<void> {
      if (!stopPromise) {
        stopPromise = (async () => {
          stopped = true
          clearReadyTimer()
          // Unblock a start() that is still waiting for open/ready.
          openGate?.resolve()
          readyGate?.resolve()
          sendJson({ type: "stop" })
          releaseSocket()
          await teardown()
          setState("closed")
        })()
      }
      return stopPromise
    },

    state: () => current,

    voiceSessionId: () => voiceId,
  }
}
