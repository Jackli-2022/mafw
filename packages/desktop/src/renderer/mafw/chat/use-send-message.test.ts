import { describe, expect, test } from "bun:test"
import { parseSlashShape, buildOptimisticParts, useSendMessage, decideBusyDelivery } from "./use-send-message"
import { createInputHistory } from "../components/input-history"

describe("decideBusyDelivery（W5a steer 语义选择）", () => {
  test("steer 支持 + 无媒体 + Enter → steer", () => {
    expect(decideBusyDelivery({ mode: "send", steerApi: true, hasMedia: false })).toBe("steer")
  })
  test("Ctrl+Enter（queue）→ gateway-queue", () => {
    expect(decideBusyDelivery({ mode: "queue", steerApi: true, hasMedia: false })).toBe("gateway-queue")
    expect(decideBusyDelivery({ mode: "queue", steerApi: false, hasMedia: false })).toBe("gateway-queue")
  })
  test("runtime 不支持 steer → 本地队列（现状回归）", () => {
    expect(decideBusyDelivery({ mode: "send", steerApi: false, hasMedia: false })).toBe("local-queue")
  })
  test("带媒体 → 本地队列（promptAsync 只承载文本，v1 不丢附件）", () => {
    expect(decideBusyDelivery({ mode: "send", steerApi: true, hasMedia: true })).toBe("local-queue")
    expect(decideBusyDelivery({ mode: "queue", steerApi: true, hasMedia: true })).toBe("local-queue")
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

  test("入队时打包批注（Review Focus 4：入队后新增不跟这条）", async () => {
    let taken = 0
    const f = baseDeps({
      pendingAnnotationCount: () => 1,
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

  // W5a：忙时 Enter=steer（delivery:'steer'）/ Ctrl+Enter=网关队列（delivery:'queue'）
  const mockPromptAsync = () => {
    const calls: any[] = []
    ;(globalThis as any).window = { api: { mafw: { sessions: { promptAsync: async (req: any) => { calls.push(req) } } } } }
    return calls
  }

  test("忙时 Enter（steerApi）→ promptAsync delivery:steer，不进本地队列", async () => {
    const calls = mockPromptAsync()
    try {
      const f = baseDeps({ steerApi: () => true })
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
      const f = baseDeps({ steerApi: () => true })
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
      const f = baseDeps({ steerApi: () => false })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(calls).toHaveLength(0)
      expect(f.queued().length).toBe(1)
    } finally { delete (globalThis as any).window }
  })

  test("忙时带附件 → 本地队列（不丢媒体）", async () => {
    const calls = mockPromptAsync()
    try {
      const f = baseDeps({ steerApi: () => true, attachments: () => [{ name: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,x" }] })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(calls).toHaveLength(0)
      expect(f.queued().length).toBe(1)
    } finally { delete (globalThis as any).window }
  })

  test("忙时 steer 调用失败 → 回落本地队列（不丢消息）", async () => {
    ;(globalThis as any).window = { api: { mafw: { sessions: { promptAsync: async () => { throw new Error("boom") } } } } }
    try {
      const f = baseDeps({ steerApi: () => true })
      const { sendMessage } = useSendMessage(f.deps)
      await sendMessage()
      expect(f.queued().length).toBe(1)
    } finally { delete (globalThis as any).window }
  })
})
