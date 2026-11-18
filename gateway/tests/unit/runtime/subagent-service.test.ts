import { SubagentService, SubagentError } from '../../../src/runtime/subagent-service';

function makeService() {
  const sessions = new Map<string, any>();
  sessions.set('p1', { id: 'p1', directory: 'C:/work', title: 'parent', time: { created: 1, updated: 1 } });
  let seq = 0;
  const deps: any = {
    createSession: jest.fn(async ({ directory, parentID }: any) => {
      const id = `c${++seq}`;
      sessions.set(id, { id, parentID, directory, title: 'child', agent: 'general', time: { created: 10 + seq, updated: 10 + seq } });
      return { id };
    }),
    getSession: jest.fn(async (sid: string) => sessions.get(sid) ?? null),
    children: jest.fn(async () => [] as any[]),
    promptChild: jest.fn(async () => {}),
    messageChild: jest.fn(async () => {}),
    abortChild: jest.fn(async () => {}),
    messages: jest.fn(async () => ({ data: [] })),
    submitted: jest.fn(() => undefined),
    broadcast: jest.fn(),
  };
  return { service: new SubagentService(deps), deps, sessions };
}

describe('SubagentService.spawn', () => {
  it('creates a child with parentID/depth and broadcasts session.created', async () => {
    const { service, deps } = makeService();
    const rec = await service.spawn({
      parentID: 'p1', prompt: 'do it', agent: 'general', description: 'Builder',
      outputSchema: { name: 'x', schema: { type: 'object' } },
    });
    expect(rec).toMatchObject({ id: 'c1', parentID: 'p1', depth: 1, status: 'running', agent: 'general' });
    expect(deps.createSession).toHaveBeenCalledWith({ directory: 'C:/work', parentID: 'p1' });
    expect(deps.promptChild).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'c1', prompt: 'do it', agent: 'general', outputSchema: { name: 'x', schema: { type: 'object' } },
    }));
    expect(deps.broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session.created',
      properties: { sessionID: 'c1', info: expect.objectContaining({ id: 'c1', parentID: 'p1', depth: 1 }) },
    }));
  });

  it('marks failed when the prompt throws but keeps the child id', async () => {
    const { service, deps } = makeService();
    deps.promptChild.mockRejectedValueOnce(new Error('provider down'));
    const rec = await service.spawn({ parentID: 'p1', prompt: 'x' });
    expect(rec).toMatchObject({ id: 'c1', status: 'failed', error: 'provider down' });
  });

  // N1（spawn 侧同源）：刷新查询瞬时失败不得把刚起的子代理写成 aborted
  it('does not mark a freshly spawned child aborted when the post-spawn lookup fails', async () => {
    const { service, deps, sessions } = makeService();
    deps.getSession.mockImplementation(async (sid: string) => {
      if (sid === 'c1') throw new Error('serve restarting');
      return sessions.get(sid) ?? null;
    });
    const rec = await service.spawn({ parentID: 'p1', prompt: 'x' });
    expect(rec).toMatchObject({ id: 'c1', status: 'running' });
  });

  it('404 when parent is missing; 400 without prompt', async () => {
    const { service } = makeService();
    await expect(service.spawn({ parentID: 'nope', prompt: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(service.spawn({ parentID: 'p1', prompt: '   ' })).rejects.toBeInstanceOf(SubagentError);
  });
});

describe('SubagentService.list/depth', () => {
  it('merges native children via canonical lifecycle and computes depth', async () => {
    const { service, deps, sessions } = makeService();
    const lifecycle = {
      phase: 'settled' as const, outcome: 'completed' as const,
      observedAt: 20, lastActivityAt: 9, epoch: 'e1', revision: 1, authority: 'adapter' as const,
    };
    sessions.set('native1', { id: 'native1', parentID: 'p1', title: 'native', lifecycle });
    deps.children.mockResolvedValueOnce([
      { id: 'native1', title: 'native', lifecycle, time: { created: 5, updated: 9 } },
    ]);
    const rows = await service.list('p1');
    expect(rows).toEqual([expect.objectContaining({ id: 'native1', parentID: 'p1', depth: 1, status: 'completed' })]);
    expect(await service.depthOf('native1')).toBe(1);
  });

  it('never infers running from native time/outcome without lifecycle', async () => {
    const { service, deps, sessions } = makeService();
    sessions.set('legacy', {
      id: 'legacy', parentID: 'p1', title: 'legacy',
      time: { created: 5, updated: 9, idle: 9 }, outcome: 'succeeded',
    });
    deps.children.mockResolvedValueOnce([
      { id: 'legacy', title: 'legacy', time: { created: 5, updated: 9, idle: 9 }, outcome: 'succeeded' },
    ]);
    const rows = await service.list('p1');
    expect(rows[0]).toMatchObject({ id: 'legacy', status: 'unknown' });
  });

  it('maps waiting lifecycle to waiting', async () => {
    const { service, deps } = makeService();
    const lifecycle = {
      phase: 'waiting' as const, waitingOn: ['children' as const],
      observedAt: 30, lastActivityAt: 29, epoch: 'e1', revision: 1, authority: 'runtime' as const,
    };
    deps.children.mockResolvedValueOnce([{ id: 'waiting', parentID: 'p1', lifecycle }]);
    deps.getSession.mockResolvedValueOnce({ id: 'waiting', parentID: 'p1', lifecycle });
    const rows = await service.list('p1');
    expect(rows[0]).toMatchObject({ id: 'waiting', status: 'waiting' });
  });

  // N1：瞬时查询失败 = 运行时暂时不可达，绝不能把在跑的子代理说成 aborted/cancelled
  it('keeps a running child running when the lookup fails transiently', async () => {
    const { service, deps, sessions } = makeService();
    const spawned = await service.spawn({ parentID: 'p1', prompt: 'x' });
    expect(spawned.status).toBe('running');

    deps.getSession.mockRejectedValueOnce(new Error('serve restarting'));
    expect(await service.list('p1')).toEqual([expect.objectContaining({ id: 'c1', status: 'running' })]);

    // 再次成功且拿到终态 lifecycle ⇒ 正常报告终态（失败只暂停刷新，不冻结）
    sessions.set('c1', {
      id: 'c1', parentID: 'p1',
      lifecycle: {
        phase: 'settled', outcome: 'completed', observedAt: 5, lastActivityAt: 5,
        epoch: 'e1', revision: 1, authority: 'adapter',
      },
    });
    expect(await service.list('p1')).toEqual([expect.objectContaining({ id: 'c1', status: 'completed' })]);
  });

  it('reports unknown when the lookup succeeds but the session is genuinely gone', async () => {
    const { service, deps } = makeService();
    await service.spawn({ parentID: 'p1', prompt: 'x' });
    // 查询成功但会话已不存在：没有 lifecycle 证据，不能伪造 aborted/completed
    deps.getSession.mockResolvedValueOnce(null);
    expect(await service.list('p1')).toEqual([expect.objectContaining({ id: 'c1', status: 'unknown' })]);
  });

  it('walks parent chains and caps at 32', async () => {
    const { service, sessions } = makeService();
    let parent = 'p1';
    for (let i = 0; i < 40; i++) {
      const id = `d${i}`;
      sessions.set(id, { id, parentID: parent, time: { created: 1, updated: 1 } });
      parent = id;
    }
    expect(await service.depthOf('d0')).toBe(1);
    expect(await service.depthOf('d39')).toBeLessThanOrEqual(32);
  });
});

describe('SubagentService ownership/message/cancel/result', () => {
  it('rejects a child of another parent', async () => {
    const { service, sessions } = makeService();
    sessions.set('other', { id: 'other', parentID: 'p2', time: { created: 1, updated: 1 } });
    await expect(service.message('p1', 'other', 'hi')).rejects.toMatchObject({ status: 404 });
    await expect(service.cancel('p1', 'other')).rejects.toMatchObject({ status: 404 });
    await expect(service.result('p1', 'other')).rejects.toMatchObject({ status: 404 });
  });

  it('message prefixes sender; cancel marks aborted; result prefers structured', async () => {
    const { service, deps, sessions } = makeService();
    sessions.set('c1', {
      id: 'c1', parentID: 'p1',
      lifecycle: {
        phase: 'settled', outcome: 'completed', observedAt: 2, lastActivityAt: 1,
        epoch: 'e1', revision: 1, authority: 'adapter',
      },
    });
    deps.submitted.mockReturnValue({ ok: true });
    await service.message('p1', 'c1', 'keep going');
    expect(deps.messageChild).toHaveBeenCalledWith('c1', '[from parent p1] keep going');
    await service.cancel('p1', 'c1');
    expect(deps.abortChild).toHaveBeenCalledWith('c1');
    expect(await service.result('p1', 'c1')).toEqual({ status: 'completed', structured: { ok: true } });
  });

  it('falls back to the last assistant text', async () => {
    const { service, deps, sessions } = makeService();
    sessions.set('c1', {
      id: 'c1', parentID: 'p1',
      lifecycle: {
        phase: 'settled', outcome: 'completed', observedAt: 2, lastActivityAt: 1,
        epoch: 'e1', revision: 1, authority: 'adapter',
      },
    });
    deps.messages.mockResolvedValueOnce({ data: [
      { role: 'assistant', content: [{ type: 'text', text: 'old' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'child-ok' }] },
    ] });
    expect(await service.result('p1', 'c1')).toEqual({ status: 'completed', text: 'child-ok' });
  });
});
