// 会话运行态判定（纯函数）：历史/会话快照 → busy|idle。
// opencode 的 session.time.busy 在回合开始时写入、time.idle 在回合结束时写入
// （绝对值），因此 busy > idle 即“正在跑”。用于“中途进入一个正在对话的会话”：
// 历史加载不能无条件把它标成 idle，否则输入框/状态条显示空闲、用户以为卡住。

export type SessionStatus = { type: "busy" | "idle" }

/**
 * @param info   `sessions.get()` 的会话快照（可能缺 time）
 * @param previous  本地已有状态；存在时优先——live SSE 事件比取回的快照新，
 *                  历史加载不得把刚收到的 busy 覆写回 idle。
 */
export function sessionStatusFromInfo(info: any, previous?: SessionStatus): SessionStatus {
  if (previous) return previous
  const busy = Number(info?.time?.busy) || 0
  const idle = Number(info?.time?.idle) || 0
  return { type: busy > idle ? "busy" : "idle" }
}
