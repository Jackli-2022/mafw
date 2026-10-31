import { Readable } from 'stream';
import { PodError } from '../../../src/core/pod/pod-store';
import { handlePods } from '../../../src/routes/pods';

function makeRes() {
  const out = { status: 0, body: '' };
  const res: any = {
    writeHead: (status: number) => { out.status = status; return res; },
    end: (chunk?: any) => { out.body = chunk == null ? '' : String(chunk); },
  };
  return { res, out };
}

function makeReq(body: unknown): any {
  const req: any = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'PATCH';
  return req;
}

function makeDeps(overrides: any = {}) {
  const calls = { edit: [] as any[], update: [] as any[], allowed: [] as string[][] };
  const deps: any = {
    pods: {
      get: () => ({ pod: { id: 'pod_1' } }),
      ensure: jest.fn(), updateStatus: jest.fn(), lookup: jest.fn(),
    },
    tasks: {
      list: () => [],
      createManual: jest.fn(),
      updateTask: (_podId: string, taskId: string, patch: any) => {
        calls.update.push({ taskId, patch });
        return { id: taskId, title: 't', status: patch.status ?? 'pending' };
      },
      editPlanTask: (_podId: string, taskId: string, patch: any) => {
        calls.edit.push({ taskId, patch });
        return { id: taskId, title: patch.title ?? 't', acceptanceJson: JSON.stringify(patch.acceptance ?? []) };
      },
    },
    messages: { list: () => [], send: jest.fn(), markRead: jest.fn() },
    goals: { list: () => [], promote: jest.fn() },
    memory: { renderContext: () => null, writeMemory: jest.fn(), readMemoryFile: jest.fn() },
    access: {
      requireMember: (_sid: string, allowed: string[]) => {
        calls.allowed.push(allowed);
        // 模拟 builder actor：只能在三档通道里通过，Lead-only 通道拒绝
        if (allowed.length === 1 && allowed[0] === 'lead') throw new PodError(403, 'actor is not allowed');
        return { id: 'm_builder', role: 'builder' };
      },
    },
    cost: async () => ({ spentUsd: 0, limitUsd: 0 }),
    transcript: async () => ({}),
    ...overrides,
  };
  return { deps, calls };
}

async function patch(deps: any, body: unknown) {
  const { res, out } = makeRes();
  await handlePods(makeReq(body), res, '/api/pods/pod_1/tasks/t1', deps);
  return out;
}

describe('PATCH /api/pods/:podId/tasks/:taskId', () => {
  test('title/acceptance go to editPlanTask (plan write-back)', async () => {
    const { deps, calls } = makeDeps();
    const out = await patch(deps, { title: '新标题', acceptance: ['a', 'b'] });
    expect(out.status).toBe(200);
    expect(calls.edit).toEqual([{ taskId: 't1', patch: { title: '新标题', acceptance: ['a', 'b'] } }]);
    expect(calls.update).toHaveLength(0);
    expect(JSON.parse(out.body).task.title).toBe('新标题');
  });

  test('status/owner keep using updateTask', async () => {
    const { deps, calls } = makeDeps();
    const out = await patch(deps, { status: 'in_progress', ownerMemberId: 'm_builder' });
    expect(out.status).toBe(200);
    expect(calls.edit).toHaveLength(0);
    expect(calls.update).toEqual([{ taskId: 't1', patch: { status: 'in_progress', ownerMemberId: 'm_builder' } }]);
  });

  test('mixing plan fields with status is rejected', async () => {
    const { deps, calls } = makeDeps();
    const out = await patch(deps, { title: 'x', status: 'done' });
    expect(out.status).toBe(400);
    expect(calls.edit).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
  });

  test('plan edits require a Lead actor when an actor is present', async () => {
    const { deps, calls } = makeDeps();
    const out = await patch(deps, { title: 'x', actorSessionID: 'ses_builder' });
    expect(out.status).toBe(403);
    expect(calls.allowed).toEqual([['lead']]);
    expect(calls.edit).toHaveLength(0);
  });

  test('status updates still allow builder/reviewer actors', async () => {
    const { deps, calls } = makeDeps({
      access: {
        requireMember: (_sid: string, allowed: string[]) => {
          calls.allowed.push(allowed);
          return { id: 'm_builder', role: 'builder' };
        },
      },
    });
    const out = await patch(deps, { status: 'in_progress', actorSessionID: 'ses_builder' });
    expect(out.status).toBe(200);
    expect(calls.allowed).toEqual([['lead', 'builder', 'reviewer']]);
  });
});
