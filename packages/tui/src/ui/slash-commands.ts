/** Chat slash 命令派发（app.ts 注入实现，此处纯逻辑可单测）。
 * 命令表与别名解析收敛在 command-registry.ts（COMMAND_REGISTRY 单表驱动补全/help/派发）。 */
import { COMMAND_REGISTRY, resolveCommand } from './command-registry.ts'

/** 兼容导出：命令表真源在 command-registry.ts。 */
export const SLASH_COMMANDS = COMMAND_REGISTRY

export interface SlashDeps {
  loadOlder(): Promise<void>
  toggleHelp(): void
  /** /new：rotate manager session；返回提示文本或 null。 */
  rotateTopic(): Promise<string | null>
  /** /btw：支线问答；返回提示文本或 null（回答经 /api/mafw-commands 异步送达）。 */
  btw(args: string): Promise<string | null>
  /** /sessions（别名 /resume /switch）：会话列表切换 picker。 */
  showSessionPicker(): Promise<void>
  /** /queue（别名 /q）：排队消息管理 overlay。 */
  showQueueManager(): Promise<void>
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
  /** /verbose：工具输出展开/折叠循环；返回新状态。 */
  cycleVerbosity(): 'all' | 'off'
  /** /focus：静视图开关；返回新状态。 */
  toggleFocus(): boolean
  /** /diff [staged|all]：git 变更视图；返回错误文本或 null。 */
  showDiff(scope: string): Promise<string | null>
  /** /rename <标题>：会话命名；返回提示文本或 null。 */
  rename(args: string): Promise<string | null>
  /** /fork：分叉当前会话并切换；返回提示文本或 null。 */
  fork(): Promise<string | null>
  /** /status：本地会话回顾 overlay。 */
  showStatusRecap(): void
  /** /waitwhat：简明重述上一条回复；返回错误文本或 null（重述经 SSE 送达）。 */
  waitwhat(): Promise<string | null>
  /** gateway 远端命令派发（本地注册表未命中时）；返回提示文本或 null。 */
  runGatewayCommand(name: string, args: string): Promise<string | null>
  /** 当前可见的 gateway 命令（确认门查 destructive 用）。 */
  gatewayCommands(): { name: string; aliases?: string[]; destructive?: boolean }[]
  /** /export：导出会话为 Markdown；返回提示文本。 */
  exportChat(): Promise<string | null>
  /** /copy [N]：复制第 N 近回复到剪贴板；返回提示文本。 */
  copyReply(n: number): string
}


export function createSlashHandler(deps: SlashDeps): (cmd: string, args: string) => Promise<string | null> {
  return async (rawCmd: string, args: string): Promise<string | null> => {
    const cmd = resolveCommand(rawCmd) ?? rawCmd
    switch (cmd) {
      case 'help':
        deps.toggleHelp()
        return null
      case 'older':
        await deps.loadOlder()
        return null
      case 'verbose':
        return `工具输出: ${deps.cycleVerbosity() === 'all' ? '展开' : '折叠'}（单击 tool 块可单独切换）`
      case 'focus':
        return deps.toggleFocus() ? '静视图已开启（/focus off 恢复）' : '静视图已关闭'
      case 'diff':
        return deps.showDiff(args.trim())
      case 'new':
        return deps.rotateTopic()
      case 'btw':
        return deps.btw(args)
      case 'sessions':
        await deps.showSessionPicker()
        return null
      case 'rename':
        return deps.rename(args)
      case 'fork':
        return deps.fork()
      case 'status':
        deps.showStatusRecap()
        return null
      case 'waitwhat':
        return deps.waitwhat()
      case 'queue':
        await deps.showQueueManager()
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
      case 'export':
        return deps.exportChat()
      case 'copy': {
        const n = parseInt(args.trim(), 10)
        return deps.copyReply(Number.isNaN(n) || n < 1 ? 1 : n)
      }
      default: {
        const gw = deps.gatewayCommands().find((c) => c.name === cmd || c.aliases?.includes(cmd))
        if (gw) return deps.runGatewayCommand(gw.name, args)
        return `未知命令 /${rawCmd}（可用: ${COMMAND_REGISTRY.map((c) => `/${c.name}`).join(' ')} …）`
      }
    }
  }
}
