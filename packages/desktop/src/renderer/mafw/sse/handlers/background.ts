// SSE background handler：canonical `background.job.updated` → 中性 jobs store。
//
// Task 3 起 gateway 把 runtime shell / MAFW 持久任务 / 子代理三源统一投影为
// `MafwBackgroundJob` 并广播本事件；desktop 不再解析 tool part 元数据或 synthetic
// 消息自行推导后台行（spec §7.3 / §8.2）。
import type { SidHandler } from "../dispatcher"
import type { BackgroundJob } from "../../background-jobs"

export const handleBackgroundEvent: SidHandler = (event, _sid, deps) => {
  if (event.type !== "background.job.updated") return false
  const job: BackgroundJob | undefined = event.properties?.job ?? event.job
  if (job) deps.background.onEvent(job)
  return true
}
