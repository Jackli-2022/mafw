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

export interface DiscoveryCommandLike {
  name?: string
  source?: string
}

/**
 * discovery DTO 的 commands → 桌面 custom 组。
 *
 * `source: 'mafw' | 'custom'` 都已在 `mafwCommands.list()`（MAFW 命令注册表）里，
 * 若再进 custom 组会在选择器里出现两份。只收 runtime 命令，并按远端名称/已见
 * 名称（大小写不敏感）去重。
 */
export function mergeDiscoveryCommands(
  commands: ReadonlyArray<DiscoveryCommandLike | null | undefined> | undefined,
  reserved: ReadonlySet<string> = new Set(),
  seen: Set<string> = new Set(),
): Array<{ name: string; source: string }> {
  const reservedLower = new Set([...reserved].map((name) => name.toLowerCase()))
  const out: Array<{ name: string; source: string }> = []
  for (const command of commands ?? []) {
    const name = typeof command?.name === 'string' ? command.name : ''
    if (!name) continue
    if (command?.source === 'mafw' || command?.source === 'custom') continue
    const lower = name.toLowerCase()
    if (reservedLower.has(lower) || seen.has(lower)) continue
    seen.add(lower)
    out.push({ name, source: command?.source === 'runtime' ? 'command' : (command?.source || 'command') })
  }
  return out
}
