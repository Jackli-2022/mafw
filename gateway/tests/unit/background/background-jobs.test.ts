/**
 * Task 3：background jobs 三源聚合（TaskService / runtime shell / 子代理）+ canonical 事件。
 *
 * 责任边界：
 *  - `mergeBackgroundJobs` 纯函数（同 id 去重、状态映射、稳定排序）
 *  - `BackgroundJobRegistry` 事件驱动的 runtime shell 台账（终态不回退）
 *  - 事件翻译（@2.1 与 @v1/@v2 方言）：synthetic shell/subagent → `background.job.updated`
 *  - `BackgroundJobService`（REST 语义：list/output/cancel）
 */
import { OPENCODE_TRANSFORM_EVENT } from '../../../src/runtime/opencode-events';
import { translateOpencode21Event } from '../../../src/runtime/opencode-21-events';
import type { SessionInfo } from '../../../src/runtime/contract';
import type { TaskEntity } from '../../../src/runtime/task-service';
import {
  BackgroundJobError,
  BackgroundJobService,
  BackgroundJobRegistry,
  backgroundJobStatusOfShell,
  backgroundJobStatusOfTask,
  backgroundJobEvent,
  jobFromRuntimeShell,
  jobFromSubagent,
  jobFromTask,
  mergeBackgroundJobs,
  runtimeShellRowFromSynthetic,
  toBackgroundOutput,
  type RuntimeShellRow,
} from '../../../src/core/background/background-jobs';

function task(over: Partial<TaskEntity>): TaskEntity {
  return {
    id: 'task_x',
    kind: 'shell',
    parentSessionID: 'ses_parent',
    title: 'task',
    status: 'working',
    createdAt: 1000,
    updatedAt: 2000,
    ...over,
  };
}

function shell(over: Partial<RuntimeShellRow>): RuntimeShellRow {
  return { id: 'sh_x', sessionID: 'ses_parent', status: 'running', ...over };
}

function session(over: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'ses_x',
    projectID: 'proj',
    directory: 'C:/work',
    title: 'child',
    time: { created: 1000, updated: 2000 },
    ...over,
  };
}

/** 事件形态的子代理 job（registry 记账用）。 */
function subagentJob(id: string, status: 'running' | 'completed' | 'failed' | 'cancelled') {
  return {
    id,
    source: 'subagent' as const,
    kind: 'subagent' as const,
    status,
    sessionID: 'ses_parent',
    childSessionID: id,
  };
}

describe('mergeBackgroundJobs', () => {
  it('dedupes task-owned shell and subagent rows by stable ids', () => {
    const jobs = mergeBackgroundJobs('ses_parent', {
      tasks: [
        task({ id: 'task_1', kind: 'shell', shellID: 'sh_1', status: 'working' }),
        task({ id: 'task_2', kind: 'subagent', childSessionID: 'ses_child', status: 'completed' }),
      ],
      runtimeShells: [shell({ id: 'sh_1', command: 'sleep 1' }), shell({ id: 'sh_2', command: 'pwd' })],
      subagents: [session({ id: 'ses_child', title: 'child' }), session({ id: 'ses_loose', title: 'loose' })],
    });
    expect(jobs.map((j) => j.id).sort()).toEqual(['ses_loose', 'sh_2', 'task_1', 'task_2']);
    expect(jobs.find((j) => j.id === 'task_1')?.source).toBe('mafw-task');
  });

  it('keeps locating ids on the winning task row', () => {
    const jobs = mergeBackgroundJobs('ses_parent', {
      tasks: [task({ id: 'task_1', kind: 'shell', shellID: 'sh_1', status: 'working' })],
      runtimeShells: [shell({ id: 'sh_1', command: 'sleep 1' })],
      subagents: [],
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'task_1', source: 'mafw-task', kind: 'shell', status: 'running',
      runtimeShellID: 'sh_1', taskID: 'task_1', sessionID: 'ses_parent',
    });
  });

  it('drops rows of other sessions and never invents jobs', () => {
    const jobs = mergeBackgroundJobs('ses_parent', {
      tasks: [task({ id: 'task_other', parentSessionID: 'ses_other' })],
      runtimeShells: [shell({ id: 'sh_other', sessionID: 'ses_other' })],
      subagents: [session({ id: 'ses_other_child', parentID: 'ses_other' })],
    });
    expect(jobs).toEqual([]);
  });

  it('orders running jobs first, then most recently updated', () => {
    const jobs = mergeBackgroundJobs('ses_parent', {
      tasks: [
        task({ id: 'done_new', status: 'completed', updatedAt: 5000 }),
        task({ id: 'run_old', status: 'working', updatedAt: 1000 }),
        task({ id: 'run_new', status: 'working', updatedAt: 3000 }),
      ],
      runtimeShells: [],
      subagents: [],
    });
    expect(jobs.map((j) => j.id)).toEqual(['run_new', 'run_old', 'done_new']);
  });

  it('maps shell runtime rows (exited/timeout/killed) into canonical statuses', () => {
    const jobs = mergeBackgroundJobs('ses_parent', {
      tasks: [],
      runtimeShells: [
        shell({ id: 'sh_ok', status: 'exited', exitCode: 0 }),
        shell({ id: 'sh_fail', status: 'exited', exitCode: 3 }),
        shell({ id: 'sh_timeout', status: 'timeout' }),
        shell({ id: 'sh_killed', status: 'killed' }),
        shell({ id: 'sh_running', status: 'running' }),
      ],
      subagents: [],
    });
    const byId = Object.fromEntries(jobs.map((j) => [j.id, j.status]));
    expect(byId).toEqual({
      sh_ok: 'completed',
      sh_fail: 'failed',
      sh_timeout: 'failed',
      sh_killed: 'cancelled',
      sh_running: 'running',
    });
    expect(jobs.every((j) => j.source === 'runtime-shell')).toBe(true);
  });
});

