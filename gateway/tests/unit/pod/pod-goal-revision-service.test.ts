import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PodError,
  PodStore,
  type PodGoalRevisionStatus,
} from '../../../src/core/pod/pod-store';
import {
  REJECT_REVISION_PRIORITY,
  PodGoalRevisionService,
} from '../../../src/core/pod/pod-goal-revision-service';
import {
  ensureGoalState,
  loadGoalState,
  revisionStatePathFor,
  writeGoalState,
} from '../../../src/core/goal/state-v3';

const NOW = '2026-11-02T00:00:00.000Z';
const LATER = '2026-11-02T00:10:00.000Z';

describe('PodGoalRevisionService', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let mafwDir: string;
  let service: PodGoalRevisionService;
  let revisionClosed: jest.Mock;

  const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8'));

  const seedGoal = (goalId = 'g1'): void => {
    store.enqueueGoal({
      id: `pg_${goalId}`,
      podId: 'pod_1',
      goalId,
      now: NOW,
    });
  };

  const seedRevision = (
    revision: number,
    status: PodGoalRevisionStatus,
    patch: { verdict?: string | null; priority?: number } = {},
  ) => store.createGoalRevision({
    podId: 'pod_1',
    goalId: 'g1',
    revision,
    status,
    priority: patch.priority ?? 0,
    verdict: patch.verdict ?? null,
    now: NOW,
  });

  const seedState = (revision: number, goalId = 'g1'): void => {
    ensureGoalState(mafwDir, goalId, {
      revision,
      projectDir: '/proj/a',
      maxRounds: 3,
    });
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-rev-service-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    mafwDir = path.join(dir, 'mafw');
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: NOW });
    revisionClosed = jest.fn(async () => {});
    service = new PodGoalRevisionService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => LATER,
      onRevisionClosed: revisionClosed,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('current returns the active revision row and never invents one', () => {
    seedGoal('g1');
    seedGoal('g2');
    seedRevision(1, 'completed', { verdict: 'PASS' });

    expect(service.current('g1')).toMatchObject({ revision: 1, status: 'completed', verdict: 'PASS' });
    expect(service.current('g2')).toBeNull();

    expect(() => service.current('nope')).toThrow(PodError);
    try {
      service.current('nope');
    } catch (err) {
      expect((err as PodError).status).toBe(404);
    }
  });

  test('openNextRevision awaits old revision retirement before creating N+1', async () => {
    seedGoal();
    seedRevision(1, 'implementing');
    seedState(1);
    let revisionsAtClose: number[] = [];
    revisionClosed.mockImplementation(async () => {
      revisionsAtClose = store.listGoalRevisions('pod_1', 'g1').map((row) => row.revision);
    });

    const result = await service.openNextRevision('g1');

    expect(revisionClosed).toHaveBeenCalledWith('g1', 1);
    expect(revisionsAtClose).toEqual([1]);
    expect(result.opened).toBe(true);
    expect(result.revision).toBe(2);
  });

  test('openNextRevision closes the current revision, archives state and activates N+1', async () => {
    seedGoal();
    seedRevision(1, 'implementing');
    seedState(1);
    writeGoalState(mafwDir, 'g1', {
      phase: 'COMPLETED',
      nextAction: 'COMPLETED',
      round: 2,
      reviewVerdict: 'PASS',
      artifacts: { plan: 'waves.json' },
    });

    const result = await service.openNextRevision('g1', '方向不对，重新讨论', { priority: 25 });

    expect(result).toMatchObject({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 2,
      status: 'discussing',
      priority: 25,
    });
    expect(result.previous).toMatchObject({
      revision: 1,
      closed: true,
      alreadyTerminal: false,
      missing: false,
    });

    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({
      status: 'completed',
      endedAt: LATER,
    });
    expect(store.getGoal('pod_1', 'g1')?.activeRevision).toBe(2);
    expect(store.getGoal('pod_1', 'g1')?.priority).toBe(25);
    expect(store.getGoalRevision('pod_1', 'g1', 2)).toMatchObject({
      status: 'discussing',
      feedback: '方向不对，重新讨论',
      priority: 25,
      enqueuedAt: LATER,
    });

    const archivePath = revisionStatePathFor(mafwDir, 'g1', 1);
    expect(fs.existsSync(archivePath)).toBe(true);
    expect(readJson(archivePath)).toMatchObject({
      revision: 1,
      nextAction: 'COMPLETED',
      reviewVerdict: 'PASS',
    });

    expect(loadGoalState(mafwDir, 'g1')).toMatchObject({
      revision: 2,
      nextAction: 'RUNNING_plan',
      phase: 'PLANNING',
      round: 1,
      reviewVerdict: null,
    });
  });

  test('a reject of an already completed revision is not rewritten (Task 3 false is explicit)', async () => {
    seedGoal();
    seedRevision(1, 'completed', { verdict: 'PASS' });
    seedState(1);
    writeGoalState(mafwDir, 'g1', { nextAction: 'COMPLETED', phase: 'COMPLETED', reviewVerdict: 'PASS' });

    const result = await service.openNextRevision('g1', '返工');

    expect(result.previous).toMatchObject({
      revision: 1,
      closed: false,
      alreadyTerminal: true,
      missing: false,
    });
    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({
      status: 'completed',
      verdict: 'PASS',
    });
    expect(store.getGoalRevision('pod_1', 'g1', 2)).toMatchObject({
      status: 'discussing',
      feedback: '返工',
      priority: REJECT_REVISION_PRIORITY,
    });
  });

  test('a replayed reject is a no-op and never writes a fake snapshot (I-1)', async () => {
    seedGoal();
    seedRevision(1, 'completed', { verdict: 'PASS' });
    seedState(1);
    writeGoalState(mafwDir, 'g1', { nextAction: 'COMPLETED', phase: 'COMPLETED', reviewVerdict: 'PASS' });

    const first = await service.openNextRevision('g1', '返工', { expectedRevision: 1 });
    expect(first).toMatchObject({ opened: true, revision: 2, status: 'discussing' });
    const rev1Archive = fs.readFileSync(revisionStatePathFor(mafwDir, 'g1', 1), 'utf-8');

    const replay = await service.openNextRevision('g1', '返工', { expectedRevision: 1 });

    expect(replay).toMatchObject({
      opened: false,
      staleReason: 'expected_revision_mismatch',
      revision: 2,
      archivedState: null,
    });
    expect(replay.previous).toMatchObject({ revision: 2, closed: false });
    expect(store.listGoalRevisions('pod_1', 'g1').map((row) => row.revision)).toEqual([1, 2]);
    expect(store.getGoal('pod_1', 'g1')?.activeRevision).toBe(2);
    expect(store.getGoalRevision('pod_1', 'g1', 2)).toMatchObject({
      status: 'discussing',
      endedAt: null,
      verdict: null,
    });
    // The freshly opened revision must not be "completed" by the replay, and no
    // rev-2 snapshot of the empty rebuilt state may exist.
    expect(fs.existsSync(revisionStatePathFor(mafwDir, 'g1', 2))).toBe(false);
    expect(fs.readFileSync(revisionStatePathFor(mafwDir, 'g1', 1), 'utf-8')).toBe(rev1Archive);
    expect(loadGoalState(mafwDir, 'g1')?.revision).toBe(2);
  });

  test('a repeat call without expectedRevision also leaves the untouched revision alone (I-1)', async () => {
    seedGoal();
    seedRevision(1, 'implementing');
    seedState(1);
    writeGoalState(mafwDir, 'g1', { nextAction: 'COMPLETED', phase: 'COMPLETED', reviewVerdict: 'PASS' });

    const first = await service.openNextRevision('g1', '返工');
    expect(first).toMatchObject({ opened: true, revision: 2 });

    const replay = await service.openNextRevision('g1', '返工');

    expect(replay).toMatchObject({
      opened: false,
      staleReason: 'pristine_revision',
      revision: 2,
      archivedState: null,
    });
    expect(store.listGoalRevisions('pod_1', 'g1').map((row) => row.revision)).toEqual([1, 2]);
    expect(store.getGoal('pod_1', 'g1')?.activeRevision).toBe(2);
    expect(store.getGoalRevision('pod_1', 'g1', 2)).toMatchObject({
      status: 'discussing',
      endedAt: null,
    });
    expect(fs.existsSync(revisionStatePathFor(mafwDir, 'g1', 2))).toBe(false);
  });

  test('an explicit abort may still close a pristine discussing revision (I-1 guard scope)', async () => {
    seedGoal();
    seedRevision(1, 'discussing');
    seedState(1);

    const result = await service.openNextRevision('g1', '方向作废', { closeAs: 'aborted' });

    expect(result).toMatchObject({ opened: true, revision: 2, status: 'discussing' });
    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({
      status: 'aborted',
      endedAt: LATER,
    });
    expect(result.previous).toMatchObject({ revision: 1, closed: true });
  });

  test('previous archives stay byte-identical after later revisions make progress', async () => {
    seedGoal();
    seedRevision(1, 'implementing');
    seedState(1);
    writeGoalState(mafwDir, 'g1', { nextAction: 'COMPLETED', phase: 'COMPLETED', reviewVerdict: 'PASS' });

    await service.openNextRevision('g1', 'first reject');
    const rev1Archive = fs.readFileSync(revisionStatePathFor(mafwDir, 'g1', 1), 'utf-8');

    writeGoalState(mafwDir, 'g1', { nextAction: 'COMPLETED', phase: 'COMPLETED', reviewVerdict: 'FAIL' });
    // Revision 2 must produce a real result before it can be rejected again.
    expect(service.finishRevision('g1', { status: 'completed', verdict: 'FAIL' }))
      .toMatchObject({ applied: true, reason: 'applied' });
    const second = await service.openNextRevision('g1', 'second reject');

    expect(second).toMatchObject({ opened: true, revision: 3, status: 'discussing' });
    expect(store.listGoalRevisions('pod_1', 'g1').map((row) => row.revision)).toEqual([1, 2, 3]);
    expect(store.getGoal('pod_1', 'g1')?.activeRevision).toBe(3);
    expect(fs.readFileSync(revisionStatePathFor(mafwDir, 'g1', 1), 'utf-8')).toBe(rev1Archive);
    expect(readJson(revisionStatePathFor(mafwDir, 'g1', 2))).toMatchObject({
      revision: 2,
      nextAction: 'COMPLETED',
      reviewVerdict: 'FAIL',
    });
    expect(loadGoalState(mafwDir, 'g1')?.revision).toBe(3);
  });

  test('openNextRevision tolerates a goal without a revision row (legacy intake)', async () => {
    seedGoal();
    seedState(1);
    writeGoalState(mafwDir, 'g1', { nextAction: 'COMPLETED' });

    const result = await service.openNextRevision('g1');

    expect(result.previous).toMatchObject({
      revision: 1,
      closed: false,
      alreadyTerminal: false,
      missing: true,
    });
    expect(result).toMatchObject({ revision: 2, status: 'discussing', priority: 0 });
    expect(store.getGoal('pod_1', 'g1')?.activeRevision).toBe(2);
    expect(fs.existsSync(revisionStatePathFor(mafwDir, 'g1', 1))).toBe(true);
    expect(loadGoalState(mafwDir, 'g1')?.revision).toBe(2);
  });

  test('closing as aborted stamps the abandoned revision without inventing a verdict', async () => {
    seedGoal();
    seedRevision(1, 'planning');
    seedState(1);

    const result = await service.openNextRevision('g1', '方向整体作废', { closeAs: 'aborted' });

    expect(result.previous).toMatchObject({ revision: 1, closed: true });
    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({
      status: 'aborted',
      verdict: null,
      endedAt: LATER,
      // 收尾不改写旧 revision 的反馈；打回理由属于新 revision。
      feedback: null,
    });
    expect(store.getGoalRevision('pod_1', 'g1', 2)).toMatchObject({
      revision: 2,
      status: 'discussing',
      feedback: '方向整体作废',
    });
  });

  test('finishRevision applies once and reports terminal/not_found explicitly', () => {
    seedGoal('g1');
    seedGoal('g2');
    seedRevision(1, 'implementing');

    const applied = service.finishRevision('g1', {
      status: 'completed',
      verdict: 'PASS',
      feedback: 'all conditions met',
    });

    expect(applied).toMatchObject({ applied: true, reason: 'applied' });
    expect(applied.revision).toMatchObject({
      status: 'completed',
      verdict: 'PASS',
      feedback: 'all conditions met',
      endedAt: LATER,
    });

    const again = service.finishRevision('g1', 'aborted');
    expect(again).toMatchObject({ applied: false, reason: 'terminal' });
    expect(again.revision).toMatchObject({ status: 'completed', verdict: 'PASS' });
    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({
      status: 'completed',
      verdict: 'PASS',
    });

    const missing = service.finishRevision('g2', 'completed');
    expect(missing).toMatchObject({ applied: false, reason: 'not_found', revision: null });

    expect(() => service.finishRevision('nope', 'completed')).toThrow(PodError);
  });

  test('finishRevision can target an explicit revision', () => {
    seedGoal();
    seedRevision(1, 'implementing');
    store.setActiveRevision('pod_1', 'g1', 2);
    seedRevision(2, 'implementing');

    const result = service.finishRevision('g1', {
      status: 'completed',
      revision: 1,
      verdict: 'FAIL',
    });

    expect(result).toMatchObject({ applied: true, reason: 'applied' });
    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({ status: 'completed', verdict: 'FAIL' });
    expect(store.getGoalRevision('pod_1', 'g1', 2)).toMatchObject({ status: 'implementing' });
  });

  test('non-reject revisions get no priority and keep the goal priority untouched', async () => {
    seedGoal();
    seedRevision(1, 'implementing');
    seedState(1);
    store.setGoalPriority('pod_1', 'g1', 5);

    const result = await service.openNextRevision('g1');

    expect(result).toMatchObject({ revision: 2, priority: 0 });
    expect(store.getGoal('pod_1', 'g1')?.priority).toBe(5);
    expect(store.getGoalRevision('pod_1', 'g1', 2)?.priority).toBe(0);
  });

  test('openNextRevision requires a resolvable mafw dir', async () => {
    seedGoal();
    seedRevision(1, 'implementing');
    const unresolved = new PodGoalRevisionService({
      store,
      resolveMafwDir: () => null,
      now: () => LATER,
    });

    await expect(unresolved.openNextRevision('g1', 'reject')).rejects.toMatchObject({ status: 400 });
    expect(store.getGoal('pod_1', 'g1')?.activeRevision).toBe(1);
    expect(store.listGoalRevisions('pod_1', 'g1').map((row) => row.revision)).toEqual([1]);
  });
});
