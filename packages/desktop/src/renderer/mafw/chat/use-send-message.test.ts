import { describe, expect, test } from "bun:test"
import { parseSlashShape, buildOptimisticParts, useSendMessage, decideBusyDelivery, steerDeliveryHint, composeVoiceOriginPart, busyQueuedText } from "./use-send-message"
import { VOICE_ORIGIN_MARKER_TEXT, appendVoiceOriginMarker } from "./voice-origin-marker"
import { createInputHistory } from "../components/input-history"

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("composeVoiceOriginPart（Plan 2 D3：空闲路径 synthetic part）", () => {
  test("synthetic text part，携带单行标记，id 可预测", () => {
    const part = composeVoiceOriginPart(1700000000000)
    expect(part).toMatchObject({ type: "text", synthetic: true })
    expect(part.text).toBe(VOICE_ORIGIN_MARKER_TEXT)
    expect(String(part.id)).toMatch(/^prt_voice_\d+$/)
  })
})

describe("busyQueuedText（Plan 2 D3：忙时 steer/网关队列内联）", () => {
  test("voiceOrigin=true 追加标记；false 原样；幂等", () => {
    const marked = busyQueuedText("你好", true)
    expect(marked).toBe(appendVoiceOriginMarker("你好"))
    expect(busyQueuedText("你好", false)).toBe("你好")
    expect(busyQueuedText(marked, true)).toBe(marked)
  })
})

describe("steerDeliveryHint（Experience boundary）", () => {
  test("after-turn 与 tool 使用不同提示，不承诺打断", () => {
    expect(steerDeliveryHint("after-turn")).toContain("本轮结束后")
    expect(steerDeliveryHint("tool")).toContain("工具")
    expect(steerDeliveryHint(undefined)).toContain("稍后")
  })
})

describe("decideBusyDelivery（W5a steer 语义选择）", () => {
  test("steer 支持 + 无媒体 + Enter → steer", () => {
    expect(decideBusyDelivery({ mode: "send", steerSupported: true, hasMedia: false })).toBe("steer")
  })
  test("Ctrl+Enter（queue）→ gateway-queue", () => {
    expect(decideBusyDelivery({ mode: "queue", steerSupported: true, hasMedia: false })).toBe("gateway-queue")
    expect(decideBusyDelivery({ mode: "queue", steerSupported: false, hasMedia: false })).toBe("gateway-queue")
  })
  test("runtime 不支持 steer → 本地队列（现状回归）", () => {
    expect(decideBusyDelivery({ mode: "send", steerSupported: false, hasMedia: false })).toBe("local-queue")
  })
  test("带媒体 → 本地队列（promptAsync 只承载文本，v1 不丢附件）", () => {
    expect(decideBusyDelivery({ mode: "send", steerSupported: true, hasMedia: true })).toBe("local-queue")
    expect(decideBusyDelivery({ mode: "queue", steerSupported: true, hasMedia: true })).toBe("local-queue")
  })
})

describe("parseSlashShape", () => {
  test("解析 /cmd args", () => {
    expect(parseSlashShape("/btw 这是啥")).toEqual({ name: "btw", args: "这是啥" })
  })
  test("无参数", () => {
    expect(parseSlashShape("/compact")).toEqual({ name: "compact", args: "" })
  })
  test("非 slash 返回 null", () => {
    expect(parseSlashShape("hello")).toBeNull()
    expect(parseSlashShape("路径 /tmp 测试")).toBeNull()
  })
})

describe("buildOptimisticParts", () => {
  test("组装 body + 缩略图 + 文件 + agent parts", () => {
    const parts = buildOptimisticParts({
      userMsgId: "user-1",
      ts: 1000,
      sid: "s1",
      bodyMessage: "你好",
      visionThumbs: [{ name: "a.wav", mime: "audio/wav", dataUrl: "data:audio/wav" }],
      fileParts: [{ type: "file", id: "prt_att_0", mime: "application/pdf", filename: "b.pdf", url: "file:///b.pdf" }],
      agentParts: [{ type: "agent", id: "prt_agent_x", name: "x" }],
    })
    expect(parts[0]).toMatchObject({ type: "text", id: "user-1-text", text: "你好", messageID: "user-1" })
    expect(parts[1]).toMatchObject({ type: "file", id: "prt_local_1000_0", localOnly: true })
    expect(parts[2]).toMatchObject({ type: "file", id: "prt_att_0", messageID: "user-1" })
    expect(parts[3]).toMatchObject({ type: "agent", id: "prt_agent_x", messageID: "user-1" })
  })
  test("空 body 时不产生 text part", () => {
    const parts = buildOptimisticParts({
      userMsgId: "user-2", ts: 1, sid: "s1", bodyMessage: "",
      visionThumbs: [], fileParts: [], agentParts: [],
    })
    expect(parts).toEqual([])
  })
})

