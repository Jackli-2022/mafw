export interface StateLock {
  goalId: string;
  loopNum: number;
  waveNum: number;
  agentId: string;
  acquiredAt: string;
  expiresAt: string;
}

export class StateLockManager {
  private locks: Map<string, StateLock> = new Map();
  private defaultTimeout: number;
  private sweepInterval?: NodeJS.Timeout;

  constructor(config?: { defaultTimeout?: number; sweepIntervalMs?: number }) {
    this.defaultTimeout = config?.defaultTimeout ?? 300000;
    if (config?.sweepIntervalMs) {
      this.startSweep(config.sweepIntervalMs);
    }
  }

  private lockKey(goalId: string, loopNum: number, waveNum: number): string {
    return `${goalId}:${loopNum}:${waveNum}`;
  }

  async acquireLock(
    goalId: string,
    loopNum: number,
    waveNum: number,
    agentId: string,
    timeout?: number
  ): Promise<boolean> {
    const key = this.lockKey(goalId, loopNum, waveNum);
    const existing = this.locks.get(key);
    const now = new Date();
    if (existing && new Date(existing.expiresAt) > now) {
      return false;
    }
    if (existing && new Date(existing.expiresAt) <= now) {
      this.locks.delete(key);
    }
    const t = timeout ?? this.defaultTimeout;
    this.locks.set(key, {
      goalId,
      loopNum,
      waveNum,
      agentId,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + t).toISOString()
    });
    return true;
  }

  async releaseLock(goalId: string, loopNum: number, waveNum: number): Promise<void> {
    this.locks.delete(this.lockKey(goalId, loopNum, waveNum));
  }

  async heartbeat(goalId: string, loopNum: number, waveNum: number): Promise<void> {
    const key = this.lockKey(goalId, loopNum, waveNum);
    const lock = this.locks.get(key);
    if (lock) {
      lock.expiresAt = new Date(Date.now() + this.defaultTimeout).toISOString();
    }
  }

  getLock(goalId: string, loopNum: number, waveNum: number): StateLock | null {
    const key = this.lockKey(goalId, loopNum, waveNum);
    const lock = this.locks.get(key);
    if (lock && new Date(lock.expiresAt) > new Date()) {
      return lock;
    }
    if (lock) {
      this.locks.delete(key);
    }
    return null;
  }

  isLocked(goalId: string, loopNum: number, waveNum: number): boolean {
    return this.getLock(goalId, loopNum, waveNum) !== null;
  }

  async releaseAllForGoal(goalId: string): Promise<void> {
    for (const [key, lock] of this.locks) {
      if (lock.goalId === goalId) {
        this.locks.delete(key);
      }
    }
  }

  startSweep(intervalMs?: number): void {
    this.stop();
    this.sweepInterval = setInterval(() => {
      const now = new Date();
      for (const [key, lock] of this.locks) {
        if (new Date(lock.expiresAt) <= now) {
          this.locks.delete(key);
        }
      }
    }, intervalMs ?? 60000);
  }

  stop(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = undefined;
    }
  }

  getActiveLocks(): StateLock[] {
    const now = new Date();
    return Array.from(this.locks.values()).filter(
      lock => new Date(lock.expiresAt) > now
    );
  }
}
