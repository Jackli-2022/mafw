// Daily USD budget cap for background memory pipelines (extract / reflect /
// review / index-scan / consolidation judge). 0 or negative = unlimited
// (back-compat default). Fail-open: any spend-query error allows the run.

export interface PipelineBudgetLike {
  allow(pipeline: string): boolean;
}

export interface PipelineBudgetDeps {
  getSpendToday: () => number;
  budgetUsdPerDay: number;
  now?: () => Date;
  log?: (msg: string) => void;
}

export class PipelineBudget {
  private readonly deps: PipelineBudgetDeps;
  private readonly deniedLog = new Map<string, string>();

  constructor(deps: PipelineBudgetDeps) {
    this.deps = deps;
  }

  allow(pipeline: string): boolean {
    const cap = this.deps.budgetUsdPerDay;
    if (!(cap > 0)) return true;
    let spend: number;
    try {
      spend = this.deps.getSpendToday();
    } catch {
      return true;
    }
    if (spend < cap) return true;
    const day = (this.deps.now?.() ?? new Date()).toISOString().slice(0, 10);
    if (this.deniedLog.get(pipeline) !== day) {
      this.deniedLog.set(pipeline, day);
      this.deps.log?.(
        `[Budget] pipeline "${pipeline}" denied: daily spend $${spend.toFixed(4)} >= cap $${cap}`,
      );
    }
    return false;
  }
}
