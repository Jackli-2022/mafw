/**
 * E10i-P0：网关错误响应契约（非 2xx 的统一错误包）。
 *
 * 只声明不校验：handler 仍是错误形状的事实源。OpenAPI 的 `default` 响应保证
 * 客户端知道「任何未列出的 4xx/5xx 都至少带 `error: string`」，特殊状态码
 * （429 quota / 503 capability / 409 冲突 / 404）用显式 schema 收窄。
 *
 * 与 `core/http/api-error.ts` 的 `API_ERROR_CODES` 同源：`code` 是 additive
 * 机器可读字段，`error` 始终保留（既有客户端按字符串消费）。
 */
import { Type } from '@sinclair/typebox';

/** 统一错误信封：`{ error, code?, message?, success?: false }`。 */
export const ErrorEnvelope = Type.Object({
  error: Type.String(),
  code: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  success: Type.Optional(Type.Literal(false)),
}, { additionalProperties: true });

/** 429：配额超限（`errorBody(..., 'quota_exceeded')` + 额度三元组）。 */
export const QuotaExceededErrorSchema = Type.Object({
  error: Type.String(),
  code: Type.Literal('quota_exceeded'),
  resource: Type.String(),
  limit: Type.Number(),
  current: Type.Number(),
}, { additionalProperties: true });

/** 503：能力不可用（中性文案，不含 runtime 名与 capability flag 名）。 */
export const CapabilityUnavailableErrorSchema = Type.Object({
  error: Type.String(),
  code: Type.Literal('capability_unavailable'),
}, { additionalProperties: true });
