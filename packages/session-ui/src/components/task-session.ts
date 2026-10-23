// task/subagent part 的子会话 id：兼容 opencode v1 `sessionId`、v2.1.0
// `sessionID`（实测大写 ID）与未来 `childSessionID`。空/非字符串一律忽略。

export function isTaskTool(tool: string | undefined): boolean {
  return tool === "task" || tool === "subagent"
}

export function taskChildSessionID(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  const m = metadata ?? {}
  for (const key of ["sessionId", "sessionID", "childSessionID"] as const) {
    const value = m[key]
    if (typeof value === "string" && value) return value
  }
  return undefined
}
