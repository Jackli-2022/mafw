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
  background: Array<{ status: string }>
  tasks: Array<{ status: string }>
}): ExecutionSummary {
  return {
    subagentRunning: input.subagents.filter((r) => r.status === "running").length,
    subagentTotal: input.subagents.length,
    backgroundRunning: input.background.filter((r) => r.status === "running").length,
    backgroundTotal: input.background.length,
    todoDone: input.tasks.filter((t) => t.status === "completed").length,
    todoTotal: input.tasks.length,
    waitingForInput: input.tasks.filter((t) => t.status === "input_required").length,
  }
}
