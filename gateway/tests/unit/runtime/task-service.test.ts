import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskService } from '../../../src/runtime/task-service';
import { TaskStore } from '../../../src/runtime/task-store';

function makeService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-task-service-'));
  const sessions = new Map<string, any>([
    ['p1', { id: 'p1', directory: 'C:/work', title: 'parent' }],
  ]);
  let shellInfo: any = { id: 'sh1', status: 'running' };
  const deps: any = {
    storeDir: dir,
    shell: {
      create: jest.fn(async () => ({ id: 'sh1', status: 'running' })),
      get: jest.fn(async () => shellInfo),
      output: jest.fn(async () => ({ output: 'ok', cursor: 2, size: 2, truncated: false })),
      remove: jest.fn(async () => {}),
    },
    spawnSubagent: jest.fn(async () => ({ id: 'c1', status: 'running' })),
    cancelSubagent: jest.fn(async () => {}),
    messageSubagent: jest.fn(async () => {}),
    getSession: jest.fn(async (sid: string) => sessions.get(sid) ?? null),
    pendingInput: jest.fn(async () => false),
    emit: jest.fn(),
    now: () => 1000,
  };
  return { svc: new TaskService(deps), deps, dir, sessions, setShell: (v: any) => { shellInfo = v; } };
}

describe('TaskService shell tasks', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => { ctx = makeService(); });
  afterEach(() => { ctx.svc.dispose(); fs.rmSync(ctx.dir, { recursive: true, force: true }); });

  it('submits a shell task and completes on exit 0', async () => {
    const task = await ctx.svc.submit({ kind: 'shell', parentSessionID: 'p1', command: 'echo ok', title: 'echo' });
    expect(task).toMatchObject({ kind: 'shell', shellID: 'sh1', status: 'working', title: 'echo' });
    expect((ctx.deps.shell.create as jest.Mock).mock.calls[0][0].metadata.taskID).toBe(task.id);
    ctx.setShell({ id: 'sh1', status: 'exited', exit: 0 });
    await ctx.svc.refreshOnce();
    expect(ctx.svc.get(task.id)).toMatchObject({ status: 'completed' });
    expect(ctx.deps.emit).toHaveBeenCalledWith(expect.objectContaining({ id: task.id, status: 'completed' }));
    expect((ctx.deps.emit as jest.Mock).mock.calls.at(-1)[0].output).toBeUndefined();
    expect(await ctx.svc.output(task.id)).toEqual({ output: 'ok', cursor: 2, size: 2, truncated: false });
  });

  it('maps exit/timeout/killed/lost', async () => {
    const t = await ctx.svc.submit({ kind: 'shell', parentSessionID: 'p1', command: 'x' });
    ctx.setShell({ id: 'sh1', status: 'exited', exit: 2 });
    await ctx.svc.refreshOnce();
    expect(ctx.svc.get(t.id)).toMatchObject({ status: 'failed', exitCode: 2 });

    const t2 = await ctx.svc.submit({ kind: 'shell', parentSessionID: 'p1', command: 'y' });
    ctx.setShell({ id: 'sh1', status: 'timeout' });
    await ctx.svc.refreshOnce();
    expect(ctx.svc.get(t2.id)).toMatchObject({ status: 'failed', error: 'timeout' });

    const t3 = await ctx.svc.submit({ kind: 'shell', parentSessionID: 'p1', command: 'z' });
    ctx.setShell({ id: 'sh1', status: 'killed' });
    await ctx.svc.refreshOnce();
    expect(ctx.svc.get(t3.id)).toMatchObject({ status: 'cancelled' });

    const t4 = await ctx.svc.submit({ kind: 'shell', parentSessionID: 'p1', command: 'w' });
    (ctx.deps.shell.get as jest.Mock).mockRejectedValueOnce(new Error('404'));
    await ctx.svc.refreshOnce();
    expect(ctx.svc.get(t4.id)).toMatchObject({ status: 'failed', error: 'lost_after_restart' });
  });

  it('cancel is idempotent and removes the shell', async () => {
    const t = await ctx.svc.submit({ kind: 'shell', parentSessionID: 'p1', command: 'sleep 1' });
    await ctx.svc.cancel(t.id);
    expect(ctx.svc.get(t.id)?.status).toBe('cancelled');
    await ctx.svc.cancel(t.id);
    expect(ctx.deps.shell.remove).toHaveBeenCalledTimes(1);
  });

  it('output proxies shell output only', async () => {
    const t = await ctx.svc.submit({ kind: 'shell', parentSessionID: 'p1', command: 'echo' });
    expect(await ctx.svc.output(t.id, { cursor: 1, limit: 2 })).toMatchObject({ output: 'ok', cursor: 2 });
    await expect(ctx.svc.message(t.id, 'hi')).rejects.toMatchObject({ status: 400 });
  });
});

