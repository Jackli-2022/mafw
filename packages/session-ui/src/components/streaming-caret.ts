// packages/session-ui/src/components/streaming-caret.ts
// 流式尾光标的判定（纯逻辑）：
// - 只有 assistant 消息未完成时才可能有光标；
// - part 自身有 end 时间 → 已结束，不显示；
// - **只有消息的最后一个 part** 显示——历史 part 没有 time.end，
//   消息级 completed 未到时会误把每个 text 段都当成流式中（v5.1 闪烁绿块 bug 根因）。
export interface StreamingCaretInput {
  role: string
  messageCompleted?: number | null
  partEnd?: number | null
  /** 该 part 是否是当前消息 parts 数组的最后一个。 */
  isTailPart: boolean
}

export function shouldShowStreamingCaret(input: StreamingCaretInput): boolean {
  if (input.role !== "assistant") return false
  if (typeof input.messageCompleted === "number") return false
  if (typeof input.partEnd === "number") return false
  return input.isTailPart === true
}
