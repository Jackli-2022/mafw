/** Chat slash 命令表与派发（app.ts 注入实现，此处纯逻辑可单测）。 */

export interface SlashDeps {
  loadOlder(): Promise<void>
  toggleHelp(): void
  /** /new：rotate manager session；返回提示文本或 null。 */
  rotateTopic(): Promise<string | null>
  /** /btw：支线问答；返回提示文本或 null（回答经 /api/mafw-commands 异步送达）。 */
  btw(args: string): Promise<string | null>
  /** /sessions（别名 /resume /switch）：会话列表切换 picker。 */
  showSessionPicker(): Promise<void>
  /** /model：模型选择 picker（选择后作用于后续 promptAsync）。 */
  showModelPicker(): Promise<void>
  /** /compact：压缩当前会话；返回错误文本或 null。 */
  compact(): Promise<string | null>
  /** /undo：回退最后一轮；返回错误文本或 null。 */
  undo(): Promise<string | null>
  /** /redo：恢复上一次回退；返回错误文本或 null。 */
  redo(): Promise<string | null>
  /** /editor（Ctrl+G 同款）：外部编辑器编辑当前输入。 */
  openExternalEditor(): Promise<void>
}

export const SLASH_COMMANDS: { name: string; description: string }[] = [
  { name: 'new', description: '新话题（rotate manager session）' },
  { name: 'btw', description: '支线问答：/btw <问题>' },
  { name: 'older', description: '加载更早历史' },
  { name: 'sessions', description: '会话列表/切换（别名 /resume /switch）' },
  { name: 'model', description: '选择模型（作用于后续消息）' },
  { name: 'compact', description: '压缩当前会话上下文' },
  { name: 'undo', description: '回退最后一轮对话' },
  { name: 'redo', description: '恢复上一次回退' },
  { name: 'editor', description: '外部编辑器编辑输入（同 Ctrl+G）' },
  { name: 'help', description: '快捷键帮助' },
]

const ALIASES: Record<string, string> = { resume: 'sessions', switch: 'sessions', clear: 'new' }

export function createSlashHandler(deps: SlashDeps): (cmd: string, args: string) => Promise<string | null> {
  return async (rawCmd: string, args: string): Promise<string | null> => {
    const cmd = ALIASES[rawCmd] ?? rawCmd
    switch (cmd) {
      case 'help':
        deps.toggleHelp()
        return null
      case 'older':
        await deps.loadOlder()
        return null
      case 'new':
        return deps.rotateTopic()
      case 'btw':
        return deps.btw(args)
      case 'sessions':
        await deps.showSessionPicker()
        return null
      case 'model':
        await deps.showModelPicker()
        return null
      case 'compact':
        return deps.compact()
      case 'undo':
        return deps.undo()
      case 'redo':
        return deps.redo()
      case 'editor':
        await deps.openExternalEditor()
        return null
      default:
        return `未知命令 /${rawCmd}（可用: ${SLASH_COMMANDS.map((c) => `/${c.name}`).join(' ')}）`
    }
  }
}
