// Task 8 review fix: behavioral coverage for the duplex hook orchestration.
// These tests mount the real hook inside `createRoot` (Solid effects run under
// `--conditions=browser`) and inject fake status/analyzer/client/tap/notify so
// no browser media stack is touched. Production defaults are unchanged.
import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { duplexClientError, type DuplexClient, type DuplexClientDeps } from "../voice/duplex-client"
import type { MicInput, VadAnalyzer, VadEvent } from "../voice/types"
import type { VoicePcmTap } from "../voice/pcm-capture"
import { useDuplexVoice, type DuplexVoiceController, type DuplexVoiceDeps } from "./use-duplex-voice"

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

interface FakeClient extends DuplexClient {
  deps: DuplexClientDeps
  startCalls: number
  stopCalls: number
}

interface FakeAnalyzer extends VadAnalyzer {
  stopCalls: number
}

function makeAnalyzer(): FakeAnalyzer {
  const analyzer: FakeAnalyzer = {
    stopCalls: 0,
    start: async () => {},
    stop() {
      analyzer.stopCalls += 1
    },
    on: (_event: VadEvent, _cb: (audio?: Float32Array) => void) => {},
    getInput: (): MicInput | null => null,
  }
  return analyzer
}

function makeClient(
  deps: DuplexClientDeps,
  start: () => Promise<void> = async () => {},
): FakeClient {
  const client: FakeClient = {
    deps,
    startCalls: 0,
    stopCalls: 0,
    async start() {
      client.startCalls += 1
      await start()
    },
    async stop() {
      client.stopCalls += 1
    },
    state: () => "closed",
    voiceSessionId: () => null,
  }
  return client
}

interface Harness {
  ctrl: DuplexVoiceController
  setReady: (value: boolean) => void
  dispose: () => void
}

function mount(deps: DuplexVoiceDeps, sid = "session-1"): Harness {
  let ctrl!: DuplexVoiceController
  let setReady!: (value: boolean) => void
  const dispose = createRoot((disposeRoot) => {
    const [ready, setReadySignal] = createSignal(false)
    setReady = setReadySignal
    ctrl = useDuplexVoice(() => sid, () => ready(), deps)
    return disposeRoot
  })
  return { ctrl, setReady, dispose }
}

