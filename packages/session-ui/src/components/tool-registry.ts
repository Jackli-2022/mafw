// 工具卡注册表（自 message-part.tsx 迁出的纯注册面——canonical 解析层
// tool-canonical.ts 与 message-part 渲染链共用；轻依赖，bun test 可直接导入）。
import type { Component } from "solid-js"
import type { ToolProps } from "./message-part"

export type ToolComponent = Component<ToolProps>

interface ToolRegistryEntry {
  name: string
  render?: ToolComponent
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

export const ToolRegistry = {
  register: registerTool,
  render: getTool,
  handlesError: toolHandlesError,
}
