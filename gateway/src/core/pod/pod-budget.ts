import type { PodStore } from './pod-store';

export interface PodBudgetDeps {
  store: PodStore;
  costForSessions(sessionIds: string[], sinceEpoch: number): number;
  dailyUsd(podId: string): number;
  nowEpoch(): number;
}

export interface PodBudgetState {
  spentUsd: number;
  limitUsd: number;
}

export class PodBudget {
  constructor(private readonly deps: PodBudgetDeps) {}

  cost(podId: string): PodBudgetState {
    const since = Math.max(0, this.deps.nowEpoch() - 24 * 60 * 60);
    const ids = this.deps.store.listSessionIds(podId, since);
    return {
      spentUsd: ids.length > 0 ? this.deps.costForSessions(ids, since) : 0,
      limitUsd: this.deps.dailyUsd(podId),
    };
  }

  canStart(podId: string): PodBudgetState & { ok: boolean } {
    const state = this.cost(podId);
    return {
      ...state,
      ok: state.limitUsd <= 0 || state.spentUsd < state.limitUsd,
    };
  }
}
