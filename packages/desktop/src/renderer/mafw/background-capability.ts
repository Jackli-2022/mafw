// 后台任务 REST 能力探测（Gate Ruling A：REST 面是可选能力）。
//
// 两个门：
// - backgroundRestAvailable：`GET /api/shell` 可达（v2 鉴权桥就绪）→
//   终止按钮 / 对账轮询可用；
// - canUseBackgroundApi：当前 runtime 为 opencode（`/api/runtime`）→
//   「全部转后台」端点存在（pi 无 session.background）。
//
// 缓存语义（reviewer Important 6）：**成功粘住**（鉴权桥就绪后不会退回），
// **失败 60s 后重试**（启动竞态/网关未就绪不永久禁用）；runtime 热切换与
// SSE 重连时调用 resetBackgroundCapability() 强制重探。
const RETRY_MS = 60_000

type Probe = { at: number; ok: boolean; known: boolean }
let rest: Probe = { at: 0, ok: false, known: false }
let runtime: Probe = { at: 0, ok: false, known: false }
let restInflight: Promise<boolean> | null = null
let runtimeInflight: Promise<boolean> | null = null

function fresh(p: Probe, now: number): boolean {
  return p.known && (p.ok || now - p.at < RETRY_MS)
}

export function backgroundRestAvailable(): Promise<boolean> {
  if (fresh(rest, Date.now())) return Promise.resolve(rest.ok)
  if (restInflight) return restInflight
  restInflight = window.api.mafw.shells.list()
    .then(() => { rest = { at: Date.now(), ok: true, known: true }; return true })
    .catch(() => { rest = { at: Date.now(), ok: false, known: true }; return false })
    .finally(() => { restInflight = null })
  return restInflight
}

export function canUseBackgroundApi(): Promise<boolean> {
  if (fresh(runtime, Date.now())) return Promise.resolve(runtime.ok)
  if (runtimeInflight) return runtimeInflight
  runtimeInflight = window.api.mafw.runtime.get()
    .then((info: any) => {
      const ok = info?.active?.name === "opencode"
      runtime = { at: Date.now(), ok, known: true }
      return ok
    })
    .catch(() => { runtime = { at: Date.now(), ok: false, known: true }; return false })
    .finally(() => { runtimeInflight = null })
  return runtimeInflight
}

/** runtime 热切换 / SSE 重连 / 测试后重置探测缓存。 */
export function resetBackgroundCapability(): void {
  rest = { at: 0, ok: false, known: false }
  runtime = { at: 0, ok: false, known: false }
}
