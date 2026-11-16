// 后台作业终态通知：应用内 toast 文案（纯逻辑，无 DOM）。
//
// OS 通知只来自事务层（main presence：「需要你」+ Goal 结果）。后台任务
// 完成/失败只在应用内提示，窗口隐藏时不再弹系统通知。
//
// 规则：completed/failed → toast；其余状态静默（null）。
// kind/source 过滤在接线层：runtime-shell 才走本通道，subagent 归 P0-1，
// mafw-task 由任务通道覆盖（防双响）。
import type { BackgroundJob } from "./background-jobs"
import { jobLabel } from "./background-jobs"

export function buildBackgroundNotice(
  job: Pick<BackgroundJob, "id" | "status" | "title" | "command">,
): string | null {
  if (job.status !== "completed" && job.status !== "failed") return null
  const done = job.status === "completed"
  const subject = jobLabel(job as BackgroundJob).slice(0, 80)
  return `${done ? "后台任务完成" : "后台任务失败"}：${subject}`
}
