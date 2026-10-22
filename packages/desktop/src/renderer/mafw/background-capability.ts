// 后台任务 REST 能力探测（Gate Ruling A：REST 面是可选能力）。
//
// 两个门，均模块级缓存（一次探测；失败 fail-closed 隐藏对应按钮，不反复打网关）：
// - backgroundRestAvailable：`GET /api/shell` 可达（v2 鉴权桥就绪）→
//   终止按钮 / 对账轮询 / 「全部转后台」可用；
// - canUseBackgroundApi：当前 runtime 为 opencode（`/api/runtime`）→
//   「全部转后台」端点存在（pi 无 session.background）。
//
// 环境实证（2026-10-22）：gateway 反代不注入 v2 Basic 鉴权 → 当前环境
// backgroundRestAvailable 为 false，UI 自动降级；鉴权桥落地后无需改动自动点亮。

let restProbe: Promise<boolean> | null = null
let runtimeProbe: Promise<boolean> | null = null

export function backgroundRestAvailable(): Promise<boolean> {
  if (!restProbe) {
    restProbe = window.api.mafw.shells.list()
      .then(() => true)
      .catch(() => false)
  }
  return restProbe
}

export function canUseBackgroundApi(): Promise<boolean> {
  if (!runtimeProbe) {
    runtimeProbe = window.api.mafw.runtime.get()
      .then((info: any) => info?.active?.name === "opencode")
      .catch(() => false)
  }
  return runtimeProbe
}

/** 测试/热切换后重置探测缓存。 */
export function resetBackgroundCapability(): void {
  restProbe = null
  runtimeProbe = null
}
