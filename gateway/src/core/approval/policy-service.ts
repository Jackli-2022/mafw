// 评估顺序（spec §6.2，逐条短路）：
//   1. 内部会话 → auto-deny + warn（deny instead of prompt，Claude dontAsk 语义）
//   2. MAFW 持久白名单命中 → auto-approve
//   3. session mode === manual → human
//   4. classifySafety === dangerous → human（高危永不自动放行）
//   5. 预算耗尽（25 次连续 auto）→ 回落 manual + 广播 → human
//   6. 其余 → auto-approve（计数 +1）
// evaluate 必须同步（handleOpencodeEvent 是同步路径）；kv 懒加载，未完成时按 manual 保守。

import { ApprovalCandidate, SafetyVerdict, classifySafety } from './safety-classifier';

export type SessionPermissionMode = 'manual' | 'auto';
export const AUTO_APPROVE_BUDGET = 25;

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
        .then((m) => { if (m === 'auto' || m === 'manual') this.modes.set(sessionID, m); })
        .catch(() => { /* fail-open：保持 manual 缺省 */ })
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
    void this.ensureLoaded(sessionID); // fire-and-forget：本次按缺省 manual 保守处理
    // 2. 持久白名单
    if (this.deps.allowlistMatches(candidate.toolName, candidate)) {
      return { action: 'auto-approve', verdict: classifySafety(candidate), reason: 'persistent allowlist match' };
    }
    // 3. manual → human
    const mode = this.modes.get(sessionID) ?? 'manual';
    if (mode !== 'auto') {
      return { action: 'human', verdict: classifySafety(candidate), reason: `session mode=${mode}` };
    }
    // 4. dangerous 永不自动放行
    const verdict = classifySafety(candidate);
    if (verdict === 'dangerous') {
      return { action: 'human', verdict, reason: 'dangerous command pattern' };
    }
    // 5. 预算
    const used = this.counts.get(sessionID) ?? 0;
    if (used >= AUTO_APPROVE_BUDGET) {
      this.modes.set(sessionID, 'manual');
      this.counts.delete(sessionID);
      void this.deps.saveMode(sessionID, 'manual').catch(() => {});
      this.deps.onModeChanged(sessionID, 'manual', `auto-approve budget (${AUTO_APPROVE_BUDGET}) exhausted — fell back to manual`);
      return { action: 'human', verdict, reason: 'budget exhausted, mode fell back to manual' };
    }
    // 6. auto-approve
    this.counts.set(sessionID, used + 1);
    return { action: 'auto-approve', verdict, reason: `auto mode (${used + 1}/${AUTO_APPROVE_BUDGET})` };
  }

  async getMode(sessionID: string): Promise<SessionPermissionMode> {
    await this.ensureLoaded(sessionID);
    return this.modes.get(sessionID) ?? 'manual';
  }

  getAutoApprovals(sessionID: string): number {
    return this.counts.get(sessionID) ?? 0;
  }

  async setMode(sessionID: string, mode: SessionPermissionMode): Promise<void> {
    this.modes.set(sessionID, mode);
    this.counts.delete(sessionID); // 显式切换 = 预算重置（spec §6.2）
    this.deps.onModeChanged(sessionID, mode, 'user toggled');
    try { await this.deps.saveMode(sessionID, mode); } catch { /* fail-open：内存态已生效 */ }
  }
}
