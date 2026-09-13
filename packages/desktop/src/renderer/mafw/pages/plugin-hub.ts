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
