/** gateway 远端命令合并（本地优先；撞名/撞别名丢弃远端）。 */
import type { CommandDef, CommandCategory } from './command-registry.ts'

export interface RemoteCommand {
  name: string
  aliases?: string[]
  description: string
  argumentHint?: string
  category: string
  destructive?: boolean
  kind: 'builtin' | 'custom'
}

const REMOTE_CATEGORY_MAP: Record<string, CommandCategory> = {
  goals: '会话',
  session: '会话',
  memory: '自定义',
  custom: '自定义',
}

export function mergeCommands(local: CommandDef[], remote: RemoteCommand[]): CommandDef[] {
  const taken = new Set<string>()
  for (const c of local) {
    taken.add(c.name)
    for (const a of c.aliases ?? []) taken.add(a)
  }
  const out = [...local]
  for (const r of remote) {
    if (taken.has(r.name) || (r.aliases ?? []).some((a) => taken.has(a))) continue
    out.push({
      name: r.name,
      description: r.description,
      argumentHint: r.argumentHint,
      category: REMOTE_CATEGORY_MAP[r.category] ?? '自定义',
      aliases: r.aliases,
      destructive: r.destructive,
      gateway: true,
    })
  }
  return out
}
