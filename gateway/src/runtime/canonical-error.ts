/**
 * 消息错误 → 规范 `{kind, message}`（与 runtime 无关的中性归一层）。
 *
 * 为什么单独成文件：错误归一同时被**两个方向**消费——
 *  - 读路径（history / live）：opencode 原生 `{name, data:{message}}` → DTO
 *    （`runtime/opencode-canonical.ts` 的 `canonicalMessage`）；
 *  - 存量数据修复（replay）：`events/event-log-migrate.ts` 把已持久化的旧
 *    `message.updated` 帧里的原生错误改成规范形。
 * 后者属于业务层（`src/events`），不应依赖 opencode adapter 模块，故把纯函数
 * 放在中性文件里，`opencode-canonical` 原样再导出（既有导入路径零改动）。
 *
 * 不变量（两侧必须逐字一致，否则 replay ≠ live）：
 *  - 已是规范形（`kind` + `message` 都是字符串）→ 原样返回（幂等）；
 *  - 无法产出可信错误（`null` / `false` / 空串 / 空对象）→ `undefined`（不改写）；
 *  - 其余一律回落 `unknown`（不静默丢弃错误）。
 */
import type { MafwMessageError } from './canonical-types';

/** 中性错误种类（spec §5.2：不暴露 runtime 原生错误类名作为业务判断）。 */
export type MafwErrorKind = 'abort' | 'rate-limit' | 'provider' | 'unknown';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 原生错误对象 → 可展示文本（保留 provider 原文；不造空串）。 */
export function errorTextOf(error: unknown): string {
  if (typeof error === 'string') return error.trim();
  if (!error || typeof error !== 'object') return '';
  const e = error as Record<string, any>;
  for (const value of [e.data?.message, e.message, e.data?.data?.message, e.name, e.type, e.code]) {
    const text = asString(value);
    if (text) return text;
  }
  return '';
}

/** 原生错误 → 中性 kind（abort 判定是 UI 中止态的唯一依据；幂等）。 */
export function errorKindOf(error: unknown): MafwErrorKind {
  if (!error || typeof error !== 'object') return 'unknown';
  const e = error as Record<string, any>;
  // 已是规范形（重复归一 / normalizeFacadeHistory 救回路径）→ 保持
  if (e.kind === 'abort' || e.kind === 'rate-limit' || e.kind === 'provider' || e.kind === 'unknown') return e.kind;
  const name = asString(e.name) || asString(e.type) || asString(e.code);
  // 显式中止（类名/type 带 abort|interrupt）优先级最高：即使文案里提到 provider 也
  // 是用户中止（与 desktop `ingest/errors.ts` 的 precedence 一致）。
  if (/abort|interrupt/i.test(name)) return 'abort';
  const status = typeof e.status === 'number' ? e.status : undefined;
  const text = errorTextOf(error);
  if (status === 429 || /rate[-\s]?limit|quota|too many requests/i.test(`${name} ${text}`)) return 'rate-limit';
  // provider 信号（name 直接命中 / 文案里的凭据与鉴权词）先于 cancel：上游取消
  // 请求不是用户中止，否则 UI 会把 provider 故障显示成「已中止」。
  if (/provider|auth|overflow|filter|unauthor|forbidden/i.test(name)) return 'provider';
  if (/api key|apikey|provider|unauthor|forbidden|403/i.test(text)) return 'provider';
  // 兜底：文案级 cancel（错误对象丢了原生类名时仍是中止，不落 unknown）。
  if (/cancel|stopped by user/i.test(`${name} ${text}`)) return 'abort';
  return 'unknown';
}

/** 原生错误 → 规范 `{kind, message}`；无错误返回 undefined（幂等）。 */
export function canonicalError(error: unknown): MafwMessageError | undefined {
  if (error === undefined || error === null || error === false || error === '') return undefined;
  if (typeof error === 'object' && Object.keys(error as object).length === 0) return undefined;
  const kind = errorKindOf(error);
  const message = errorTextOf(error) || 'unknown error';
  return { kind, message };
}

/** 已是规范错误 DTO（`kind` + `message` 字符串）→ true（迁移幂等判据）。 */
export function isCanonicalError(error: unknown): error is MafwMessageError {
  return (
    !!error &&
    typeof error === 'object' &&
    typeof (error as Record<string, unknown>).kind === 'string' &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}
