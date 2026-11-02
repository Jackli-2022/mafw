// 会话运行态判定（纯函数）：会话快照 → MAFW 规范状态字符串。
//
// Task 10/Review I1：状态**只读规范字段** `MafwSession.status`（gateway 在
// `/api/sessions` 出口由 `time.busy > time.idle` / 原生 status 投影得出）。
// 客户端不再自己比较 `time.busy`/`time.idle`——那是 runtime 原生形状，pi 根本没有。
import type { MafwSessionStatus } from "@mafw/sdk"

/** 运行中状态集（`retry` 也在跑：等 provider 重试时输入框必须仍显示忙碌）。 */
export function isWorkingStatus(status: MafwSessionStatus | undefined | null): boolean {
  return status === "busy" || status === "retry"
}

/**
 * @param info   `sessions.get()` 的会话快照（`MafwSession`；缺 `status` = unknown）
 * @param previous  本地已有状态；存在时优先——live SSE 事件比取回的快照新，
 *                  历史加载不得把刚收到的 busy 覆写成 idle。
 */
export function sessionStatusFromInfo(info: any, previous?: MafwSessionStatus): MafwSessionStatus {
  if (previous) return previous
  const status = info?.status
  if (status === "idle" || status === "busy" || status === "retry" || status === "unknown") return status
  return "unknown"
}
