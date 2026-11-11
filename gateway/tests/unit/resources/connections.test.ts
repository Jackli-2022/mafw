/**
 * E4-4 连接表（spec §4.4）。
 *
 * 连接上限是拒绝路径的唯一来源：lease 必须幂等（req close + res close 都会
 * 释放），计数不得为负（重复释放会在长驻进程里把名额泄漏成负数 = 无上限），
 * `0` 必须是"不限"而不是"全拒"。refused 只记逻辑连接（http socket 走
 * `server.maxConnections` 硬帽，没有软拒绝）。
 */
import { ConnectionTable, type ConnectionKind } from '../../../src/resources/connections';

type LimitOverrides = Partial<Record<
  'httpConnections' | 'sseClients' | 'wsClients' | 'voiceClients' | 'terminalClients',
  number
>>;

function limits(over: LimitOverrides = {}): any {
  return {
    httpConnections: 256,
    sseClients: 4,
    wsClients: 4,
    voiceClients: 2,
    terminalClients: 2,
    ...over,
  };
}

const KINDS: ConnectionKind[] = ['sse', 'ws', 'voice', 'terminal'];

describe('ConnectionTable: acquire / release', () => {
  it('acquires up to the per-kind limit, then refuses', () => {
    const table = new ConnectionTable({ limits: () => limits({ sseClients: 2 }) });
    const a = table.tryAcquire('sse');
    const b = table.tryAcquire('sse');
    const c = table.tryAcquire('sse');

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).toBeNull();
    expect(table.snapshot().sse).toBe(2);
    expect(table.snapshot().refused.sse).toBe(1);
  });

  it('increments refused only for the requested logical kind', () => {
    const refused: ConnectionKind[] = [];
    const table = new ConnectionTable({
      limits: () => limits({ wsClients: 1 }),
      onRefused: (kind) => refused.push(kind),
    });
    expect(table.tryAcquire('ws')).not.toBeNull();
    expect(table.tryAcquire('ws')).toBeNull();
    expect(table.tryAcquire('ws')).toBeNull();

    const snap = table.snapshot();
    expect(snap.refused).toEqual({ sse: 0, ws: 2, voice: 0, terminal: 0 });
    expect(refused).toEqual(['ws', 'ws']);
  });

  it('keeps kinds isolated from each other', () => {
    const table = new ConnectionTable({ limits: () => limits({ sseClients: 1 }) });
    expect(table.tryAcquire('sse')).not.toBeNull();
    expect(table.tryAcquire('sse')).toBeNull();

    for (const kind of ['ws', 'voice', 'terminal'] as const) {
      expect({ kind, lease: table.tryAcquire(kind) !== null }).toEqual({ kind, lease: true });
    }
    const snap = table.snapshot();
    expect({ sse: snap.sse, ws: snap.ws, voice: snap.voice, terminal: snap.terminal })
      .toEqual({ sse: 1, ws: 1, voice: 1, terminal: 1 });
  });

  it('release is idempotent and counts never go negative', () => {
    const table = new ConnectionTable({ limits: () => limits({ sseClients: 2 }) });
    const lease = table.tryAcquire('sse')!;
    expect(table.snapshot().sse).toBe(1);

    lease.release();
    lease.release();
    lease.release();

    expect(table.snapshot().sse).toBe(0);
    // A freed slot is reusable: a leaked negative counter would let this pass
    // even when the limit is 1.
    expect(table.tryAcquire('sse')).not.toBeNull();
    expect(table.snapshot().sse).toBe(1);
  });

  it('release only frees its own kind', () => {
    const table = new ConnectionTable({ limits: () => limits() });
    const sse = table.tryAcquire('sse')!;
    const ws = table.tryAcquire('ws')!;
    sse.release();
    const snap = table.snapshot();
    expect({ sse: snap.sse, ws: snap.ws }).toEqual({ sse: 0, ws: 1 });
    ws.release();
  });
});

describe('ConnectionTable: limits normalization (0 = unlimited)', () => {
  it('treats 0 / negative / non-finite limits as unlimited', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const table = new ConnectionTable({ limits: () => limits({ sseClients: value }) });
      const leases = Array.from({ length: 50 }, () => table.tryAcquire('sse'));
      expect({ value, all: leases.every((l) => l !== null) }).toEqual({ value, all: true });
      expect(table.snapshot().refused.sse).toBe(0);
      for (const lease of leases) lease?.release();
    }
  });

  it('floors fractional limits', () => {
    const table = new ConnectionTable({ limits: () => limits({ sseClients: 1.9 }) });
    expect(table.tryAcquire('sse')).not.toBeNull();
    expect(table.tryAcquire('sse')).toBeNull();
  });
});

describe('ConnectionTable: http socket accounting', () => {
  it('tracks http open/close and never goes negative', () => {
    const table = new ConnectionTable({ limits: () => limits() });
    table.noteHttpOpen();
    table.noteHttpOpen();
    expect(table.snapshot().httpOpen).toBe(2);

    table.noteHttpClose();
    expect(table.snapshot().httpOpen).toBe(1);

    table.noteHttpClose();
    table.noteHttpClose();
    expect(table.snapshot().httpOpen).toBe(0);
  });
});

describe('ConnectionTable: snapshot', () => {
  it('reports counts, resolved limits (0 = unlimited) and refused counters', () => {
    const table = new ConnectionTable({ limits: () => limits({ sseClients: 0 }) });
    expect(table.tryAcquire('sse')).not.toBeNull();
    table.noteHttpOpen();

    expect(table.snapshot()).toEqual({
      httpOpen: 1,
      sse: 1,
      ws: 0,
      voice: 0,
      terminal: 0,
      limits: {
        httpConnections: 256,
        sseClients: 0,
        wsClients: 4,
        voiceClients: 2,
        terminalClients: 2,
      },
      refused: { sse: 0, ws: 0, voice: 0, terminal: 0 },
    });
  });

  it('reads the live config getter on every acquire (hot reload)', () => {
    let current = limits({ sseClients: 1 });
    const table = new ConnectionTable({ limits: () => current });
    expect(table.tryAcquire('sse')).not.toBeNull();
    expect(table.tryAcquire('sse')).toBeNull();

    current = limits({ sseClients: 2 });
    expect(table.tryAcquire('sse')).not.toBeNull();
  });

  it('exposes every kind through the lease for diagnostics', () => {
    const table = new ConnectionTable({ limits: () => limits() });
    for (const kind of KINDS) {
      const lease = table.tryAcquire(kind)!;
      expect(lease.kind).toBe(kind);
      lease.release();
    }
  });
});
