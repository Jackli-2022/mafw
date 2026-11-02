// BackgroundDock 的数据动作（纯逻辑，可单测）。
//
// - `formatJobOutput`：中性 `MafwBackgroundOutput`（data/cursor/truncated）→ 展示文本；
// - `cancelJobAndIngest`：`background.jobs.cancel` 返回权威行后立即并入 store
//   （本地落终态，不等 SSE；重复 ingest 由 jobs reducer 去重）。
import type { MafwBackgroundJob, MafwBackgroundOutput } from "@mafw/sdk"

export interface BackgroundJobsApi {
  output(sessionID: string, id: string, cursor?: number): Promise<MafwBackgroundOutput>
  cancel(sessionID: string, id: string): Promise<MafwBackgroundJob>
}

export interface JobOutputView {
  text: string
  /** 下一次读取的起点（gateway 游标，字节）。 */
  cursor: number
}

export function formatJobOutput(
  out: Partial<Pick<MafwBackgroundOutput, "data" | "cursor" | "truncated">> | null | undefined,
): JobOutputView {
  const data = typeof out?.data === "string" ? out.data : ""
  const text = data.length > 0 ? data : "(无输出)"
  const cursor = typeof out?.cursor === "number" && Number.isFinite(out.cursor) ? out.cursor : 0
  return {
    text: out?.truncated === true ? `${text}\n…（输出已截断，游标 ${cursor}）` : text,
    cursor,
  }
}

/** 取消作业并把 gateway 返回的权威行并入 store；失败不 ingest（抛给调用方提示）。 */
export async function cancelJobAndIngest(
  api: BackgroundJobsApi,
  sessionID: string,
  jobID: string,
  ingest: (job: MafwBackgroundJob) => void,
): Promise<MafwBackgroundJob> {
  const updated = await api.cancel(sessionID, jobID)
  ingest(updated)
  return updated
}
