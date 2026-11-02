/**
 * Chat 事件派发（Task 12 review I2）。
 *
 * `ConnectionStore` 只负责把白名单事件送达；**真正喂给 ChatStore 的接线**在这里，
 * 由 app 的 `onEvent` 调用。此前 `applyEvent` 没有生产调用方，live 流式与工具卡
 * 只能等历史重载才出现。
 */
export const CHAT_EVENT_TYPES = [
  'part.updated',
  'part.delta',
  'turn.completed',
  'turn.failed',
  'turn.aborted',
] as const

export type ChatEventType = typeof CHAT_EVENT_TYPES[number]

export function isChatEvent(type: string): type is ChatEventType {
  return (CHAT_EVENT_TYPES as readonly string[]).includes(type)
}

/**
 * 把 chat 域 canonical 事件交给 ChatStore；返回 true = 已消费（调用方可据此
 * 跳过其他分支，并保留 turn.completed 的用量刷新等附带副作用）。
 */
export function dispatchChatEvent(
  store: { applyEvent(type: string, data: any): void },
  type: string,
  data: any,
): boolean {
  if (!isChatEvent(type)) return false
  store.applyEvent(type, data)
  return true
}
