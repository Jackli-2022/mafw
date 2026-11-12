export type ChatMode = "discuss" | "propose" | "delegate" | "resolve"
export type ChatModeAvailability = Record<ChatMode, boolean>

export const CHAT_MODE_ITEMS: readonly {
  id: ChatMode
  label: string
  hint: string
}[] = [
  { id: "discuss", label: "讨论", hint: "自由讨论，不承诺" },
  { id: "propose", label: "提议", hint: "给出选项、取舍与建议" },
  { id: "delegate", label: "委托", hint: "预览并确认一个 Goal" },
  { id: "resolve", label: "解决", hint: "处理评审项 / 决定，Agent 不代做" },
]

const DIRECTIVES: Record<ChatMode, string | null> = {
  discuss: null,
  propose: "[[mode:propose]] 请给出至少两个选项、取舍、风险与建议；不要直接执行。",
  delegate: null,
  resolve: null,
}

const ACTION_LABELS: Record<ChatMode, string> = {
  discuss: "发送",
  propose: "提议",
  delegate: "委托",
  resolve: "去处理",
}

/** 只把模式指令作为 synthetic part；不修改用户正文。 */
export function modeDirective(mode: ChatMode): string | null {
  return DIRECTIVES[mode]
}

/** discuss / propose 发送消息；delegate / resolve 只打开对应表面。 */
export function modeSendsMessage(mode: ChatMode): boolean {
  return mode === "discuss" || mode === "propose"
}

export function modeActionLabel(mode: ChatMode): string {
  return ACTION_LABELS[mode]
}

export function modeAvailability(input: {
  canDelegate: boolean
  canResolve: boolean
}): ChatModeAvailability {
  return {
    discuss: true,
    propose: true,
    delegate: input.canDelegate,
    resolve: input.canResolve,
  }
}
