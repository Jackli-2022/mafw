// 后台作业终态通知：文案构造（纯逻辑，无 DOM）。
//
// 规则：completed/failed → toast 恒发 + hidden 时 OS 通知；其余状态静默。
// OS 限频门与子代理通知共享（两类合计 10s 一条，接线层负责）。
// kind/source 过滤在接线层：runtime-shell 才走本通道，subagent 归 P0-1，
// mafw-task 由任务通道覆盖（防双响）。
import type { BackgroundJob } from "./background-jobs"
import { jobLabel } from "./background-jobs"

export interface BackgroundNotice {
  toast: string
  os?: { title: string; body: string }
}

export function buildBackgroundNotice(
  job: Pick<BackgroundJob, "id" | "status" | "title" | "command">,
  opts: { hidden: boolean },
): BackgroundNotice | null {
  if (job.status !== "completed" && job.status !== "failed") return null
  const done = job.status === "completed"
  const subject = jobLabel(job as BackgroundJob).slice(0, 80)
  const toast = `${done ? "后台任务完成" : "后台任务失败"}：${subject}`
  if (!opts.hidden) return { toast }
  return { toast, os: { title: done ? "MAFW：后台任务完成" : "MAFW：后台任务失败", body: subject } }
}
