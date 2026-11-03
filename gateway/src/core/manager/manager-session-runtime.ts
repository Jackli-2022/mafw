// Runtime ownership of manager-session kv entries — per-runtime SLOTS.
// The manager "topic" exists separately in each runtime's storage, so the kv
// value keeps one slot per runtime and switching runtimes never drops a topic:
// switching back resumes the previous manager.
//
// Ownership is EXPLICIT (the persisted `runtime` tag). Session id prefixes
// (`pi_` / `ses_`) are runtime-private naming conventions and must not be used
// to guess an owner: a legacy v1 entry without a tag stays dormant (never
// deleted, never attributed), and new writes always carry the tag.

export interface ManagerSlot {
  sessionId: string;
  createdAt?: string | null;
}

/**
 * 协调会话（kv 槽位 `manager-session`）的 session metadata。
 *
 * Task 2（spec 2026-11-02-pod-collaborative-goal-loop §3.1）：Manager 被 Lead 替换——
 * kv 键名与 `readManagerSlot`/`writeManagerSlot` 保留（既有行兼容），但会话对外的身份
 * 是 Lead：`role:'lead'`。生命周期豁免（trim/evict/archive）与 pinned 不变：协调会话
 * 仍是 per-project 单例常驻会话。
 *
 * `manager` / `manager-archived` 只作为历史行的读取兼容，不再由新写入产生。
 */
export function projectLeadSessionMetadata(): {
  mafw: {
    role: 'lead';
    pinned: true;
    exemptFromTrim: true;
    exemptFromEvict: true;
    exemptFromArchive: true;
  };
} {
  return {
    mafw: {
      role: 'lead',
      pinned: true,
      exemptFromTrim: true,
      exemptFromEvict: true,
      exemptFromArchive: true,
    },
  };
}

export interface ManagerSessionValueV2 {
  byRuntime: Record<string, ManagerSlot>;
  /**
   * Legacy v1 entry with no explicit runtime tag. Never surfaced for any
   * runtime (that would be a guess); preserved so a write cannot lose it.
   */
  unattributed?: ManagerSlot;
}

/**
 * Owner runtime of a persisted entry — explicit tag only.
 * Returns null when the entry carries no runtime tag (unknown origin).
 */
export function resolveManagerRuntime(slot: { runtime?: string; id?: string; sessionId?: string }): string | null {
  const runtime = slot?.runtime;
  if (typeof runtime !== 'string') return null;
  const trimmed = runtime.trim();
  return trimmed ? trimmed : null;
}

/**
 * One-time backfill for entries written before runtime tagging existed.
 *
 * Ruling（review I3）：单 runtime 时代的 legacy writer 只会是 opencode，所以
 * 「从未带过 tag」的 legacy 行可以被**一次性**归到 `byRuntime.opencode`。这不是
 * 读路径的归属推断——`readManagerSlot` 仍然只认显式 tag，本函数只在启动时跑一次，
 * 把存量行补齐成 v2（幂等：已带 tag 的值原样返回）。
 *
 * 触发形态：
 *  - v1 `{sessionId, createdAt?}`（无 byRuntime / 无 runtime tag）→ opencode slot
 *  - v1 `{sessionId, runtime: 'pi'}`（带 tag 的旧行）→ 该 runtime 的 slot
 *  - v2 `{byRuntime, unattributed}` 且 opencode slot 缺失 → 把 unattributed 提升为
 *    opencode slot（旧迁移写的就是 untagged 行，`writeManagerSlot` 会把它存成
 *    unattributed，于是永远读不到 = 新会话替换旧 topic 后旧 topic 又"复活"）；
 *    已有 opencode slot 时保持 unattributed 不动（不覆盖真实状态）。
 */
