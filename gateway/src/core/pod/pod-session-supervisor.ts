import { randomUUID } from 'crypto';
import {
  PodError,
  type PodSessionRow,
  type PodSessionScopeKey,
  type PodStore,
} from './pod-store';

/**
 * 隐藏内部会话的稳定作用域身份。runtime session id 只用来接线，
 * 不是 Goal ownership 或用户界面的主键。
 */
export type PodSessionScope = PodSessionScopeKey;

/** 一次 ensure 的结果：租约（runtime 会话）+ 世代 + 是否为存活复用。 */
export interface PodSessionLease {
  sessionId: string;
  generation: number;
  reused: boolean;
}

export interface PodSessionSupervisorDeps {
  store: PodStore;
  now(): string;
  newId?(): string;
  /**
   * runtime 会话活性探测。**显式 false** 才作废旧租约并重建（generation+1）；
   * 抛错按存活处理（fail-open）——传输/鉴权抖动不该销毁可复用上下文。
   */
  isAlive?(sessionId: string): boolean | Promise<boolean>;
  /**
   * 回收一个已创建但**没有被任何租约接住**的 runtime 会话（review I-3）：
   * 会话 id 已被别人占用、或跨实例竞争丢给赢家时调用。best-effort，抛错只记日志。
   */
  dispose?(sessionId: string): void | Promise<void>;
  broadcast?(event: { type: string; properties?: Record<string, unknown> }): void;
  log?(message: string): void;
}

function generationOf(row: PodSessionRow): number {
  return Number.isFinite(row.generation) && row.generation > 0 ? row.generation : 1;
}

/** 作用域入口归一（M6）：undefined 的 goalId/revision 一律按 null。 */
function normalizeScope(scope: PodSessionScope): PodSessionScope {
  return {
    ...scope,
    goalId: scope.goalId ?? null,
    revision: typeof scope.revision === 'number' && Number.isFinite(scope.revision)
      ? scope.revision
      : null,
  };
}

/** SQLite 唯一约束（作用域索引 / session_id）错误识别。 */
function isUniqueViolation(err: unknown): boolean {
  const message = String((err as any)?.message ?? err);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message);
}

/**
 * 唯一约束冲突归因（决定能不能回收会话）：
 * - `session_id`：runtime 会话在本次调用**之前**就已登记（别的作用域/节点持有），
 *   绝不能 dispose——那会删掉另一个 agent 的活会话与 transcript；
 * - `active_scope`：本次新建的会话在作用域竞争里输了，可以回收；
 * - `unique_unknown`：未知唯一约束，保守按「可能已存在」处理（只报错不回收）；
 * - `other`：非唯一约束错误（本次建的行/会话可回收）。
 */
function leaseConflictKind(err: unknown): 'session_id' | 'active_scope' | 'unique_unknown' | 'other' {
  if (!isUniqueViolation(err)) return 'other';
  const message = String((err as any)?.message ?? err);
  if (/pod_member_sessions\.session_id/.test(message)) return 'session_id';
  if (message.includes('idx_pod_member_sessions_active_scope')) return 'active_scope';
  return 'unique_unknown';
}

/**
 * 作用域会话管理员：按 `(podId, memberId, goalId, revision, kind)` 查找、复用、
 * 重建和退休内部会话。
 *
 * - `ensure`：精确作用域命中存活租约则复用；否则（含 isAlive=false 的死亡租约）
 *   结束旧行并以 generation+1 建新租约。数据库唯一索引兜底跨实例竞争。
 * - `retire`：只结束该作用域的活跃租约，不动其它作用域/成员。
 * - `current`：只读查询（不建、不结束、不盖 last_active_at）；死亡租约返回 null，
 *   交给 `ensure` 处理。
 */
export class PodSessionSupervisor {
  private readonly inflight = new Map<string, Promise<PodSessionLease>>();

  constructor(private readonly deps: PodSessionSupervisorDeps) {}

