export type CommandGateId =
  | "compact"
  | "fork"
  | "diff"
  | "undo"
  | "redo"
  | "rename"
  | "plan"
  | "build"
  | "skills"

export interface CommandCapabilities {
  summarize: boolean
  fork: boolean
  diff: boolean
  undo: boolean
  redo: boolean
  rename: boolean
  planning: boolean
  build: boolean
  discovery: boolean
}

const CAPABILITY_KEY: Record<CommandGateId, keyof CommandCapabilities> = {
  compact: "summarize",
  fork: "fork",
  diff: "diff",
  undo: "undo",
  redo: "redo",
  rename: "rename",
  plan: "planning",
  build: "build",
  skills: "discovery",
}

const DISABLED_REASON: Record<CommandGateId, string> = {
  compact: "当前环境不支持压缩上下文",
  fork: "当前环境不支持分叉会话",
  diff: "当前环境不支持会话 diff",
  undo: "当前环境不支持回退",
  redo: "当前环境不支持撤销回退",
  rename: "当前环境不支持重命名",
  plan: "当前 runtime 没有规划 Agent",
  build: "当前 runtime 没有默认执行 Agent",
  skills: "当前环境不支持技能发现",
}

/** Null = available; otherwise a neutral, user-facing reason. */
export function commandDisabledReason(id: CommandGateId, capabilities: CommandCapabilities): string | null {
  return capabilities[CAPABILITY_KEY[id]] ? null : DISABLED_REASON[id]
}
