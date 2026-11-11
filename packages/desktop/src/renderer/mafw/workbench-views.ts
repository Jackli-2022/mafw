// Plan D1: the right workbench is a context stack, not four tool tabs.
// Context answers “what am I looking at”; L2 surfaces answer “which tool”.
//
// Task 8：L2 surface 从封闭三值扩展为「内置三值 + 插件面板动态 tab」。
// 插件 surface id 固定为 `plugin:<package>:<panel>`，与插件包/面板 id 的
// 字符集（NAME_PATTERN）一致，因此可直接持久化到 localStorage。
import {
  normalizeWorkbenchContext,
  workbenchContextFromLegacyView,
  type WorkbenchContext,
} from "./workbench-context"

export type BuiltinWorkbenchSurface = "code" | "browser" | "terminal"
export type PluginSurfaceId = `plugin:${string}`
export type WorkbenchSurface = BuiltinWorkbenchSurface | PluginSurfaceId
export type ExecutionSection = "overview" | "pod" | "todos" | "subagents" | "background" | "trajectory"

const PLUGIN_SURFACE_PATTERN = /^plugin:([A-Za-z0-9][A-Za-z0-9._-]*):([A-Za-z0-9][A-Za-z0-9._-]*)$/

export function pluginSurfaceId(packageName: string, panelId: string): PluginSurfaceId {
  return `plugin:${packageName}:${panelId}`
}

export function parsePluginSurfaceId(
  value: string | null | undefined,
): { package: string; panel: string } | null {
  if (typeof value !== "string") return null
  const match = PLUGIN_SURFACE_PATTERN.exec(value)
  if (!match) return null
  return { package: match[1] as string, panel: match[2] as string }
}

export function isPluginSurfaceId(value: string | null | undefined): value is PluginSurfaceId {
  return parsePluginSurfaceId(value) !== null
}

export type WorkbenchState = {
  context: WorkbenchContext
  surface: WorkbenchSurface
  executionSection: ExecutionSection
}

export const DEFAULT_WORKBENCH_STATE: WorkbenchState = {
  context: "project",
  surface: "code",
  executionSection: "overview",
}

export const WORKBENCH_SURFACES: readonly { id: BuiltinWorkbenchSurface; label: string }[] = [
  { id: "code", label: "文件" },
  { id: "browser", label: "浏览器" },
  { id: "terminal", label: "终端" },
]

export const EXECUTION_SECTIONS: readonly { id: ExecutionSection; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "todos", label: "待办" },
  { id: "subagents", label: "子代理" },
  { id: "background", label: "后台" },
  { id: "trajectory", label: "轨迹" },
]

const SURFACE_IDS = new Set<string>(WORKBENCH_SURFACES.map((v) => v.id))
const SECTION_IDS = new Set<ExecutionSection>(EXECUTION_SECTIONS.map((v) => v.id))

export function normalizeWorkbenchSurface(v: string | null | undefined): WorkbenchSurface {
  if (isPluginSurfaceId(v)) return v
  return v && SURFACE_IDS.has(v) ? (v as BuiltinWorkbenchSurface) : "code"
}

export function normalizeExecutionSection(v: string | null | undefined): ExecutionSection {
  return v && SECTION_IDS.has(v as ExecutionSection) ? (v as ExecutionSection) : "overview"
}

export function executionSectionLabel(section: ExecutionSection): string {
  // `pod` 是内部团队资源面（不再出现在日常下拉），仍然需要一个可读标签。
  if (section === "pod") return "团队"
  return EXECUTION_SECTIONS.find((s) => s.id === section)?.label ?? "概览"
}

export const LEGACY_WORKBENCH_KEYS = [
  "mafw-right-dock-tab",
  "mafw-workbench-tab",
  "mafw-tasks-placement",
] as const

/** 新键写好后一次性清掉旧键；失败由调用方 fail-open。 */
export function clearLegacyWorkbenchKeys(remove: (key: string) => void): void {
  for (const key of LEGACY_WORKBENCH_KEYS) remove(key)
}