describe('TaskService subagent tasks', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => { ctx = makeService(); });
  afterEach(() => { ctx.svc.dispose(); fs.rmSync(ctx.dir, { recursive: true, force: true }); });

  it('tracks child completion and pending input', async () => {
    ctx.sessions.set('c1', { id: 'c1', parentID: 'p1', time: { created: 1 }, outcome: undefined });
    const task = await ctx.svc.submit({ kind: 'subagent', parentSessionID: 'p1', prompt: 'do it' });
    expect(task).toMatchObject({ kind: 'subagent', childSessionID: 'c1', status: 'working' });

    (ctx.deps.pendingInput as jest.Mock).mockResolvedValueOnce(true);
    await ctx.svc.refreshOnce();
    expect(ctx.svc.get(task.id)?.status).toBe('input_required');

    ctx.sessions.set('c1', { id: 'c1', parentID: 'p1', time: { created: 1, idle: 2 }, outcome: 'succeeded' });
    await ctx.svc.refreshOnce();
    expect(ctx.svc.get(task.id)?.status).toBe('completed');
  });

  it('message and cancel delegate to subagent; wrong kind rejected', async () => {
    const t = await ctx.svc.submit({ kind: 'subagent', parentSessionID: 'p1', prompt: 'x' });
    await ctx.svc.message(t.id, 'continue');
    expect(ctx.deps.messageSubagent).toHaveBeenCalledWith('p1', 'c1', 'continue');
    await ctx.svc.cancel(t.id);
    expect(ctx.deps.cancelSubagent).toHaveBeenCalledWith('p1', 'c1');
    await expect(ctx.svc.output(t.id)).rejects.toMatchObject({ status: 400 });
  });

  it('message reopens a terminal subagent task', async () => {
    const t = await ctx.svc.submit({ kind: 'subagent', parentSessionID: 'p1', prompt: 'x' });
    ctx.sessions.set('c1', { id: 'c1', parentID: 'p1', time: { created: 1, idle: 2 }, outcome: 'succeeded' });
    await ctx.svc.refreshOnce();
    expect(ctx.svc.get(t.id)?.status).toBe('completed');
    await ctx.svc.message(t.id, 'again');
    expect(ctx.svc.get(t.id)).toMatchObject({ status: 'working' });
    expect(ctx.svc.get(t.id)?.finishedAt).toBeUndefined();
    expect(ctx.svc.get(t.id)).not.toHaveProperty('resumeAt');
    ctx.sessions.set('c1', { id: 'c1', parentID: 'p1', time: { created: 1, idle: 2 }, outcome: 'succeeded' });
    await ctx.svc.refreshOnce();
    expect(ctx.svc.get(t.id)?.status).toBe('working');
    ctx.sessions.set('c1', { id: 'c1', parentID: 'p1', time: { created: 1, idle: 2000 }, outcome: 'succeeded' });
    await ctx.svc.refreshOnce();
    expect(ctx.svc.get(t.id)?.status).toBe('completed');
  });

  it('missing child session → failed lost', async () => {
    const t = await ctx.svc.submit({ kind: 'subagent', parentSessionID: 'p1', prompt: 'x' });
    (ctx.deps.getSession as jest.Mock).mockImplementation(async (sid: string) => sid === 'p1' ? { directory: 'C:/work' } : null);
    await ctx.svc.refreshOnce();
    expect(ctx.svc.get(t.id)).toMatchObject({ status: 'failed', error: 'lost_after_restart' });
  });
});

describe('TaskService init', () => {
  it('loads persisted active tasks and reconciles them', async () => {
    const ctx = makeService();
    const store = new TaskStore(ctx.dir);
    store.save({
      id: 'task_old', kind: 'shell', parentSessionID: 'p1', shellID: 'sh1', title: 'old',
      status: 'working', createdAt: 1, updatedAt: 1,
    });
    ctx.setShell({ id: 'sh1', status: 'exited', exit: 0 });
    await ctx.svc.init();
    expect(ctx.svc.get('task_old')?.status).toBe('completed');
    ctx.svc.dispose();
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });
});
