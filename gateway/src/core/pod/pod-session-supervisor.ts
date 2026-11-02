import { randomUUID } from 'crypto';
import type {
  PodSessionRow,
  PodSessionScopeKey,
  PodStore,
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
  broadcast?(event: { type: string; properties?: Record<string, unknown> }): void;
  log?(message: string): void;
}

function generationOf(row: PodSessionRow): number {
  return Number.isFinite(row.generation) && row.generation > 0 ? row.generation : 1;
}

/**
 * 作用域会话管理员：按 `(podId, memberId, goalId, revision, kind)` 查找、复用、
 * 重建和退休内部会话。
 *
 * - `ensure`：精确作用域命中存活租约则复用；否则（含 isAlive=false 的死亡租约）
 *   结束旧行并以 generation+1 建新租约。
 * - `retire`：只结束该作用域的活跃租约，不动其它作用域/成员。
 * - `current`：只读查询（不建、不结束）；死亡租约返回 null，交给 `ensure` 处理。
 */
export class PodSessionSupervisor {
  private readonly inflight = new Map<string, Promise<PodSessionLease>>();

  constructor(private readonly deps: PodSessionSupervisorDeps) {}

  async ensure(
    scope: PodSessionScope,
    create: () => Promise<string> | string,
  ): Promise<PodSessionLease> {
    // 并发 ensure 单飞：同一作用域只建一次租约（否则两个 create 会各写一行、
    // 一个租约立刻成为孤儿）。
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
  retire(scope: PodSessionScope): boolean {
    const active = this.deps.store.getActiveScopedSession(scope);
    if (!active) return false;
    this.deps.store.endSession(active.sessionId, this.deps.now());
    this.emit(scope);
    return true;
  }

  /** 只读查看当前租约；isAlive=false 时返回 null（不在此处销毁）。 */
  async current(scope: PodSessionScope): Promise<PodSessionLease | null> {
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

    const generation = this.deps.store.getScopedGeneration(scope) + 1;
    const now = this.deps.now();
    const sessionId = await create();
    const claimed = this.deps.store.getSessionBySessionId(sessionId);
    if (claimed) {
      // runtime 返回了一个已登记给别的会话的行：拒绝静默复用（否则租约指向
      // 错作用域，后续查找永远 miss 并不断重建）。
      throw new Error(
        `[Pod] session ${sessionId} already bound to ${claimed.scopeKind ?? claimed.node ?? 'unknown'} `
        + `(${claimed.podId}); cannot lease it as ${scope.kind}`,
      );
    }
    this.deps.store.insertSession({
      id: this.deps.newId?.() ?? `podsess_${randomUUID()}`,
      podId: scope.podId,
      memberId: scope.memberId,
      goalId: scope.goalId,
      // 作用域元点是权威；`node` 留给历史节点会话。
      node: null,
      sessionId,
      status: 'active',
      transcriptRef: null,
      scopeKind: scope.kind,
      revision: scope.revision,
      generation,
      lastActiveAt: now,
      now,
    });
    this.emit(scope);
    return { sessionId, generation, reused: false };
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
