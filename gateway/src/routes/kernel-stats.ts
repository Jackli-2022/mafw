/**
 * E4-8 `GET /api/kernel/stats` — 内核资源账本快照（internal）。
 *
 * 唯一的逻辑是"读快照 → 200 JSON"；形状/归一化在 `resources/stats.ts`，鉴权在
 * 路由分发层（token/loopback 规则不变，本模块不新增认证面）。快照构建失败时
 * 返回 500 `{ error }`，绝不返回半截 body：账本的可观测性失败不能伪装成空账本。
 *
 * 用字面 `attachHandler('kernel.stats')`（而非 attachTypedRoute）——E3 可达性
 * 守卫按源码字面量扫描 attach 证据；schema 仍写回 catalog def（emit:openapi 读它）。
 */
import type { IncomingMessage, ServerResponse } from 'http'
import type { KernelStatsSnapshot } from '../resources/stats'
import type { RouteRegistry } from './registry'
import { KernelStatsResponse } from './schemas/resources'

export interface KernelStatsRouteDeps {
  /** live getter：每次请求重新构建（providers 一直在变）。 */
  snapshot(): KernelStatsSnapshot
}

export function attachKernelStatsRoute(registry: RouteRegistry, deps: KernelStatsRouteDeps): void {
  const def = registry.list().find((d) => d.operationId === 'kernel.stats')
  if (def) def.response = KernelStatsResponse

  registry.attachHandler('kernel.stats', async (_req: IncomingMessage, res: ServerResponse) => {
    let body: KernelStatsSnapshot
    try {
      body = deps.snapshot()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: message }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  })
}