  async ensure(
    requested: PodSessionScope,
    create: () => Promise<string> | string,
  ): Promise<PodSessionLease> {
    const scope = normalizeScope(requested);
    // 并发 ensure 单飞：同一作用域只建一次租约（否则两个 create 会各写一行、
    // 一个租约立刻成为孤儿）。跨实例/跨进程竞争由 DB 唯一索引兜底。
    const key = scopeKey(scope);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = this.ensureLease(scope, create).finally(() => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  /** 结束该作用域当前的活跃租约；返回是否真的结束了什么。 */
  retire(requested: PodSessionScope): boolean {
    const scope = normalizeScope(requested);
    const active = this.deps.store.getActiveScopedSession(scope);
    if (!active) return false;
    this.deps.store.endSession(active.sessionId, this.deps.now());
    this.emit(scope);
    return true;
  }

  /** 只读查看当前租约；isAlive=false 时返回 null（不在此处销毁）。 */
  async current(requested: PodSessionScope): Promise<PodSessionLease | null> {
    // 只读语义（M4）：不创建、不结束、也不盖 last_active_at。
    const scope = normalizeScope(requested);
    const active = this.deps.store.getActiveScopedSession(scope);
    if (!active) return null;
    if (!(await this.isAlive(active.sessionId))) return null;
    return {
      sessionId: active.sessionId,
      generation: generationOf(active),
      reused: true,
    };
  }

  private async ensureLease(
    scope: PodSessionScope,
    create: () => Promise<string> | string,
  ): Promise<PodSessionLease> {
    const active = this.deps.store.getActiveScopedSession(scope);
    if (active) {
      if (await this.isAlive(active.sessionId)) {
        this.deps.store.touchSession(active.sessionId, this.deps.now());
        return {
          sessionId: active.sessionId,
          generation: generationOf(active),
          reused: true,
        };
      }
      this.deps.store.endSession(active.sessionId, this.deps.now());
      this.deps.log?.(
        `[Pod] dead scoped session retired: ${active.sessionId} (${scope.kind}, generation ${generationOf(active)})`,
      );
      this.emit(scope);
    }

    const now = this.deps.now();
    const sessionId = await create();
    const claimed = this.deps.store.getSessionBySessionId(sessionId);
    if (claimed) {
      // runtime 返回了一个**本调用之前**就已登记给别的会话的行：拒绝静默复用
      // （否则租约指向错作用域，后续查找永远 miss 并不断重建）。
      // 这个会话不属于我们：只记结构化告警并报 409，**绝不 dispose**（I-3 round 2）。
      const owner = claimed.scopeKind ?? claimed.node ?? 'unknown';
      this.warnExistingSession(
        sessionId,
        `already bound to ${owner} (${claimed.podId}), scope ${claimed.goalId ?? '-'}/${claimed.revision ?? '-'}`,
      );
      throw new PodError(
        409,
        `session ${sessionId} already bound to ${owner} `
        + `(${claimed.podId}); cannot lease it as ${scope.kind}`,
      );
    }

    let row: PodSessionRow;
    try {
      // 世代读取 + 插入在同一事务；作用域唯一索引兜底跨实例竞争（I-1）。
      row = this.deps.store.leaseScopedSession({
        id: this.deps.newId?.() ?? `podsess_${randomUUID()}`,
        scope,
        sessionId,
        now,
      });
    } catch (err) {
      const conflict = leaseConflictKind(err);
      if (conflict === 'session_id' || conflict === 'unique_unknown') {
        // 会话 id 已在别处登记（或无法归因的唯一约束）：同 claimed-guard，
        // 该 runtime 会话可能早于本调用存在 → 只告警 + 409，不 dispose。
        this.warnExistingSession(sessionId, `insert rejected by unique constraint: ${String((err as any)?.message ?? err)}`);
        throw new PodError(
          409,
          `session ${sessionId} already bound elsewhere; cannot lease it as ${scope.kind}`,
        );
      }
      if (conflict === 'active_scope') {
        // 输给并发实例：它已写入该作用域的活跃租约，我们复用赢家并回收自己刚建的会话。
        const winner = this.deps.store.getActiveScopedSession(scope);
        if (winner) {
          await this.releaseUnleased(sessionId, 'lost the active-lease race');
          this.deps.log?.(
            `[Pod] scoped lease race lost for ${scope.kind}; reusing ${winner.sessionId} `
            + `(generation ${generationOf(winner)})`,
          );
          return {
            sessionId: winner.sessionId,
            generation: generationOf(winner),
            reused: true,
          };
        }
        await this.releaseUnleased(sessionId, 'unique violation without a winner');
        throw new PodError(
          409,
          `session ${sessionId} conflicts with another pod session row; cannot lease it as ${scope.kind}`,
        );
      }
      await this.releaseUnleased(sessionId, String((err as any)?.message ?? err));
      throw err;
    }

    this.emit(scope);
    return { sessionId: row.sessionId, generation: generationOf(row), reused: false };
  }

  /**
   * 已存在的 runtime 会话只告警不回收（I-3 round 2）：dispose 接线到
   * `runtime.session.delete` 后，误删别的作用域/节点的活会话（含 transcript）
   * 是不可逆的破坏，宁可让它留着由原持有者管理。
   */
  private warnExistingSession(sessionId: string, reason: string): void {
    this.deps.log?.(`[Pod] refusing to lease existing session ${sessionId}: ${reason}`);
  }

  /**
   * 回收**本次调用新建**、但没被任何租约接住的 runtime 会话（I-3）：best-effort，
   * 删不掉也不掩盖原错误；无论 dispose 是否存在都留结构化日志，避免运行资源静默泄漏。
   */
  private async releaseUnleased(sessionId: string, reason: string): Promise<void> {
    this.deps.log?.(`[Pod] releasing unleased session ${sessionId}: ${reason}`);
    const dispose = this.deps.dispose;
    if (!dispose) return;
    try {
      await dispose(sessionId);
    } catch (err: any) {
      this.deps.log?.(
        `[Pod] dispose failed for unleased session ${sessionId} (leaked, non-fatal): ${err?.message ?? err}`,
      );
    }
  }

  private async isAlive(sessionId: string): Promise<boolean> {
    const probe = this.deps.isAlive;
    if (!probe) return true;
    try {
      return (await probe(sessionId)) !== false;
    } catch (err: any) {
      this.deps.log?.(
        `[Pod] session liveness probe failed for ${sessionId} (treated as alive): ${err?.message ?? err}`,
      );
      return true;
    }
  }

  private emit(scope: PodSessionScope): void {
    this.deps.broadcast?.({
      type: 'pod.updated',
      properties: { podId: scope.podId, kind: 'session' },
    });
  }
}

function scopeKey(scope: PodSessionScope): string {
  return [
    scope.podId,
    scope.memberId,
    scope.goalId ?? '',
    scope.revision === null ? '' : String(scope.revision),
    scope.kind,
  ].join('\u0000');
}