describe("useDuplexVoice", () => {
  test("fetches status only after the gateway becomes ready", async () => {
    let statusCalls = 0
    const h = mount({
      status: async () => {
        statusCalls += 1
        return { config: { duplexV1: true } }
      },
      notify: () => {},
    })

    await tick()
    expect(statusCalls).toBe(0)
    expect(h.ctrl.enabled()).toBe(false)
    expect(h.ctrl.active()).toBe(false)

    h.setReady(true)
    await tick()
    expect(statusCalls).toBe(1)
    expect(h.ctrl.enabled()).toBe(true)

    h.dispose()
  })

  test("stop disposes the client once and late callbacks from that start are ignored", async () => {
    const clients: FakeClient[] = []
    const analyzers: FakeAnalyzer[] = []
    const h = mount({
      status: async () => ({ config: { duplexV1: true } }),
      notify: () => {},
      createAnalyzer: () => {
        const analyzer = makeAnalyzer()
        analyzers.push(analyzer)
        return analyzer
      },
      createClient: (deps) => {
        const client = makeClient(deps)
        clients.push(client)
        return client
      },
    })

    h.setReady(true)
    await tick()
    await h.ctrl.toggle()

    expect(clients).toHaveLength(1)
    expect(analyzers).toHaveLength(1)
    expect(h.ctrl.active()).toBe(true)

    clients[0].deps.onPartial("hello")
    expect(h.ctrl.partial()).toBe("hello")

    await h.ctrl.stop()
    expect(clients[0].stopCalls).toBe(1)
    expect(h.ctrl.active()).toBe(false)
    expect(h.ctrl.partial()).toBe("")

    // Stale start: socket/VAD callbacks that settle after stop() must not write.
    clients[0].deps.onPartial("late partial")
    clients[0].deps.onFinal("late final")
    clients[0].deps.onState("listening")
    expect(h.ctrl.partial()).toBe("")
    expect(h.ctrl.finalText()).toBe("")
    expect(h.ctrl.active()).toBe(false)

    // A new start gets a fresh analyzer + client; unmount stops that one once.
    await h.ctrl.toggle()
    expect(clients).toHaveLength(2)
    expect(analyzers).toHaveLength(2)
    expect(h.ctrl.active()).toBe(true)

    h.dispose()
    await tick()
    expect(clients[1].stopCalls).toBe(1)
    expect(clients[0].stopCalls).toBe(1)

    // Unmount retired the second start as well.
    clients[1].deps.onPartial("after unmount")
    expect(h.ctrl.partial()).toBe("")
  })

  test("losing the gateway stops a live session instead of leaving it active", async () => {
    const clients: FakeClient[] = []
    const analyzers: FakeAnalyzer[] = []
    const h = mount({
      status: async () => ({ config: { duplexV1: true } }),
      notify: () => {},
      createAnalyzer: () => {
        const analyzer = makeAnalyzer()
        analyzers.push(analyzer)
        return analyzer
      },
      createClient: (deps) => {
        const client = makeClient(deps)
        clients.push(client)
        return client
      },
    })

    h.setReady(true)
    await tick()
    await h.ctrl.toggle()
    expect(h.ctrl.active()).toBe(true)

    // Gateway drops: the not-ready branch must use the same shutdown path as a
    // config flip, otherwise the client keeps the mic/socket alive while the UI
    // no longer considers duplex enabled.
    h.setReady(false)
    await tick()
    expect(h.ctrl.enabled()).toBe(false)
    expect(h.ctrl.active()).toBe(false)
    expect(clients[0].stopCalls).toBe(1)

    h.dispose()
    await tick()
    // stop() already released it; unmount must not stop a second time.
    expect(clients[0].stopCalls).toBe(1)
    expect(analyzers[0].stopCalls).toBeGreaterThanOrEqual(1)
  })

  test("connecting is not reported as listening until the server is ready", async () => {
    const clients: FakeClient[] = []
    let releaseStart!: () => void
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve
    })

    const h = mount({
      status: async () => ({ config: { duplexV1: true } }),
      notify: () => {},
      createClient: (deps) => {
        const client = makeClient(deps, () => startGate)
        clients.push(client)
        return client
      },
    })

    h.setReady(true)
    await tick()
    const toggled = h.ctrl.toggle()
    await tick()

    // Socket opened and `hello` sent: the mic button is live, but the gateway
    // may still be starting the ASR sidecar, so the UI must not say "listening".
    expect(h.ctrl.active()).toBe(true)
    expect(h.ctrl.listening()).toBe(false)

    clients[0].deps.onState("listening")
    expect(h.ctrl.listening()).toBe(true)

    releaseStart()
    await toggled
    expect(h.ctrl.active()).toBe(true)
    expect(h.ctrl.listening()).toBe(true)

    await h.ctrl.stop()
    expect(h.ctrl.active()).toBe(false)
    expect(h.ctrl.listening()).toBe(false)

    h.dispose()
  })

  test("a rejected start surfaces exactly one error and releases client + analyzer", async () => {
    const notified: string[] = []
    const clients: FakeClient[] = []
    const analyzers: FakeAnalyzer[] = []
    let failNextStart = true

    const h = mount({
      status: async () => ({ config: { duplexV1: true } }),
      notify: (options) => notified.push(options.description),
      createAnalyzer: () => {
        const analyzer = makeAnalyzer()
        analyzers.push(analyzer)
        return analyzer
      },
      createClient: (deps) => {
        const shouldFail = failNextStart
        const client = makeClient(deps, async () => {
          if (!shouldFail) return
          // Mirrors Task 7: onError fires before `start()` rejects.
          const failure = duplexClientError("voice_connection_failed", "socket closed before ready")
          deps.onError(failure)
          throw failure
        })
        clients.push(client)
        return client
      },
    })

    h.setReady(true)
    await tick()
    await h.ctrl.toggle()

    expect(h.ctrl.active()).toBe(false)
    expect(h.ctrl.listening()).toBe(false)
    expect(h.ctrl.error()).toContain("voice_connection_failed")
    expect(notified).toHaveLength(1)
    // Failure path tears the generation down: client stopped once, analyzer released.
    expect(clients[0].stopCalls).toBe(1)
    expect(analyzers[0].stopCalls).toBe(1)

    // No leaked instance: the retry builds a brand-new client + analyzer and works.
    failNextStart = false
    await h.ctrl.toggle()
    expect(clients).toHaveLength(2)
    expect(analyzers).toHaveLength(2)
    expect(clients[1]).not.toBe(clients[0])
    expect(h.ctrl.active()).toBe(true)
    expect(h.ctrl.error()).toBe("")

    await h.ctrl.stop()
    h.dispose()
  })
})

// Keep the tap seam type-checked without a real AudioContext.
export const __tapSeam: DuplexVoiceDeps["createTap"] = async (
  _input: MicInput,
  _onFrame: (pcm: Int16Array) => void,
): Promise<VoicePcmTap> => ({ dispose: async () => {} })
