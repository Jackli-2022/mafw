// 执行概览的纯计数（当前 run）。不推断阻塞：只统计明确状态。
export type ExecutionSummary = {
  subagentRunning: number
  subagentTotal: number
  backgroundRunning: number
  backgroundTotal: number
  todoDone: number
  todoTotal: number
  waitingForInput: number
}

export function summarizeExecution(input: {
  subagents: Array<{ status: string }>
  /** 中性后台作业（三源合并；后台面板渲染的就是这份数据）。 */
  background: Array<{ status: string }>
  /** SSE todo list, rendered by TaskList. */
  todos: Array<{ status: string }>
}): ExecutionSummary {
  const active = (status: string) => status === "running" || status === "input_required"
  return {
    subagentRunning: input.subagents.filter((r) => r.status === "running").length,
    subagentTotal: input.subagents.length,
    backgroundRunning: input.background.filter((r) => active(r.status)).length,
    backgroundTotal: input.background.length,
    todoDone: input.todos.filter((t) => t.status === "completed").length,
    todoTotal: input.todos.length,
    waitingForInput: input.background.filter((r) => r.status === "input_required").length,
  }
}
