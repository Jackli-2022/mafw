import { test, expect } from "bun:test"
import {
  createDuplexClient,
  type DuplexClientError,
  type DuplexClientState,
} from "./duplex-client"
import type { MicInput, VadAnalyzer, VadEvent } from "./types"

/** Node test double for the browser WebSocket shape the client consumes. */
class FakeSocket {
  url = ""
  readyState = 0
  readonly sent: (string | ArrayBufferView)[] = []
  closeCalls = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null

  send(data: string | ArrayBufferView) {
    this.sent.push(data)
  }

  close() {
    this.closeCalls++
    this.readyState = 3
    this.onclose?.({ code: 1000 })
  }

  open() {
    this.readyState = 1
    this.onopen?.()
  }

  /** Server → client JSON text frame. */
  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  error() {
    this.onerror?.({ type: "error" })
  }

  drop() {
    this.readyState = 3
    this.onclose?.({ code: 1006 })
  }

  strings(): string[] {
    return this.sent.filter((d): d is string => typeof d === "string")
  }

  json(): any[] {
    return this.strings().map((s) => JSON.parse(s))
  }

  binaries(): ArrayBufferView[] {
    return this.sent.filter((d): d is ArrayBufferView => typeof d !== "string")
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

const READY = {
  type: "ready",
  routing: { status: "local" },
  asr: { engine: "qwen3-asr", streaming: "native" },
  tts: null,
}

const MIC = { sampleRate: 16000 } as unknown as MicInput

function harness(opts: {
  readyTimeoutMs?: number
  input?: MicInput | null
  /** Awaited inside `vad.start()` before the mic becomes live. */
  vadStart?: () => Promise<void>
  /** Awaited inside `createTap()` before the tap is returned. */
  tapGate?: () => Promise<void>
} = {}) {
  const sockets: FakeSocket[] = []
  const states: DuplexClientState[] = []
  const errors: DuplexClientError[] = []
  const partials: string[] = []
  const finals: string[] = []
  const vadSubs = new Map<VadEvent, ((a?: Float32Array) => void)[]>()
  const vadCounters = { starts: 0, stops: 0 }
  const taps: { onFrame: (pcm: Int16Array) => void; disposeCalls: number }[] = []
  // Models the real Silero analyzer: the mic is live only between a resolved
  // start() and the next stop(); getInput() is null while it is not live.
  let micLive = false

  const vad: VadAnalyzer = {
    start: async () => {
      vadCounters.starts++
      if (opts.vadStart) await opts.vadStart()
      micLive = true
    },
    stop: () => {
      vadCounters.stops++
      micLive = false
    },
    on: (event, cb) => {
      vadSubs.set(event, [...(vadSubs.get(event) ?? []), cb])
    },
    getInput: () => {
      if (opts.input === null || !micLive) return null
      return opts.input === undefined ? MIC : opts.input
    },
  }

  const client = createDuplexClient({
    chatSessionId: "chat-1",
    wsUrl: async () => "ws://127.0.0.1:3000/ws/voice",
    vad,
    createTap: async (_input, onFrame) => {
      if (opts.tapGate) await opts.tapGate()
      const tap = {
        onFrame,
        disposeCalls: 0,
        dispose: async () => {
          tap.disposeCalls++
        },
      }
      taps.push(tap)
      return tap
    },
    wsFactory: (url) => {
      const socket = new FakeSocket()
      socket.url = url
      sockets.push(socket)
      return socket
    },
    idFactory: () => "voice-1",
    ...(opts.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: opts.readyTimeoutMs }),
    onPartial: (text) => partials.push(text),
    onFinal: (text) => finals.push(text),
    onState: (state) => states.push(state),
    onError: (error) => errors.push(error),
  })

  const socket = () => {
    const s = sockets[0]
    if (!s) throw new Error("no socket created")
    return s
  }

  const emitVad = (event: VadEvent) => {
    for (const cb of vadSubs.get(event) ?? []) cb()
  }

  return {
    client,
    sockets,
    socket,
    states,
    errors,
    partials,
    finals,
    vadCounters,
    vadSubs,
    taps,
    emitVad,
    micLive: () => micLive,
  }
}

type Harness = ReturnType<typeof harness>

async function listen(h: Harness) {
  const started = h.client.start()
  await flush()
  h.socket().open()
  await flush()
  h.socket().message(READY)
  await started
}

test("sends hello with both ids and starts the mic only after ready", async () => {
  const h = harness()
  const started = h.client.start()
  await flush()

  expect(h.sockets).toHaveLength(1)
  expect(h.socket().url).toBe("ws://127.0.0.1:3000/ws/voice")
  // hello must not be sent before the socket is open.
  expect(h.socket().sent).toHaveLength(0)
  expect(h.states).toEqual(["connecting"])

  h.socket().open()
  await flush()

  expect(h.socket().json()).toEqual([
    {
      type: "hello",
      voiceSessionId: "voice-1",
      chatSessionId: "chat-1",
      mode: "continuous",
      tier: "auto",
      format: "pcm16",
      clientVad: true,
    },
  ])
  // No microphone capture until the server says it is ready.
  expect(h.vadCounters.starts).toBe(0)
  expect(h.taps).toHaveLength(0)

  h.socket().message(READY)
  await started

  expect(h.client.state()).toBe("listening")
  expect(h.client.voiceSessionId()).toBe("voice-1")
  expect(h.states).toEqual(["connecting", "listening"])
  expect(h.vadCounters.starts).toBe(1)
  expect(h.taps).toHaveLength(1)
})

test("streams 20ms PCM frames before speech_stopped", async () => {
  const h = harness()
  await listen(h)

  h.taps[0].onFrame(new Int16Array(320))

  const binaries = h.socket().binaries()
  expect(binaries).toHaveLength(1)
  expect(binaries[0]).toBeInstanceOf(Int16Array)
  expect(binaries[0].byteLength).toBe(640)
  // Frames flow while the user is still speaking: no end_audio yet.
  expect(h.socket().json()).toHaveLength(1) // hello only

  h.emitVad("speech_started")
  expect(h.socket().json()).toHaveLength(1)

  h.emitVad("speech_stopped")
  const afterStop = h.socket().json()
  expect(afterStop).toHaveLength(2)
  expect(afterStop[1]).toEqual({ type: "end_audio" })

  h.socket().message({ type: "asr.partial", text: "你" })
  h.socket().message({ type: "asr.partial", text: "你好" })
  h.socket().message({
    type: "asr.final",
    text: "你好。",
    language: "zh",
    durationMs: 1200,
    engine: "qwen3-asr",
    final: true,
  })

  expect(h.partials).toEqual(["你", "你好"])
  expect(h.finals).toEqual(["你好。"])
  // A final transcript is not an end-of-listen signal in Plan 1.
  expect(h.client.state()).toBe("listening")
  expect(h.socket().closeCalls).toBe(0)
  expect(h.vadCounters.stops).toBe(0)
})

test("stop is idempotent and releases socket, tap, and VAD", async () => {
  const h = harness()
  await listen(h)

  await h.client.stop()
  await h.client.stop()

  const stopMessages = h.socket().json().filter((m) => m.type === "stop")
  expect(stopMessages).toHaveLength(1)
  expect(h.socket().closeCalls).toBe(1)
  expect(h.taps[0].disposeCalls).toBe(1)
  expect(h.vadCounters.stops).toBe(1)
  expect(h.client.state()).toBe("closed")
  expect(h.errors).toHaveLength(0)
})

test("ready timeout closes socket and reports a recoverable error", async () => {
  const h = harness({ readyTimeoutMs: 10 })
  const started = h.client.start()
  await flush()
  h.socket().open()

  await expect(started).rejects.toMatchObject({ code: "voice_ready_timeout" })

  expect(h.errors).toHaveLength(1)
  expect(h.errors[0].code).toBe("voice_ready_timeout")
  expect(h.errors[0].message).toContain("voice_ready_timeout")
  expect(h.client.state()).toBe("error")
  expect(h.socket().closeCalls).toBe(1)
  expect(h.vadCounters.starts).toBe(0)
  expect(h.taps).toHaveLength(0)

  // Repeated stop after a failure must not emit a second error.
  await h.client.stop()
  expect(h.errors).toHaveLength(1)
})

test("server error frame stops the client with that code", async () => {
  const h = harness()
  await listen(h)

  h.socket().message({
    type: "error",
    code: "voice_unavailable",
    message: "asr engine is not running",
    recoverable: true,
  })
  await flush()

  expect(h.errors).toHaveLength(1)
  expect(h.errors[0].code).toBe("voice_unavailable")
  expect(h.errors[0].message).toContain("asr engine is not running")
  expect(h.client.state()).toBe("error")
  expect(h.socket().closeCalls).toBe(1)
  expect(h.taps[0].disposeCalls).toBe(1)
  expect(h.vadCounters.stops).toBe(1)
})

test("socket error before ready fails start without starting the mic", async () => {
  const h = harness()
  const started = h.client.start()
  await flush()
  h.socket().open()
  await flush()

  h.socket().error()
  await expect(started).rejects.toMatchObject({ code: "voice_connection_failed" })

  expect(h.errors).toHaveLength(1)
  expect(h.client.state()).toBe("error")
  expect(h.socket().closeCalls).toBe(1)
  expect(h.vadCounters.starts).toBe(0)
})

test("socket close while listening surfaces a single connection error", async () => {
  const h = harness()
  await listen(h)

  h.socket().drop()
  await flush()

  expect(h.errors).toHaveLength(1)
  expect(h.errors[0].code).toBe("voice_connection_failed")
  expect(h.client.state()).toBe("error")
  expect(h.taps[0].disposeCalls).toBe(1)

  // A later explicit stop is silent and idempotent.
  await h.client.stop()
  expect(h.errors).toHaveLength(1)
  expect(h.client.state()).toBe("closed")
})

test("stop before ready releases the socket and never starts the mic", async () => {
  const h = harness()
  const started = h.client.start()
  await flush()
  expect(h.sockets).toHaveLength(1)

  await h.client.stop()
  await started

  expect(h.socket().closeCalls).toBe(1)
  expect(h.vadCounters.starts).toBe(0)
  expect(h.taps).toHaveLength(0)
  expect(h.client.state()).toBe("closed")
  expect(h.errors).toHaveLength(0)
})

test("start after stop is a no-op", async () => {
  const h = harness()
  await h.client.stop()
  await h.client.start()

  expect(h.sockets).toHaveLength(0)
  expect(h.vadCounters.starts).toBe(0)
  expect(h.client.state()).toBe("closed")
})

test("missing microphone input fails with voice_mic_unavailable", async () => {
  const h = harness({ input: null })
  const started = h.client.start()
  await flush()
  h.socket().open()
  await flush()
  h.socket().message(READY)

  await expect(started).rejects.toMatchObject({ code: "voice_mic_unavailable" })

  expect(h.errors[0].code).toBe("voice_mic_unavailable")
  expect(h.client.state()).toBe("error")
  expect(h.taps).toHaveLength(0)
})

test("stop during vad.start() still releases the microphone", async () => {
  let releaseStart!: () => void
  const startGate = new Promise<void>((r) => {
    releaseStart = r
  })
  const h = harness({ vadStart: () => startGate })
  const started = h.client.start()
  await flush()
  h.socket().open()
  await flush()
  h.socket().message(READY)
  await flush()
  expect(h.vadCounters.starts).toBe(1)

  await h.client.stop()
  expect(h.vadCounters.stops).toBe(1)

  // Silero's pending getUserMedia resolves after stop and revives the stream.
  releaseStart()
  await started

  expect(h.vadCounters.stops).toBe(2)
  expect(h.micLive()).toBe(false)
  expect(h.client.state()).toBe("closed")
  expect(h.errors).toHaveLength(0)
  expect(h.taps).toHaveLength(0)
})

test("socket failure during vad.start() still releases the microphone", async () => {
  let releaseStart!: () => void
  const startGate = new Promise<void>((r) => {
    releaseStart = r
  })
  const h = harness({ vadStart: () => startGate })
  const started = h.client.start()
  await flush()
  h.socket().open()
  await flush()
  h.socket().message(READY)
  await flush()
  expect(h.vadCounters.starts).toBe(1)

  h.socket().error()
  await flush()
  expect(h.errors).toHaveLength(1)
  expect(h.errors[0].code).toBe("voice_connection_failed")

  releaseStart()
  await started

  // The failure already surfaced once; the late mic must not stay alive.
  expect(h.errors).toHaveLength(1)
  expect(h.vadCounters.stops).toBe(2)
  expect(h.micLive()).toBe(false)
})

test("stop while createTap is pending disposes the late tap and never sends", async () => {
  let releaseTap!: () => void
  const tapGate = new Promise<void>((r) => {
    releaseTap = r
  })
  const h = harness({ tapGate: () => tapGate })
  const started = h.client.start()
  await flush()
  h.socket().open()
  await flush()
  h.socket().message(READY)
  await flush()
  expect(h.taps).toHaveLength(0)

  const socket = h.socket()
  await h.client.stop()
  expect(h.vadCounters.stops).toBe(1)

  releaseTap()
  await started

  expect(h.taps).toHaveLength(1)
  expect(h.taps[0].disposeCalls).toBe(1)
  // Final release happens after the late tap is disposed.
  expect(h.vadCounters.stops).toBe(2)
  expect(h.micLive()).toBe(false)
  expect(h.client.state()).toBe("closed")
  expect(h.errors).toHaveLength(0)

  h.taps[0].onFrame(new Int16Array(320))
  expect(socket.binaries()).toHaveLength(0)
  expect(socket.json().filter((m) => m.type === "end_audio")).toHaveLength(0)
})

test("frames and speech_stopped after stop are dropped", async () => {
  const h = harness()
  await listen(h)
  const socket = h.socket()
  const onFrame = h.taps[0].onFrame

  await h.client.stop()
  const sentAfterStop = socket.sent.length

  onFrame(new Int16Array(320))
  h.emitVad("speech_stopped")

  expect(socket.sent).toHaveLength(sentAfterStop)
  expect(socket.binaries()).toHaveLength(0)
  expect(socket.json().filter((m) => m.type === "end_audio")).toHaveLength(0)
  expect(h.client.state()).toBe("closed")
})

test("ready timeout racing stop stays silent", async () => {
  const h = harness({ readyTimeoutMs: 10 })
  const started = h.client.start()
  await flush()
  h.socket().open()
  await flush()

  await h.client.stop()
  await started
  await new Promise<void>((r) => setTimeout(r, 30))

  expect(h.errors).toHaveLength(0)
  expect(h.states).not.toContain("error")
  expect(h.client.state()).toBe("closed")
  expect(h.vadCounters.starts).toBe(0)
})
