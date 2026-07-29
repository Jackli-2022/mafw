export interface AgentConfig {
  model: string;
  priority: 'quality' | 'cost';
}

export interface RouterConfig {
  agents: {
    plan: AgentConfig;
    execute: AgentConfig;
    review: AgentConfig;
  };
  budget: {
    total: number;
    perGoal: number;
    threshold: number;
  };
}

export const defaultRouterConfig: RouterConfig = {
  agents: {
    plan: { model: 'claude-sonnet-4-20250514', priority: 'quality' },
    execute: { model: 'claude-sonnet-4-20250514', priority: 'quality' },
    review: { model: 'claude-haiku-3-5-20241022', priority: 'cost' }
  },
  budget: { total: 1000000, perGoal: 200000, threshold: 0.8 }
};

type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T;

export interface ModelSelection {
  model: string;
  reason: string;
}

export class CognitiveRouter {
  private config: RouterConfig;

  constructor(config?: DeepPartial<RouterConfig>) {
    this.config = this.mergeConfig(defaultRouterConfig, config as unknown as Partial<RouterConfig>);
  }

  selectModel(
    agentType: 'plan' | 'execute' | 'review',
    remainingBudget: number,
    totalBudget: number
  ): ModelSelection {
    const usage = 1 - (remainingBudget / totalBudget);
    const agentConfig = this.config.agents[agentType];

    if (usage > this.config.budget.threshold && agentType === 'execute') {
      return { model: 'haiku', reason: 'budget_threshold' };
    }

    return { model: agentConfig.model, reason: 'default' };
  }

  getConfig(): RouterConfig {
    return { ...this.config };
  }

  private mergeConfig(base: RouterConfig, override?: Partial<RouterConfig>): RouterConfig {
    if (!override) return base;
    return {
      agents: {
        plan: { ...base.agents.plan, ...override.agents?.plan },
        execute: { ...base.agents.execute, ...override.agents?.execute },
        review: { ...base.agents.review, ...override.agents?.review }
      },
      budget: { ...base.budget, ...override.budget }
    };
  }
}
