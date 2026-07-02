export interface BudgetCategory {
  parametric: any[];
  procedural: any[];
  semantic: any[];
  episodic: any[];
}

export interface AllocatedMemory extends BudgetCategory {
  totalTokens: number;
}

export class TokenBudgetAllocator {
  private defaultBudget: number;
  private allocations: Record<string, number>;

  constructor(config?: {
    defaultBudget?: number;
    allocations?: Record<string, number>;
  }) {
    this.defaultBudget = config?.defaultBudget ?? 8000;
    this.allocations = {
      parametric: 0.25,
      procedural: 0.20,
      semantic: 0.30,
      episodic: 0.15,
      buffer: 0.10,
      ...config?.allocations
    };
  }

  allocate(memories: BudgetCategory, totalBudget?: number): AllocatedMemory {
    const budget = totalBudget ?? this.defaultBudget;
    const order: (keyof BudgetCategory)[] = ['parametric', 'procedural', 'semantic', 'episodic'];

    const selected: Record<string, any[]> = {
      parametric: [], procedural: [], semantic: [], episodic: []
    };
    const unselected: { item: any; category: string }[] = [];
    let totalUsed = 0;

    for (const category of order) {
      const catBudget = Math.floor(budget * (this.allocations[category] ?? 0));
      const items = [...(memories[category] ?? [])];

      items.sort((a, b) => {
        const ea = typeof a.energy === 'number' ? a.energy : 0;
        const eb = typeof b.energy === 'number' ? b.energy : 0;
        return eb - ea;
      });

      let remaining = catBudget;
      for (const item of items) {
        const tokens = this.estimateItemTokens(item, category);
        if (tokens <= remaining) {
          selected[category].push(item);
          remaining -= tokens;
        } else {
          unselected.push({ item, category });
        }
      }

      totalUsed += catBudget - remaining;
    }

    const bufferBudget = Math.floor(budget * (this.allocations.buffer ?? 0));
    let bufferRemaining = bufferBudget;

    for (const category of order) {
      const catBudget = Math.floor(budget * (this.allocations[category] ?? 0));
      const catUsed = selected[category].reduce(
        (sum, item) => sum + this.estimateItemTokens(item, category), 0
      );
      bufferRemaining += catBudget - catUsed;
    }

    if (bufferRemaining > 0 && unselected.length > 0) {
      unselected.sort((a, b) => {
        const ea = typeof a.item.energy === 'number' ? a.item.energy : 0;
        const eb = typeof b.item.energy === 'number' ? b.item.energy : 0;
        return eb - ea;
      });

      for (const { item, category } of unselected) {
        const tokens = this.estimateItemTokens(item, category);
        if (tokens <= bufferRemaining) {
          selected[category].push(item);
          bufferRemaining -= tokens;
          totalUsed += tokens;
        }
      }
    }

    return {
      parametric: selected.parametric,
      procedural: selected.procedural,
      semantic: selected.semantic,
      episodic: selected.episodic,
      totalTokens: totalUsed
    };
  }

  estimateItemTokens(item: any, category: string): number {
    switch (category) {
      case 'parametric':
        return Math.ceil((item.content || item.rule || '').length / 4) + 10;
      case 'procedural':
        return Math.ceil((item.pattern || '').length / 4) + 15;
      case 'semantic':
        return Math.ceil((item.facts || []).join(' ').length / 4) + 20;
      case 'episodic':
        return Math.ceil((item.summary || item.content || '').length / 4) + 10;
      default:
        return 50;
    }
  }

  setDefaultBudget(budget: number): void {
    this.defaultBudget = budget;
  }
}
