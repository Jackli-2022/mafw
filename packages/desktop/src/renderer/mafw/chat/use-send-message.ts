// 发送管线 hook（逐字迁移自 ChatPane.tsx sendMessage 468-703 + interrupt + flushQueue）。
// 纯函数 parseSlashShape / buildOptimisticParts 可独立单测；
// 媒体上传循环消费 useAttachments 的 imageToDataUrl / uploadMediaBinary（deps 注入）。
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { mimeOf } from "./use-attachments"
import { enqueueTurn, takeFirstTurn } from "../components/turn-queue"

/** 解析 "/cmd args" 形态（不做命令表匹配——那由 deps.matchSlash 注入）。 */
export function parseSlashShape(text: string): { name: string; args: string } | null {
  const m = text.match(/^\/(\S+)(?:\s+(.*))?$/)
  if (!m) return null
  return { name: m[1].toLowerCase(), args: (m[2] || "").trim() }
}

/**
 * 组装乐观 user 消息的 parts：body text + 本地缩略图（localOnly）+ 文件 + agent。
 * 空 body 且无其他 parts 时返回空数组。
 */
export function buildOptimisticParts(opts: {
  userMsgId: string
  ts: number
  sid: string
  bodyMessage: string
  visionThumbs: Array<{ name: string; mime: string; dataUrl: string }>
  fileParts: any[]
  agentParts: any[]
}): any[] {
  const { userMsgId, ts, sid, bodyMessage, visionThumbs, fileParts, agentParts } = opts
  const optimisticParts: any[] = []
  if (bodyMessage) {
    optimisticParts.push({ type: "text", text: bodyMessage, id: `${userMsgId}-text`, sessionID: sid, messageID: userMsgId })
  }
  // Local-only thumbnails: rendered immediately, kept across SSE/history
  // rewrites (prt_local_ parts are re-merged by loadSessionHistory/loadOlder),
  // but never sent to the server.
  optimisticParts.push(...visionThumbs.map((t, i) => ({
    type: "file", id: `prt_local_${ts}_${i}`, mime: t.mime, filename: t.name, url: t.dataUrl, localOnly: true, sessionID: sid, messageID: userMsgId,
  })))
  optimisticParts.push(...fileParts.map(p => ({ ...p, sessionID: sid, messageID: userMsgId })))
  optimisticParts.push(...agentParts.map(p => ({ ...p, sessionID: sid, messageID: userMsgId })))
  return optimisticParts
}

export interface SendMessageDeps {
  sid: () => string
  onCreateSession: () => Promise<string | null>
  // composer signals
  input: () => string
  setInput: (v: string) => void
  sending: () => boolean
  setSending: (v: boolean) => void
  setPhase: (v: 'idle' | 'searching' | 'writing') => void
  attachments: () => any[]
  setAttachments: (v: any[]) => void
  mentionedAgents: () => any[]
  setMentionedAgents: (fn: (prev: any[]) => any[]) => void
  mentionedFiles: () => any[]
  setMentionedFiles: (v: any[]) => void
  queuedItems: () => any[]
  setQueuedItems: (fn: (prev: any[]) => any[]) => void
  textareaEl: () => HTMLTextAreaElement | null
  history: { push(t: string): void }
  clearDraft: (sid: string) => void
  matchSlash: (text: string) => { name: string; group: "mafw" | "custom" } | null
  agentSel: () => { name: string } | null | undefined
  model: () => { providerID: string; modelID: string } | null | undefined
  setStore: (fn: (prev: any) => any) => void
  forceAnchor: () => void
  // attachment helpers（来自 useAttachments）
  imageToDataUrl: (file: File) => Promise<string | undefined>
  uploadMediaBinary: (bytes: ArrayBuffer, mediaType: string) => Promise<string>
  // 纯文本路径转义（ChatPane 保留，encodeFilePath 为文件 URL 语义）
  encodeFilePath: (filepath: string) => string
}

