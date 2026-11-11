/**
 * E4-7 项目/会话配额（spec §4.7）。
 *
 * 配额是"机制 + 可观测"，不是激进阻断：默认值偏高，`0`/负数/NaN = 不限。
 * 语义统一为 `current < limit`（新增第 `limit` 个即拒绝）。`check().limit` 与
 * `snapshot().limit` 都是**归一化值**（有限正值向下取整，0/负数/非有限 → 0；
 * `0` = 不限），不是原始配置；内部判定用 `limitOf()`（`Infinity` 永不命中）。
 *
 * 拒绝路径（429）：
 *  - `POST /register` → projects
 *  - `POST /api/session` → sessions / sessionRecordsPerProject
 *  - `POST /api/python/execute` → python_kernels（由 SessionKernels 抛同一错误类型）
 */
import type { GatewayConfig } from '../config';
import { limitOf } from './settings';

export type QuotaResource = 'projects' | 'sessions' | 'sessionRecordsPerProject';

const RESOURCE_ORDER: QuotaResource[] = ['projects', 'sessions', 'sessionRecordsPerProject'];

export interface QuotaCheck {
  ok: boolean;
  /** 归一化 limit（有限正值向下取整，0/负数/非有限 → 0；`0` = 不限）。 */
  limit: number;
  current: number;
}

/** `snapshot()` 形状：按资源键控，limit 为归一化值（`0` = 不限）。 */
export type QuotaSnapshot = Partial<Record<QuotaResource, { current: number; limit: number }>>;

/**
 * wire 归一化：JSON 里 `Infinity` / `NaN` 会变成 `null`（客户端无法判断"不限"），
 * 所以出口把非有限值与负数统一成 `0`（= 不限）；有限正值向下取整，保证 wire
 * 上的 `limit` 与 `limitOf()` 的判定值一致（12.5 实际按 12 执行，不能报告 12.5；
 * 0.5 取整为 0 = 不限，否则判定侧 floor 成 0 会拒绝一切）。
 * `check()` 与 `snapshot()` 共用同一归一化，原始配置不会从 API 漏出去。
 */
export function sanitizeLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export class QuotaExceededError extends Error {
  readonly code = 'quota_exceeded';

  constructor(
    readonly resource: string,
    readonly limit: number,
    readonly current: number,
  ) {
    super(`quota exceeded for ${resource} (limit ${limit}, current ${current})`);
    this.name = 'QuotaExceededError';
  }
}

export interface QuotaServiceDeps {
  /** live getter：hot reload 在每次检查时生效。 */
  limits: () => Pick<GatewayConfig['resources']['limits'], QuotaResource>;
}

export class QuotaService {
  constructor(private readonly deps: QuotaServiceDeps) {}

  private rawLimit(resource: QuotaResource): number {
    // 缺键 / 非有限 / 负数 → 0（不限）；有限正值向下取整（与 limitOf 判定一致）。
    return sanitizeLimit(this.deps.limits()?.[resource]);
  }

  check(resource: QuotaResource, current: number): QuotaCheck {
    const limit = this.rawLimit(resource);
    const effective = limitOf(limit);
    return { ok: current < effective, limit, current };
  }

  assert(resource: QuotaResource, current: number): void {
    const check = this.check(resource, current);
    if (!check.ok) throw new QuotaExceededError(resource, check.limit, check.current);
  }

  /** 只报告调用方显式给出 current 的资源（顺序固定，limit 保留原始值）。 */
  snapshot(currents: Partial<Record<QuotaResource, number>>): QuotaSnapshot {
    const out: QuotaSnapshot = {};
    for (const resource of RESOURCE_ORDER) {
      if (!(resource in currents)) continue;
      const current = currents[resource];
      out[resource] = {
        current: typeof current === 'number' && Number.isFinite(current) ? current : 0,
        // 非有限/负数在 wire 上统一按 0（不限）表达。
        limit: sanitizeLimit(this.rawLimit(resource)),
      };
    }
    return out;
  }
}

/**
 * 项目注册准入：已登记的同目录重复注册放行（幂等、不占新名额），
 * 只有新增目录才检查 `projects` 配额。API 入口（`registerProject`）据此抛错，
 * 文件系统 watcher 据此 log + skip（不得抛）。
 */
export function projectAdmission(quotas: QuotaService, isNew: boolean, current: number): QuotaCheck {
  const check = quotas.check('projects', current);
  return isNew ? check : { ...check, ok: true };
}
