// 语音绑定层 hook（逐字迁移自 ChatPane.tsx 407-589 + 自动播放 effect 1220-1254）。
// VoiceSession 状态机接线、assistant 播报、语音分段乐观上传、mediaSpeak artifact 自动播放。
// 纯函数 extractVoiceReplies / cleanAssistantText 可独立单测。
// 交叉域依赖（TTS picker 的 ttsVoiceSel、previewing 清理回调）经 deps 注入，hook 不持有。
import { createSignal, createEffect, onCleanup } from "solid-js"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { createVoiceSession } from "../voice/session"
import { createSileroVadAnalyzer } from "../voice/silero"
import { DEFAULT_VAD_PARAMS, type VadParams } from "../voice/types"
import { SilenceTimeoutStrategy } from "../voice/turn"
import { cachedArtifactUrl } from "../components/AudioReply"
import { uploadVoiceSegment } from "../voice/upload"
import { isLocalMessageId } from "./local-id"
import type { AssistantActions } from "@mafw/session-ui/message-part"

// [语音回复 art:<id> 音色:<voice> h:<hash>]
const VOICE_REPLY_RE = /\[语音回复\s+art:([a-zA-Z0-9-]+)(?:\s+音色:([^\]]+?))?(?:\s+h:([a-f0-9]{8}))?\]/g

/** 从文本提取 [语音回复] 标记（多标记按序）。 */
export function extractVoiceReplies(text: string): Array<{ artifactId: string; voice?: string; hash?: string }> {
  const out: Array<{ artifactId: string; voice?: string; hash?: string }> = []
  for (const m of text.matchAll(VOICE_REPLY_RE)) {
    if (m[1]) out.push({ artifactId: m[1], voice: m[2]?.trim(), hash: m[3]?.trim() || undefined })
  }
  return out
}

/** 去掉 [语音回复] 标记并 trim（供播报取纯文本）。 */
export function cleanAssistantText(text: string): string {
  return text.replace(/\[语音回复\s+art:[^\]]+\]/g, "").trim()
}

// 已自动播放过的语音回复 artifact（防历史重载/重渲染重复播放）
const playedVoiceArtifacts = new Set<string>()

