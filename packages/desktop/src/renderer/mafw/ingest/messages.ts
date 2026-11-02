// 摄取层：flat 历史/SSE 消息 → 桌面 store 的规范记录。
//
// 输入只认 MAFW flat `MafwMessage`（`content: MafwPart[]`）；旧 `{info,parts}`
// 信封仅在此处兼容展开（渲染层永远看不到 `info`/`parts`）。所有多形状
// （错误、工具输出、文件 diff、task 子会话、step-finish→stopReason）在这里
// 收敛，session-ui 只读规范形。
import { canonicalMessageError, type CanonicalMessageError } from "./errors"
import { canonicalToolPart } from "./parts"

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
}

function fallbackId(prefix: string, opts: IngestMessageOptions): string {
  return `${prefix}-${opts.sessionID ?? "session"}-${opts.index ?? 0}`
}

/** 旧 wire 信封（{info,parts}）→ flat 形状；flat 原样返回。 */
function flatMessage(raw: any): any {
  if (!raw || typeof raw !== "object") return raw
  if (raw.info && typeof raw.info === "object") {
    const parts = Array.isArray(raw.parts)
      ? raw.parts
      : Array.isArray(raw.info.parts)
        ? raw.info.parts
        : undefined
    return parts ? { ...raw.info, content: parts } : { ...raw.info }
  }
  return raw
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
  const flat = flatMessage(raw)
  if (!flat || typeof flat !== "object") return null
  const isSynthetic = flat.type === "synthetic" || (flat.role == null && flat.metadata?.source)
  if (flat.role !== "user" && flat.role !== "assistant" && !isSynthetic) return null
  const sessionID = typeof flat.sessionID === "string" && flat.sessionID
    ? flat.sessionID
    : (opts.sessionID ?? "")
  const id = typeof flat.id === "string" && flat.id ? flat.id : fallbackId("msg", opts)
  const rawParts = Array.isArray(flat.content)
    ? flat.content
    : Array.isArray(flat.parts)
      ? flat.parts
      : []
  const parts = canonicalParts(rawParts, { sessionID, messageID: id })
  const error: CanonicalMessageError | undefined = canonicalMessageError(flat.error)
  const nativeModel =
    flat.model && typeof flat.model === "object"
      ? flat.model
      : typeof flat.modelID === "string" && typeof flat.providerID === "string"
        ? { providerID: flat.providerID, modelID: flat.modelID }
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
  return { message, parts }
}

/** 历史页（`session.history` 的 `data`）→ store 可写的消息 + parts 索引。 */
export function ingestHistoryPage(items: unknown, opts: IngestMessageOptions = {}): IngestedHistoryPage {
  const messages: any[] = []
  const parts: Record<string, any[]> = {}
  const list = Array.isArray(items) ? items : []
  list.forEach((item, index) => {
    const ingested = canonicalMessage(item, { ...opts, index })
    if (!ingested) return
    messages.push(ingested.message)
    parts[ingested.message.id] = ingested.parts
  })
  return { messages, parts }
}

/**
 * live `message.updated`（gateway canonical `properties.message` / 过渡期 wire
 * `properties.info`）→ 规范消息。与历史共用同一归一器，live/history 同形。
 */
export function ingestLiveMessage(
  payload: any,
  opts: { sessionID: string },
): { message: any; parts: any[] } | null {
  return canonicalMessage(payload, { sessionID: opts.sessionID })
}

/** live `part.updated` → 规范 part（身份 + 工具形状）。 */
export function ingestLivePart(part: any, sessionID: string): any {
  if (!part || typeof part !== "object") return part
  const messageID = typeof part.messageID === "string" && part.messageID ? part.messageID : ""
  const normalized = canonicalParts([part], { sessionID, messageID })[0]
  return normalized ?? part
}
