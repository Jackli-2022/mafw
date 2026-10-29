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
    expect(updated[0].status).toBe('done');
    expect(JSON.parse(updated[0].artifactRefsJson ?? '[]')).toEqual(['a.ts']);
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
});