export function useVoiceBinding(
  sid: () => string,
  deps: {
    store: { message: Record<string, any[]>; part: Record<string, any[]> }
    setStore: (fn: (prev: any) => any) => void
    gwReady: () => boolean
    ttsVoiceSel: () => string | null
    onSetUserMsgId: (sid: string, id: string) => void
    voiceRepliesForTurn: (userMsgId: string) => Array<{ artifactId: string; hash?: string }>
    userMessages: () => any[]
    onSpeakingIdle: () => void
  },
) {
  const [ttsSpeaking, setTtsSpeaking] = createSignal(false)
  const [voiceRecording, setVoiceRecording] = createSignal(false)
  const [speakingPartId, setSpeakingPartId] = createSignal<string | null>(null)

  // ── 语音核心（VoiceSession 状态机；UI 只绑定事件）──
  // VAD 参数对象可变：config 异步加载后 Object.assign，MicVAD.new 在 start() 时才读值。
  const vadParams: VadParams = { ...DEFAULT_VAD_PARAMS }
  void (async () => {
    try {
      const cfg: any = await window.api.mafw.config.get("media.tts.vad")
      if (cfg && typeof cfg === "object") Object.assign(vadParams, cfg)
    } catch { /* fail-open 默认值 */ }
  })()

  const voiceSession = createVoiceSession({
    vad: createSileroVadAnalyzer(vadParams),
    strategy: new SilenceTimeoutStrategy({ stopSecs: vadParams.stopSecs }),
    streamUrl: () => window.api.mafw.tts.streamUrl(),
    interrupt: (s) => window.api.mafw.tts.interrupt(s),
    sessionId: sid,
    defaultVoice: () => deps.ttsVoiceSel() ?? "茉莉",
    speakFallback: (text, voice) => window.api.mafw.tts.speak({ text, voice }),
  })
  onCleanup(() => voiceSession.dispose())

  voiceSession.on("state", (s) => {
    setVoiceRecording(s === "recording")
    setTtsSpeaking(s === "speaking")
    if (s !== "speaking") { deps.onSpeakingIdle(); setSpeakingPartId(null) }
  })
  voiceSession.on("error", (e) => showToastV2({ description: `语音失败: ${e.message}`, duration: 3000 }))
  voiceSession.on("segment", ({ wavBytes, duration }) => { void handleVoiceSegment(wavBytes, duration) })

  // assistant 消息行内播报按钮（与 copy 按钮同款）：toggle 语义——同条再点=停止，
  // 点其他条/其他播报进行中=先停再播（speak 的 state guard 会吞掉并发请求，故先显式 stop）
  const assistantActions = (): AssistantActions => ({
    speakingPartId: () => speakingPartId(),
    onSpeakToggle: (text, partId) => {
      if (speakingPartId() === partId) {
        voiceSession.stopSpeaking("manual")
        return
      }
      voiceSession.stopSpeaking("manual")
      setSpeakingPartId(partId)
      void voiceSession.speak(text).catch(() => {}).finally(() => setSpeakingPartId(null))
    },
  })

  // 手动打断：录音开始前/新播放前停掉正在播放的语音（AEC 兜底，双击安全）
  const stopActivePlayback = () => voiceSession.stopSpeaking("manual")

  // 取本会话最后一条 assistant 消息的纯文本（供语音播报）。
  // 排除 synthetic parts（工具结果/指针）与 [语音回复] 标记自身。
  const lastAssistantText = (): string => {
    const s = sid()
    if (!s) return ""
    const msgs = deps.store.message[s] || []
    const assistants = msgs.filter((m: any) => m.role === "assistant")
    if (assistants.length === 0) return ""
    const last = assistants[assistants.length - 1]
    const texts: string[] = []
    for (const p of deps.store.part[last.id] || []) {
      if (p?.type === "text" && typeof p.text === "string" && !p.synthetic) {
        const clean = cleanAssistantText(p.text)
        if (clean) texts.push(clean)
      }
    }
    return texts.join("\n").trim()
  }

  const speakText = async () => {
    const t = lastAssistantText()
    console.log("[voice] speakText, text length:", t.length, "| voice:", deps.ttsVoiceSel() ?? "茉莉")
    if (!t || !deps.gwReady()) {
      if (!t) showToastV2({ description: "没有可播报的回复文本", duration: 3000 })
      return
    }
    try {
      await voiceSession.speak(t, deps.ttsVoiceSel() ?? undefined)
    } catch (e: any) {
      // 打断（barge-in）不算失败；其余报 toast
      if (e?.name !== "AbortError") {
        showToastV2({ description: `语音合成失败: ${e?.message || String(e)}`, duration: 3000 })
      }
    }
  }

  // ── 语音输入：VoiceSession.on('segment') → 乐观显示 + 后台上传 ──
  const handleVoiceSegment = async (wavBytes: ArrayBuffer, duration: number) => {
    const s = sid()
    if (!s) return
    const tempMsgId = `temp-voice-${Date.now()}`

    // 立即创建本地消息（乐观显示，voiceStatus: "uploading"）
    deps.setStore((prev: any) => {
      const msgs = { ...prev.message }
      const sessionMsgs = [...(msgs[s] || [])]
      sessionMsgs.push({
        id: tempMsgId,
        sessionID: s,
        role: "user",
        parentID: null,
        time: { created: Date.now() },
        text: "",
        agent: "general",
        model: { providerID: "opencode", modelID: "" },
        voiceStatus: "uploading",
        voiceDuration: duration,
      })
      msgs[s] = sessionMsgs
      return { ...prev, message: msgs }
    })

    // 后台上传 + 发送（一次 IPC 完成 upload + createTask）
    const t0 = performance.now()
    console.log("[voice][perf] onSegment start", { bytes: wavBytes.byteLength, duration })
    try {
      const t1 = performance.now()
      await uploadVoiceSegment({
        wavBytes,
        sessionID: s,
        uploadAndCreate: (args) => window.api.mafw.media.uploadAndCreate(args),
        sendEnriched: (args) => window.api.mafw.chat.sendEnriched(args as any),
        onUploaded: ({ pointerText, partId }) => {
          // 上传完成即显示指针文本（analyzing 态）——发送前保持旧 UI 时序
          const realMsgId = `user-${Date.now()}`
          deps.setStore((prev: any) => {
            const msgs = { ...prev.message }
            const sessionMsgs = [...(msgs[s] || [])]
            const idx = sessionMsgs.findIndex((m: any) => m.id === tempMsgId)
            if (idx >= 0) {
              sessionMsgs[idx] = {
                ...sessionMsgs[idx],
                id: realMsgId,
                text: pointerText,
                voiceStatus: "analyzing",
              }
            }
            msgs[s] = sessionMsgs
            const parts = { ...prev.part }
            parts[realMsgId] = [{
              type: "text",
              id: partId,
              text: pointerText,
              sessionID: s,
              messageID: realMsgId,
              synthetic: true,
            }]
            return { ...prev, message: msgs, part: parts }
          })
          deps.onSetUserMsgId(s, realMsgId)
        },
      })
      const t2 = performance.now()
      console.log("[voice][perf] uploadAndSend done", {
        ipcMs: (t1 - t0).toFixed(1),
        totalMs: (t2 - t0).toFixed(1),
      })

      // 发送完成：voiceStatus → done
      deps.setStore((prev: any) => {
        const msgs = { ...prev.message }
        const sessionMsgs = [...(msgs[s] || [])]
        const idx = sessionMsgs.findIndex((m: any) => isLocalMessageId(m.id) && m.voiceStatus !== "done")
        if (idx >= 0 && sessionMsgs[idx]?.voiceStatus === "analyzing") {
          sessionMsgs[idx] = { ...sessionMsgs[idx], voiceStatus: "done" }
        }
        msgs[s] = sessionMsgs
        return { ...prev, message: msgs }
      })
    } catch (err: any) {
      console.warn("[voice] upload failed:", err)
      deps.setStore((prev: any) => {
        const msgs = { ...prev.message }
        const sessionMsgs = [...(msgs[s] || [])]
        const idx = sessionMsgs.findIndex((m: any) => m.id === tempMsgId)
        if (idx >= 0) {
          sessionMsgs[idx] = { ...sessionMsgs[idx], voiceStatus: "failed", error: err.message || String(err) }
        }
        msgs[s] = sessionMsgs
        return { ...prev, message: msgs }
      })
    }
  }

  // mafw_media_speak 自动播放：回复文本出现新的 [语音回复 art:...] → 自动播 artifact。
  // 去重：playedVoiceArtifacts（历史重载不重播）；标记 h 匹配"已流式播放"→ 跳过（防双播，
  // hash 由 VoiceSession.speakFromTool 记录，同 gateway media-speak djb2 实现）。
  createEffect(() => {
    const s = sid()
    if (!s) return
    const users = deps.userMessages()
    const last = users.length > 0 ? users[users.length - 1] : null
    if (!last) return
    const replies = deps.voiceRepliesForTurn(last.id)
    if (replies.length === 0) return
    for (const r of replies) {
      if (r.hash && voiceSession.hasRecentSpeakHash(r.hash)) {
        console.log("[voice] artifact skipped (already streamed):", r.artifactId)
        continue
      }
      if (playedVoiceArtifacts.has(r.artifactId)) continue
      playedVoiceArtifacts.add(r.artifactId)
      // URL 契约归 SDK（media.artifactUrl）；播放经 VoiceSession（互斥 + barge-in 一致）。
      void cachedArtifactUrl(r.artifactId).then(
        (url) => {
          console.log("[voice] artifact auto-playing:", r.artifactId)
          void voiceSession.playUrl(url).then(
            ({ ok }) => {
              if (!ok) {
                playedVoiceArtifacts.delete(r.artifactId)
                showToastV2({ description: "语音回复已生成，请点击播放", duration: 4000 })
              }
            },
          )
        },
        (err: any) => {
          playedVoiceArtifacts.delete(r.artifactId)
          console.log("[voice] artifact url error:", r.artifactId, err?.message || String(err))
        },
      )
    }
  })

  return {
    voiceSession,
    voiceRecording,
    ttsSpeaking,
    speakingPartId,
    assistantActions,
    stopActivePlayback,
    lastAssistantText,
    speakText,
    handleVoiceSegment,
  }
}
