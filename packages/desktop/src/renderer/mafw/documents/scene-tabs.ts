// 场景 tab：世界 / Goal / 终端 / 插件 与文档 tab 共用一条 tab 条。
// 世界与 Goal 跨重启恢复；终端与插件是会话内临时 tab，不落盘。
import { createSignal } from "solid-js"
import type { DocumentTabIcon } from "../document-frame-model"
import type { Scope, SubjectRef } from "../focus/focus-model"
import { subjectKey } from "../focus/focus-model"
import { WORKBENCH_PAGE_META, isWorkbenchPageId } from "../focus/workbench-pages"

export type SceneSubject = Extract<SubjectRef, { kind: "world" | "goal" | "terminal" | "plugin" | "memory" | "page" }>

export type SceneTab = {
  id: string
  subject: SceneSubject
  scope: Scope
  label: string
  icon: DocumentTabIcon
  persistent: boolean
}

export type OpenSceneTabInput = {
  subject: SceneSubject
  scope: Scope
  label?: string
  icon?: DocumentTabIcon
}

export type SceneTabStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

const PREFIX = "mafw-scene-tabs:v1:"
const MAX_TABS = 30

function defaultStorage(): SceneTabStorage | null {
  try {
    return (globalThis as { localStorage?: SceneTabStorage }).localStorage ?? null
  } catch {
    return null
  }
}

let storage: SceneTabStorage | null = defaultStorage()

export function configureSceneTabStorage(next: SceneTabStorage | null): void {
  storage = next
}

export function sceneTabStorageKey(worldId: string): string {
  return `${PREFIX}${worldId}`
}

export function sceneTabId(subject: SceneSubject): string {
  switch (subject.kind) {
    case "world":
      return "scene:world"
    case "goal":
      return `scene:goal:${subject.goalId}`
    case "terminal":
      return `scene:terminal:${subject.id}`
    case "plugin":
      return `scene:plugin:${subject.package}:${subject.panel}`
    case "memory":
      return "scene:memory"
    case "page":
      return `scene:page:${subject.id}`
  }
}

export function isPersistentSceneSubject(subject: SceneSubject): boolean {
  return subject.kind === "world" || subject.kind === "goal" || subject.kind === "memory" || subject.kind === "page"
}

function defaultLabel(subject: SceneSubject): string {
  switch (subject.kind) {
    case "world":
      return "世界总览"
    case "goal":
      return "Goal"
    case "terminal":
      return "终端"
    case "plugin":
      return subject.panel
    case "memory":
      return "记忆"
    case "page":
      return WORKBENCH_PAGE_META[subject.id].label
  }
}

function defaultIcon(subject: SceneSubject): DocumentTabIcon {
  switch (subject.kind) {
    case "world":
      return "world"
    case "goal":
      return "goal"
    case "terminal":
      return "terminal"
    case "plugin":
      return "plugin"
    case "memory":
      return "memory"
    case "page":
      return WORKBENCH_PAGE_META[subject.id].icon as DocumentTabIcon
  }
}

/** 场景 subject 的 tab 图标（供 shell 建 tab 时复用，避免把 kind 当图标）。 */
export function sceneTabIconFor(subject: SceneSubject): DocumentTabIcon {
  return defaultIcon(subject)
}

const [tabs, setTabs] = createSignal<SceneTab[]>([])

export function sceneTabs(): SceneTab[] {
  return tabs()
}

export function sceneTabForSubject(subject: SubjectRef): SceneTab | null {
  if (subject.kind !== "world" && subject.kind !== "goal" && subject.kind !== "terminal" && subject.kind !== "plugin" && subject.kind !== "memory" && subject.kind !== "page") {
    return null
  }
  const id = sceneTabId(subject)
  return tabs().find((tab) => tab.id === id) ?? null
}

export function openSceneTab(input: OpenSceneTabInput): SceneTab {
  const id = sceneTabId(input.subject)
  const next: SceneTab = {
    id,
    subject: input.subject,
    scope: input.scope,
    label: input.label ?? defaultLabel(input.subject),
    icon: input.icon ?? defaultIcon(input.subject),
    persistent: isPersistentSceneSubject(input.subject),
  }
  const current = tabs()
  const index = current.findIndex((tab) => tab.id === id)
  if (index >= 0) {
    setTabs(current.map((tab) => (tab.id === id ? next : tab)))
  } else {
    setTabs([...current, next].slice(-MAX_TABS))
  }
  persistSceneTabs()
  return next
}

