import type { GatewayConfig } from '../config';
import { limitOf } from './settings';

/**
 * E4-4 连接表（spec §4.4）。
 *
 * 单一入口统计两类连接：
 *  - `httpOpen`：HTTP server `connection` 事件里的 socket 数（观测用；
 *    硬帽由 `server.maxConnections` 承担，没有软拒绝路径）；
 *  - 逻辑长连接 `sse / ws / voice / terminal`：`tryAcquire` 到上限后拒绝，
 *    返回的 lease 在连接关闭时 release。
 *
 * 所有上限每 acquire 一次就从 live getter 读取（hot reload 生效），
 * `0`/负数/非有限值 = 不限（见 `settings.limitOf`）。
 *
 * 计数不得为负：lease 的 `release` 自带一次性标志，`noteHttpClose` 也在 0
 * 处夹住。长驻进程里泄漏的负数会让上限彻底失效。
 */
export type ConnectionKind = 'sse' | 'ws' | 'voice' | 'terminal';

export interface ConnectionLease {
  readonly kind: ConnectionKind;
  /** 幂等：req close 与 res close 都可能先到。 */
  release(): void;
}

export interface ConnectionTableDeps {
  /** live getter：不缓存配置对象。 */
  limits: () => GatewayConfig['resources']['limits'];
  /** 拒绝回调（观测/日志）；`tryAcquire` 返回 null 之前调用。 */
  onRefused?: (kind: ConnectionKind) => void;
}

export interface ConnectionSnapshot {
  httpOpen: number;
  sse: number;
  ws: number;
  voice: number;
  terminal: number;
  /** 解析后的上限；`0` = 不限（JSON 安全，Infinity 会序列化成 null）。 */
  limits: {
    httpConnections: number;
    sseClients: number;
    wsClients: number;
    voiceClients: number;
    terminalClients: number;
  };
  refused: Record<ConnectionKind, number>;
}

/** JSON 安全化：Infinity（不限）→ 0，与配置语义一致。 */
function wireLimit(configured: unknown): number {
  const limit = limitOf(configured);
  return Number.isFinite(limit) ? limit : 0;
}

function limitKey(kind: ConnectionKind): 'sseClients' | 'wsClients' | 'voiceClients' | 'terminalClients' {
  switch (kind) {
    case 'sse': return 'sseClients';
    case 'ws': return 'wsClients';
    case 'voice': return 'voiceClients';
    case 'terminal': return 'terminalClients';
  }
}

export class ConnectionTable {
  private readonly counts: Record<ConnectionKind, number> = { sse: 0, ws: 0, voice: 0, terminal: 0 };
  private readonly refusedCounts: Record<ConnectionKind, number> = { sse: 0, ws: 0, voice: 0, terminal: 0 };
  private httpOpen = 0;

  constructor(private readonly deps: ConnectionTableDeps) {}

  /**
   * 申请一个逻辑连接名额：达到上限返回 null（拒绝路径），否则返回幂等 lease。
   * `limits` 在每次调用时读取，因此 hot reload 后立即生效。
   */
  tryAcquire(kind: ConnectionKind): ConnectionLease | null {
    const limit = limitOf(this.deps.limits()?.[limitKey(kind)]);
    if (this.counts[kind] >= limit) {
      this.refusedCounts[kind] += 1;
      this.deps.onRefused?.(kind);
      return null;
    }
    this.counts[kind] += 1;

    let released = false;
    return {
      kind,
      release: () => {
        if (released) return;
        released = true;
        this.counts[kind] = Math.max(0, this.counts[kind] - 1);
      },
    };
  }

  /** HTTP server `connection` 事件：socket 计数（观测，不做软拒绝）。 */
  noteHttpOpen(): void {
    this.httpOpen += 1;
  }

  /** HTTP socket 关闭（重复事件不得把计数压成负数）。 */
  noteHttpClose(): void {
    this.httpOpen = Math.max(0, this.httpOpen - 1);
  }

  snapshot(): ConnectionSnapshot {
    const limits = this.deps.limits();
    return {
      httpOpen: this.httpOpen,
      sse: this.counts.sse,
      ws: this.counts.ws,
      voice: this.counts.voice,
      terminal: this.counts.terminal,
      limits: {
        httpConnections: wireLimit(limits?.httpConnections),
        sseClients: wireLimit(limits?.sseClients),
        wsClients: wireLimit(limits?.wsClients),
        voiceClients: wireLimit(limits?.voiceClients),
        terminalClients: wireLimit(limits?.terminalClients),
      },
      refused: { ...this.refusedCounts },
    };
  }
}
