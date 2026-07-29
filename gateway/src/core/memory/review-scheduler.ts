import * as fs from 'fs';
import * as path from 'path';
import { HarmonicIndexManager } from './harmonic-index';

export interface ReviewTask {
  unitId: string;
  primaryAbstraction: string;
  overdue: number;
}

export function getNextInterval(reviewCount: number): number {
  return Math.pow(2, reviewCount);
}

export class ReviewScheduler {
  private indexManager: HarmonicIndexManager;
  private baseDir: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private queue: ReviewTask[] = [];

  constructor(indexManager: HarmonicIndexManager, baseDir: string) {
    this.indexManager = indexManager;
    this.baseDir = baseDir;
  }

  start(periodMs: number = 3600000): void {
    this.timer = setInterval(() => this.tick(), periodMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getReviewQueue(): ReviewTask[] {
    return [...this.queue];
  }

  tick(): void {
    const index = this.indexManager.getIndex();
    const nowTime = this.now();
    const tasks: ReviewTask[] = [];

    for (const entry of index.entries) {
      if (entry.energy < 0.5) continue;

      const reviewCount = (entry as any).review_count || 0;
      const interval = getNextInterval(reviewCount);
      const daysSince = this.calcDaysSince(entry, nowTime);

      if (daysSince >= interval) {
        tasks.push({
          unitId: entry.id,
          primaryAbstraction: entry.primary_abstraction,
          overdue: daysSince - interval
        });
      }
    }

    tasks.sort((a, b) => b.overdue - a.overdue);
    this.queue = tasks.slice(0, 3);

    const queuePath = path.join(this.baseDir, 'memory', '.review_queue.json');
    const tmpPath = queuePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.queue, null, 2), 'utf-8');
    fs.renameSync(tmpPath, queuePath);
  }

  private now(): number {
    return Date.now();
  }

  private calcDaysSince(entry: any, nowTime: number): number {
    const lastReviewed = (entry as any).last_reviewed || (entry as any).created_at;
    if (!lastReviewed) return 0;
    const lastTime = new Date(lastReviewed).getTime();
    return (nowTime - lastTime) / (24 * 60 * 60 * 1000);
  }
}
