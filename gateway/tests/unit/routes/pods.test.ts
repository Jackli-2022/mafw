import * as http from 'http';
import { PodError } from '../../../src/core/pod/pod-store';
import { attachPodHandlers } from '../../../src/routes/pod-handlers';
import { handlePods } from '../../../src/routes/pods';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';

function mockRes() {
  const res: any = {
    status: 0,
    body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string };
}

function mockReq(method: string, body?: any): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = {
    method,
    on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); },
  };
  setImmediate(() => {
    if (body !== undefined) for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as http.IncomingMessage;
}

const pod = {
  id: 'pod_1', projectDir: '/proj', name: 'Project', status: 'idle', configJson: '{}',
  activeGoalId: null, createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z',
};
const detail = { pod, members: [], goals: [], tasks: [], sessions: [] };

function makeDeps(overrides: Record<string, any> = {}) {
  const deps: any = {
    pods: {
      ensure: jest.fn(async () => detail),
      get: jest.fn(() => detail),
      updateStatus: jest.fn((_id: string, status: string) => ({ ...detail, pod: { ...pod, status } })),
      lookup: jest.fn(() => detail),
    },
    tasks: {
      list: jest.fn(() => []),
      createManual: jest.fn(() => ({ id: 't1', title: 'do' })),
      updateTask: jest.fn(() => ({ id: 't1', status: 'done' })),
    },
    messages: {
      list: jest.fn(() => []),
      send: jest.fn(() => ({ id: 'm1' })),
    },
    goals: { list: jest.fn(() => []), promote: jest.fn(async () => true) },
    memory: {
      renderContext: jest.fn(() => '[POD CONTEXT]'),
      writeMemory: jest.fn(() => '/tmp/POD.md'),
      readMemoryFile: jest.fn(() => 'full memory'),
    },
    cost: jest.fn(async () => ({ spentUsd: 0, limitUsd: 10 })),
    transcript: jest.fn(async () => ({ sessionID: 's1', messages: [] })),
    access: undefined,
  };
  return { ...deps, ...overrides };
}

async function call(method: string, url: string, deps: any, body?: any) {
  const res = mockRes();
  const handled = await handlePods(mockReq(method, body), res, url, deps);
  return { handled, res, json: res.body ? JSON.parse(res.body) : null };
}

describe('pod routes', () => {
  it('ensures, gets, and updates a pod', async () => {
    const deps = makeDeps();
    const ensured = await call('GET', '/api/projects/p1/pod', deps);
    expect(ensured.handled).toBe(true);
    expect(ensured.res.status).toBe(200);
    expect(ensured.json.pod.id).toBe('pod_1');

    const got = await call('GET', '/api/pods/pod_1', deps);
    expect(got.res.status).toBe(200);

    const patched = await call('PATCH', '/api/pods/pod_1', deps, { status: 'paused' });
    expect(patched.res.status).toBe(200);
    expect(deps.pods.updateStatus).toHaveBeenCalledWith('pod_1', 'paused');

    const invalid = await call('PATCH', '/api/pods/pod_1', deps, { status: 'bogus' });
    expect(invalid.res.status).toBe(400);
  });

  it('returns 404 when the pod or project is missing', async () => {
    const deps = makeDeps({
      pods: {
        ensure: jest.fn(async () => { throw new PodError(404, 'project not found'); }),
        get: jest.fn(() => null),
        updateStatus: jest.fn(() => { throw new PodError(404, 'pod not found'); }),
      },
    });
    expect((await call('GET', '/api/projects/missing/pod', deps)).res.status).toBe(404);
    expect((await call('GET', '/api/pods/missing', deps)).res.status).toBe(404);
    expect((await call('POST', '/api/pods/missing/wake', deps)).res.status).toBe(404);
  });

  it('lists/creates/updates tasks and maps illegal transitions to 409', async () => {
    const deps = makeDeps();
    expect((await call('GET', '/api/pods/pod_1/tasks', deps)).res.status).toBe(200);
    expect((await call('POST', '/api/pods/pod_1/tasks', deps, { title: 'do' })).res.status).toBe(200);
    expect((await call('PATCH', '/api/pods/pod_1/tasks/t1', deps, { status: 'done' })).res.status).toBe(200);

    deps.tasks.updateTask = jest.fn(() => { throw new PodError(409, 'illegal transition'); });
    expect((await call('PATCH', '/api/pods/pod_1/tasks/t1', deps, { status: 'pending' })).res.status).toBe(409);
  });

  it('lists/sends messages and serves cost/goals/transcript/memory', async () => {
    const deps = makeDeps();
    expect((await call('POST', '/api/pods/pod_1/wake', deps)).res.status).toBe(200);
    expect(deps.goals.promote).toHaveBeenCalledWith('pod_1');
    expect((await call('GET', '/api/pods/pod_1/messages', deps)).res.status).toBe(200);
    expect((await call('POST', '/api/pods/pod_1/messages', deps, {
      fromMemberId: 'm_lead', kind: 'note', body: 'hello',
    })).res.status).toBe(200);

    expect((await call('GET', '/api/pods/pod_1/cost', deps)).json).toEqual({ spentUsd: 0, limitUsd: 10 });
    expect((await call('GET', '/api/pods/pod_1/goals', deps)).res.status).toBe(200);
    expect((await call('GET', '/api/pods/pod_1/sessions/s1/transcript', deps)).res.status).toBe(200);
    expect((await call('GET', '/api/pods/pod_1/memory?node=plan', deps)).json.context).toBe('[POD CONTEXT]');
    expect((await call('GET', '/api/pods/pod_1/memory?file=POD', deps)).json.content).toBe('full memory');
    expect((await call('POST', '/api/pods/pod_1/memory', deps, {
      file: 'POD', content: 'hello',
    })).res.status).toBe(200);
  });

  it('marks a pod message read and 404s unknown ids', async () => {
    const deps = makeDeps();
    const row = { id: 'm1', podId: 'pod_1', readAt: '2026-10-31T00:00:00.000Z' };
    (deps.messages as any).markRead = jest.fn((id: string, podId: string) => (id === 'm1' && podId === 'pod_1' ? row : null));

    const ok = await call('POST', '/api/pods/pod_1/messages/m1/read', deps);
    expect(ok.res.status).toBe(200);
    expect(ok.json.message).toEqual(row);
    expect((deps.messages as any).markRead).toHaveBeenCalledWith('m1', 'pod_1');

    const missing = await call('POST', '/api/pods/pod_1/messages/nope/read', deps);
    expect(missing.res.status).toBe(404);

    const foreign = await call('POST', '/api/pods/pod_1/messages/m_other/read', deps);
    expect(foreign.res.status).toBe(404);
  });

  it('rejects notify on a broadcast message and reports the delivery state', async () => {
    const deps = makeDeps();
    (deps as any).delivery = { deliver: jest.fn(async () => 'delivered') };

    const broadcast = await call('POST', '/api/pods/pod_1/messages', deps, {
      fromMemberId: 'm_lead', kind: 'note', body: 'all hands', notify: true,
    });
    expect(broadcast.res.status).toBe(400);
    expect((deps as any).delivery.deliver).not.toHaveBeenCalled();

    const direct = await call('POST', '/api/pods/pod_1/messages', deps, {
      fromMemberId: 'm_lead', toMemberId: 'm_builder', kind: 'note', body: 'ping', notify: true,
    });
    expect(direct.res.status).toBe(200);
    expect(direct.json.delivery).toBe('delivered');
    expect((deps as any).delivery.deliver).toHaveBeenCalledWith('m1', { force: true });

    const plain = await call('POST', '/api/pods/pod_1/messages', deps, {
      fromMemberId: 'm_lead', kind: 'note', body: 'fyi',
    });
    expect(plain.json.delivery).toBeUndefined();
  });

  it('lookup reads a pod without ensuring one', async () => {
    const deps = makeDeps();
    const found = await call('GET', '/api/projects/p1/pod/lookup', deps);
    expect(found.res.status).toBe(200);
    expect(found.json.pod.id).toBe('pod_1');
    expect(deps.pods.ensure).not.toHaveBeenCalled();

    deps.pods.lookup = jest.fn(() => null);
    const missing = await call('GET', '/api/projects/p1/pod/lookup', deps);
    expect(missing.res.status).toBe(404);

    const legacy = await call('GET', '/api/projects/p1/pod?lookup=1', deps);
    expect(legacy.handled).toBe(true);
  });

  it('lookup applies actor scoping and hides sessions from non-leads', async () => {
    const detailWithSession = {
      ...detail,
      sessions: [{
        id: 'ps1', podId: 'pod_1', memberId: 'm1', goalId: null, node: 'execute',
        sessionId: 'ses_1', status: 'active', transcriptRef: null,
        createdAt: '2026-10-29T00:00:00.000Z', endedAt: null,
      }],
    };
    const builder = { id: 'm1', role: 'builder' };
    const deps = makeDeps({
      pods: { ...makeDeps().pods, lookup: jest.fn(() => detailWithSession) },
      access: { requireMember: jest.fn(() => builder) },
    });
    const scoped = await call('GET', '/api/projects/p1/pod/lookup?actorSessionID=ses_builder', deps);
    expect(scoped.res.status).toBe(200);
    expect(scoped.json.sessions).toEqual([]);

    const foreign = makeDeps({
      pods: { ...makeDeps().pods, lookup: jest.fn(() => detailWithSession) },
      access: { requireMember: jest.fn(() => { throw new PodError(403, 'foreign pod'); }) },
    });
    expect((await call('GET', '/api/projects/p1/pod/lookup?actorSessionID=ses_x', foreign)).res.status).toBe(403);
  });

  it('attaches every pod operation declared in the catalog', () => {
    const ids: string[] = [];
    const registry = { attachHandler: (id: string) => { ids.push(id) } } as any;
    attachPodHandlers(registry, makeDeps());
    const expected = buildRouteCatalog()
      .map((route) => route.operationId)
      .filter((id) => id.startsWith('pods.') && !id.startsWith('pods.a2a'));
    expect(ids.slice().sort()).toEqual(expected.slice().sort());
  });

  it('falls through unknown routes', async () => {
    const deps = makeDeps();
    const result = await call('GET', '/api/unknown', deps);
    expect(result.handled).toBe(false);
  });

  it('scopes read routes when an actor session is supplied', async () => {
    const deps = makeDeps({
      access: {
        requireMember: jest.fn(() => { throw new PodError(403, 'foreign pod'); }),
      },
    });

    expect((await call('GET', '/api/pods/pod_1?actorSessionID=ses_x', deps)).res.status).toBe(403);
    expect((await call('GET', '/api/pods/pod_1/memory?actorSessionID=ses_x', deps)).res.status).toBe(403);
  });
});
