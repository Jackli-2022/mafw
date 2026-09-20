// 评估顺序（spec §6.2 + 切片 1 三档化，逐条短路）：
//   1. 内部会话 → auto-deny + warn（deny instead of prompt，Claude dontAsk 语义；任何档位不豁免）
//   2. 持久规则/白名单命中 → auto-approve
//   3. session mode 三档预设：
//      read-only   → 只读工具（isReadOnlyTool）auto-approve，其余 human
//      full-access → 一律 auto-approve（dangerous 也放；不计数）
//      auto        → 4. dangerous → human；5. 预算耗尽（25）→ 回落 read-only + 广播 → human；
//                    6. 其余 auto-approve（计数 +1）
// 'manual' 为 legacy 别名：load/save/set 入参归一化为 'read-only'。
// evaluate 必须同步（handleOpencodeEvent 是同步路径）；kv 懒加载，未完成时按 read-only 保守。

import { ApprovalCandidate, SafetyVerdict, classifySafety, isReadOnlyTool } from './safety-classifier';

export type SessionPermissionMode = 'read-only' | 'auto' | 'full-access';
export const AUTO_APPROVE_BUDGET = 25;
const VALID_MODES: SessionPermissionMode[] = ['read-only', 'auto', 'full-access'];

/** legacy 'manual'（及任何未知值）归一化 read-only。 */
export function normalizeMode(m: unknown): SessionPermissionMode {
  if (m === 'auto' || m === 'full-access') return m;
  return 'read-only';
}

export interface PolicyDecision {
  action: 'auto-approve' | 'auto-deny' | 'human';
  verdict: SafetyVerdict;
  reason: string;
}

export interface ApprovalPolicyDeps {
  getInternalRole(sessionID: string): string | undefined;
  allowlistMatches(toolName: string, candidate: ApprovalCandidate): boolean;
  loadMode(sessionID: string): Promise<SessionPermissionMode>;
  saveMode(sessionID: string, mode: SessionPermissionMode): Promise<void>;
  onModeChanged(sessionID: string, mode: SessionPermissionMode, reason: string): void;
}

export class ApprovalPolicyService {
  private modes = new Map<string, SessionPermissionMode>();
  private counts = new Map<string, number>();
  private loadPromises = new Map<string, Promise<void>>();

  constructor(private deps: ApprovalPolicyDeps) {}

  private ensureLoaded(sessionID: string): Promise<void> {
    if (this.modes.has(sessionID)) return Promise.resolve();
    let p = this.loadPromises.get(sessionID);
    if (!p) {
      p = this.deps.loadMode(sessionID)
        .then((m) => { this.modes.set(sessionID, normalizeMode(m)); })
        .catch(() => { /* fail-open：保持 read-only 缺省 */ })
        .finally(() => { this.loadPromises.delete(sessionID); });
      this.loadPromises.set(sessionID, p);
    }
    return p;
  }

  evaluate(sessionID: string, candidate: ApprovalCandidate): PolicyDecision {
    // 1. 内部会话 fail-safe
    const role = this.deps.getInternalRole(sessionID);
    if (role) {
      return {
        action: 'auto-deny',
        verdict: classifySafety(candidate),
        reason: `internal session (role=${role}) — denied by fail-safe policy`,
      };
    }
    void this.ensureLoaded(sessionID); // fire-and-forget：本次按缺省 read-only 保守处理
    // 2. 持久规则/白名单
    if (this.deps.allowlistMatches(candidate.toolName, candidate)) {
      return { action: 'auto-approve', verdict: classifySafety(candidate), reason: 'persistent allowlist match' };
    }
    // 3. 三档预设
    const mode = this.modes.get(sessionID) ?? 'read-only';
    const verdict = classifySafety(candidate);
    if (mode === 'read-only') {
      if (isReadOnlyTool(candidate.toolName)) {
        return { action: 'auto-approve', verdict, reason: 'read-only mode — read-only tool' };
      }
      return { action: 'human', verdict, reason: 'read-only mode — mutating tool requires approval' };
    }
    if (mode === 'full-access') {
      return { action: 'auto-approve', verdict, reason: 'full-access mode' };
    }
    // 4. auto 档：dangerous 永不自动放行
    if (verdict === 'dangerous') {
      return { action: 'human', verdict, reason: 'dangerous command pattern' };
    }
    // 5. 预算
    const used = this.counts.get(sessionID) ?? 0;
    if (used >= AUTO_APPROVE_BUDGET) {
      this.modes.set(sessionID, 'read-only');
      this.counts.delete(sessionID);
      void this.deps.saveMode(sessionID, 'read-only').catch(() => {});
      this.deps.onModeChanged(sessionID, 'read-only', `auto-approve budget (${AUTO_APPROVE_BUDGET}) exhausted — fell back to read-only`);
      return { action: 'human', verdict, reason: 'budget exhausted, mode fell back to read-only' };
    }
    // 6. auto-approve
    this.counts.set(sessionID, used + 1);
    return { action: 'auto-approve', verdict, reason: `auto mode (${used + 1}/${AUTO_APPROVE_BUDGET})` };
  }

  async getMode(sessionID: string): Promise<SessionPermissionMode> {
    await this.ensureLoaded(sessionID);
    return this.modes.get(sessionID) ?? 'read-only';
  }

  getAutoApprovals(sessionID: string): number {
    return this.counts.get(sessionID) ?? 0;
  }

  async setMode(sessionID: string, mode: SessionPermissionMode | 'manual'): Promise<void> {
    const next = normalizeMode(mode);
    this.modes.set(sessionID, next);
    this.counts.delete(sessionID); // 显式切换 = 预算重置（spec §6.2）
    this.deps.onModeChanged(sessionID, next, 'user toggled');
    try { await this.deps.saveMode(sessionID, next); } catch { /* fail-open：内存态已生效 */ }
  }
}
