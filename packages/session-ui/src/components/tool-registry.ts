// 工具卡注册表（自 message-part.tsx 迁出的纯注册面——canonical 解析层
// tool-canonical.ts 与 message-part 渲染链共用；轻依赖，bun test 可直接导入）。
import type { Component } from "solid-js"
import type { ToolProps } from "./message-part"

export type ToolComponent = Component<ToolProps>

const state: Record<
  string,
  {
    name: string
    render?: ToolComponent
  }
> = {}

export function registerTool(input: { name: string; render?: ToolComponent }) {
  state[input.name] = input
  return input
}

export function getTool(name: string) {
  return state[name]?.render
}

export const ToolRegistry = {
  register: registerTool,
  render: getTool,
}
