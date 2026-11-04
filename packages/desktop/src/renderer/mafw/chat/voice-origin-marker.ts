// 语音来源标记（Plan 2 D3）：让模型知道这条消息来自 duplex ASR 实时转写，并要求
// 以 mafw_media_speak 语音回复。桌面展示面不得出现该标记——空闲路径作为 synthetic
// text part 走「首个非 synthetic part」隐藏规则；忙时 steer/网关队列内联进文本，
// 队列条显示经 stripVoiceOriginMarker 剥离。
// 标记必须单行且以 `[语音输入] ` 开头（行首判定 + 整行剥离都依赖此前缀）。
export const VOICE_ORIGIN_MARKER_TEXT =
  "[语音输入] 本消息来自用户的实时语音转写。请用简短、口语化的中文回答（避免表格与长代码），回答完成后调用 mafw_media_speak 工具把回答合成语音播报给用户。"

/** 是否存在标记（仅认行首出现，正文/缩进出现不算，防误伤用户文本）。 */
export function hasVoiceOriginMarker(text: string): boolean {
  if (!text) return false
  return text.split("\n").some((line) => line.startsWith("[语音输入]"))
}

/**
 * 剥离所有标记行（含尾随空白）；无标记时原样返回。
 * 行级处理而非正则，避免把正文中出现的 `[语音输入]` 字样误删。
 */
export function stripVoiceOriginMarker(text: string): string {
  if (!hasVoiceOriginMarker(text)) return text
  const kept = text.split("\n").filter((line) => !line.startsWith("[语音输入]"))
  return kept.join("\n").replace(/\n+$/, "")
}

/** 把标记作为独立段落追加到文本（幂等：已有标记原样返回）。 */
export function appendVoiceOriginMarker(text: string): string {
  if (hasVoiceOriginMarker(text)) return text
  return text ? `${text}\n\n${VOICE_ORIGIN_MARKER_TEXT}` : VOICE_ORIGIN_MARKER_TEXT
}
