/**
 * T2-1 Task 4: CheckpointService create/list（restore 见 restore.test.ts）。
 * deps 全注入（含 Task 5 才会用到的 runtime/git 成员——create/list 路径不触碰）。
 */
import {
  CheckpointService,
  type CheckpointServiceDeps,
  type SessionCheckpoint,
} from '../../../src/core/checkpoint/checkpoint-service';
import type { SessionCheckpointRow } from '../../../src/memory/gateway-db';

function harness() {
  const rows = new Map<string, SessionCheckpointRow>();
  const calls = {
    pruned: [] as Array<{ sessionId: string; keep: number }>,
    deletedAfter: [] as Array<{ sessionId: string; at: string }>,
    broadcasts: [] as any[],
  };
  let seq = 0;

  const deps: CheckpointServiceDeps = {
    db: {
      insertSessionCheckpoint: (row) => { rows.set(row.id, row); },
      getSessionCheckpoint: (id) => rows.get(id),
      listSessionCheckpoints: (sessionId) =>
        [...rows.values()]
          .filter((r) => r.session_id === sessionId)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
      pruneSessionAutoCheckpoints: (sessionId, keep) => {
        calls.pruned.push({ sessionId, keep });
        return 0;
      },
      deleteSessionCheckpointsAfter: (sessionId, at) => {
        calls.deletedAfter.push({ sessionId, at });
        return 0;
      },
      deleteSessionCheckpoints: () => {},
    },
    runtime: {
      session: {
        get: async () => null,
        messages: async () => ({ data: [] }),
        revert: async () => {},
        vcs: { apply: async () => {} },
      },
    },
    git: { run: async () => ({ code: 0, stdout: '', stderr: '' }) },
    porcelainOf: async () => '',
    readWorkspaceTree: () => null,
    writeWorkspaceTree: () => {},
    broadcast: (event) => { calls.broadcasts.push(event); },
    now: () => '2026-10-26T00:00:00Z',
    newId: () => `ckpt_${++seq}`,
  };

  return { deps, rows, calls, service: new CheckpointService(deps) };
}

const input = {
  sessionID: 's1',
  projectDir: '/tmp/proj',
  anchorMessageID: 'u1',
  snapshotTree: 'a'.repeat(40),
  untracked: ['x.txt'],
  kind: 'auto' as const,
};

describe('CheckpointService.create', () => {
  it('inserts a row and returns the camelCase DTO', () => {
    const { service, rows } = harness();
    const cp = service.create(input);

    expect(cp).toEqual({
      id: 'ckpt_1',
      sessionID: 's1',
      projectDir: '/tmp/proj',
      anchorMessageID: 'u1',
      snapshotTree: 'a'.repeat(40),
      untracked: ['x.txt'],
      kind: 'auto',
      createdAt: '2026-10-26T00:00:00Z',
    } satisfies SessionCheckpoint);

    const row = rows.get('ckpt_1')!;
    expect(row.untracked_json).toBe(JSON.stringify(['x.txt']));
    expect(row.session_id).toBe('s1');
  });

  it('prunes auto checkpoints to 100 after insert', () => {
    const { service, calls } = harness();
    service.create(input);
    expect(calls.pruned).toEqual([{ sessionId: 's1', keep: 100 }]);
  });

  it('never prunes manual checkpoints', () => {
    const { service, calls } = harness();
    service.create({ ...input, kind: 'manual' });
    expect(calls.pruned).toEqual([]);
  });

  it('broadcasts session.checkpoint with properties payload', () => {
    const { service, calls } = harness();
    service.create(input);
    expect(calls.broadcasts).toEqual([{
      type: 'session.checkpoint',
      properties: { sessionID: 's1', checkpointId: 'ckpt_1', kind: 'auto' },
      sessionID: 's1',
    }]);
  });
});

describe('CheckpointService.list', () => {
  it('returns newest first with parsed untracked arrays', () => {
    const { service, deps } = harness();
    deps.db.insertSessionCheckpoint({
      id: 'old', session_id: 's1', project_dir: '/p', anchor_message_id: 'u0',
      snapshot_tree: null, untracked_json: '[]', kind: 'auto', created_at: '2026-10-26T00:00:00Z',
    });
    deps.db.insertSessionCheckpoint({
      id: 'new', session_id: 's1', project_dir: '/p', anchor_message_id: 'u1',
      snapshot_tree: 'b'.repeat(40), untracked_json: '["a","b"]', kind: 'manual', created_at: '2026-10-26T01:00:00Z',
    });
    deps.db.insertSessionCheckpoint({
      id: 'other', session_id: 's2', project_dir: '/p', anchor_message_id: 'u9',
      snapshot_tree: null, untracked_json: '[]', kind: 'auto', created_at: '2026-10-26T02:00:00Z',
    });

    const list = service.list('s1');
    expect(list.map((c) => c.id)).toEqual(['new', 'old']);
    expect(list[0].untracked).toEqual(['a', 'b']);
    expect(list[1].snapshotTree).toBeNull();
  });
});

describe('CheckpointService.createManual', () => {
  const T1 = 'a'.repeat(40);
  const T2 = 'b'.repeat(40);

  function manualHarness(opts: {
    directory?: string | null;
    messages?: any[];
    porcelain?: string;
  } = {}) {
    const h = harness();
    (h.deps.runtime.session as any).get = async () => ({
      id: 's1',
      directory: opts.directory === undefined ? '/tmp/proj' : opts.directory,
    });
    (h.deps.runtime.session as any).messages = async () => ({
      data: opts.messages ?? [
        { id: 'u1', role: 'user', time: { created: 1 } },
        { id: 'a1', role: 'assistant', time: { created: 2 }, snapshot: { start: T1, end: T2 } },
      ],
    });
    h.deps.porcelainOf = async () => opts.porcelain ?? '?? scratch.txt\n';
    return h;
  }

  it('manual checkpoint anchors at the last persisted message and current tree', async () => {
    const h = manualHarness();
    const cp = await h.service.createManual({ sessionID: 's1' });

    expect(cp.kind).toBe('manual');
    expect(cp.anchorMessageID).toBe('a1');
    expect(cp.snapshotTree).toBe(T2);
    expect(cp.projectDir).toBe('/tmp/proj');
    expect(cp.untracked).toEqual(['scratch.txt']);
  });

  it('honors an explicit messageID anchor', async () => {
    const h = manualHarness();
    const cp = await h.service.createManual({ sessionID: 's1', messageID: 'u1' });
    expect(cp.anchorMessageID).toBe('u1');
  });

  it('400 when the session directory is unavailable', async () => {
    const h = manualHarness({ directory: null });
    await expect(h.service.createManual({ sessionID: 's1' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('400 when there are no persisted messages', async () => {
    const h = manualHarness({ messages: [] });
    await expect(h.service.createManual({ sessionID: 's1' }))
      .rejects.toMatchObject({ status: 400 });
  });
});