export function backfillManagerSlot(value: unknown): { value: unknown; changed: boolean } {
  if (!value || typeof value !== 'object') return { value, changed: false };
  const v = value as {
    byRuntime?: Record<string, ManagerSlot>;
    unattributed?: ManagerSlot;
    sessionId?: string;
    createdAt?: string | null;
    runtime?: string;
  };
  const hasSession = typeof v.sessionId === 'string' && v.sessionId.length > 0;

  if (v.byRuntime && typeof v.byRuntime === 'object') {
    if (v.unattributed?.sessionId && !v.byRuntime.opencode) {
      const { unattributed, ...rest } = v;
      return {
        value: { ...rest, byRuntime: { ...v.byRuntime, opencode: { ...unattributed } } },
        changed: true,
      };
    }
    return { value, changed: false };
  }

  if (!hasSession) return { value, changed: false };
  const slot: ManagerSlot = { sessionId: v.sessionId as string, ...(v.createdAt ? { createdAt: v.createdAt } : {}) };
  const owner = resolveManagerRuntime(v) ?? 'opencode';
  return { value: { byRuntime: { [owner]: slot } }, changed: true };
}

/**
 * Read the slot for `currentRuntime`.
 * v2 value → byRuntime[currentRuntime]; tagged v1 legacy → its explicit slot
 * when it matches; untagged v1 → null (dormant, never guessed at read time —
 * `backfillManagerSlot` tags it once at startup instead).
 */
export function readManagerSlot(
  value: unknown,
  currentRuntime: string,
): ManagerSlot | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as {
    byRuntime?: Record<string, ManagerSlot>;
    sessionId?: string;
    createdAt?: string | null;
    runtime?: string;
  };
  if (v.byRuntime && typeof v.byRuntime === 'object') {
    return v.byRuntime[currentRuntime] ?? null;
  }
  const owner = resolveManagerRuntime(v);
  return owner === currentRuntime && v.sessionId ? { sessionId: v.sessionId, createdAt: v.createdAt } : null;
}

/**
 * Remove only one runtime's slot while preserving every other runtime and any
 * unattributed legacy value. Used after a dead Lead is archived so repeated
 * canonicalized reads cannot re-archive the same runtime session.
 */
export function clearManagerSlot(value: unknown, currentRuntime: string): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as {
    byRuntime?: Record<string, ManagerSlot>;
    unattributed?: ManagerSlot;
    sessionId?: string;
    createdAt?: string | null;
    runtime?: string;
  };
  if (v.byRuntime && typeof v.byRuntime === 'object') {
    const byRuntime = { ...v.byRuntime };
    delete byRuntime[currentRuntime];
    return { byRuntime, ...(v.unattributed ? { unattributed: v.unattributed } : {}) };
  }
  if (resolveManagerRuntime(v) !== currentRuntime) return value;
  return v.unattributed ? { byRuntime: {}, unattributed: v.unattributed } : { byRuntime: {} };
}

/**
 * Write the slot for `currentRuntime`, preserving all other runtimes' slots.
 * A tagged v1 legacy entry is migrated into its own slot; an untagged v1 entry
 * is preserved verbatim under `unattributed`.
 */
export function writeManagerSlot(
  existing: unknown,
  currentRuntime: string,
  slot: ManagerSlot,
): ManagerSessionValueV2 {
  const byRuntime: Record<string, ManagerSlot> = {};
  let unattributed: ManagerSlot | undefined;
  if (existing && typeof existing === 'object') {
    const v = existing as {
      byRuntime?: Record<string, ManagerSlot>;
      sessionId?: string;
      createdAt?: string | null;
      runtime?: string;
      unattributed?: ManagerSlot;
    };
    if (v.byRuntime && typeof v.byRuntime === 'object') {
      Object.assign(byRuntime, v.byRuntime);
      if (v.unattributed?.sessionId) unattributed = { ...v.unattributed };
    } else if (v.sessionId) {
      const owner = resolveManagerRuntime(v);
      if (owner) byRuntime[owner] = { sessionId: v.sessionId, createdAt: v.createdAt };
      else unattributed = { sessionId: v.sessionId, createdAt: v.createdAt };
    }
  }
  byRuntime[currentRuntime] = slot;
  return { byRuntime, ...(unattributed ? { unattributed } : {}) };
}