describe('status mapping', () => {
  it('normalizes task statuses (working/input_required are active ⇒ running)', () => {
    expect(backgroundJobStatusOfTask('working')).toBe('running');
    expect(backgroundJobStatusOfTask('input_required')).toBe('running');
    expect(backgroundJobStatusOfTask('completed')).toBe('completed');
    expect(backgroundJobStatusOfTask('failed')).toBe('failed');
    expect(backgroundJobStatusOfTask('cancelled')).toBe('cancelled');
  });

  it('maps runtime shell statuses; unknown/missing stay running', () => {
    expect(backgroundJobStatusOfShell('running')).toBe('running');
    expect(backgroundJobStatusOfShell(undefined)).toBe('running');
    expect(backgroundJobStatusOfShell('weird')).toBe('running');
    expect(backgroundJobStatusOfShell('exited', 0)).toBe('completed');
    expect(backgroundJobStatusOfShell('exited', 2)).toBe('failed');
    expect(backgroundJobStatusOfShell('timeout')).toBe('failed');
    expect(backgroundJobStatusOfShell('killed')).toBe('cancelled');
  });
});

describe('row/job builders', () => {
  it('task job carries ids, command and time window', () => {
    const job = jobFromTask(task({
      id: 'task_1', kind: 'shell', shellID: 'sh_1', title: 'sleep 1',
      metadata: { command: 'sleep 1' }, status: 'failed', exitCode: 7,
      createdAt: 10, updatedAt: 20, finishedAt: 30,
    }));
    expect(job).toMatchObject({
      id: 'task_1', source: 'mafw-task', kind: 'shell', status: 'failed',
      sessionID: 'ses_parent', title: 'sleep 1', command: 'sleep 1',
      runtimeShellID: 'sh_1', taskID: 'task_1', exitCode: 7,
      time: { created: 10, updated: 20, completed: 30 },
    });
  });

  it('subagent job uses the child session as its stable id', () => {
    const info = jobFromSubagent(session({ id: 'ses_child', parentID: 'ses_parent', title: 'explore' }));
    expect(info).toMatchObject({
      id: 'ses_child', source: 'subagent', kind: 'subagent', sessionID: 'ses_parent',
      title: 'explore', childSessionID: 'ses_child',
    });
    expect(info.status).toBe('running');
  });

  it('runtime shell job keeps the native shell id', () => {
    const job = jobFromRuntimeShell(shell({ id: 'sh_9', command: 'npm test', status: 'killed' }));
    expect(job).toMatchObject({ id: 'sh_9', source: 'runtime-shell', kind: 'shell', status: 'cancelled', command: 'npm test' });
  });

  it('builds a runtime shell row from synthetic shell metadata (legacy + normalized info)', () => {
    expect(runtimeShellRowFromSynthetic('ses_1', { source: 'shell', shellID: 'sh_1', command: 'pwd' }, 42)).toMatchObject({
      id: 'sh_1', sessionID: 'ses_1', command: 'pwd', status: 'running',
    });
    expect(runtimeShellRowFromSynthetic('ses_1', { source: 'shell', shellID: 'sh_1', status: 'completed', exitCode: 0 })?.status)
      .toBe('exited');
    expect(runtimeShellRowFromSynthetic('ses_1', { source: 'shell', jobID: 'sh_2', exit: 2 })?.status).toBe('exited');
    expect(runtimeShellRowFromSynthetic('ses_1', { source: 'shell', jobID: 'sh_3', state: 'cancelled' })?.status).toBe('killed');
    expect(runtimeShellRowFromSynthetic('ses_1', { source: 'subagent', childID: 'ses_c' })).toBeNull();
    expect(runtimeShellRowFromSynthetic('ses_1', {})).toBeNull();
  });

  it('wraps a job into the canonical background.job.updated event', () => {
    const job = jobFromRuntimeShell(shell({ id: 'sh_1' }));
    const evt = backgroundJobEvent(job, { directory: 'C:/work' });
    expect(evt.payload.type).toBe('background.job.updated');
    expect(evt.payload.properties.job).toEqual(job);
    expect(evt.sessionID).toBe('ses_parent');
    expect(evt.directory).toBe('C:/work');
  });
});