describe("sendMessage busy 排队路径", () => {
  const baseDeps = (over: any = {}): any => {
    const history = createInputHistory()
    let inputVal = "排队的消息"
    let queued: any[] = []
    return {
      deps: {
        sid: () => "s_test_session",
        onCreateSession: async () => null,
        onSetUserMsgId: () => {},
        input: () => inputVal,
        setInput: (v: string) => { inputVal = v },
        sending: () => true, // busy → queue branch
        setSending: () => {},
        setPhase: () => {},
        attachments: () => [],
        setAttachments: () => {},
        mentionedAgents: () => [],
        setMentionedAgents: () => {},
        mentionedFiles: () => [],
        setMentionedFiles: () => {},
        queuedItems: () => queued,
        setQueuedItems: (fn: (prev: any[]) => any[]) => { queued = fn(queued) },
        textareaEl: () => null,
        history,
        clearDraft: () => {},
        matchSlash: () => null,
        agentSel: () => null,
        model: () => null,
        setStore: () => {},
        forceAnchor: () => {},
        imageToDataUrl: async () => undefined,
        uploadMediaBinary: async () => "",
        encodeFilePath: (p: string) => p,
        ...over,
      },
      history: () => history,
      queued: () => queued,
      input: () => inputVal,
    }
  }

  test("排队消息也进输入历史（↑ 可召回）", async () => {
    const f = baseDeps()
    const { sendMessage } = useSendMessage(f.deps)
    await sendMessage()
    expect(f.queued().length).toBe(1) // 确认真的走了排队分支
    expect(f.history().up("")).toBe("排队的消息")
  })

  test("propose adds one synthetic mode part and leaves message text clean", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = {
      api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } },
    }
    try {
      const f = baseDeps({ sending: () => false, input: () => "hello" })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage("send", { chatMode: "propose" })
      expect(sent).toHaveLength(1)
      expect(sent[0].message).toBe("hello")
      const mode = (sent[0].parts ?? []).find((part: any) => part?.synthetic === true)
      expect(mode).toMatchObject({ type: "text", synthetic: true })
      expect(String(mode.text)).toContain("[[mode:propose]]")
    } finally {
      delete (globalThis as any).window
    }
  })

  test("discuss adds no mode part", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = {
      api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } },
    }
    try {
      const f = baseDeps({ sending: () => false, input: () => "hello" })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage("send", { chatMode: "discuss" })
      expect(sent).toHaveLength(1)
      expect((sent[0].parts ?? []).some((part: any) => String(part?.text ?? "").includes("[[mode:"))).toBe(false)
    } finally {
      delete (globalThis as any).window
    }
  })

  test("delegate and resolve bypass send", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = {
      api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } },
    }
    try {
      const f = baseDeps({ sending: () => false, input: () => "hello" })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage("send", { chatMode: "delegate" })
      await sendMessage("send", { chatMode: "resolve" })
      expect(sent).toHaveLength(0)
    } finally {
      delete (globalThis as any).window
    }
  })

  test("tech lead send forwards the mode part", async () => {
    const calls: any[] = []
    ;(globalThis as any).window = {
      api: { mafw: { pod: { sendTechLeadMessage: async (...args: any[]) => { calls.push(args); return { revision: 1 } } } } },
    }
    try {
      const f = baseDeps({
        sending: () => false,
        input: () => "hello",
        techLeadTarget: async () => ({ podId: "pod_1", goalId: "g1" }),
      })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage("send", { chatMode: "propose" })
      expect(calls).toHaveLength(1)
      const body = calls[0][3]
      const mode = (body?.parts ?? []).find((part: any) => part?.synthetic === true)
      expect(mode).toMatchObject({ type: "text", synthetic: true })
      expect(String(mode.text)).toContain("[[mode:propose]]")
    } finally {
      delete (globalThis as any).window
    }
  })

  test("入队时打包批注（Review Focus 4：入队后新增不跟这条）", async () => {
    let taken = 0
    const f = baseDeps({
      pendingAnnotationCount: () => 1,
      peekAnnotations: () => [{ id: "a1" }],
      takeAnnotations: () => { taken++; return [{ id: "a1" }] },
      formatAnnotations: () => "BLOCK",
    })
    const { sendMessage } = useSendMessage(f.deps)
    await sendMessage()
    expect(taken).toBe(1)
    expect(f.queued()[0].text).toBe("排队的消息\n\nBLOCK")
  })

  test("空文本 + 纯批注：允许发送并打包（Review Focus 5）", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = { api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } } }
    try {
      const f = baseDeps({
        input: () => "",
        sending: () => false,
        pendingAnnotationCount: () => 1,
        peekAnnotations: () => [{ id: "a1" }],
        takeAnnotations: () => [{ id: "a1" }],
        formatAnnotations: () => "BLOCK",
      })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(sent).toHaveLength(1)
      expect(sent[0].message).toContain("BLOCK")
    } finally {
      delete (globalThis as any).window
    }
  })

  test("批注落库失败：不发送、不清草稿、不取走批注", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = { api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } } }
    try {
      let taken = 0
      let inputValue = "要发的话"
      const f = baseDeps({
        input: () => inputValue,
        setInput: (v: string) => { inputValue = v },
        sending: () => false,
        pendingAnnotationCount: () => 1,
        peekAnnotations: () => [{ id: "a1", comment: "改这里" }],
        persistAnnotations: async () => { throw new Error("db down") },
        takeAnnotations: () => { taken++; return [{ id: "a1" }] },
        formatAnnotations: () => "BLOCK",
      })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(sent).toHaveLength(0)
      expect(taken).toBe(0)
      expect(inputValue).toBe("要发的话")
    } finally { delete (globalThis as any).window }
  })

  test("忙时批注落库失败：不进队列、不取走批注、不清输入", async () => {
    let taken = 0
    const f = baseDeps({
      pendingAnnotationCount: () => 1,
      peekAnnotations: () => [{ id: "a1", comment: "改这里" }],
      persistAnnotations: async () => { throw new Error("db down") },
      takeAnnotations: () => { taken++; return [{ id: "a1" }] },
      formatAnnotations: () => "BLOCK",
    })
    const { sendMessage } = useSendMessage(f.deps)
    await sendMessage()
    expect(f.queued()).toHaveLength(0)
    expect(taken).toBe(0)
    expect(f.input()).toBe("排队的消息")
  })

  test("批注落库成功：评审项块随消息发出，然后才清空草稿", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = { api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } } }
    try {
      let taken = 0
      const f = baseDeps({
        input: () => "要发的话",
        sending: () => false,
        pendingAnnotationCount: () => 1,
        peekAnnotations: () => [{ id: "a1", comment: "改这里" }],
        persistAnnotations: async () => "已登记 1 条评审项：review_1",
        takeAnnotations: () => { taken++; return [{ id: "a1" }] },
        formatAnnotations: () => "BLOCK",
      })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(taken).toBe(1)
      expect(sent).toHaveLength(1)
      expect(sent[0].message).toContain("review_1")
      expect(sent[0].message).toContain("BLOCK")
    } finally { delete (globalThis as any).window }
  })

  test("并发双击只落库并发送一次（批注不被重复持久化）", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = { api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } } }
    try {
      let sending = false
      let persistCalls = 0
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const f = baseDeps({
        input: () => "要发的话",
        sending: () => sending,
        setSending: (v: boolean) => { sending = v },
        pendingAnnotationCount: () => 1,
        peekAnnotations: () => [{ id: "a1", comment: "改这里" }],
        persistAnnotations: async () => {
          persistCalls++
          await gate
          return "已登记 1 条评审项：review_1"
        },
        takeAnnotations: () => [{ id: "a1" }],
        formatAnnotations: () => "BLOCK",
      })
      const { sendMessage } = useSendMessage(f.deps)
      const first = sendMessage()
      const second = sendMessage()
      await settle()
      release()
      await Promise.all([first, second])
      expect(persistCalls).toBe(1)
      expect(sent).toHaveLength(1)
    } finally { delete (globalThis as any).window }
  })

  test("并发不同消息：首个落库失败后第二个重试并排队", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = { api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } } }
    try {
      let sending = false
      let persistCalls = 0
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      let inputValue = "第一条"
      let annotations = [{ id: "a1", comment: "改这里" }]
      const f = baseDeps({
        input: () => inputValue,
        setInput: (v: string) => { inputValue = v },
        sending: () => sending,
        setSending: (v: boolean) => { sending = v },
        pendingAnnotationCount: () => annotations.length,
        peekAnnotations: () => annotations,
        persistAnnotations: async () => {
          persistCalls++
          if (persistCalls === 1) {
            await gate
            throw new Error("db down")
          }
          return "已登记 1 条评审项：review_1"
        },
        takeAnnotations: () => {
          const taken = annotations
          annotations = []
          return taken
        },
        formatAnnotations: () => "BLOCK",
      })
      const { sendMessage } = useSendMessage(f.deps)
      const first = sendMessage()
      inputValue = "第二条"
      const second = sendMessage()
      await settle()
      release()
      await Promise.all([first, second])
      expect(persistCalls).toBe(2)
      expect(sent).toHaveLength(0)
      expect(f.queued()).toHaveLength(1)
      expect(f.queued()[0].text).toContain("第二条")
    } finally { delete (globalThis as any).window }
  })

  test("落库期间新增的批注留给下一条消息", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = { api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } } }
    try {
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      let annotations = [{ id: "a1", comment: "第一条" }]
      const f = baseDeps({
        input: () => "要发的话",
        sending: () => false,
        pendingAnnotationCount: () => annotations.length,
        peekAnnotations: () => annotations,
        persistAnnotations: async (items: any[]) => {
          annotations = [...annotations, { id: "a2", comment: "落库期间新增" }]
          await gate
          return `已登记 ${items.length} 条评审项`
        },
        takeAnnotationsById: (_sid: string, ids: readonly string[]) => {
          const wanted = new Set(ids)
          const taken = annotations.filter((item) => wanted.has(item.id))
          annotations = annotations.filter((item) => !wanted.has(item.id))
          return taken
        },
        formatAnnotations: () => "BLOCK",
      })
      const { sendMessage } = useSendMessage(f.deps)
      const pending = sendMessage()
      await settle()
      release()
      await pending
      expect(sent).toHaveLength(1)
      expect(sent[0].message).toContain("BLOCK")
      expect(annotations.map((item) => item.id)).toEqual(["a2"])
    } finally { delete (globalThis as any).window }
  })

  test("排队中的较早消息不会取走之后新增的批注", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = { api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } } }
    try {
      let sending = false
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      let inputValue = "第一条"
      let annotations = [{ id: "a1", comment: "第一条的批注" }]
      const persisted: string[][] = []
      const f = baseDeps({
        input: () => inputValue,
        setInput: (v: string) => { inputValue = v },
        sending: () => sending,
        setSending: (v: boolean) => { sending = v },
        pendingAnnotationCount: () => annotations.length,
        peekAnnotations: () => annotations,
        persistAnnotations: async (items: any[]) => {
          persisted.push(items.map((item) => item.id))
          await gate
          return `已登记 ${items.length} 条评审项`
        },
        takeAnnotationsById: (_sid: string, ids: readonly string[]) => {
          const wanted = new Set(ids)
          const taken = annotations.filter((item) => wanted.has(item.id))
          annotations = annotations.filter((item) => !wanted.has(item.id))
          return taken
        },
        formatAnnotations: () => "BLOCK",
      })
      const { sendMessage } = useSendMessage(f.deps)
      const first = sendMessage()
      await settle()
      inputValue = "第二条"
      const second = sendMessage()
      await settle()
      annotations = [...annotations, { id: "a2", comment: "第二条之后新增" }]
      inputValue = "第三条"
      const third = sendMessage()
      await settle()
      release()
      await Promise.all([first, second, third])
      expect(persisted).toEqual([["a1"], ["a2"]])
      expect(sent).toHaveLength(1)
      expect(f.queued()).toHaveLength(2)
      expect(f.queued()[0].text).not.toContain("BLOCK")
      expect(f.queued()[1].text).toContain("BLOCK")
      expect(annotations).toEqual([])
    } finally { delete (globalThis as any).window }
  })

  test("并发不同消息：等待落库后排队，不静默丢弃", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = { api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } } }
    try {
      let sending = false
      let persistCalls = 0
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      let inputValue = "第一条"
      let annotations = [{ id: "a1", comment: "改这里" }]
      const f = baseDeps({
        input: () => inputValue,
        setInput: (v: string) => { inputValue = v },
        sending: () => sending,
        setSending: (v: boolean) => { sending = v },
        pendingAnnotationCount: () => annotations.length,
        peekAnnotations: () => annotations,
        persistAnnotations: async () => {
          persistCalls++
          await gate
          return "已登记 1 条评审项：review_1"
        },
        takeAnnotations: () => {
          const taken = annotations
          annotations = []
          return taken
        },
        formatAnnotations: () => "BLOCK",
      })
      const { sendMessage } = useSendMessage(f.deps)
      const first = sendMessage()
      inputValue = "第二条"
      const second = sendMessage()
      await settle()
      release()
      await Promise.all([first, second])
      expect(persistCalls).toBe(1)
      expect(sent).toHaveLength(1)
      expect(f.queued()).toHaveLength(1)
      expect(f.queued()[0].text).toContain("第二条")
    } finally { delete (globalThis as any).window }
  })

  // W5a：忙时 Enter=steer（delivery:'steer'）/ Ctrl+Enter=网关队列（delivery:'queue'）
  const mockPromptAsync = () => {
    const calls: any[] = []
    ;(globalThis as any).window = { api: { mafw: { sessions: { promptAsync: async (req: any) => { calls.push(req) } } } } }
    return calls
  }

  test("忙时 Enter（steerSupported）→ promptAsync delivery:steer，不进本地队列", async () => {
    const calls = mockPromptAsync()
    try {
      const f = baseDeps({ steerSupported: () => true })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(calls).toHaveLength(1)
      expect(calls[0].delivery).toBe("steer")
      expect(calls[0].message).toBe("排队的消息")
      expect(f.queued().length).toBe(0)
      expect(f.history().up("")).toBe("排队的消息") // 插话也进历史
    } finally { delete (globalThis as any).window }
  })

  test("忙时 Ctrl+Enter → promptAsync delivery:queue（gateway 队列）", async () => {
    const calls = mockPromptAsync()
    try {
      const f = baseDeps({ steerSupported: () => true })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage("queue")
      expect(calls).toHaveLength(1)
      expect(calls[0].delivery).toBe("queue")
      expect(f.queued().length).toBe(0)
    } finally { delete (globalThis as any).window }
  })

  test("忙时 steer 不受支持 → 回落本地队列（现状回归）", async () => {
    const calls = mockPromptAsync()
    try {
      const f = baseDeps({ steerSupported: () => false })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(calls).toHaveLength(0)
      expect(f.queued().length).toBe(1)
    } finally { delete (globalThis as any).window }
  })

  test("忙时带附件 → 本地队列（不丢媒体）", async () => {
    const calls = mockPromptAsync()
    try {
      const f = baseDeps({ steerSupported: () => true, attachments: () => [{ name: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,x" }] })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(calls).toHaveLength(0)
      expect(f.queued().length).toBe(1)
    } finally { delete (globalThis as any).window }
  })

  test("忙时 steer 调用失败 → 回落本地队列（不丢消息）", async () => {
    ;(globalThis as any).window = { api: { mafw: { sessions: { promptAsync: async () => { throw new Error("boom") } } } } }
    try {
      const f = baseDeps({ steerSupported: () => true })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(f.queued().length).toBe(1)
    } finally { delete (globalThis as any).window }
  })

  // ── Plan 2 D3：voiceOrigin 标记在忙时/空闲/重放三路径的携带 ──

  test("忙时 voiceOrigin → steer 消息内联标记", async () => {
    const calls = mockPromptAsync()
    try {
      const f = baseDeps({ steerSupported: () => true })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage("send", { voiceOrigin: true })
      expect(calls).toHaveLength(1)
      expect(calls[0].delivery).toBe("steer")
      expect(calls[0].message).toContain("[语音输入]")
    } finally { delete (globalThis as any).window }
  })

  test("忙时不支持 steer + voiceOrigin → 本地队列带 flag、文本干净", async () => {
    const f = baseDeps({ steerSupported: () => false })
    const { sendMessage } = useSendMessage(f.deps)
    await sendMessage("send", { voiceOrigin: true })
    expect(f.queued()).toHaveLength(1)
    expect(f.queued()[0].voiceOrigin).toBe(true)
    expect(f.queued()[0].text).toBe("排队的消息")
  })

  test("忙时非 voice → 队列项无 voiceOrigin flag（回归）", async () => {
    const f = baseDeps({ steerSupported: () => false })
    const { sendMessage } = useSendMessage(f.deps)
    await sendMessage()
    expect(f.queued()).toHaveLength(1)
    expect(f.queued()[0].voiceOrigin).toBeUndefined()
  })

  test("空闲 voiceOrigin → sendEnriched parts 含 synthetic 标记 part，message 干净", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = { api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } } }
    try {
      const f = baseDeps({ sending: () => false, input: () => "你好" })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage("send", { voiceOrigin: true })
      expect(sent).toHaveLength(1)
      // 桌面侧：用户文本走 message 字段（gateway 会把它组装为首个 text part），
      // parts 只携带 synthetic 标记——首个非 synthetic 展示规则由此保持气泡干净。
      expect(sent[0].message).toBe("你好")
      expect(sent[0].message).not.toContain("[语音输入]")
      const parts = sent[0].parts ?? []
      expect(parts).toHaveLength(1)
      expect(parts[0]).toMatchObject({ type: "text", synthetic: true, text: VOICE_ORIGIN_MARKER_TEXT })
    } finally { delete (globalThis as any).window }
  })

  test("空闲非 voice → parts 无 synthetic 标记（回归）", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = { api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } } }
    try {
      const f = baseDeps({ sending: () => false, input: () => "你好" })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(sent).toHaveLength(1)
      expect((sent[0].parts ?? []).some((p: any) => p.synthetic === true)).toBe(false)
    } finally { delete (globalThis as any).window }
  })

  test("flushQueue 重放 voiceOrigin 队列项 → 重新携带 synthetic 标记", async () => {
    const sent: any[] = []
    ;(globalThis as any).window = { api: { mafw: { chat: { sendEnriched: async (req: any) => { sent.push(req); return { sessionID: "s_test_session" } } } } } }
    try {
      let queued: any[] = [{ text: "排队的消息", atts: [], agents: [], voiceOrigin: true }]
      let currentInput = ""
      const f = baseDeps({
        sending: () => false,
        input: () => currentInput,
        setInput: (v: string) => { currentInput = v },
        queuedItems: () => queued,
        setQueuedItems: (fn: (prev: any[]) => any[]) => { queued = fn(queued) },
      })
      const { flushQueue } = useSendMessage(f.deps)
      flushQueue()
      await settle()
      expect(sent).toHaveLength(1)
      expect(sent[0].message).toBe("排队的消息")
      expect((sent[0].parts ?? []).some((p: any) => p.synthetic === true && p.text.includes("[语音输入]"))).toBe(true)
    } finally { delete (globalThis as any).window }
  })

  test("skill slash calls the uniform invokeSkill API", async () => {
    const calls: any[] = []
    const commands: any[] = []
    ;(globalThis as any).window = {
      api: {
        mafw: {
          discovery: { invokeSkill: async (...args: any[]) => { calls.push(args) } },
          sessions: { command: async (req: any) => { commands.push(req) } },
        },
      },
    }
    try {
      const f = baseDeps({
        sending: () => false,
        input: () => "/superpowers 帮我审一下",
        matchSlash: () => ({ name: "superpowers", group: "skill" }),
      })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(commands).toHaveLength(0)
      expect(calls).toEqual([["s_test_session", "superpowers", "帮我审一下"]])
    } finally {
      delete (globalThis as any).window
    }
  })

  test("runtime slash forwards agent/model metadata", async () => {
    const calls: any[] = []
    ;(globalThis as any).window = {
      api: { mafw: { sessions: { command: async (req: any) => { calls.push(req) } } } },
    }
    try {
      const f = baseDeps({
        sending: () => false,
        input: () => "/review 123",
        matchSlash: () => ({
          name: "review",
          group: "custom",
          agent: "plan",
          model: { id: "m1", providerID: "p1" },
        }),
      })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(calls).toEqual([{
        sessionID: "s_test_session",
        command: "review",
        arguments: "123",
        agent: "plan",
        model: { providerID: "p1", modelID: "m1" },
      }])
    } finally {
      delete (globalThis as any).window
    }
  })

  test("skill failure does not fall back to session.command", async () => {
    const commands: any[] = []
    ;(globalThis as any).window = {
      api: {
        mafw: {
          discovery: { invokeSkill: async () => { throw new Error("unavailable") } },
          sessions: { command: async (req: any) => { commands.push(req) } },
        },
      },
    }
    try {
      const f = baseDeps({
        sending: () => false,
        input: () => "/superpowers",
        matchSlash: () => ({ name: "superpowers", group: "skill" }),
      })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(commands).toHaveLength(0)
    } finally {
      delete (globalThis as any).window
    }
  })
})
