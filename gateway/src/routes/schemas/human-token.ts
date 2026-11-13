/**
 * E11-1：human token 轮换（`POST /api/human-token/rotate`）的响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变 wire 形状：
 *   { token: string, rotatedAt: string }
 *
 * `token` 是新凭据本身（调用方必须持有被替换的旧凭据才能拿到），
 * 因此 CLI 只打印 `rotatedAt`，绝不把 `token` 写进日志或终端输出。
 */
import { Type } from '@sinclair/typebox'

export const HumanTokenRotateResponse = Type.Object({
  token: Type.String(),
  rotatedAt: Type.String(),
})
