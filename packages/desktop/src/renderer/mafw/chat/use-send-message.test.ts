import { describe, expect, test } from "bun:test"
import { parseSlashShape, buildOptimisticParts, useSendMessage } from "./use-send-message"
import { createInputHistory } from "../components/input-history"

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
})
