import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore, PodError } from '../../../src/core/pod/pod-store';
import { PodTaskService } from '../../../src/core/pod/pod-task-service';

describe('PodTaskService', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let notifications: string[];
  let seq: number;
  let service: PodTaskService;

  const plan = {
    waves: [
      { id: 'w1', tasks: ['do a', 'do b'] },
      { id: 'w2', tasks: ['do c'] },
    ],
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-tasks-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    store.ensurePod({
      id: 'pod_1',
      projectDir: '/proj/a',
      name: 'A',
      now: '2026-10-29T00:00:00.000Z',
    });
    notifications = [];
    seq = 0;
    service = new PodTaskService({
      store,
      now: () => `2026-10-29T00:00:0${seq}.000Z`,
      newId: () => `task_${++seq}`,
      notify: (podId) => notifications.push(podId),
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('projects waves with stable source keys and external task ids', () => {
    const tasks = service.projectWaves('pod_1', 'g1', plan);

    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.sourceKey)).toEqual([
      'wave:w1:task:0',
      'wave:w1:task:1',
      'wave:w2:task:0',
    ]);
    expect(tasks.map((t) => t.externalTaskId)).toEqual(['w1-t1', 'w1-t2', 'w2-t1']);
    expect(tasks.every((t) => t.status === 'pending')).toBe(true);
    expect(notifications).toEqual(['pod_1']);
  });

  test('re-projection updates titles but preserves status', () => {
    const first = service.projectWaves('pod_1', 'g1', plan);
    service.updateTask('pod_1', first[0].id, { status: 'in_progress' });

    const second = service.projectWaves('pod_1', 'g1', {
      waves: [{ id: 'w1', tasks: ['do a better', 'do b'] }, { id: 'w2', tasks: ['do c'] }],
    });

    expect(second).toHaveLength(3);
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].title).toBe('do a better');
    expect(second[0].status).toBe('in_progress');
  });

  test('applies known receipts and ignores unknown task ids', () => {
    service.projectWaves('pod_1', 'g1', plan);
    const updated = service.applyReceipt('pod_1', 'g1', {
      receipts: [
        { taskId: 'w1-t1', status: 'done', summary: 'done', files: ['a.ts'] },
        { taskId: 'w9-t1', status: 'failed' },
      ],
    });

    expect(updated).toHaveLength(1);
    expect(updated[0].status).toBe('review');
    expect(JSON.parse(updated[0].artifactRefsJson ?? '[]')).toEqual(['a.ts']);
  });

  test('reopenForReview reopens tasks waiting in review', () => {
    service.projectWaves('pod_1', 'g1', plan);
    service.applyReceipt('pod_1', 'g1', {
      receipts: [{ taskId: 'w1-t1', status: 'done' }],
    });
    const reopened = service.reopenForReview('pod_1', 'g1');
    expect(reopened.map((t) => t.externalTaskId)).toContain('w1-t1');
  });

  test('reconcileArchive closes review tasks when the goal passes', () => {
    service.projectWaves('pod_1', 'g1', plan);
    service.applyReceipt('pod_1', 'g1', {
      receipts: [{ taskId: 'w1-t1', status: 'done' }],
    });
    service.reconcileArchive('pod_1', 'g1', true);
    const task = service.list('pod_1', 'g1').find((t) => t.externalTaskId === 'w1-t1');
    expect(task?.status).toBe('done');
  });

  test('manual tasks are not matched by receipts', () => {
    const manual = service.createManual('pod_1', 'g1', 'investigate');
    service.projectWaves('pod_1', 'g1', plan);

    service.applyReceipt('pod_1', 'g1', {
      receipts: [{ taskId: 'manual', status: 'done' }],
    });

    expect(manual.sourceKey).toMatch(/^manual:/);
    expect(manual.externalTaskId).toBeNull();
    expect(service.list('pod_1', 'g1').find((t) => t.id === manual.id)?.status).toBe('pending');
  });

  test('rejects illegal task transitions', () => {
    const [task] = service.projectWaves('pod_1', 'g1', plan);
    service.updateTask('pod_1', task.id, { status: 'in_progress' });
    service.updateTask('pod_1', task.id, { status: 'done' });

    expect(() => service.updateTask('pod_1', task.id, { status: 'pending' })).toThrow(PodError);
  });

  test('reopenForReview reopens in-progress and done tasks', () => {
    const tasks = service.projectWaves('pod_1', 'g1', plan);
    service.updateTask('pod_1', tasks[0].id, { status: 'in_progress' });
    service.updateTask('pod_1', tasks[1].id, { status: 'in_progress' });
    service.updateTask('pod_1', tasks[1].id, { status: 'done' });

    const reopened = service.reopenForReview('pod_1', 'g1');

    expect(reopened.map((t) => t.status)).toEqual(['reopened', 'reopened']);
    expect(notifications).toContain('pod_1');
  });

  test('same wave ids across goals stay separate', () => {
    const first = service.projectWaves('pod_1', 'g1', plan);
    service.updateTask('pod_1', first[0].id, { status: 'in_progress' });
    service.updateTask('pod_1', first[0].id, { status: 'done' });
    const second = service.projectWaves('pod_1', 'g2', plan);

    expect(service.list('pod_1', 'g1')).toHaveLength(3);
    expect(service.list('pod_1', 'g2')).toHaveLength(3);
    expect(service.list('pod_1', 'g1')[0].status).toBe('done');
    expect(service.list('pod_1', 'g2')[0].status).toBe('pending');
    expect(second[0].id).not.toBe(first[0].id);
  });

  test('startExecution marks pending and reopened tasks in progress', () => {
    const tasks = service.projectWaves('pod_1', 'g1', plan);
    service.updateTask('pod_1', tasks[0].id, { status: 'in_progress' });
    service.updateTask('pod_1', tasks[0].id, { status: 'done' });

    const started = service.startExecution('pod_1', 'g1');

    expect(started.map((t) => t.status)).toEqual(['done', 'in_progress', 'in_progress']);
    expect(notifications).toContain('pod_1');
  });

  test('clearProjected removes wave tasks but preserves manual tasks', () => {
    service.projectWaves('pod_1', 'g1', plan);
    const manual = service.createManual('pod_1', 'g1', 'investigate');

    service.clearProjected('pod_1', 'g1');

    expect(service.list('pod_1', 'g1').map((t) => t.id)).toEqual([manual.id]);
  });

  test('applyReviewResults closes each task by rubric result (idempotent by target)', () => {
    service.projectWaves('pod_1', 'g1', plan);
    service.applyReceipt('pod_1', 'g1', {
      receipts: [
        { taskId: 'w1-t1', status: 'done' },
        { taskId: 'w1-t2', status: 'done' },
        { taskId: 'w2-t1', status: 'done' },
      ],
    });
    const updated = service.applyReviewResults('pod_1', 'g1', [
      { taskId: 'w1-t1', result: 'pass' },
      { taskId: 'w1-t2', result: 'fail' },
      { taskId: 'w2-t1', result: 'skipped' },
      { taskId: 'nope', result: 'pass' },
    ]);
    const byExternal = () => new Map(service.list('pod_1', 'g1').map((t) => [t.externalTaskId, t.status]));
    expect(byExternal().get('w1-t1')).toBe('done');
    expect(byExternal().get('w1-t2')).toBe('reopened');
    expect(byExternal().get('w2-t1')).toBe('failed');
    expect(updated).toHaveLength(3);

    // 幂等：重复同一结果不再变更
    service.applyReviewResults('pod_1', 'g1', [{ taskId: 'w1-t2', result: 'fail' }]);
    expect(byExternal().get('w1-t2')).toBe('reopened');

    // 再来一轮通过 → 收口为 done（reopened 可被 PASS 关闭）
    service.applyReviewResults('pod_1', 'g1', [{ taskId: 'w1-t2', result: 'pass' }]);
    expect(byExternal().get('w1-t2')).toBe('done');
  });

  test('projectWaves accepts object tasks and keeps string tasks', () => {
    const tasks = service.projectWaves('pod_1', 'g1', {
      waves: [{ id: 'w1', tasks: ['旧式', { title: '新式', acceptance: ['x'] }] }],
    } as any);
    expect(tasks.map((task) => task.title)).toEqual(['旧式', '新式']);
    expect(tasks.map((task) => task.externalTaskId)).toEqual(['w1-t1', 'w1-t2']);
  });

  test('reconcileArchive closes open tasks on success', () => {
    const tasks = service.projectWaves('pod_1', 'g1', plan);
    service.startExecution('pod_1', 'g1');

    service.reconcileArchive('pod_1', 'g1', true);

    expect(service.list('pod_1', 'g1').map((t) => t.status)).toEqual(['done', 'done', 'done']);
  });

  test('reconcileArchive fails open tasks on failure and leaves success alone', () => {
    const tasks = service.projectWaves('pod_1', 'g1', plan);
    service.updateTask('pod_1', tasks[0].id, { status: 'in_progress' });
    service.updateTask('pod_1', tasks[1].id, { status: 'in_progress' });
    service.updateTask('pod_1', tasks[1].id, { status: 'done' });

    service.reconcileArchive('pod_1', 'g1', false);
    expect(service.list('pod_1', 'g1').map((t) => t.status)).toEqual(['failed', 'done', 'failed']);

    service.reconcileArchive('pod_1', 'g1', true);
    expect(service.list('pod_1', 'g1').map((t) => t.status)).toEqual(['failed', 'done', 'failed']);
  });

  test('projectWaves mirrors acceptance into acceptanceJson', () => {
    const tasks = service.projectWaves('pod_1', 'g1', {
      waves: [{ id: 'w1', tasks: [{ title: 'a', acceptance: ['跑测试', '看日志'] }, 'b'] }],
    });
    expect(JSON.parse(tasks[0].acceptanceJson!)).toEqual(['跑测试', '看日志']);
    expect(tasks[1].acceptanceJson).toBeNull();
  });

  describe('editPlanTask', () => {
    const writePlan = (plan: unknown, nextAction = 'NEXT_execute') => {
      const wavesPath = path.join(dir, 'waves.json');
      fs.writeFileSync(wavesPath, JSON.stringify(plan), 'utf-8');
      const svc = new PodTaskService({
        store,
        now: () => '2026-10-29T00:10:00.000Z',
        newId: () => `task_x${++seq}`,
        notify: (podId) => notifications.push(podId),
        resolveGoalPlan: (goalId) => goalId === 'g1'
          ? { wavesPath, nextAction, nodeSession: null }
          : null,
      });
      return { svc, wavesPath };
    };

    test('writes title+acceptance back to waves.json and refreshes the projected task', () => {
      const { svc, wavesPath } = writePlan(plan);
      const tasks = svc.projectWaves('pod_1', 'g1', plan as any);
      svc.updateTask('pod_1', tasks[1].id, { status: 'in_progress' });
      svc.updateTask('pod_1', tasks[1].id, { status: 'review' });

      const updated = svc.editPlanTask('pod_1', tasks[1].id, {
        title: '新 b',
        acceptance: [' npm test 全绿 ', 'npm test 全绿', '看日志'],
      });

      const written = JSON.parse(fs.readFileSync(wavesPath, 'utf-8'));
      expect(written.waves[0].tasks[1]).toEqual({
        title: '新 b', acceptance: ['npm test 全绿', '看日志'],
      });
      expect(updated.title).toBe('新 b');
      expect(JSON.parse(updated.acceptanceJson!)).toEqual(['npm test 全绿', '看日志']);
      expect(updated.status).toBe('review');
      expect(notifications).toContain('pod_1');
    });

    test('rejects while a node session is running', () => {
      const wavesPath = path.join(dir, 'waves.json');
      fs.writeFileSync(wavesPath, JSON.stringify(plan), 'utf-8');
      const svc = new PodTaskService({
        store,
        now: () => '2026-10-29T00:10:00.000Z',
        newId: () => `task_y${++seq}`,
        notify: () => {},
        resolveGoalPlan: () => ({ wavesPath, nextAction: 'RUNNING_execute', nodeSession: { id: 'ses_1' } }),
      });
      const tasks = svc.projectWaves('pod_1', 'g1', plan as any);
      expect(() => svc.editPlanTask('pod_1', tasks[0].id, { title: 'x' }))
        .toThrow(/running/);
    });

    test('rejects terminal goals, manual tasks and unknown goals', () => {
      const { svc } = writePlan(plan, 'COMPLETED');
      const tasks = svc.projectWaves('pod_1', 'g1', plan as any);
      expect(() => svc.editPlanTask('pod_1', tasks[0].id, { title: 'x' })).toThrow(/closed/);

      const manual = svc.createManual('pod_1', null, '手工');
      expect(() => svc.editPlanTask('pod_1', manual.id, { title: 'x' })).toThrow(/plan/);

      const outer = new PodTaskService({
        store, now: () => 't', newId: () => 'id', notify: () => {},
        resolveGoalPlan: () => null,
      });
      expect(() => outer.editPlanTask('pod_1', tasks[0].id, { title: 'x' })).toThrow(PodError);
    });

    test('missing task in plan is a 404-shaped error', () => {
      const { svc } = writePlan(plan);
      const tasks = svc.projectWaves('pod_1', 'g1', plan as any);
      // 任务存在但计划已被换掉（模拟手工删改）
      fs.writeFileSync(path.join(dir, 'waves.json'), JSON.stringify({
        waves: [{ id: 'w9', tasks: ['other'] }],
      }), 'utf-8');
      expect(() => svc.editPlanTask('pod_1', tasks[0].id, { title: 'x' }))
        .toThrow(/not found in plan/);
    });
  });

  describe('addPlanTask / deleteTask (v2)', () => {
    const legacyPlan = {
      waves: [
        { id: 'w1', tasks: ['do a', 'do b'] },
        { id: 'w2', tasks: ['do c'] },
      ],
    };

    const withPlan = (initial: unknown = legacyPlan, nextAction = 'NEXT_execute') => {
      const wavesPath = path.join(dir, 'waves.json');
      fs.writeFileSync(wavesPath, JSON.stringify(initial), 'utf-8');
      const svc = new PodTaskService({
        store,
        now: () => '2026-10-29T00:20:00.000Z',
        newId: () => `task_z${++seq}`,
        notify: (podId) => notifications.push(podId),
        resolveGoalPlan: () => ({ wavesPath, nextAction, nodeSession: null }),
      });
      return { svc, wavesPath };
    };

    test('delete migrates legacy keys and keeps the remaining task status', () => {
      const { svc, wavesPath } = withPlan();
      const tasks = svc.projectWaves('pod_1', 'g1', legacyPlan as any);
      svc.updateTask('pod_1', tasks[1].id, { status: 'in_progress' });
      svc.updateTask('pod_1', tasks[1].id, { status: 'review' });

      const deleted = svc.deleteTask('pod_1', tasks[0].id);

      expect(deleted).toEqual({ goalId: 'g1', externalTaskId: 'w1-t1' });
      const written = JSON.parse(fs.readFileSync(wavesPath, 'utf-8'));
      expect(written.waves[0].tasks).toEqual([
        { title: 'do b', taskId: 'w1-t2' },
      ]);
      const remaining = svc.list('pod_1', 'g1');
      expect(remaining.map((t) => t.externalTaskId)).toEqual(['w1-t2', 'w2-t1']);
      expect(remaining[0].status).toBe('review');
      expect(remaining[0].sourceKey).toBe('wave:w1:task:w1-t2');
      expect(svc.list('pod_1', 'g1').some((t) => t.id === tasks[0].id)).toBe(false);
    });

    test('add appends to the last wave and projects a pending task', () => {
      const { svc, wavesPath } = withPlan();
      svc.projectWaves('pod_1', 'g1', legacyPlan as any);

      const added = svc.addPlanTask('pod_1', 'g1', null, '新任务', ['跑测试']);

      const written = JSON.parse(fs.readFileSync(wavesPath, 'utf-8'));
      expect(written.waves[1].tasks.at(-1)).toMatchObject({
        taskId: 'w2-t2', title: '新任务', acceptance: ['跑测试'],
      });
      expect(added.status).toBe('pending');
      expect(added.externalTaskId).toBe('w2-t2');
      expect(JSON.parse(added.acceptanceJson!)).toEqual(['跑测试']);
    });

    test('add/delete are blocked while a node is running', () => {
      const wavesPath = path.join(dir, 'waves.json');
      fs.writeFileSync(wavesPath, JSON.stringify(legacyPlan), 'utf-8');
      const svc = new PodTaskService({
        store, now: () => 't', newId: () => `task_r${++seq}`, notify: () => {},
        resolveGoalPlan: () => ({ wavesPath, nextAction: 'RUNNING_execute', nodeSession: { id: 'ses_1' } }),
      });
      const tasks = svc.projectWaves('pod_1', 'g1', legacyPlan as any);
      expect(() => svc.addPlanTask('pod_1', 'g1', null, 'x')).toThrow(/running/);
      expect(() => svc.deleteTask('pod_1', tasks[0].id)).toThrow(/running/);
    });

    test('deleting a manual task only removes the row', () => {
      const { svc, wavesPath } = withPlan();
      const before = fs.readFileSync(wavesPath, 'utf-8');
      const manual = svc.createManual('pod_1', null, '手工');
      expect(svc.deleteTask('pod_1', manual.id)).toEqual({ goalId: null, externalTaskId: null });
      expect(svc.list('pod_1').some((t) => t.id === manual.id)).toBe(false);
      expect(fs.readFileSync(wavesPath, 'utf-8')).toBe(before);
    });
  });
});