export function closeSceneTab(id: string): void {
  setTabs((current) => current.filter((tab) => tab.id !== id))
  persistSceneTabs()
}

export function resetSceneTabsForTests(): void {
  setTabs([])
  currentWorld = null
  storage = defaultStorage()
}

type SceneSnapshot = {
  version: 1
  tabs: Array<{
    subject: SceneSubject
    scope: Scope
    label: string
    icon: DocumentTabIcon
  }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isSceneSubject(value: unknown): value is SceneSubject {
  if (!isRecord(value)) return false
  if (value.kind === "world") return true
  if (value.kind === "goal") return typeof value.goalId === "string" && value.goalId.length > 0
  if (value.kind === "terminal") return typeof value.id === "string" && value.id.length > 0
  if (value.kind === "plugin") {
    return typeof value.package === "string" && value.package.length > 0 &&
      typeof value.panel === "string" && value.panel.length > 0
  }
  if (value.kind === "memory") return true
  if (value.kind === "page") return isWorkbenchPageId(value.id)
  return false
}

function isScope(value: unknown): value is Scope {
  if (!isRecord(value)) return false
  if (value.kind === "world") return typeof value.worldId === "string" && value.worldId.length > 0
  if (value.kind === "goal") {
    return typeof value.worldId === "string" && value.worldId.length > 0 &&
      typeof value.goalId === "string" && value.goalId.length > 0 &&
      typeof value.revision === "number" && Number.isFinite(value.revision) &&
      typeof value.worktreeDir === "string" && value.worktreeDir.length > 0
  }
  return false
}

const ICONS: ReadonlySet<DocumentTabIcon> = new Set([
  "file", "globe", "review", "world", "goal", "terminal", "plugin", "memory",
  "checklist", "warning", "sliders", "mcp", "settings-gear",
])

function parseSnapshot(raw: string | null): SceneSnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.tabs)) return null
    const out: SceneSnapshot["tabs"] = []
    for (const item of parsed.tabs) {
      if (!isRecord(item) || !isSceneSubject(item.subject) || !isScope(item.scope)) continue
      if (!isPersistentSceneSubject(item.subject)) continue
      const label = typeof item.label === "string" && item.label ? item.label : defaultLabel(item.subject)
      const icon = typeof item.icon === "string" && ICONS.has(item.icon as DocumentTabIcon)
        ? (item.icon as DocumentTabIcon)
        : defaultIcon(item.subject)
      out.push({ subject: item.subject, scope: item.scope, label, icon })
    }
    return { version: 1, tabs: out }
  } catch {
    return null
  }
}

/** 切换项目：丢弃临时 tab，恢复该项目上次打开的世界 / Goal tab。 */
export function restoreSceneTabs(worldId: string): void {
  const snapshot = storage ? parseSnapshot(safeGet(sceneTabStorageKey(worldId))) : null
  const restored: SceneTab[] = (snapshot?.tabs ?? []).slice(-MAX_TABS).map((item) => ({
    id: sceneTabId(item.subject),
    subject: item.subject,
    scope: item.scope,
    label: item.label,
    icon: item.icon,
    persistent: true,
  }))
  const seen = new Set<string>()
  setTabs(restored.filter((tab) => {
    if (seen.has(tab.id)) return false
    seen.add(tab.id)
    return true
  }))
}

export function persistSceneTabsFor(worldId: string): void {
  if (!storage) return
  const snapshot: SceneSnapshot = {
    version: 1,
    tabs: tabs()
      .filter((tab) => tab.persistent)
      .slice(-MAX_TABS)
      .map((tab) => ({
        subject: tab.subject,
        scope: tab.scope,
        label: tab.label,
        icon: tab.icon,
      })),
  }
  try {
    storage.setItem(sceneTabStorageKey(worldId), JSON.stringify(snapshot))
  } catch { /* quota / blocked → fail-open */ }
}

let currentWorld: string | null = null

/** 由 shell 在项目切换时调用：先 flush 旧 world，再恢复新 world。 */
export function switchSceneTabWorld(worldId: string): void {
  if (currentWorld && currentWorld !== worldId) persistSceneTabsFor(currentWorld)
  currentWorld = worldId
  restoreSceneTabs(worldId)
}

function persistSceneTabs(): void {
  if (currentWorld) persistSceneTabsFor(currentWorld)
}

function safeGet(key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** 测试 / 退出时 flush。 */
export function flushSceneTabs(): void {
  if (currentWorld) persistSceneTabsFor(currentWorld)
}

export function sceneTabKeyOfSubject(subject: SceneSubject): string {
  return subjectKey(subject)
}
