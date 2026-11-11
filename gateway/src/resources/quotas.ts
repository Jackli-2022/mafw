/**
 * E4-7 项目/会话配额（spec §4.7）。
 *
 * 配额是"机制 + 可观测"，不是激进阻断：默认值偏高，`0`/负数/NaN = 不限。
 * 语义统一为 `current < limit`（新增第 `limit` 个即拒绝），`check()` 返回
 * **原始配置值**（`0` 原样保留，供 stats 显示"不限"）；内部判定用
 * `limitOf()`（`Infinity` 永不命中）。
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
  /** 原始配置值（`0` = 不限） */
  limit: number;
  current: number;
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
    const raw = this.deps.limits()?.[resource];
    // 缺键 → 0（不限）；其余原样保留（含 0/负数/NaN，由 limitOf 解释）。
    return typeof raw === 'number' ? raw : 0;
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
  snapshot(currents: Partial<Record<QuotaResource, number>>): Array<{ resource: QuotaResource; current: number; limit: number }> {
    const out: Array<{ resource: QuotaResource; current: number; limit: number }> = [];
    for (const resource of RESOURCE_ORDER) {
      if (!(resource in currents)) continue;
      const current = currents[resource];
      out.push({
        resource,
        current: typeof current === 'number' && Number.isFinite(current) ? current : 0,
        limit: this.rawLimit(resource),
      });
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