describe('MafwBackgroundOutput cursor（UTF-8 字节）', () => {
  it('advances by UTF-8 byte length, not UTF-16 code units', () => {
    // '你好' = 6 bytes / 2 UTF-16 units；'🙂' = 4 bytes / 2 UTF-16 units
    expect(toBackgroundOutput({ output: '你好', cursor: 0, size: 6 })).toEqual({ cursor: 6, data: '你好', truncated: false });
    expect(toBackgroundOutput({ output: '🙂', cursor: 0, size: 4 }).cursor).toBe(4);
    expect(toBackgroundOutput({ output: '🙂', cursor: 6, size: 10 }).cursor).toBe(10);
  });

  it('pages CJK output without skipping or stalling (runtime cursor is bytes)', () => {
    const page1 = toBackgroundOutput({ output: '你好', cursor: 0, size: 9, truncated: true });
    const page2 = toBackgroundOutput({ output: '世', cursor: page1.cursor, size: 9, truncated: false });
    expect(page1.cursor).toBe(6);
    expect(page2.cursor).toBe(9);
    expect(`${page1.data}${page2.data}`).toBe('你好世');
  });

  it('never runs past the reported size (frozen snapshot semantics)', () => {
    // 冻结快照：cursor 已是「下一次起点」，size 与内容同长 → 不得按字节再加一次
    expect(toBackgroundOutput({ output: 'abc', cursor: 3, size: 3 }).cursor).toBe(3);
    // size 缺失：按数据字节数推进
    expect(toBackgroundOutput({ output: 'abc' }).cursor).toBe(3);
  });
});

