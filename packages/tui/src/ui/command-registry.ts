import { theme } from '../theme.ts'

/**
 * 命令注册表（Hermes COMMAND_REGISTRY 模式）：单表驱动 slash 补全、
 * /help 渲染、别名解析（未来 palette 复用同表）。
 * - destructive：破坏性操作（P4 接确认 modal，先标记）
 * - immediate：busy 时立即执行不排队（Claude Code 语义：/model 等）
 */

export const COMMAND_CATEGORIES = ['会话', '上下文', '模型', '输入', '帮助'] as const
export type CommandCategory = (typeof COMMAND_CATEGORIES)[number]

export interface CommandDef {
  name: string
  description: string
  category: CommandCategory
  aliases?: string[]
  /** 破坏性操作：会丢会话/历史状态，需要确认 */
  destructive?: boolean
  /** busy 期间立即执行（不排队） */
  immediate?: boolean
}

export const COMMAND_REGISTRY: CommandDef[] = [
  { name: 'new', description: '新话题（rotate manager session）', category: '会话', aliases: ['clear'], destructive: true },
  { name: 'sessions', description: '会话列表/切换（/resume /switch）', category: '会话', aliases: ['resume', 'switch'], immediate: true },
  { name: 'rename', description: '会话命名：/rename <标题>', category: '会话', immediate: true },
  { name: 'fork', description: '分叉当前会话（历史副本）', category: '会话', immediate: true },
  { name: 'status', description: '会话状态回顾（本地计算）', category: '会话', immediate: true },
  { name: 'queue', description: '排队消息管理（收回/丢弃）', category: '会话', aliases: ['q'], immediate: true },
  { name: 'btw', description: '支线问答：/btw <问题>', category: '会话' },
  { name: 'waitwhat', description: '没听懂：用简明语言+项目术语重述上一条回复', category: '会话', immediate: true },
  { name: 'compact', description: '压缩当前会话上下文', category: '上下文', destructive: true, immediate: true },
  { name: 'undo', description: '回退最后一轮对话', category: '上下文', destructive: true },
  { name: 'redo', description: '恢复上一次回退', category: '上下文', destructive: true },
  { name: 'older', description: '加载更早历史', category: '上下文', immediate: true },
  { name: 'verbose', description: '工具输出展开/折叠循环', category: '上下文', immediate: true },
  { name: 'focus', description: '静视图（隐藏工具输出）', category: '上下文', immediate: true },
  { name: 'diff', description: '查看 git 变更（/diff staged|all）', category: '上下文', immediate: true },
  { name: 'model', description: '选择模型（作用于后续消息）', category: '模型', immediate: true },
  { name: 'editor', description: '外部编辑器编辑输入（同 Ctrl+G）', category: '输入', immediate: true },
  { name: 'help', description: '快捷键帮助', category: '帮助', immediate: true },
]

/** 名字/别名 → 规范命令名；未知名 → null。 */
export function resolveCommand(name: string): string | null {
  for (const c of COMMAND_REGISTRY) {
    if (c.name === name) return c.name
    if (c.aliases?.includes(name)) return c.name
  }
  return null
}

/** 编辑器 slash 补全条目（chat-tab CombinedAutocompleteProvider 直接消费）。 */
export function autocompleteItems(): { name: string; description: string }[] {
  return COMMAND_REGISTRY.map((c) => ({ name: c.name, description: c.description }))
}

/** /help overlay 渲染行：按分类分组，破坏性命令带 ⚠。 */
export function helpLines(): string[] {
  const lines: string[] = []
  for (const cat of COMMAND_CATEGORIES) {
    const cmds = COMMAND_REGISTRY.filter((c) => c.category === cat)
    if (cmds.length === 0) continue
    lines.push(theme.accent(cat))
    for (const c of cmds) {
      const mark = c.destructive ? theme.warn(' ⚠') : ''
      lines.push(`  /${c.name.padEnd(10)}${c.description}${mark}`)
    }
    lines.push('')
  }
  return lines
}
