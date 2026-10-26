// B1 右工作台视图状态（2026-10-26 agent-workbench-layout-ia spec）。
// 一级决定“看什么”，二级决定“当前这一类”；执行二级固定下拉。
export type WorkbenchView = "workbench" | "execution" | "review"
export type WorkbenchSurface = "code" | "browser"
export type ExecutionSection = "overview" | "todos" | "subagents" | "background" | "trajectory"

export type WorkbenchState = {
  view: WorkbenchView
  surface: WorkbenchSurface
  executionSection: ExecutionSection
}

export const DEFAULT_WORKBENCH_STATE: WorkbenchState = {
  view: "workbench",
  surface: "code",
  executionSection: "overview",
}

export const WORKBENCH_VIEWS: readonly { id: WorkbenchView; label: string }[] = [
  { id: "workbench", label: "工作台" },
  { id: "execution", label: "执行" },
  { id: "review", label: "审阅" },
]

export const WORKBENCH_SURFACES: readonly { id: WorkbenchSurface; label: string }[] = [
  { id: "code", label: "代码" },
  { id: "browser", label: "浏览器" },
]

export const EXECUTION_SECTIONS: readonly { id: ExecutionSection; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "todos", label: "待办" },
  { id: "subagents", label: "子代理" },
  { id: "background", label: "后台" },
  { id: "trajectory", label: "轨迹" },
]

const VIEW_IDS = new Set<WorkbenchView>(WORKBENCH_VIEWS.map((v) => v.id))
const SURFACE_IDS = new Set<WorkbenchSurface>(WORKBENCH_SURFACES.map((v) => v.id))
const SECTION_IDS = new Set<ExecutionSection>(EXECUTION_SECTIONS.map((v) => v.id))

export function normalizeWorkbenchView(v: string | null | undefined): WorkbenchView {
  return v && VIEW_IDS.has(v as WorkbenchView) ? (v as WorkbenchView) : "workbench"
}

export function normalizeWorkbenchSurface(v: string | null | undefined): WorkbenchSurface {
  return v && SURFACE_IDS.has(v as WorkbenchSurface) ? (v as WorkbenchSurface) : "code"
}

export function normalizeExecutionSection(v: string | null | undefined): ExecutionSection {
  return v && SECTION_IDS.has(v as ExecutionSection) ? (v as ExecutionSection) : "overview"
}

export function executionSectionLabel(section: ExecutionSection): string {
  return EXECUTION_SECTIONS.find((s) => s.id === section)?.label ?? "概览"
}

type LegacyTab = {
  view: WorkbenchView
  executionSection: ExecutionSection
  surface?: WorkbenchSurface
}

const LEGACY_TABS: Record<string, LegacyTab> = {
  tasks: { view: "execution", executionSection: "todos" },
  trajectory: { view: "execution", executionSection: "trajectory" },
  subagents: { view: "execution", executionSection: "subagents" },
  background: { view: "execution", executionSection: "background" },
  changes: { view: "review", executionSection: "overview" },
  usage: { view: "execution", executionSection: "overview" },
  quota: { view: "execution", executionSection: "overview" },
  notes: { view: "workbench", executionSection: "overview" },
  // pre-merge workbench tabs
  files: { view: "workbench", executionSection: "overview", surface: "code" },
  editor: { view: "workbench", executionSection: "overview", surface: "code" },
  browser: { view: "workbench", executionSection: "overview", surface: "browser" },
  terminal: { view: "workbench", executionSection: "overview", surface: "code" },
}

function legacySurface(v: string | null | undefined): WorkbenchSurface | null {
  return v === "browser" ? "browser" : v === "editor" ? "code" : null
}

export function workbenchStateFromStorage(read: (key: string) => string | null): WorkbenchState {
  const legacyTab = LEGACY_TABS[read("mafw-right-dock-tab") ?? ""]
  const legacyWorkbenchTab = legacySurface(read("mafw-workbench-tab"))
  const legacy = legacyTab

  const view = normalizeWorkbenchView(read("mafw-workbench-view") ?? legacy?.view)
  const surface = normalizeWorkbenchSurface(
    read("mafw-workbench-surface") ?? legacyWorkbenchTab ?? legacy?.surface,
  )
  const executionSection = normalizeExecutionSection(
    read("mafw-execution-section") ?? legacy?.executionSection,
  )

  return { view, surface, executionSection }
}
