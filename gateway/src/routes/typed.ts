/**
 * Code-first 路由辅助（P0 试点）。
 *
 * 与 opencode 的 `HttpApiEndpoint(..., { success: Schema })` 对应：
 *   - schema 挂在 RouteDef.response 上（OpenAPI 的唯一来源）；
 *   - handler 返回 `Static<schema>`（编译期约束）；
 *   - 分发层负责序列化与 200（handler 不再碰 res）。
 *
 * 当前只接 registry dispatch 的路由；未迁移的 legacy 链不受影响。
 */
import type { IncomingMessage, ServerResponse } from 'http'
import type { Static, TSchema } from '@sinclair/typebox'
import type { RouteRegistry } from './registry'

export interface TypedRouteContext {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  url: URL
}

export interface AttachTypedRouteOptions<S extends TSchema> {
  operationId: string
  /** 与 route-catalog 中的声明保持同一对象（catalog 也引用它，emit:openapi 才能看到）。 */
  response: S
  handler: (ctx: TypedRouteContext) => Promise<Static<S>>
}

/**
 * 把数据返回型 handler 接到已登记的 operationId 上。
 * schema 同时写回 RouteDef（catalog 里通常已经写了；重复赋值是幂等的）。
 */
export function attachTypedRoute<S extends TSchema>(
  registry: RouteRegistry,
  opts: AttachTypedRouteOptions<S>,
): void {
  const def = registry.list().find((d) => d.operationId === opts.operationId)
  if (!def) throw new Error(`attachTypedRoute: unknown operationId '${opts.operationId}' (catalog 未登记？)`)
  def.response = opts.response
  registry.attachHandler(opts.operationId, async (req, res, params) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`)
    const result = await opts.handler({ req, res, params, url })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
    return true
  })
}
