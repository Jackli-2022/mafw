/**
 * E4-1 命名定时器台账。
 *
 * 常驻 gateway 里的 `setInterval` 原本散落在各子系统，无法统一观测或关闭：
 * 谁起的、起在哪、shutdown 时留没留 handle 都只能靠 grep。TimerService 把
 * kernel 自有长驻 timer 收进一个注册表：
 *
 *  - 名称唯一（活着的同名注册直接抛错，防两个子系统互相覆盖）；
 *  - 默认 `unref: true`，定时器不会单独把进程钉住；
 *  - `clear` / `disposeAll` 幂等，shutdown 后不留 handle；
 *  - `stats()` 供 `/api/kernel/stats` 观测。
 *
 * 短命 retry/sleep/超时不进这里（spec §2 非目标）。
 */
export interface TimerHandle {
  readonly name: string;
  /** 幂等；只会清掉本 handle 对应的定时器，不会误伤同名重注册的新定时器。 */
  clear(): void;
}

export interface TimerOptions {
  /** 默认 true：定时器不保持进程存活。 */
  unref?: boolean;
}

interface TimerEntry {
  readonly name: string;
  handle: TimerHandle;
  timer: NodeJS.Timeout | null;
}

export class TimerService {
  private readonly entries = new Map<string, TimerEntry>();

  every(name: string, ms: number, fn: () => void, opts?: TimerOptions): TimerHandle {
    return this.register('every', name, ms, fn, opts);
  }

  after(name: string, ms: number, fn: () => void, opts?: TimerOptions): TimerHandle {
    return this.register('after', name, ms, fn, opts);
  }

  /** 幂等。传 null/undefined 静默忽略（调用点常是可选 handle）。 */
  clear(handle: TimerHandle | null | undefined): void {
    if (!handle) return;
    const entry = this.entries.get(handle.name);
    if (!entry || entry.handle !== handle) return;
    this.clearEntry(entry);
  }

  /** 清掉所有名字以 `prefix` 开头的定时器，返回清除数量。用于连接级 timer。 */
  clearByPrefix(prefix: string): number {
    let cleared = 0;
    for (const entry of Array.from(this.entries.values())) {
      if (entry.name.startsWith(prefix)) {
        this.clearEntry(entry);
        cleared++;
      }
    }
    return cleared;
  }

  /** shutdown 用；清空本组 handle，幂等。 */
  disposeAll(): void {
    for (const entry of Array.from(this.entries.values())) {
      this.clearEntry(entry);
    }
  }

  stats(): { active: number; byName: Record<string, number> } {
    const byName: Record<string, number> = {};
    for (const name of this.entries.keys()) {
      byName[name] = (byName[name] || 0) + 1;
    }
    return { active: this.entries.size, byName };
  }

  private register(
    kind: 'every' | 'after',
    name: string,
    ms: number,
    fn: () => void,
    opts?: TimerOptions,
  ): TimerHandle {
    if (!name) throw new Error('TimerService: timer name is required');
    if (this.entries.has(name)) {
      throw new Error(`TimerService: timer "${name}" is already registered`);
    }

    const entry = { name } as TimerEntry;
    const handle: TimerHandle = { name, clear: () => this.clear(handle) };
    entry.handle = handle;
    entry.timer = null;

    const run = () => {
      if (kind === 'after') {
        // 一次性定时器触发即离开台账；clear 仍幂等。
        if (this.entries.get(name) === entry) this.entries.delete(name);
        entry.timer = null;
      }
      fn();
    };

    const timer = kind === 'every' ? setInterval(run, ms) : setTimeout(run, ms);
    if (opts?.unref !== false && typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    entry.timer = timer;
    // `after` 的 ms 极小时 run 仍会在当前栈之后执行，不会早于 set 完成。
    this.entries.set(name, entry);
    return handle;
  }

  private clearEntry(entry: TimerEntry): void {
    if (entry.timer) {
      clearTimeout(entry.timer as NodeJS.Timeout);
      entry.timer = null;
    }
    if (this.entries.get(entry.name) === entry) this.entries.delete(entry.name);
  }
}
