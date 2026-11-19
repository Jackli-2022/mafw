// 工具卡注册表（自 message-part.tsx 迁出的纯注册面——canonical 解析层
// tool-canonical.ts 与 message-part 渲染链共用；轻依赖，bun test 可直接导入）。
import type { Component, JSX } from "solid-js"
import type { ToolProps } from "./message-part"
import type { Section, ToolPresenter } from "./tool-presentation"

export type ToolComponent = Component<ToolProps>

export interface ToolRegistryEntry {
  name: string
  present?: ToolPresenter
  /** Custom collapsed row (header-only, no Collapsible shell). */
  renderCollapsed?: (props: ToolProps) => JSX.Element
  /** Custom expanded body (body-only, rendered inside the card shell). */
  renderBody?: ToolComponent
  /** Desktop-injected renderer for `expanded.sections`. */
  renderSections?: (sections: Section[]) => JSX.Element
  render?: ToolComponent
  /** Plugin override: a full-card render wins over first-party present(). */
  override?: boolean
  /**
   * Opt-in: this card renders its own error state. Unflagged cards keep the
   * generic ToolErrorCard short-circuit (built-in/legacy behavior unchanged).
   */
  handlesError?: boolean
}

const state: Record<string, ToolRegistryEntry> = {}

export function registerTool(input: ToolRegistryEntry) {
  state[input.name] = input
  return input
}

export function getTool(name: string) {
  return state[name]?.render
}

/** True only for a registered card that explicitly renders error parts. */
export function toolHandlesError(name: string): boolean {
  const entry = state[name]
  return !!entry?.render && entry.handlesError === true
}

export function overrideTool(name: string, render: ToolComponent) {
  const previous = state[name]
  state[name] = { ...(previous ?? { name }), name, render, override: true }
  return () => {
    if (previous) state[name] = previous
    else delete state[name]
  }
}

/** Slot occupancy: every custom presentation slot counts as available. */
export function hasTool(name: string): boolean {
  const entry = state[name]
  return !!(entry?.present || entry?.render || entry?.renderCollapsed || entry?.renderBody)
}

export function toolNames(): string[] {
  return Object.keys(state)
}

export function toolEntry(name: string): ToolRegistryEntry | undefined {
  return state[name]
}

/** ToolPartDisplay decision: presenter/custom slots win unless a plugin override replaces the card. */
export function shouldUsePresentation(entry: ToolRegistryEntry | undefined): boolean {
  if (!entry) return false
  if (entry.override && entry.render) return false
  return !!(entry.present || entry.renderCollapsed || entry.renderBody)
}

export const ToolRegistry = {
  register: registerTool,
  render: getTool,
  handlesError: toolHandlesError,
  override: overrideTool,
  has: hasTool,
  names: toolNames,
  entry: toolEntry,
  shouldPresent: shouldUsePresentation,
}
