/**
 * Metrics Collector — Gateway 运行时指标收集
 */

import { config } from '../config';

export class MetricsCollector {
  private metrics: any[] = [];

  async record(data: {
    goalId: string;
    phase: string | null;
    loop: number;
    sessionCount: number;
    timestamp: string;
  }): Promise<void> {
    this.metrics.push(data);
    // 限制内存中的指标数量
    if (this.metrics.length > config.metrics.maxInMemory) {
      this.metrics = this.metrics.slice(-config.metrics.pruneRetainCount);
    }
  }

  async getSnapshot(): Promise<any> {
    return {
      totalGoals: new Set(this.metrics.map(m => m.goalId)).size,
      activePhases: this.metrics.reduce((acc, m) => {
        acc[m.phase] = (acc[m.phase] || 0) + 1;
        return acc;
      }, {}),
      recent: this.metrics.slice(-config.metrics.recentSnapshotSize)
    };
  }
}