export function useSendMessage(deps: SendMessageDeps) {
  const {
    input, setInput, sending, setSending, setPhase,
    attachments, setAttachments, mentionedAgents, setMentionedAgents,
    mentionedFiles, setMentionedFiles, queuedItems, setQueuedItems,
    textareaEl, history, clearDraft, matchSlash, agentSel, model,
    setStore, forceAnchor, imageToDataUrl, uploadMediaBinary, encodeFilePath,
  } = deps
  const sidProp = deps.sid

  async function sendMessage() {
    const text = input()
    const atts = attachments()
    const agents = mentionedAgents()
    if (!text.trim() && atts.length === 0) return
    let sid = sidProp()
    if (!sid) { sid = await deps.onCreateSession(); if (!sid) return }
    const hasVoice = atts.some(a => a.name?.startsWith("voice-"))
    console.log("[mafw] sendMessage", sid.slice(-8), "| text:", text.trim().length, "chars | atts:", atts.length, "| sending:", sending(), "| voice:", hasVoice)
    if (sending()) {
      // Voice messages (walkie-talkie) interrupt the in-flight reply; regular
      // messages queue for the next idle boundary instead of being dropped.
      if (!hasVoice) {
        setQueuedItems(prev => enqueueTurn(prev, { text, atts, agents }))
        setInput("")
        setAttachments([])
        setMentionedAgents(() => [])
        // The queued turn carries its own @file references inside `text` —
        // leaving mentionedFiles set would re-prepend them on flush AND leak
        // the stale chip onto the next manual message.
        setMentionedFiles([])
        clearDraft(sidProp())
        const ta = textareaEl()
        if (ta) ta.style.height = "auto"
        return
      }
      console.log("[mafw] sendMessage: voice interrupts in-flight turn")
      try { await window.api.mafw.sessions.abort(sid) } catch { /* ignore */ }
    }

    // ── Slash commands: dispatch before the plain-message path ──
    const fileMentions = mentionedFiles()
    if (atts.length === 0 && agents.length === 0 && fileMentions.length === 0) {
      const cmd = matchSlash(text.trim())
      if (cmd) {
        const rest = parseSlashShape(text.trim())?.args ?? ""
        setSending(true)
        setPhase('searching')
        setInput("")
        history.push(text)
        clearDraft(sidProp())
        try {
          if (cmd.group === "mafw") {
            const result = await window.api.mafw.mafwCommands.run({ command: cmd.name, args: rest, sessionID: sid })
            if (result?.ok) {
              showToastV2({ description: result.message || result.text || `/${cmd.name} 完成`, duration: 4000 })
            } else {
              showToastV2({ description: `/${cmd.name} 失败: ${result?.error || "unknown"}`, duration: 4000 })
            }
          } else {
            await window.api.mafw.sessions.command({ sessionID: sid, command: cmd.name, arguments: rest })
          }
        } catch (e: any) {
          console.warn("[mafw] command run failed:", e)
          showToastV2({ description: `/${cmd.name} 执行失败: ${e?.message || String(e)}`, duration: 4000 })
        }
        setSending(false)
        setPhase('idle')
        return
      }
    }

    setSending(true)
    setPhase('searching')
    history.push(text)
    clearDraft(sidProp())
    setInput("")
    setAttachments([])
    setMentionedAgents(() => [])
    setMentionedFiles([])
    // @file mentions ride as text references — the model reads them with its
    // own read tool (Claude Code semantics, no file part expansion).
    const filePrefix = fileMentions.map(f => "@" + f.rel).join(" ")
    // Collapse the textarea back to single line after the message is queued
    const ta = textareaEl()
    if (ta) ta.style.height = "auto"

    const userMsgId = `user-${Date.now()}`
    const ts = Date.now()
    deps.onSetUserMsgId(sid, userMsgId)

    // ── Vision attachments: images go to the gateway A2A VisionAgent first;
    // the message then carries a text pointer instead of the image part, so a
    // text-only model never receives raw image bytes. Non-image attachments
    // keep the original file-part path.
    const visionParts: any[] = []
    const visionFailed: string[] = []
    const visionThumbs: { name: string; mime: string; dataUrl: string }[] = []
    const visionable = atts.filter(a => { const m = a.mime || mimeOf(a.name); return m.startsWith("image/") || m.startsWith("video/") || m.startsWith("audio/") })
    for (const a of visionable) {
      try {
        // Pre-uploaded attachment (voice segments): reuse the A2A task pointer
        // directly — no second upload round-trip on send.
        if ((a as any).taskPromise) {
          const pre = await (a as any).taskPromise
          if (pre) {
            const artifactIdPart = pre.artifactId ? ` artifactId: ${pre.artifactId}` : ""
            visionParts.push({
              type: "text",
              id: `prt_media_${ts}_${visionParts.length}`,
              text: `[媒体附件 taskID: ${pre.taskID} contextID: ${pre.contextId}${artifactIdPart}（媒体: ${a.name}），这是用户发给你的媒体消息（图片/视频/音频）——调用 mafw_media_ask 工具获取其内容后直接回应（taskID 填 ${pre.taskID}）]`,
              synthetic: true,
            })
            visionThumbs.push({ name: a.name, mime: a.mime || "audio/wav", dataUrl: a.dataUrl || "" })
            console.log("[media] reused pre-uploaded task:", pre.taskID.slice(0, 8), a.name)
            continue
          }
        }
        let dataUrl = a.dataUrl
        let pickedBytes: ArrayBuffer | undefined
        if (!dataUrl && a.path) {
          // readPickedFile returns raw bytes; images reuse the paste downscale
          // pipeline, video/audio read straight (no canvas).
          pickedBytes = await (window as any).api?.readPickedFile?.(a.token, a.path)
          if (pickedBytes) {
            const mime = a.mime || mimeOf(a.name)
            const file = new File([pickedBytes], a.name, { type: mime })
            dataUrl = mime.startsWith("image/") ? await imageToDataUrl(file) : undefined
          }
        }
        // Derive the actual encoded format from the data URL prefix: canvas
        // re-encodes non-PNG to JPEG, so a.mime would mislabel gif/webp/bmp.
        const mediaType = dataUrl
          ? dataUrl.split(",")[0].replace("data:", "").replace(";base64", "")
          : (a.mime || mimeOf(a.name))
        // Upload bytes to the A2A artifact store (binary, no base64 JSON body);
        // the message references the artifact via a tiny URL part.
        let task: { id: string; contextId: string; state: string }
        let artifactId: string | undefined
        try {
          let bytes: ArrayBuffer | undefined = pickedBytes
          if (!bytes && dataUrl) {
            // pasted/dragged attachments already carry a (downscaled) data URL;
            // convert back to bytes locally — no IPC/HTTP copy of the string.
            const blob = await (await fetch(dataUrl)).blob()
            bytes = await blob.arrayBuffer()
          }
          if (!bytes) throw new Error("无法读取媒体数据")
          console.log("[media] uploading to A2A artifact:", a.name, mediaType, bytes.byteLength, "bytes")
          artifactId = await uploadMediaBinary(bytes, mediaType)
          task = await window.api.mafw.media.createTask({
            artifactId,
            mediaType,
            question: text.trim() || undefined,
          })
          console.log("[media] A2A uploaded:", a.name, "-> artifact", artifactId.slice(0, 8), "task", task.id.slice(0, 8))
        } catch (uploadErr: any) {
          // Fallback: legacy base64 path (kept for gateway versions without
          // the upload endpoint).
          console.warn("[mafw] binary media upload failed, falling back to dataUrl:", uploadErr?.message || uploadErr)
          if (!dataUrl) throw new Error("无法读取媒体数据")
          task = await window.api.mafw.media.createTask({
            dataUrl,
            mediaType,
            question: text.trim() || undefined,
          })
          console.log("[media] A2A fallback(dataUrl):", a.name, "-> task", task.id.slice(0, 8))
        }
        const artifactIdPart = artifactId ? ` artifactId: ${artifactId}` : ""
        visionParts.push({
          type: "text",
          id: `prt_media_${ts}_${visionParts.length}`,
          text: `[媒体附件 taskID: ${task.id} contextID: ${task.contextId}${artifactIdPart}（媒体: ${a.name}），这是用户发给你的媒体消息（图片/视频/音频）——调用 mafw_media_ask 工具获取其内容后直接回应（taskID 填 ${task.id}）]`,
          synthetic: true,
        })
        visionThumbs.push({ name: a.name, mime: mediaType, dataUrl: dataUrl || "" })
      } catch (err: any) {
        console.warn("[media] vision attachment failed:", a.name, err?.message || String(err))
        visionFailed.push(`${a.name}: ${err?.message || String(err)}`)
      }
    }
    const nonVision = atts.filter(a => { const m = a.mime || mimeOf(a.name); return !(m.startsWith("image/") || m.startsWith("video/") || m.startsWith("audio/")) })
    const fileParts = nonVision.map((a, i) => a.dataUrl
      ? { type: "file", id: `prt_att_${ts}_${i}`, mime: a.mime || "image/png", filename: a.name, url: a.dataUrl }
      : { type: "file", id: `prt_att_${ts}_${i}`, mime: a.mime || mimeOf(a.name), filename: a.name, url: "file://" + encodeFilePath(a.path || "") })
    const agentParts = agents.map(a => ({ type: "agent", id: `prt_agent_${ts}_${a.name}`, name: a.name }))
    // Release picker tokens only after the vision reads above consumed the
    // image bytes (releasing first invalidates read-picked-file).
    for (const a of atts) if (a.token) (window as any).api?.releasePickedFiles?.(a.token)
    // Front-end display text: merge user text + vision pointers + failure notes
    // into a single non-synthetic text part. Message only renders the first
    // non-synthetic text part, so synthetic pointers alone would render an
    // empty user message. Pointers still reach the server via `parts` only.
    const pointerTexts = visionParts.map(p => p.text)
    const failureNote = visionFailed.length > 0 ? `[媒体附件未送达 Media Agent] ${visionFailed.join("; ")}` : ""
    const bodyMessage = [filePrefix, text.trim(), ...pointerTexts, failureNote].filter(Boolean).join("\n\n")
    const optimisticParts = buildOptimisticParts({ userMsgId, ts, sid, bodyMessage, visionThumbs, fileParts, agentParts })
    setStore(prev => {
      const msgs = { ...prev.message }
      const sessionMsgs = [...(msgs[sid] || [])]
      sessionMsgs.push({ id: userMsgId, sessionID: sid, role: "user", parentID: null, time: { created: Date.now() }, text: bodyMessage, agent: "general", model: { providerID: "opencode", modelID: "" } })
      msgs[sid] = sessionMsgs
      return {
        ...prev,
        message: msgs,
        part: { ...prev.part, [userMsgId]: optimisticParts },
      }
    })
    forceAnchor()

    console.log("[mafw] sendMessage", sid)
    try {
      const result = await window.api.mafw.chat.sendEnriched({
        message: [filePrefix, text.trim() || failureNote].filter(Boolean).join("\n"),
        sessionID: sid,
        parts: visionParts.length || fileParts.length || agentParts.length ? [...visionParts, ...fileParts, ...agentParts] : undefined,
        agent: agentSel()?.name === "manager" ? undefined : agentSel()?.name,
        model: model() ? { providerID: model()!.providerID, modelID: model()!.modelID } : undefined,
      }) as any
      if (result?.sessionID) {
        console.log("[mafw] sendEnriched result: session", result.sessionID)
      } else {
        const errMsg = result?.error || 'no session ID returned'
        console.warn("[mafw] sendEnriched failed:", errMsg)
        showToastV2({ description: `Chat failed: ${errMsg}`, duration: 5000 })
        setSending(false)
        setPhase('idle')
      }
    } catch (err: any) {
      console.warn("[mafw] sendEnriched error:", err.message)
      setSending(false)
      setPhase('idle')
      showToastV2({ description: `Chat failed: ${err.message}`, duration: 5000 })
    }
  }

  // Interrupt the in-flight conversation (ESC / Ctrl+C / stop button)
  async function interrupt() {
    const sid = sidProp()
    if (!sid) return
    try {
      await window.api.mafw.sessions.abort(sid)
    } catch (e) {
      console.warn("[mafw] interrupt failed", e)
    }
    setSending(false)
    setPhase('idle')
  }

  // Dispatch the next queued turn (called from MafwShell on session idle).
  // Restores the turn into the composer signals, then reuses sendMessage().
  const flushQueue = () => {
    if (sending()) return
    const { first, rest } = takeFirstTurn(queuedItems())
    if (!first) return
    setQueuedItems(() => rest)
    setInput(first.text)
    setAttachments(first.atts as any[])
    setMentionedAgents(() => first.agents)
    void sendMessage()
  }

  return { sendMessage, interrupt, flushQueue }
}
