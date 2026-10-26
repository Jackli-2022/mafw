/**
 * T2-1 Task 7: turn.completed 自动检查点编排（deps 注入，可测）�? * 门控顺序：能力位 �?内部角色 �?session.get �?isHiddenSession �?messages �?plan �?create�? */
import { runAutoCheckpoint, type AutoCheckpointHookDeps } from '../../../src/core/checkpoint/auto-hook';
import { isHiddenSession } from '../../../src/core/session-visibility';
import type { SessionCheckpoint } from '../../../src/core/checkpoint/checkpoint-service';

const T1 = 'a'.repeat(40);
const T2 = 'b'.repeat(40);

function assistantTurn() {
  return [
    { info: { id: 'u1', role: 'user', time: { created: 1 } } },
    { info: { id: 'a1', role: 'assistant', time: { created: 2 }, snapshot: { start: T1, end: T2 } } },
  ];
}

function harness(opts: {
  capabilities?: any;
  role?: string;
  info?: any;
  messages?: any[];
  messagesSeq?: any[][];
  porcelain?: string;
  porcelainThrows?: boolean;
} = {}) {
  const calls = {
    get: [] as string[],
    messages: [] as Array<{ sid: string; limit?: number }>,
    create: [] as any[],
  };
  let seqIdx = 0;
  const created: SessionCheckpoint = {
    id: 'ckpt_1', sessionID: 's1', projectDir: '/tmp/proj', anchorMessageID: 'u1',
    snapshotTree: T1, untracked: [], kind: 'auto', createdAt: '2026-10-26T00:00:00Z',
  };

  const deps: AutoCheckpointHookDeps = {
    runtime: () => ({
      capabilities: opts.capabilities ?? { checkpointApi: true },
      session: {
        get: async ({ sessionID }) => {
          calls.get.push(sessionID);
          return opts.info === undefined
            ? { id: 's1', directory: '/tmp/proj', title: 'chat' }
            : opts.info;
        },
        messages: async ({ sessionID, limit }) => {
          calls.messages.push({ sid: sessionID, limit });
          if (opts.messagesSeq) {
            return { data: opts.messagesSeq[Math.min(seqIdx++, opts.messagesSeq.length - 1)] };
          }
          return { data: opts.messages ?? assistantTurn() };
        },
      },
    }),
    internalRoleOf: () => opts.role,
    isHidden: isHiddenSession,
    porcelainOf: async () => {
      if (opts.porcelainThrows) throw new Error('git unavailable');
      return opts.porcelain ?? '?? scratch.txt\n';
    },
    wait: async () => {}, // 测试不真�?300ms
    create: (input) => { calls.create.push(input); return created; },
  };

  return { deps, calls, created };
}

describe('runAutoCheckpoint', () => {
  it('records an auto checkpoint at the prompt moment (anchor=user, tree=pre-turn)', async () => {
    const h = harness();
    const cp = await runAutoCheckpoint(h.deps, 's1');

    expect(cp).toEqual(h.created);
    expect(h.calls.create).toEqual([{
      sessionID: 's1',
      projectDir: '/tmp/proj',
      anchorMessageID: 'u1',
      snapshotTree: T1,
      untracked: ['scratch.txt'],
      kind: 'auto',
    }]);
  });

  it('skips when the runtime lacks checkpointApi (pi/minimal)', async () => {
    const h = harness({ capabilities: {} });
    expect(await runAutoCheckpoint(h.deps, 's1')).toBeNull();
    expect(h.calls.get).toEqual([]);
  });

  it('skips internal/worker sessions (role registry)', async () => {
    const h = harness({ role: 'extract' });
    expect(await runAutoCheckpoint(h.deps, 's1')).toBeNull();
    expect(h.calls.get).toEqual([]);
  });

  it('records for manager sessions (visible, not a worker)', async () => {
    const h = harness({ role: 'manager' });
    const cp = await runAutoCheckpoint(h.deps, 's1');
    expect(cp).toEqual(h.created);
    expect(h.calls.get).toEqual(['s1']);
  });

  it('reads a 200-message window (long agentic turns must still find the anchor)', async () => {
    const h = harness();
    await runAutoCheckpoint(h.deps, 's1');
    expect(h.calls.messages).toEqual([{ sid: 's1', limit: 200 }]);
  });

  it('skips hidden sessions and sessions without a directory', async () => {
    const hidden = harness({ info: { id: 's1', directory: '/tmp/proj', parentID: 'p1' } });
    expect(await runAutoCheckpoint(hidden.deps, 's1')).toBeNull();
    expect(hidden.calls.messages).toEqual([]);

    const noDir = harness({ info: { id: 's1' } });
    expect(await runAutoCheckpoint(noDir.deps, 's1')).toBeNull();
    expect(noDir.calls.messages).toEqual([]);
  });

  it('reads opencode 2.1 location.directory when directory is absent', async () => {
    const h = harness({ info: { id: 's1', location: { directory: '/tmp/oc21' } } });
    const cp = await runAutoCheckpoint(h.deps, 's1');
    expect(cp).toEqual(h.created);
    expect(h.calls.create[0].projectDir).toBe('/tmp/oc21');
  });

  it('skips when the message window has no complete turn', async () => {
    const h = harness({ messages: [{ info: { id: 'u1', role: 'user', time: { created: 1 } } }] });
    expect(await runAutoCheckpoint(h.deps, 's1')).toBeNull();
    expect(h.calls.create).toEqual([]);
    expect(h.calls.messages).toHaveLength(8); // 8 次有界重试后放弃
  });

  it('retries when turn.completed races ahead of message persistence', async () => {
    // 第一次只看到 user（assistant 尚未可见），第二次完整回�?�?仍能记录
    const h = harness({
      messagesSeq: [
        [{ info: { id: 'u1', role: 'user', time: { created: 1 } } }],
        assistantTurn(),
      ],
    });
    const cp = await runAutoCheckpoint(h.deps, 's1');
    expect(cp).toEqual(h.created);
    expect(h.calls.messages).toHaveLength(2);
    expect(h.calls.create).toHaveLength(1);
  });

  it('treats git status failure as empty untracked (still records)', async () => {
    const h = harness({ porcelainThrows: true });
    const cp = await runAutoCheckpoint(h.deps, 's1');
    expect(cp).toEqual(h.created);
    expect(h.calls.create[0].untracked).toEqual([]);
  });

  it('keeps the anchor when the turn is pure chat (no snapshot tree)', async () => {
    const h = harness({
      messages: [
        { info: { id: 'u1', role: 'user', time: { created: 1 } } },
        { info: { id: 'a1', role: 'assistant', time: { created: 2 } } },
      ],
    });
    await runAutoCheckpoint(h.deps, 's1');
    expect(h.calls.create[0]).toMatchObject({ anchorMessageID: 'u1', snapshotTree: null });
  });

  it('no runtime => null', async () => {
    const h = harness();
    h.deps.runtime = () => null;
    expect(await runAutoCheckpoint(h.deps, 's1')).toBeNull();
  });
});

