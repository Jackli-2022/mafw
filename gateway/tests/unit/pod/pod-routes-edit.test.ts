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

function makeReq(body: unknown, method = 'PATCH'): any {
  const req: any = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  return req;
}

function makeDeps(overrides: any = {}) {
  const calls = {
    edit: [] as any[],
    rename: [] as any[],
    update: [] as any[],
    add: [] as any[],
    remove: [] as any[],
    manual: [] as any[],
    allowed: [] as string[][],
  };
  const tasks = [
    { id: 't1', kind: 'plan', title: 'plan task' },
    { id: 'note1', kind: 'note', title: 'note' },
  ];
  const deps: any = {
    pods: {
      get: () => ({ pod: { id: 'pod_1' } }),
      ensure: jest.fn(), updateStatus: jest.fn(), lookup: jest.fn(),
    },
    tasks: {
      list: () => tasks,
      createManual: (_podId: string, goalId: string | null, title: string, ownerMemberId?: string) => {
        calls.manual.push({ goalId, title, ownerMemberId });
        return { id: 'manual_1', title, goalId };
      },
      updateTask: (_podId: string, taskId: string, patch: any) => {
        calls.update.push({ taskId, patch });
        return { id: taskId, title: 't', status: patch.status ?? 'pending' };
      },
      editTitle: (_podId: string, taskId: string, title: string) => {
        calls.rename.push({ taskId, title });
        return { id: taskId, title, kind: tasks.find((t) => t.id === taskId)?.kind ?? 'note' };
      },
      editPlanTask: (_podId: string, taskId: string, patch: any) => {
        calls.edit.push({ taskId, patch });
        return { id: taskId, title: patch.title ?? 't', acceptanceJson: JSON.stringify(patch.acceptance ?? []) };
      },
      addPlanTask: (_podId: string, goalId: string, waveId: string | null, title: string, acceptance?: string[]) => {
        calls.add.push({ goalId, waveId, title, acceptance });
        return { id: 'planned_1', title, goalId, externalTaskId: 'w1-t1' };
      },
      deleteTask: (_podId: string, taskId: string) => {
        calls.remove.push({ taskId });
        return { goalId: 'g1', externalTaskId: 'w1-t1' };
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

async function patch(deps: any, body: unknown, method = 'PATCH') {
  const { res, out } = makeRes();
  await handlePods(makeReq(body, method), res, '/api/pods/pod_1/tasks/t1', deps);
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

  test('a note can be renamed without the Lead plan gate', async () => {
    const { deps, calls } = makeDeps({
      access: {
        requireMember: (_sid: string, allowed: string[]) => {
          calls.allowed.push(allowed);
          return { id: 'm_builder', role: 'builder' };
        },
      },
    });
    const { res, out } = makeRes();
    await handlePods(makeReq({ title: '新备注', actorSessionID: 'ses_builder' }, 'PATCH'), res, '/api/pods/pod_1/tasks/note1', deps);
    expect(out.status).toBe(200);
    expect(calls.rename).toEqual([{ taskId: 'note1', title: '新备注' }]);
    expect(calls.allowed).toEqual([['lead', 'tech_lead', 'builder', 'reviewer']]);
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
    expect(calls.allowed).toEqual([['lead', 'tech_lead', 'builder', 'reviewer']]);
  });

  test('DELETE removes a task and requires Lead when an actor is present', async () => {
    const { deps, calls } = makeDeps();
    const out = await patch(deps, {}, 'DELETE');
    expect(out.status).toBe(200);
    expect(calls.remove).toEqual([{ taskId: 't1' }]);
    expect(JSON.parse(out.body).deleted).toEqual({ goalId: 'g1', externalTaskId: 'w1-t1' });

    const denied = await patch(deps, { actorSessionID: 'ses_builder' }, 'DELETE');
    expect(denied.status).toBe(403);
    expect(calls.remove).toHaveLength(1);
  });

  test('POST with plan:true appends to the goal plan (last wave by default)', async () => {
    const { deps, calls } = makeDeps();
    const { res, out } = makeRes();
    await handlePods(makeReq({ plan: true, goalId: 'g1', title: '新任务', acceptance: ['a'] }, 'POST'), res, '/api/pods/pod_1/tasks', deps);
    expect(out.status).toBe(200);
    expect(calls.add).toEqual([{ goalId: 'g1', waveId: null, title: '新任务', acceptance: ['a'] }]);
    expect(calls.manual).toHaveLength(0);

    const explicit = await (async () => {
      const r = makeRes();
      await handlePods(makeReq({ plan: true, goalId: 'g1', waveId: 'w2', title: 'x' }, 'POST'), r.res, '/api/pods/pod_1/tasks', deps);
      return r.out;
    })();
    expect(explicit.status).toBe(200);
    expect(calls.add.at(-1)).toMatchObject({ goalId: 'g1', waveId: 'w2' });

    const missingGoal = await (async () => {
      const r = makeRes();
      await handlePods(makeReq({ plan: true, title: 'x' }, 'POST'), r.res, '/api/pods/pod_1/tasks', deps);
      return r.out;
    })();
    expect(missingGoal.status).toBe(400);
  });

  test('notify never forces delivery into a running node', async () => {
    const delivery = { deliver: jest.fn(async () => 'pending') };
    const { deps } = makeDeps({
      messages: {
        list: () => [],
        send: () => ({ id: 'm1' }),
        markRead: jest.fn(),
      },
      delivery,
      access: { requireMember: () => ({ id: 'm_lead', role: 'lead' }) },
    });
    const { res, out } = makeRes();
    await handlePods(makeReq({
      fromMemberId: 'm_lead', toMemberId: 'm_builder', kind: 'request', body: 'work', notify: true,
    }, 'POST'), res, '/api/pods/pod_1/messages', deps);
    expect(out.status).toBe(200);
    expect(delivery.deliver).toHaveBeenCalledWith('m1', { force: false });
  });

  test('POST without plan stays a manual task', async () => {
    const { deps, calls } = makeDeps();
    const { res, out } = makeRes();
    await handlePods(makeReq({ title: '手工' }, 'POST'), res, '/api/pods/pod_1/tasks', deps);
    expect(out.status).toBe(200);
    expect(calls.manual).toEqual([{ goalId: null, title: '手工', ownerMemberId: undefined }]);
    expect(calls.add).toHaveLength(0);
  });
});

describe('roster-wide Pod access includes the Tech Lead', () => {
  // 四角色 roster：lead / tech_lead / builder / reviewer 都是「成员」，roster 级通道
  // 必须放行；Lead 专属动作（计划编辑、Goal 建立）仍只允许 lead。
  const rosterAccess = (calls: any, roles: Record<string, string>) => ({
    requireMember: (sid: string, allowed: string[]) => {
      calls.allowed.push(allowed);
      const role = roles[sid];
      if (!role || !allowed.includes(role)) throw new PodError(403, 'actor is not allowed');
      return { id: `m_${role}`, role };
    },
  });

  test('a tech lead session may update task status (roster-wide)', async () => {
    const { deps, calls } = makeDeps();
    deps.access = rosterAccess(calls, { ses_tl: 'tech_lead' });
    const out = await patch(deps, { status: 'in_progress', actorSessionID: 'ses_tl' });
    expect(out.status).toBe(200);
    expect(calls.allowed).toEqual([['lead', 'tech_lead', 'builder', 'reviewer']]);
    expect(calls.update).toEqual([{ taskId: 't1', patch: { status: 'in_progress' } }]);
  });

  test('a tech lead session may send a Pod message', async () => {
    const { deps, calls } = makeDeps();
    const sent: any[] = [];
    deps.access = rosterAccess(calls, { ses_tl: 'tech_lead' });
    deps.messages = {
      list: () => [],
      send: (input: any) => { sent.push(input); return { id: 'msg_tl', ...input }; },
      markRead: jest.fn(),
    };
    const { res, out } = makeRes();
    await handlePods(makeReq({
      actorSessionID: 'ses_tl', fromMemberId: 'm_tech_lead', kind: 'request', body: 'probe this', toMemberId: 'm_builder',
    }, 'POST'), res, '/api/pods/pod_1/messages', deps);
    expect(out.status).toBe(200);
    expect(calls.allowed).toEqual([['lead', 'tech_lead', 'builder', 'reviewer']]);
    expect(sent[0]).toMatchObject({ fromMemberId: 'm_tech_lead', body: 'probe this' });
  });

  test('a tech lead session may read the Pod (GET roster-wide)', async () => {
    const { deps, calls } = makeDeps();
    deps.access = rosterAccess(calls, { ses_tl: 'tech_lead' });
    const { res, out } = makeRes();
    await handlePods(
      { method: 'GET' } as any,
      res,
      '/api/pods/pod_1/messages?actorSessionID=ses_tl',
      deps,
    );
    expect(out.status).toBe(200);
    expect(calls.allowed).toEqual([['lead', 'tech_lead', 'builder', 'reviewer']]);
  });

  test('a non-roster role is still rejected by the roster-wide gate', async () => {
    const { deps, calls } = makeDeps();
    deps.access = rosterAccess(calls, { ses_ghost: 'ghost' });
    const out = await patch(deps, { status: 'in_progress', actorSessionID: 'ses_ghost' });
    expect(out.status).toBe(403);
    expect(calls.update).toHaveLength(0);
  });

  test('Lead-only plan edits stay Lead-only', async () => {
    const { deps, calls } = makeDeps();
    deps.access = rosterAccess(calls, { ses_tl: 'tech_lead' });
    const out = await patch(deps, { acceptance: ['a'], actorSessionID: 'ses_tl' });
    expect(out.status).toBe(403);
    expect(calls.allowed).toEqual([['lead']]);
    expect(calls.edit).toHaveLength(0);
  });
});
