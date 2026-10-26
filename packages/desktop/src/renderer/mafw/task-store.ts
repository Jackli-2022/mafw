import { createSignal } from "solid-js"
import type { TaskEntity } from "@mafw/sdk"

/** 网关 durable task 的全局行（BackgroundDock 按 parentSessionID 过滤）。 */
const [taskRows, setTaskRows] = createSignal<TaskEntity[]>([])

export { taskRows }

export function applyTask(rows: TaskEntity[], task: TaskEntity): TaskEntity[] {
  if (!task?.id) return rows
  const next = rows.filter(r => r.id !== task.id)
  next.push(task)
  return next.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function ingestTask(task: TaskEntity): void {
  setTaskRows(prev => applyTask(prev, task))
}

export function replaceTasks(tasks: TaskEntity[]): void {
  setTaskRows([...tasks].sort((a, b) => b.updatedAt - a.updatedAt))
}

export async function fetchTasks(): Promise<void> {
  try {
    replaceTasks(await window.api.mafw.tasks.list())
  } catch {
    // fail-open: SSE/task.updated will fill in later
  }
}

export async function cancelTask(id: string): Promise<TaskEntity | null> {
  try {
    const task = await window.api.mafw.tasks.cancel(id)
    ingestTask(task)
    return task
  } catch {
    return null
  }
}
