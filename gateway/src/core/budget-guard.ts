/**
 * BudgetGuard —— 回合预算硬停（turnBudgetApi 缺位 runtime 的 gateway 侧兜底）。
 * 由调用方在会话每个已结算 step（EventFacets.step）喂 onStep()；
 * 超限 → abort + noReply 通知，自动 detonate（最多触发一次）。
 */
export interface BudgetGuardOpts {
  sessionID: string;
  maxTurns?: number;
  maxCostUsd?: number;
  getCostUsd(sessionID: string): number;
  abort(sessionID: string): Promise<void>;
  notify(sessionID: string, text: string): Promise<void>;
  log?(msg: string): void;
}

export class BudgetGuard {
  private turns = 0;
  private fired = false;
  private detached = false;

  constructor(private opts: BudgetGuardOpts) {}

  get triggered(): boolean { return this.fired; }

  onStep(): void {
    if (this.fired || this.detached) return;
    this.turns++;
    const { maxTurns, maxCostUsd } = this.opts;
    let reason: string | null = null;
    if (typeof maxTurns === 'number' && maxTurns > 0 && this.turns >= maxTurns) {
      reason = `maxTurns=${maxTurns}`;
    } else if (typeof maxCostUsd === 'number' && maxCostUsd > 0) {
      try {
        if (this.opts.getCostUsd(this.opts.sessionID) >= maxCostUsd) reason = `maxCostUsd=${maxCostUsd}`;
      } catch { /* 成本查询失败不阻断 */ }
    }
    if (!reason) return;
    this.fired = true;
    const sid = this.opts.sessionID;
    const log = this.opts.log ?? (() => {});
    log(`[BudgetGuard] ${sid} budget exceeded (${reason}) — aborting`);
    void (async () => {
      try { await this.opts.abort(sid); } catch (err: any) { log(`[BudgetGuard] abort failed (non-fatal): ${err?.message ?? err}`); }
      try {
        await this.opts.notify(sid, `[MAFW] 预算上限已触发（${reason}），会话已中止。调整预算后可重新发起。`);
      } catch (err: any) { log(`[BudgetGuard] notify failed (non-fatal): ${err?.message ?? err}`); }
    })();
  }

  detach(): void { this.detached = true; }
}
