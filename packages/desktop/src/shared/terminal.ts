// 终端连接状态（main 与 renderer 共享的纯词汇，spec 2026-10-26 §3/§8）。
export type ConnState = "idle" | "probing" | "live" | "closed" | "gone" | "unavailable"

export type ConnEvent = "attachOk" | "wsClosed" | "ptyGone" | "probeFail" | "retry"

/** 连接状态机（spec §3：closed→重连；gone→重新打开；probeFail→不可用）。 */
export function nextConnState(s: ConnState, ev: ConnEvent): ConnState {
  switch (ev) {
    case "attachOk":
      return "live"
    case "wsClosed":
      return "closed"
    case "ptyGone":
      return "gone"
    case "probeFail":
      return "unavailable"
    case "retry":
      return s === "closed" || s === "gone" || s === "unavailable" ? "probing" : s
  }
}
