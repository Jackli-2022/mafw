/** gateway 远端命令 → 桌面 mafw 组 CommandItem（纯函数可测）。 */
export interface RemoteCommandDef {
  name: string
  aliases?: string[]
  description: string
  argumentHint?: string
  category: string
  destructive?: boolean
  kind: 'builtin' | 'custom'
}

export interface MergedCommandItem {
  id: string
  trigger: string
  title: string
  description: string
  group: 'mafw'
  source: 'builtin'
}

export function mergeRemoteCommands(remote: RemoteCommandDef[]): { items: MergedCommandItem[]; names: Set<string> } {
  const items: MergedCommandItem[] = []
  const names = new Set<string>()
  for (const r of remote) {
    items.push({
      id: `mafw-${r.name}`,
      trigger: `/${r.name}`,
      title: r.description,
      description: r.argumentHint ? r.argumentHint : (r.kind === 'custom' ? '自定义命令' : 'MAFW 命令'),
      group: 'mafw',
      source: 'builtin',
    })
    names.add(r.name)
    for (const a of r.aliases ?? []) names.add(a)
  }
  return { items, names }
}
