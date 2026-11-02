/**
 * 会话错误卡判定（MAFW View DTO 规范形守卫）。
 *
 * spec: docs/superpowers/specs/2026-11-02-runtime-experience-full-migration-design.md §5.2
 *
 * `MafwMessage.error` 的规范形是 `{ kind, message }`（kind 为中性分类）。
 * 过渡期（Task 10 desktop 摄取迁移前）桌面 store 里仍可能是 runtime wire 形状
 * `{ name, data: { message } }` / `{ type, message }`——这种对象**不是**规范
 * error：若把它当真，会渲染一张没有内容的红色错误卡（`error()` 真值但
 * `message` 缺失）。因此只认 `typeof kind === 'string'` 的规范形；
 * 非规范 error 一律不渲染卡片，中性 stop hint（`stopReason` 推断）保留。
 */
import type { MafwMessageError } from "@mafw/sdk"

/** 规范错误形状守卫：只证明 `kind` 是字符串（message 由卡片侧再校验）。 */
export function isCanonicalMessageError(value: unknown): value is MafwMessageError {
  return !!value && typeof value === "object" && typeof (value as MafwMessageError).kind === "string"
}

/** 中止判定：只有规范 error 参与（wire `{name:'MessageAbortedError'}` 迁移期忽略）。 */
export function isAbortMessageError(value: unknown): boolean {
  return isCanonicalMessageError(value) && value.kind === "abort"
}

/**
 * 错误卡文本：规范形且非 abort、message 非空才返回。
 *
 * - 非规范（wire）error → `undefined`（不渲染空卡；Task 10 摄取后补齐规范形）
 * - `kind === 'abort'` → `undefined`（中止由 divider/stop hint 表达，不重复红卡）
 * - message 为空 → `undefined`
 */
export function errorCardText(error: unknown): string | undefined {
  if (!isCanonicalMessageError(error) || error.kind === "abort") return undefined
  const message = typeof error.message === "string" ? error.message.trim() : ""
  return message ? message : undefined
}
