// Task 12: pure view model for the unified plugin-package management section.
//
// Inputs are the Hub inventory (`GET /api/plugins` packages[]), the committed
// client descriptors and Desktop diagnostics. Outputs are plain data for Solid
// components: row status, revision badges, contribution badges, action
// availability, install previews and confirmation copy.
//
// No Solid/DOM/Electron/plugin code is imported, so every decision is unit
// testable headlessly. Renderer stays on named preload methods; this module
// never touches the filesystem.
import type { PluginsPackageEntry, PluginCheckResult } from "@mafw/sdk"
import type { PluginClientDescriptor } from "@mafw/plugin-contract"

export type PackageStatus = "active" | "pending" | "error" | "disabled"

export interface PackageContributionBadge {
  key: string
  label: string
}

export interface PackageActionFlags {
  apply: boolean
  reload: boolean
  disable: boolean
  enable: boolean
  remove: boolean
  config: boolean
  reveal: boolean
}

export interface PackageNotice {
  level: "error" | "warning" | "info"
  message: string
  code?: string
  package?: string
}

export interface PackageDiagnostic {
  level: "error" | "warning" | "info"
  message: string
  code: string
}

export interface PackageRowView {
  name: string
  version?: string
  source: string
  status: PackageStatus
  statusLabel: string
  enabled: boolean
  activeRevision?: string
  pendingRevision?: string
  error?: string
  pendingReason?: string
  retainsActiveRevision: boolean
  contributions: PackageContributionBadge[]
  actions: PackageActionFlags
  diagnostics: PackageDiagnostic[]
  descriptor?: PluginClientDescriptor
}

export interface OverwriteDiff {
  added: string[]
  removed: string[]
  unchanged: string[]
  existingVersion?: string
  nextVersion?: string
  replacesActive: boolean
  existingActiveRevision?: string
}

export interface InstallPreview {
  status: "ready" | "invalid"
  name?: string
  version?: string
  error?: string
  contributions: string[]
  overwrite: boolean
  diff?: OverwriteDiff
}

export interface ConfirmationRequest {
  title: string
  message?: string
  confirmLabel: string
  danger: boolean
}

export type InstallPickResult =
  | { status: "selected"; path: string }
  | { status: "cancelled" }
  | { status: "failed"; error: string }

const STATUS_LABEL: Record<PackageStatus, string> = {
  active: "已启用",
  pending: "待应用",
  error: "错误",
  disabled: "已禁用",
}

const LEGACY_CONTRIBUTIONS: Record<string, string> = {
  runtime: "Runtime",
  media: "媒体",
  usage: "用量",
  tts: "语音",
  tools: "工具",
  ui: "UI",
}

// ---------------------------------------------------------------------------
// Row status / contributions
// ---------------------------------------------------------------------------

export function packageStatus(row: PluginsPackageEntry): PackageStatus {
  const enabled = row.enabled !== false && row.status !== "disabled"
  if (!enabled) return "disabled"
  if (row.status === "error" || (typeof row.error === "string" && row.error.length > 0)) {
    return "error"
  }
  if (typeof row.pendingRevision === "string" && row.pendingRevision.length > 0) {
    return "pending"
  }
  return "active"
}

export function packageStatusLabel(status: PackageStatus): string {
  return STATUS_LABEL[status]
}

export function retainsActiveRevision(
  row: Pick<PluginsPackageEntry, "status" | "revision">,
): boolean {
  return row.status === "error" && typeof row.revision === "string" && row.revision.length > 0
}

export function pendingApplyVisible(
  row: Pick<PluginsPackageEntry, "enabled" | "status" | "pendingRevision">,
): boolean {
  if (row.enabled === false || row.status === "disabled") return false
  return typeof row.pendingRevision === "string" && row.pendingRevision.length > 0
}

function countLabel(label: string, count: number): string {
  return count > 1 ? `${label} ×${count}` : label
}

export function contributionBadges(
  row: PluginsPackageEntry,
  descriptor: PluginClientDescriptor | undefined,
): PackageContributionBadge[] {
  const badges: PackageContributionBadge[] = []
  const seen = new Set<string>()
  const push = (key: string, label: string) => {
    if (seen.has(key)) return
    seen.add(key)
    badges.push({ key, label })
  }

  const ui = descriptor?.ui
  if (ui) {
    const panels = ui.panels?.length ?? 0
    if (panels > 0) push("panel", countLabel("面板", panels))
    const configPages = ui.configPages?.length ?? 0
    if (configPages > 0) push("config-page", countLabel("配置页", configPages))
    const toolCards = ui.toolCards?.length ?? 0
    if (toolCards > 0) push("tool-card", countLabel("工具卡", toolCards))
    const windows = ui.messageWindows?.length ?? 0
    if (windows > 0) push("message-window", countLabel("小窗", windows))
  }
  const actions = descriptor?.actions?.length ?? 0
  if (actions > 0) push("action", countLabel("动作", actions))
  const events = descriptor?.events?.length ?? 0
  if (events > 0) push("event", countLabel("事件", events))

  for (const kind of row.contributions ?? []) {
    if (typeof kind !== "string") continue
    const label = LEGACY_CONTRIBUTIONS[kind]
    if (!label) continue
    push(kind, label)
  }
  return badges
}