describe('BackgroundJobRegistry', () => {
  it('upserts by id and never regresses a terminal shell back to running', () => {
    const reg = new BackgroundJobRegistry();
    const running = jobFromRuntimeShell(shell({ id: 'sh_1', status: 'running' }));
    expect(reg.apply(running)).toBe(true);
    const done = jobFromRuntimeShell(shell({ id: 'sh_1', status: 'exited', exitCode: 0 }));
    expect(reg.apply(done)).toBe(true);
    expect(reg.list('ses_parent')[0].status).toBe('completed');

    const lateStart = jobFromRuntimeShell(shell({ id: 'sh_1', status: 'running' }));
    expect(reg.apply(lateStart)).toBe(false);
    expect(reg.list('ses_parent')[0].status).toBe('completed');
  });

  it('answers per session and keeps newest shells first', () => {
    const reg = new BackgroundJobRegistry();
    reg.apply(jobFromRuntimeShell(shell({ id: 'sh_old', time: { updated: 100 } })));
    reg.apply(jobFromRuntimeShell(shell({ id: 'sh_new', time: { updated: 300 } })));
    reg.apply(jobFromRuntimeShell(shell({ id: 'sh_other', sessionID: 'ses_other', time: { updated: 900 } })));
    expect(reg.list('ses_parent').map((j) => j.id)).toEqual(['sh_new', 'sh_old']);
    expect(reg.rows('ses_parent').map((r) => r.id)).toEqual(['sh_new', 'sh_old']);
    expect(reg.list('ses_other')).toHaveLength(1);
  });

  // ── review Important 3：事件与 REST 快照必须一致（子代理也记账） ──
  it('records subagent events so the snapshot agrees with the event', async () => {
    const reg = new BackgroundJobRegistry();
    expect(reg.apply(subagentJob('ses_child', 'failed'))).toBe(true);
    expect(reg.subagentRows('ses_parent')).toHaveLength(1);

    const { svc } = service({ registry: reg, tasks: { list: () => [] }, listSubagents: async () => [] });
    const jobs = await svc.list('ses_parent');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: 'ses_child', source: 'subagent', status: 'failed' });
  });

  it('terminal event upgrades a still-running authoritative subagent row', async () => {
    const reg = new BackgroundJobRegistry();
    reg.apply(subagentJob('ses_child', 'cancelled'));
    const { svc } = service({
      registry: reg,
      tasks: { list: () => [] },
      listSubagents: async () => [{ id: 'ses_child', parentID: 'ses_parent', status: 'running' }],
    });
    const jobs = await svc.list('ses_parent');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('cancelled');
  });

  it('keeps the authoritative terminal status over a stale event', async () => {
    const reg = new BackgroundJobRegistry();
    reg.apply(subagentJob('ses_child', 'completed'));
    const { svc } = service({
      registry: reg,
      tasks: { list: () => [] },
      listSubagents: async () => [{ id: 'ses_child', parentID: 'ses_parent', status: 'failed' }],
    });
    const jobs = await svc.list('ses_parent');
    expect(jobs[0].status).toBe('failed');
  });

  it('does not mirror mafw-task jobs into the event registry (TaskService is authoritative)', () => {
    const reg = new BackgroundJobRegistry();
    expect(reg.apply({ id: 'task_1', source: 'mafw-task', kind: 'shell', status: 'running', sessionID: 'ses_parent' } as any)).toBe(false);
    expect(reg.list('ses_parent')).toEqual([]);
  });
});

describe('event translation → background.job.updated', () => {
  it('maps shell synthetic lifecycle to canonical background.job.updated (@2.1 dialect)', () => {
    const out: any = translateOpencode21Event({
      type: 'session.next.synthetic',
      data: { sessionID: 'ses_1', metadata: { source: 'shell', shellID: 'sh_1', status: 'completed', exitCode: 0 } },
    });
    expect(out?.payload.type).toBe('background.job.updated');
    expect(out?.payload.properties.job).toMatchObject({
      id: 'sh_1', source: 'runtime-shell', kind: 'shell', status: 'completed', sessionID: 'ses_1',
    });
  });

  it('maps subagent synthetic lifecycle (@2.1 dialect)', () => {
    const out: any = translateOpencode21Event({
      type: 'session.next.synthetic',
      data: { sessionID: 'ses_1', metadata: { source: 'subagent', childID: 'ses_child', description: 'explore' } },
    });
    expect(out?.payload.type).toBe('background.job.updated');
    expect(out?.payload.properties.job).toMatchObject({
      id: 'ses_child', source: 'subagent', kind: 'subagent', childSessionID: 'ses_child', sessionID: 'ses_1',
    });
  });

  it('leaves non-background synthetics untouched (@2.1 dialect)', () => {
    const raw = { type: 'session.next.synthetic', data: { sessionID: 'ses_1', metadata: { source: 'system' } } };
    expect(translateOpencode21Event(raw)).toBe(raw);
  });

  it('maps synthetic lifecycle in the @v1/@v2 dialect transform', () => {
    const out: any = OPENCODE_TRANSFORM_EVENT({
      directory: 'C:/work',
      payload: {
        type: 'session.next.synthetic',
        properties: { sessionID: 'ses_1', metadata: { source: 'shell', shellID: 'sh_3', status: 'completed', exitCode: 1 } },
      },
    });
    expect(out?.payload.type).toBe('background.job.updated');
    expect(out?.payload.properties.job).toMatchObject({ id: 'sh_3', status: 'failed', sessionID: 'ses_1' });
    expect(out?.directory).toBe('C:/work');
  });

  it('keeps message.updated translation intact', () => {
    const out: any = OPENCODE_TRANSFORM_EVENT({
      payload: { type: 'message.updated', properties: { sessionID: 'ses_1', info: { id: 'm1', role: 'assistant' } } },
    });
    expect(out.payload).toMatchObject({ type: 'message.updated', properties: { sessionID: 'ses_1', message: { id: 'm1' } } });
  });
});

