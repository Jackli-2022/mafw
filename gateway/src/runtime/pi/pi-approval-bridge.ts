interface PendingRequest {
  resolve: (approved: boolean) => void;
  timeout: NodeJS.Timeout;
}

export type ApprovalDecision = 'once' | 'always' | 'reject';

export interface DecisionRecord {
  decision: ApprovalDecision;
  message?: string;
}

export class ApprovalBridge {
  private pending = new Map<string, PendingRequest>();
  private decisions = new Map<string, DecisionRecord>();
  private timeoutMs: number;

  constructor(timeoutMs: number = 300_000) {
    this.timeoutMs = timeoutMs;
  }

  request(requestId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(false);
      }, this.timeoutMs);

      this.pending.set(requestId, { resolve, timeout });
    });
  }

  /** 三值回复；兼容旧 boolean 调用（true→once / false→reject）。 */
  reply(requestId: string, decision: ApprovalDecision | boolean, message?: string): boolean {
    const req = this.pending.get(requestId);
    if (!req) return false;

    const normalized: ApprovalDecision =
      typeof decision === 'boolean' ? (decision ? 'once' : 'reject') : decision;
    clearTimeout(req.timeout);
    this.pending.delete(requestId);
    this.decisions.set(requestId, { decision: normalized, message });
    req.resolve(normalized !== 'reject');
    return true;
  }

  /** extension 回查决策（always → 动态 allowlist；reject → block reason）。 */
  lastDecision(requestId: string): DecisionRecord | null {
    return this.decisions.get(requestId) ?? null;
  }

  dispose(): void {
    for (const { resolve, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      resolve(false);
    }
    this.pending.clear();
  }
}
