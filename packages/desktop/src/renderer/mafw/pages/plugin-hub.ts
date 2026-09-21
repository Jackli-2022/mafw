export type PluginType = "runtime" | "media" | "usage" | "ui"
export type PluginStatus = "enabled" | "disabled" | "error" | "config-disabled"

export interface HubEntry {
  type: PluginType
  name: string
  file: string
  status: PluginStatus
  error?: string
  size: number
  mtime: string
  builtin?: boolean
  overridden?: boolean
  pluginType?: string
}

const TYPE_ORDER: PluginType[] = ["runtime", "media", "usage", "ui"]

const STATUS_LABEL: Record<PluginStatus, string> = {
  enabled: "已启用",
  disabled: "已禁用",
  error: "错误",
  "config-disabled": "config 禁用",
}

export function statusLabel(entry: HubEntry): string {
  return STATUS_LABEL[entry.status]
}

export function installableTypes(): PluginType[] {
  return [...TYPE_ORDER]
}

const TYPE_META: Record<PluginType, { label: string; icon: string }> = {
  runtime: { label: "Runtime", icon: "settings-gear" },
  media: { label: "Media", icon: "video" },
  usage: { label: "Usage", icon: "chart-bar" },
  ui: { label: "UI", icon: "shapes" },
}

export function typeMeta(type: PluginType): { label: string; icon: string } {
  return TYPE_META[type]
}

export interface HubGroup {
  type: PluginType
  entries: HubEntry[]
}

/** Groups entries by type in the fixed TYPE_ORDER, entries sorted by name
 * within each group; empty types are omitted. Input is not mutated. */
export function groupEntries(entries: HubEntry[]): HubGroup[] {
  const sorted = sortEntries(entries)
  const groups: HubGroup[] = []
  for (const e of sorted) {
    const last = groups[groups.length - 1]
    if (last && last.type === e.type) last.entries.push(e)
    else groups.push({ type: e.type, entries: [e] })
  }
  return groups
}

export function sortEntries(entries: HubEntry[]): HubEntry[] {
  return [...entries].sort((a, b) => {
    const t = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
    if (t !== 0) return t
    return a.name.localeCompare(b.name)
  })
}

/** A runtime hub entry can be activated via /api/runtime/switch when it is an
 * enabled plugin file that is not already the active runtime. */
export function runtimeActivatable(entry: HubEntry, activeName: string | null | undefined): boolean {
  return entry.type === "runtime" && entry.status === "enabled" && entry.name !== (activeName ?? "opencode")
}

/** Extracts the candidate type list from a gateway `ambiguous plugin interface` install error. */
export function parseAmbiguousCandidates(message: string): string[] | null {
  const prefix = "ambiguous plugin interface: "
  if (!message.startsWith(prefix)) return null
  const rest = message.slice(prefix.length).trim()
  const candidates = rest.split("/").map((s) => s.trim()).filter(Boolean)
  return candidates.length > 0 ? candidates : null
}

/** Human-readable plugin file size ("512 B" / "1.5 KB"). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/** Badge text for builtin hub entries ("" for user file entries). */
export function builtinMeta(e: HubEntry): string {
  if (!e.builtin) return ""
  const parts = ["内置"]
  if (e.type === "usage" && e.pluginType) parts.push(e.pluginType)
  if (e.overridden) parts.push("被覆盖")
  return parts.join(" · ")
}