export function packageActions(
  row: PluginsPackageEntry,
  descriptor?: PluginClientDescriptor,
): PackageActionFlags {
  const enabled = row.enabled !== false && row.status !== "disabled"
  const configPages = descriptor?.ui.configPages?.length ?? 0
  return {
    apply: pendingApplyVisible(row),
    reload: enabled,
    disable: enabled,
    enable: !enabled,
    remove: true,
    config: enabled && configPages > 0,
    reveal: typeof row.source === "string" && row.source.length > 0,
  }
}

// ---------------------------------------------------------------------------
// Row assembly
// ---------------------------------------------------------------------------

export function packageDiagnosticsFor(
  row: Pick<PluginsPackageEntry, "name" | "error">,
  notices: readonly PackageNotice[],
): PackageDiagnostic[] {
  const out: PackageDiagnostic[] = []
  const seen = new Set<string>()
  const messages = new Set<string>()
  for (const notice of notices) {
    if (!notice || notice.package !== row.name) continue
    if (typeof notice.message !== "string" || notice.message.length === 0) continue
    const code = typeof notice.code === "string" && notice.code.length > 0 ? notice.code : "diagnostic"
    const key = `${code}|${notice.message}`
    if (seen.has(key)) continue
    seen.add(key)
    messages.add(notice.message)
    out.push({ level: notice.level, message: notice.message, code })
  }
  if (typeof row.error === "string" && row.error.length > 0 && !messages.has(row.error)) {
    out.unshift({ level: "error", message: row.error, code: "package" })
  }
  return out
}