export type TerminalSurfaceHotkeyState = {
  dockOpen: boolean
  context: WorkbenchContext
  surface: WorkbenchSurface
  previousSurface: "code" | "browser"
}

export type TerminalSurfaceHotkeyResult = {
  openDock: boolean
  context: "content"
  surface: WorkbenchSurface
}

/** Ctrl+` surface 级开合：内容面可见即回上一个 surface；否则跳到内容 › 终端。 */
export function terminalSurfaceHotkeyAction(s: TerminalSurfaceHotkeyState): TerminalSurfaceHotkeyResult {
  if (s.dockOpen && s.context === "content" && s.surface === "terminal") {
    return { openDock: true, context: "content", surface: s.previousSurface }
  }
  return { openDock: true, context: "content", surface: "terminal" }
}

export function nextWorkbenchSurface(
  current: WorkbenchSurface,
  key: string,
  pluginSurfaces: readonly string[] = [],
): WorkbenchSurface | null {
  const order: readonly string[] = [...WORKBENCH_SURFACES.map((v) => v.id), ...pluginSurfaces]
  const index = order.indexOf(current)
  if (index < 0) return null
  if (key === "ArrowRight") return (order[index + 1] as WorkbenchSurface | undefined) ?? null
  if (key === "ArrowLeft") return (order[index - 1] as WorkbenchSurface | undefined) ?? null
  if (key === "Home") return order[0] as WorkbenchSurface
  if (key === "End") return order[order.length - 1] as WorkbenchSurface
  return null
}

type LegacyTab = {
  context: WorkbenchContext
  executionSection: ExecutionSection
  surface?: WorkbenchSurface
}

const LEGACY_TABS: Record<string, LegacyTab> = {
  tasks: { context: "project", executionSection: "todos" },
  trajectory: { context: "project", executionSection: "trajectory" },
  subagents: { context: "project", executionSection: "subagents" },
  background: { context: "project", executionSection: "background" },
  changes: { context: "review", executionSection: "overview" },
  usage: { context: "project", executionSection: "overview" },
  quota: { context: "project", executionSection: "overview" },
  notes: { context: "content", executionSection: "overview" },
  // pre-merge workbench tabs
  files: { context: "content", executionSection: "overview", surface: "code" },
  editor: { context: "content", executionSection: "overview", surface: "code" },
  browser: { context: "content", executionSection: "overview", surface: "browser" },
  terminal: { context: "content", executionSection: "overview", surface: "terminal" },
}

function legacySurface(v: string | null | undefined): WorkbenchSurface | null {
  return v === "browser" ? "browser" : v === "editor" ? "code" : v === "terminal" ? "terminal" : null
}

export function workbenchStateFromStorage(read: (key: string) => string | null): WorkbenchState {
  const legacyTab = LEGACY_TABS[read("mafw-right-dock-tab") ?? ""]
  const legacyWorkbenchTab = legacySurface(read("mafw-workbench-tab"))

  const storedContext = read("mafw-workbench-context")
  const legacyView = read("mafw-workbench-view") ?? legacyTab?.context
  const context = storedContext
    ? normalizeWorkbenchContext(storedContext)
    : workbenchContextFromLegacyView(legacyView)
  const surface = normalizeWorkbenchSurface(
    read("mafw-workbench-surface") ?? legacyWorkbenchTab ?? legacyTab?.surface,
  )
  const executionSection = normalizeExecutionSection(
    read("mafw-execution-section") ?? legacyTab?.executionSection,
  )

  return { context, surface, executionSection }
}

/**
 * Task 15：旧的执行分区 `pod` 退役为「项目资源」。读取时一次性标记，
 * 调用方把左栏面偏好写成 resources 并删除执行分区键；normalize 已回落 overview。
 */
export function migrateWorkbenchStorage(read: (key: string) => string | null): {
  state: WorkbenchState
  openResources: boolean
} {
  const rawExecution = read("mafw-execution-section")
  const legacyTab = read("mafw-right-dock-tab")
  return {
    state: workbenchStateFromStorage(read),
    openResources: rawExecution === "pod" || legacyTab === "pod",
  }
}
