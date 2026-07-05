export interface BudgetCategory {
  parametric: any[];
  procedural: any[];
  semantic: any[];
  episodic: any[];
}

export interface AllocatedMemory extends BudgetCategory {
  totalTokens: number;
  p0Budget?: number;
  p1Budget?: number;
  p2Budget?: number;
  p3Budget?: number;
}

export class TokenBudgetAllocator {
  private defaultBudget: number;
  private allocations: Record<string, number>;
  private useWatermark: boolean;

  constructor(config?: {
    defaultBudget?: number;
    allocations?: Record<string, number>;
  }) {
    this.defaultBudget = config?.defaultBudget ?? 8000;
    this.useWatermark = !config?.allocations;
    this.allocations = {
      parametric: 0.25,
      procedural: 0.20,
      semantic: 0.30,
      episodic: 0.15,
      buffer: 0.10,
      ...config?.allocations
    };
  }

  allocate(memories: BudgetCategory, totalBudget?: number, model?: string): AllocatedMemory {
    const budget = totalBudget ?? this.defaultBudget;
    const compressPct = model === 'haiku' ? 0.5 : 1.0;

    const order: (keyof BudgetCategory)[] = ['parametric', 'procedural', 'semantic', 'episodic'];
    const selected: Record<string, any[]> = { parametric: [], procedural: [], semantic: [], episodic: [] };
    let totalUsed = 0;
    const unselected: { item: any; category: string }[] = [];

    if (!this.useWatermark) {
      // Legacy percentage-based allocation
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
      // Buffer fill: recycle unused budget across all categories
      let buf = Math.floor(budget * (this.allocations.buffer ?? 0));
      for (const category of order) {
        const catBudget = Math.floor(budget * (this.allocations[category] ?? 0));
        const catUsed = selected[category].reduce(
          (sum: number, item: any) => sum + this.estimateItemTokens(item, category), 0
        );
        buf += catBudget - catUsed;
      }
      unselected.sort((a, b) => {
        const ea = typeof a.item.energy === 'number' ? a.item.energy : 0;
        const eb = typeof b.item.energy === 'number' ? b.item.energy : 0;
        return eb - ea;
      });
      for (const { item, category } of unselected) {
        const tokens = this.estimateItemTokens(item, category);
        if (tokens <= buf) {
          selected[category].push(item);
          buf -= tokens;
          totalUsed += tokens;
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

    // Dynamic watermark mode
    const watermark = {
      p0: { budget: Math.min(3000, budget * 0.20), key: 'parametric' as keyof BudgetCategory },
      p1: { budget: Math.min(5000, budget * 0.35), key: 'procedural' as keyof BudgetCategory },
      p2: { budget: Math.min(4000, budget * 0.30) * compressPct, key: 'semantic' as keyof BudgetCategory },
      p3: { budget: Math.min(2000, budget * 0.15) * compressPct, key: 'episodic' as keyof BudgetCategory }
    };

    for (const cat of order) {
      let catItems = [...(memories[cat] ?? [])];
      catItems.sort((a, b) => {
        const ea = typeof a.energy === 'number' ? a.energy : 0;
        const eb = typeof b.energy === 'number' ? b.energy : 0;
        return eb - ea;
      });
      const catBudget = this.getWatermarkBudget(watermark, cat);
      let remaining = catBudget;
      for (const item of catItems) {
        const tokens = this.estimateItemTokens(item, cat);
        if (tokens <= remaining) {
          selected[cat].push(item);
          remaining -= tokens;
        }
      }
      totalUsed += catBudget - remaining;
    }

    return {
      parametric: selected.parametric,
      procedural: selected.procedural,
      semantic: selected.semantic,
      episodic: selected.episodic,
      totalTokens: totalUsed,
      p0Budget: watermark.p0.budget,
      p1Budget: watermark.p1.budget,
      p2Budget: watermark.p2.budget,
      p3Budget: watermark.p3.budget
    };
  }

  private getWatermarkBudget(watermark: any, category: string): number {
    for (const [, v] of Object.entries(watermark)) {
      const entry = v as any;
      if (entry.key === category) return entry.budget;
    }
    return 0;
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