/** 服务装配（模块级：registry 一致性用例也要用）。 */
function service(over: any = {}) {
  const registry = over.registry ?? new BackgroundJobRegistry();
  const broadcast = over.broadcast ?? jest.fn();
  const svc = new BackgroundJobService({
    tasks: over.tasks ?? {
      list: jest.fn(() => []),
      get: jest.fn(),
      cancel: jest.fn(),
      output: jest.fn(async () => ({ output: '', cursor: 0, size: 0, truncated: false })),
    },
    registry,
    listSubagents: over.listSubagents ?? (async () => []),
    outputShell: over.outputShell,
    cancelShell: over.cancelShell,
    cancelSubagent: over.cancelSubagent,
    broadcast,
  });
  return { svc, registry, broadcast };
}

describe('BackgroundJobService', () => {
  it('merges the three sources into one neutral list', async () => {
    const { svc } = service({
      tasks: { list: () => [task({ id: 'task_1', kind: 'shell', shellID: 'sh_1' })] },
      listSubagents: async () => [session({ id: 'ses_child', parentID: 'ses_parent' })],
    });
    const jobs = await svc.list('ses_parent');
    expect(jobs.map((j) => j.id).sort()).toEqual(['ses_child', 'task_1']);
  });

  it('rejects an empty session id', async () => {
    const { svc } = service();
    await expect(svc.list('')).rejects.toBeInstanceOf(BackgroundJobError);
    await expect(svc.list('')).rejects.toMatchObject({ status: 400 });
  });

  it('survives an unavailable subagent source (fail-open)', async () => {
    const { svc } = service({
      tasks: { list: () => [] },
      listSubagents: async () => { throw new Error('runtime down'); },
    });
    await expect(svc.list('ses_parent')).resolves.toEqual([]);
  });

  it('reads shell output with a next cursor and never exposes raw runtime DTOs', async () => {
    const registry = new BackgroundJobRegistry();
    registry.apply(jobFromRuntimeShell(shell({ id: 'sh_1', status: 'exited', exitCode: 0 })));
    const outputShell = jest.fn(async () => ({ output: 'hello', cursor: 10, size: 15, truncated: true }));
    const { svc } = service({ registry, outputShell });
    const out = await svc.output('ses_parent', 'sh_1', 10);
    expect(outputShell).toHaveBeenCalledWith(expect.objectContaining({ shellID: 'sh_1', cursor: 10 }));
    expect(out).toEqual({ cursor: 15, data: 'hello', truncated: true });
  });

  it('delegates task output and maps the task output shape', async () => {
    const tasks = {
      list: () => [task({ id: 'task_1', kind: 'shell', shellID: 'sh_1', status: 'completed' })],
      get: jest.fn(),
      cancel: jest.fn(),
      output: jest.fn(async () => ({ output: 'done', cursor: 4, size: 4, truncated: false })),
    };
    const { svc } = service({ tasks });
    const out = await svc.output('ses_parent', 'task_1');
    expect(tasks.output).toHaveBeenCalledWith('task_1', {});
    expect(out).toEqual({ cursor: 4, data: 'done', truncated: false });
  });

  it('rejects output for subagent jobs and unknown ids', async () => {
    const { svc } = service({ listSubagents: async () => [session({ id: 'ses_child', parentID: 'ses_parent' })] });
    await expect(svc.output('ses_parent', 'ses_child')).rejects.toMatchObject({ status: 400 });
    await expect(svc.output('ses_parent', 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('rejects output for MAFW subagent tasks (no shell面)', async () => {
    const tasks = {
      list: () => [task({ id: 'task_sub', kind: 'subagent', childSessionID: 'ses_child', title: 'explore' })],
      get: jest.fn(),
      cancel: jest.fn(),
      output: jest.fn(),
    };
    const { svc } = service({ tasks, listSubagents: async () => [session({ id: 'ses_child', parentID: 'ses_parent' })] });
    await expect(svc.output('ses_parent', 'task_sub')).rejects.toMatchObject({ status: 400 });
    expect(tasks.output).not.toHaveBeenCalled();
  });

  // ── review Important 1：子代理状态取 SubagentService 权威值 ──
  it('uses authoritative SubagentService status (failed child stays failed)', async () => {
    const { svc } = service({
      tasks: { list: () => [] },
      // SubagentService.list 形状：id/parentID/status/description/createdAt/updatedAt
      listSubagents: async () => [{
        id: 'ses_child', parentID: 'ses_parent',
        description: 'explore', status: 'failed', createdAt: 10, updatedAt: 20,
      }],
    });
    const jobs = await svc.list('ses_parent');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'ses_child', source: 'subagent', kind: 'subagent', status: 'failed',
      sessionID: 'ses_parent', childSessionID: 'ses_child', title: 'explore',
    });
  });

  it('maps every SubagentService status onto the MAFW state machine', () => {
    const row = (status: any) => ({ id: 'ses_child', parentID: 'ses_parent', status });
    expect(jobFromSubagent(row('running')).status).toBe('running');
    expect(jobFromSubagent(row('input_required')).status).toBe('running');
    expect(jobFromSubagent(row('completed')).status).toBe('completed');
    expect(jobFromSubagent(row('failed')).status).toBe('failed');
    expect(jobFromSubagent(row('aborted')).status).toBe('cancelled');
  });

  it('cancels a subagent through the injected ownership-checked canceller', async () => {
    const cancelSubagent = jest.fn(async () => {});
    const { svc, broadcast } = service({
      tasks: { list: () => [] },
      listSubagents: async () => [{ id: 'ses_child', parentID: 'ses_parent', status: 'running' }],
      cancelSubagent,
    });
    const job = await svc.cancel('ses_parent', 'ses_child');
    expect(cancelSubagent).toHaveBeenCalledWith({ parentSessionID: 'ses_parent', childSessionID: 'ses_child' });
    expect(job.status).toBe('cancelled');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ id: 'ses_child', status: 'cancelled' }));
  });

  it('cancels a runtime shell through the injected shell surface and broadcasts', async () => {
    const registry = new BackgroundJobRegistry();
    registry.apply(jobFromRuntimeShell(shell({ id: 'sh_1', status: 'running' })));
    const cancelShell = jest.fn(async () => {});
    const { svc, broadcast } = service({ registry, cancelShell });
    const job = await svc.cancel('ses_parent', 'sh_1');
    expect(cancelShell).toHaveBeenCalledWith(expect.objectContaining({ shellID: 'sh_1' }));
    expect(job.status).toBe('cancelled');
    expect(registry.list('ses_parent')[0].status).toBe('cancelled');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ id: 'sh_1', status: 'cancelled' }));
  });

  it('cancels a task through TaskService (single source of truth)', async () => {
    const tasks = {
      list: () => [task({ id: 'task_1', kind: 'shell', shellID: 'sh_1' })],
      get: jest.fn(),
      cancel: jest.fn(async () => task({ id: 'task_1', kind: 'shell', shellID: 'sh_1', status: 'cancelled' })),
      output: jest.fn(),
    };
    const { svc, broadcast } = service({ tasks });
    const job = await svc.cancel('ses_parent', 'task_1');
    expect(tasks.cancel).toHaveBeenCalledWith('task_1');
    expect(job.status).toBe('cancelled');
    expect(broadcast).toHaveBeenCalled();
  });

  it('is idempotent for terminal jobs (no runtime call)', async () => {
    const tasks = {
      list: () => [task({ id: 'task_1', kind: 'shell', shellID: 'sh_1', status: 'completed' })],
      get: jest.fn(),
      cancel: jest.fn(),
      output: jest.fn(),
    };
    const { svc } = service({ tasks });
    const job = await svc.cancel('ses_parent', 'task_1');
    expect(job.status).toBe('completed');
    expect(tasks.cancel).not.toHaveBeenCalled();
  });

  it('reports 503 when the runtime shell surface is missing', async () => {
    const registry = new BackgroundJobRegistry();
    registry.apply(jobFromRuntimeShell(shell({ id: 'sh_1' })));
    const { svc } = service({ registry });
    await expect(svc.output('ses_parent', 'sh_1')).rejects.toMatchObject({ status: 503 });
    await expect(svc.cancel('ses_parent', 'sh_1')).rejects.toMatchObject({ status: 503 });
  });
});
