/**
 * E4-6 子进程台账（spec §4.6）。
 *
 * gateway 会 spawn 三类子进程：per-session python kernel、llamacpp embedding
 * sidecar、runtime serve sidecar。台账是"当前还活着几个"的唯一真相：
 *  - `release()` 必须幂等：child `exit` 与主动 kill 两条路径都会释放同一个条目；
 *  - `disposeAll()` 在 shutdown/测试收尾调用，close 钩子 best-effort（一个失败
 *    不能把其余进程留在后台），随后清空；
 *  - `snapshot()` 只暴露可序列化字段（不泄漏 close 闭包），供 `/api/kernel/stats`。
 */
export type ProcessKind = 'python' | 'llamacpp' | 'serve';

export interface ProcessEntry {
  id: string;
  kind: ProcessKind;
  pid?: number;
  sessionId?: string;
  label?: string;
  /** runtime serve 由 adapter 拥有进程，E4 只记逻辑条目（`owned:false`）。 */
  owned?: boolean;
  startedAt: number;
}

export interface ProcessHandle {
  readonly id: string;
  /** 从台账移除条目；幂等（首次调用生效，之后为 no-op）。 */
  release(): void;
}

export interface ProcessRegisterInput extends Omit<ProcessEntry, 'id' | 'startedAt'> {
  /** 缺省 = 注册时刻。 */
  startedAt?: number;
  /** disposeAll 时调用的清理钩子（kill/close），best-effort。 */
  close?: () => void;
}

export interface ProcessLedgerSnapshot {
  total: number;
  byKind: Record<ProcessKind, number>;
  entries: ProcessEntry[];
}

interface StoredEntry {
  entry: ProcessEntry;
  close?: () => void;
}

export class ProcessLedger {
  private readonly stored = new Map<string, StoredEntry>();
  private seq = 0;

  register(input: ProcessRegisterInput): ProcessHandle {
    const id = `proc-${++this.seq}`;
    const { close, ...rest } = input;
    const entry: ProcessEntry = {
      ...rest,
      id,
      startedAt: input.startedAt ?? Date.now(),
    };
    this.stored.set(id, { entry, close });

    let released = false;
    return {
      id,
      release: () => {
        if (released) return;
        released = true;
        this.stored.delete(id);
      },
    };
  }

  count(kind?: ProcessKind): number {
    if (!kind) return this.stored.size;
    let n = 0;
    for (const { entry } of this.stored.values()) if (entry.kind === kind) n++;
    return n;
  }

  list(): ProcessEntry[] {
    return Array.from(this.stored.values(), ({ entry }) => ({ ...entry }));
  }

  snapshot(): ProcessLedgerSnapshot {
    const byKind = { python: 0, llamacpp: 0, serve: 0 } as Record<ProcessKind, number>;
    for (const { entry } of this.stored.values()) byKind[entry.kind]++;
    const entries = this.list();
    return { total: entries.length, byKind, entries };
  }

  /** 调 close 钩子（best-effort），然后清空台账；之后 release 均为 no-op。 */
  disposeAll(): void {
    const stored = Array.from(this.stored.values());
    this.stored.clear();
    for (const { close } of stored) {
      if (!close) continue;
      try {
        close();
      } catch {
        /* best-effort: 一个进程清理失败不能阻断其余进程 */
      }
    }
  }
}
