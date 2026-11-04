// 摄取层：flat 历史/SSE 消息 → 桌面 store 的规范记录。
//
// 输入只认 MAFW flat `MafwMessage`（`content: MafwPart[]`）；旧 `{info,parts}`
// 信封已在 Task 15 删除（不展开、不回落）。所有多形状（错误、工具输出、文件
// diff、task 子会话、step-finish→stopReason）在这里收敛，session-ui 只读规范形。
import { canonicalMessageError, type CanonicalMessageError } from "./errors"
import { canonicalToolPart } from "./parts"
import { stripVoiceOriginMarker } from "../chat/voice-origin-marker"

export interface IngestedHistoryPage {
  /** 规范 flat 消息（含 `content`），不含 `info`/`parts` 信封。 */
  messages: any[]
  /** 渲染用 parts 索引（与 `messages[].content` 同对象）。 */
  parts: Record<string, any[]>
}

export interface IngestMessageOptions {
  sessionID?: string
  /** 稳定兜底 id（缺省时按时间/序号生成，保证同一页内确定）。 */
  index?: number
  /**
   * 是否允许为缺 id 的消息合成兜底 id。
   * 仅历史分页可开启（同一页内确定性）；live `message.updated` 缺 id 必须丢弃，
   * 否则无 id 的 user/assistant 帧会塌到同一 `msg_<sid>_0`，assistant 直接覆盖
   * user 回合（pi 的 id 由 gateway 翻译层按 role+timestamp 产出）。
   */
  allowSyntheticId?: boolean
}

function fallbackId(prefix: string, opts: IngestMessageOptions): string {
  return `${prefix}-${opts.sessionID ?? "session"}-${opts.index ?? 0}`
}

function lastStepFinishReason(parts: any[]): string | undefined {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part?.type === "step-finish" && typeof part.reason === "string" && part.reason) return part.reason
  }
  return undefined
}

/** 规范 part 列表（补 id/session/message 身份 + 工具规范形）。 */
export function canonicalParts(
  rawParts: unknown,
  opts: { sessionID: string; messageID: string },
): any[] {
  if (!Array.isArray(rawParts)) return []
  const out: any[] = []
  rawParts.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return
    const base = {
      ...raw,
      id: typeof raw.id === "string" && raw.id ? raw.id : `${opts.messageID}-part-${index}`,
      sessionID: typeof raw.sessionID === "string" && raw.sessionID ? raw.sessionID : opts.sessionID,
      messageID: typeof raw.messageID === "string" && raw.messageID ? raw.messageID : opts.messageID,
    }
    out.push(canonicalToolPart(base))
  })
  return out
}

/**
 * 单条 flat/wire 消息 → 规范消息 + parts。
 * 返回的 message 只含 View DTO 字段（附加 `content`），绝不含 `info`/`parts`。
 */
export function canonicalMessage(
  raw: any,
  opts: IngestMessageOptions = {},
): { message: any; parts: any[] } | null {
  const flat = raw
  if (!flat || typeof flat !== "object") return null
  // 只接受有渲染角色的消息：旧的 `synthetic` 终端消息（opencode shell 行）已由
  // `background.jobs` façade 取代（desktop 不再从历史推导后台行），不再摄取
  // 无 role 的记录——否则它们会以 role=undefined 进入 store 却无人渲染。
  if (flat.role !== "user" && flat.role !== "assistant") return null
  const sessionID = typeof flat.sessionID === "string" && flat.sessionID
    ? flat.sessionID
    : (opts.sessionID ?? "")
  const hasId = typeof flat.id === "string" && flat.id.length > 0
  // live 缺 id：丢弃（旧行为会合成共享 id 导致 user 回合被 assistant 覆盖）。
  if (!hasId && opts.allowSyntheticId === false) return null
  const id = hasId ? flat.id : fallbackId("msg", opts)
  const rawParts = Array.isArray(flat.content)
    ? flat.content
    : []
  const parts = canonicalParts(rawParts, { sessionID, messageID: id })
  // Plan 2 D3：用户语音消息的 `[语音输入]` 标记只服务模型（服务端原始文本保留），
  // 桌面展示层在摄取时剥离——「首个非 synthetic part」规则在 SDK 把 message 与
  // parts 合并成单个 text part 后不再成立（真机历史重载实证泄漏）。
  if (flat.role === "user") {
    for (const part of parts) {
      if (part?.type === "text" && typeof part.text === "string") {
        part.text = stripVoiceOriginMarker(part.text)
      }
    }
  }
  const error: CanonicalMessageError | undefined = canonicalMessageError(flat.error)
  const nativeModel =
    flat.model && typeof flat.model === "object"
      ? flat.model
      : undefined
  const model =
    nativeModel && typeof nativeModel.modelID === "string" && typeof nativeModel.providerID === "string"
      ? {
          providerID: nativeModel.providerID,
          modelID: nativeModel.modelID,
          ...(typeof nativeModel.variant === "string" ? { variant: nativeModel.variant } : {}),
        }
      : undefined
  const stopReason =
    (typeof flat.stopReason === "string" && flat.stopReason) ||
    lastStepFinishReason(parts) ||
    (error?.kind === "abort" ? "cancelled" : undefined)

  const { info: _info, parts: _parts, ...rest } = flat as Record<string, any>
  const message: any = {
    ...rest,
    id,
    ...(sessionID ? { sessionID } : {}),
    role: flat.role,
    time: flat.time && typeof flat.time === "object" ? flat.time : { created: Date.now() },
    ...(error ? { error } : {}),
    ...(model ? { model } : {}),
    ...(stopReason ? { stopReason } : {}),
    content: parts,
  }
  // Plan 2：展示 DTO 的 text 同步剥离（部分消费方读 message.text 而非 parts）。
  if (message.role === "user" && typeof message.text === "string") {
    message.text = stripVoiceOriginMarker(message.text)
  }
  return { message, parts }
}

/** 历史页（`session.messages` 的 `data`）→ store 可写的消息 + parts 索引。 */
export function ingestHistoryPage(items: unknown, opts: IngestMessageOptions = {}): IngestedHistoryPage {
  const messages: any[] = []
  const parts: Record<string, any[]> = {}
  const list = Array.isArray(items) ? items : []
  list.forEach((item, index) => {
    const ingested = canonicalMessage(item, { ...opts, index, allowSyntheticId: true })
    if (!ingested) return
    messages.push(ingested.message)
    parts[ingested.message.id] = ingested.parts
  })
  return { messages, parts }
}

/**
 * live `message.updated`（gateway canonical `properties.message`）→ 规范消息。
 * 与历史共用同一归一器，live/history 同形。Task 14 起不再接受旧 wire
 * `properties.info`（event_log 旧帧已一次性迁移，出口无兼容层）。
 */
export function ingestLiveMessage(
  payload: any,
  opts: { sessionID: string },
): { message: any; parts: any[] } | null {
  // Ruling（Task 10 review）：live 无 id = 丢弃；兜底 id 只允许历史分页使用。
  return canonicalMessage(payload, { sessionID: opts.sessionID, allowSyntheticId: false })
}

/** live `part.updated` → 规范 part（身份 + 工具形状）。 */
export function ingestLivePart(part: any, sessionID: string): any {
  if (!part || typeof part !== "object") return part
  const messageID = typeof part.messageID === "string" && part.messageID ? part.messageID : ""
  const normalized = canonicalParts([part], { sessionID, messageID })[0]
  return normalized ?? part
}
