/**
 * T2-1 Task 4: auto-recorder 纯函数（无 IO）。
 * 语义对齐 B3「回到发送该 prompt 的时刻」：anchor=user_N、tree=pre-turn 树
 * （该回合**第一条** assistant 的 snapshot.start）。
 */
import {
  latestSnapshotTree,
  manualAnchor,
  parseUntrackedLines,
  planAutoCheckpoint,
} from '../../../src/core/checkpoint/auto-recorder';

const t = (n: number) => ({ created: 1_000 + n });
const S1 = 'a'.repeat(40);
const S2 = 'b'.repeat(40);
const S3 = 'c'.repeat(40);
const S4 = 'd'.repeat(40);

function u(id: string, n: number) {
  return { id, role: 'user', time: t(n) };
}
function a(id: string, n: number, start?: string, end?: string) {
  return {
    id,
    role: 'assistant',
    time: t(n),
    ...(start ? { snapshot: { start, ...(end ? { end } : {}) } } : {}),
  };
}

describe('planAutoCheckpoint', () => {
  it('regular turn: anchor=user_N, tree=A_N.snapshot.start', () => {
    const messages = [u('u1', 1), a('a1', 2, S1, S2)];
    expect(planAutoCheckpoint(messages)).toEqual({ anchorMessageID: 'u1', snapshotTree: S1 });
  });

  it('immediate-delivery: already-persisted next user does NOT shift the anchor', () => {
    // U2 已持久化在末尾（下一个 prompt 已入历史）——anchor 仍须是 U1
    const messages = [u('u1', 1), a('a1', 2, S1, S2), u('u2', 3)];
    expect(planAutoCheckpoint(messages)).toEqual({ anchorMessageID: 'u1', snapshotTree: S1 });
  });

  it('multi-step turn uses the FIRST assistant snapshot.start (pre-turn tree)', () => {
    const messages = [
      u('u1', 1),
      a('a1a', 2, S1, S2),
      a('a1b', 3, S2, S3),
    ];
    expect(planAutoCheckpoint(messages)).toEqual({ anchorMessageID: 'u1', snapshotTree: S1 });
  });

  it('unwraps {info} envelopes (opencode message list shape)', () => {
    const messages = [
      { info: u('u1', 1) },
      { info: a('a1', 2, S1, S2) },
      { info: u('u2', 3) },
    ];
    expect(planAutoCheckpoint(messages)).toEqual({ anchorMessageID: 'u1', snapshotTree: S1 });
  });

  it('pure chat turn (assistant without snapshot) yields null tree but keeps anchor', () => {
    const messages = [u('u1', 1), a('a1', 2)];
    expect(planAutoCheckpoint(messages)).toEqual({ anchorMessageID: 'u1', snapshotTree: null });
  });

  it('rejects invalid snapshot ids (git arg injection guard)', () => {
    const messages = [u('u1', 1), a('a1', 2, '--output=/tmp/x', S2)];
    expect(planAutoCheckpoint(messages)).toEqual({ anchorMessageID: 'u1', snapshotTree: null });
  });

  it('no assistant / no user / empty => null', () => {
    expect(planAutoCheckpoint([])).toBeNull();
    expect(planAutoCheckpoint([u('u1', 1)])).toBeNull();
    expect(planAutoCheckpoint([a('a1', 1, S1, S2)])).toBeNull();
  });

  it('sorts by time.created before locating the last turn', () => {
    const messages = [a('a1', 2, S1, S2), u('u1', 1)];
    expect(planAutoCheckpoint(messages)).toEqual({ anchorMessageID: 'u1', snapshotTree: S1 });
  });
});

describe('latestSnapshotTree', () => {
  it('returns the last valid snapshot.end', () => {
    const messages = [u('u1', 1), a('a1', 2, S1, S2), a('a2', 3, S2, S3)];
    expect(latestSnapshotTree(messages)).toBe(S3);
  });

  it('ignores snapshots without a valid end (falls back to earlier turns)', () => {
    const messages = [a('a1', 1, S1, S2), a('a2', 2, S3)];
    expect(latestSnapshotTree(messages)).toBe(S2);
  });

  it('null when nothing valid', () => {
    expect(latestSnapshotTree([u('u1', 1), a('a1', 2)])).toBeNull();
  });
});

describe('manualAnchor', () => {
  it('uses the explicit message id when present', () => {
    const messages = [u('u1', 1), a('a1', 2, S1, S2)];
    expect(manualAnchor(messages, 'u1')).toEqual({ anchorMessageID: 'u1' });
  });

  it('falls back to the last persisted message', () => {
    const messages = [u('u1', 1), a('a1', 2, S1, S2)];
    expect(manualAnchor(messages)).toEqual({ anchorMessageID: 'a1' });
  });

  it('explicit id not in the window falls back to the last message', () => {
    const messages = [u('u1', 1)];
    expect(manualAnchor(messages, 'missing')).toEqual({ anchorMessageID: 'u1' });
  });

  it('null on empty messages', () => {
    expect(manualAnchor([])).toBeNull();
  });
});

describe('parseUntrackedLines', () => {
  it('extracts only ?? entries and strips the status columns', () => {
    const porcelain = [
      '?? a.txt',
      'M  b.txt',
      '?? dir/',
      '?? "with space.txt"',
      '',
    ].join('\n');
    expect(parseUntrackedLines(porcelain)).toEqual(['a.txt', 'dir/', '"with space.txt"']);
  });

  it('empty output => []', () => {
    expect(parseUntrackedLines('')).toEqual([]);
  });
});