export function buildPackageRows(
  inventory: readonly PluginsPackageEntry[] | null | undefined,
  descriptors: readonly PluginClientDescriptor[],
  notices: readonly PackageNotice[],
): PackageRowView[] {
  const descriptorByName = new Map<string, PluginClientDescriptor>()
  for (const descriptor of descriptors) {
    if (descriptor && typeof descriptor.name === "string") {
      descriptorByName.set(descriptor.name, descriptor)
    }
  }

  const rows = new Map<string, PluginsPackageEntry>()
  for (const entry of inventory ?? []) {
    if (!entry || typeof entry.name !== "string" || entry.name.length === 0) continue
    rows.set(entry.name, entry)
  }
  // A committed descriptor always has an inventory row in practice; keep it
  // visible defensively instead of silently dropping an active package.
  for (const [name, descriptor] of descriptorByName) {
    if (rows.has(name)) continue
    rows.set(name, {
      name,
      source: "",
      status: "ok",
      enabled: true,
      contributions: [],
      version: descriptor.version,
      revision: descriptor.revision,
    })
  }

  const views: PackageRowView[] = []
  for (const entry of rows.values()) {
    const descriptor = descriptorByName.get(entry.name)
    const status = packageStatus(entry)
    const pendingRevision =
      typeof entry.pendingRevision === "string" && entry.pendingRevision.length > 0
        ? entry.pendingRevision
        : undefined
    const view: PackageRowView = {
      name: entry.name,
      source: entry.source,
      status,
      statusLabel: packageStatusLabel(status),
      enabled: entry.enabled !== false && entry.status !== "disabled",
      contributions: contributionBadges(entry, descriptor),
      actions: packageActions(entry, descriptor),
      retainsActiveRevision: retainsActiveRevision(entry),
      diagnostics: packageDiagnosticsFor(entry, notices),
    }
    if (typeof entry.version === "string" && entry.version.length > 0) view.version = entry.version
    if (typeof entry.revision === "string" && entry.revision.length > 0) {
      view.activeRevision = entry.revision
    }
    if (pendingRevision) {
      view.pendingRevision = pendingRevision
      view.pendingReason = "候选版本已暂存，应用后才会替换当前运行版本。"
    }
    if (typeof entry.error === "string" && entry.error.length > 0) view.error = entry.error
    if (descriptor) view.descriptor = descriptor
    views.push(view)
  }
  return views.sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Install preview
// ---------------------------------------------------------------------------

function normalizeContributionList(value: readonly unknown[] | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value ?? []) {
    if (typeof item !== "string" || item.length === 0 || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

export function planInstallPreview(
  inventory: readonly PluginsPackageEntry[] | null | undefined,
  check: PluginCheckResult | null | undefined,
): InstallPreview {
  if (!check) {
    return {
      status: "invalid",
      error: "尚未检查插件包",
      contributions: [],
      overwrite: false,
    }
  }
  if (check.ok !== true) {
    return {
      status: "invalid",
      ...(typeof check.name === "string" && check.name.length > 0 ? { name: check.name } : {}),
      error:
        typeof check.error === "string" && check.error.length > 0
          ? check.error
          : "插件包检查失败",
      contributions: [],
      overwrite: false,
    }
  }
  const name = typeof check.name === "string" ? check.name : ""
  if (name.length === 0) {
    return {
      status: "invalid",
      error: "检查结果缺少插件包名称",
      contributions: [],
      overwrite: false,
    }
  }

  const lower = name.toLowerCase()
  const existing = (inventory ?? []).find(
    (entry) => typeof entry?.name === "string" && entry.name.toLowerCase() === lower,
  )
  const nextContributions = normalizeContributionList(check.contributions)
  const preview: InstallPreview = {
    status: "ready",
    name,
    ...(typeof check.version === "string" && check.version.length > 0
      ? { version: check.version }
      : {}),
    contributions: nextContributions,
    overwrite: Boolean(existing),
  }
  if (!existing) return preview

  const currentContributions = normalizeContributionList(existing.contributions)
  const current = new Set(currentContributions)
  const next = new Set(nextContributions)
  preview.diff = {
    added: nextContributions.filter((item) => !current.has(item)),
    removed: currentContributions.filter((item) => !next.has(item)),
    unchanged: currentContributions.filter((item) => next.has(item)),
    existingVersion: existing.version,
    nextVersion: check.version,
    replacesActive: existing.enabled !== false && existing.status !== "disabled",
    existingActiveRevision: existing.revision,
  }
  return preview
}

export function installConfirmation(preview: InstallPreview): ConfirmationRequest | null {
  if (preview.status !== "ready" || !preview.overwrite || !preview.name) return null
  const diff = preview.diff
  const parts: string[] = []
  if (diff) {
    parts.push(
      `版本：${diff.existingVersion ?? "未知"} → ${diff.nextVersion ?? "未知"}`,
    )
    if (diff.added.length > 0) parts.push(`新增贡献：${diff.added.join(", ")}`)
    if (diff.removed.length > 0) parts.push(`移除贡献：${diff.removed.join(", ")}`)
    if (diff.added.length === 0 && diff.removed.length === 0) parts.push("贡献声明无变化")
    if (diff.existingActiveRevision) {
      parts.push(`当前运行 revision ${diff.existingActiveRevision} 将被替换`)
    }
  }
  parts.push("提交失败时会保留已安装版本")
  return {
    title: `覆盖安装插件包 ${preview.name}？`,
    message: parts.join("；"),
    confirmLabel: "覆盖安装",
    danger: true,
  }
}

// ---------------------------------------------------------------------------
// Directory picker + confirmations
// ---------------------------------------------------------------------------

export function installPickResult(
  result: { path?: string | null; error?: string } | null | undefined,
): InstallPickResult {
  if (!result) return { status: "cancelled" }
  if (typeof result.error === "string" && result.error.length > 0) {
    return { status: "failed", error: result.error }
  }
  const path = typeof result.path === "string" ? result.path : ""
  if (path.length === 0) return { status: "cancelled" }
  return { status: "selected", path }
}

export function deleteConfirmation(
  row: Pick<PackageRowView, "name" | "activeRevision">,
): ConfirmationRequest {
  const revision = row.activeRevision ? ` 当前运行 revision：${row.activeRevision}。` : ""
  return {
    title: `删除插件包 ${row.name}？`,
    message: `将移除包文件和全部贡献，此操作不可恢复。${revision}`,
    confirmLabel: "删除",
    danger: true,
  }
}

export function disableConfirmation(
  row: Pick<PackageRowView, "name">,
): ConfirmationRequest {
  return {
    title: `停用插件包 ${row.name}？`,
    message: "停用后其面板、配置页、工具卡和小窗会立即移除；包文件和已安装版本会保留，可随时重新启用。",
    confirmLabel: "停用",
    danger: false,
  }
}

export function enableConfirmation(row: Pick<PackageRowView, "name">): ConfirmationRequest {
  return {
    title: `启用插件包 ${row.name}？`,
    message: "启用后会重新加载该插件包，并在提交成功后恢复其贡献。",
    confirmLabel: "启用",
    danger: false,
  }
}
