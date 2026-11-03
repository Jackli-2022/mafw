import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { canonicalProjectDir } from '../../../src/core/pod/pod-identity';
import {
  applyPodGoalBackfill,
  planPodGoalBackfill,
} from '../../../src/core/pod/pod-goal-backfill';
import { PodStore } from '../../../src/core/pod/pod-store';

const NOW = '2026-11-03T00:00:00.000Z';

function project(root: string, name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, '.mafw'), { recursive: true });
  return dir;
}

function writeRequest(projectDir: string, goalId: string, projectField: string | null = projectDir): void {
  const dir = path.join(projectDir, '.mafw', 'goals', goalId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify({
    goalId,
    ...(projectField ? { projectDir: projectField } : {}),
    title: goalId,
  }), 'utf-8');
}

function writeState(projectDir: string, goalId: string, patch: Record<string, unknown> = {}): void {
  const dir = path.join(projectDir, '.mafw', 'state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${goalId}.json`), JSON.stringify({
    version: '3',
    goalId,
    projectDir,
    nextAction: 'COMPLETED',
    phase: 'ARCHIVED',
    ...patch,
  }), 'utf-8');
}

describe('planPodGoalBackfill', () => {
  test('includes provable terminal and discussion goals only', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-backfill-'));
    const a = project(root, 'a');
    writeRequest(a, 'g-done');
    writeState(a, 'g-done', { reviewVerdict: 'PASS' });
    writeRequest(a, 'g-discuss');

    const report = planPodGoalBackfill([a]);

    expect(report.eligible).toEqual([
      { projectDir: canonicalProjectDir(a), goalId: 'g-discuss' },
      { projectDir: canonicalProjectDir(a), goalId: 'g-done' },
    ]);
    expect(report.skipped).toEqual([]);
  });

  test('skips ambiguous, unprovable, state-conflicting and present goals', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-backfill-'));
    const a = project(root, 'a');
    const b = project(root, 'b');
    const c = project(root, 'c');
    writeRequest(a, 'g-dup');
    writeRequest(b, 'g-dup');
    writeRequest(c, 'g-bad', a);
    writeRequest(a, 'g-conflict');
    writeState(a, 'g-conflict', { projectDir: b });
    writeRequest(a, 'g-present');

    const report = planPodGoalBackfill([a, b, c], {
      existingGoal: (ref) => ref.goalId === 'g-present',
    });

    expect(report.eligible).toEqual([]);
    expect(report.skipped).toEqual(expect.arrayContaining([
      { goalId: 'g-dup', reason: 'ambiguous' },
      { goalId: 'g-bad', reason: 'unprovable' },
      { goalId: 'g-conflict', reason: 'unprovable' },
      { goalId: 'g-present', reason: 'already_present' },
    ]));
  });

  test('never resolves a goal from the first registered project', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-backfill-'));
    const a = project(root, 'a');
    const b = project(root, 'b');
    writeRequest(b, 'g-b');
    expect(planPodGoalBackfill([a, b]).eligible).toEqual([
      { projectDir: canonicalProjectDir(b), goalId: 'g-b' },
    ]);
  });
});

describe('applyPodGoalBackfill', () => {
  test('is idempotent and imports a discussion revision without starting it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-backfill-'));
    const db = new Database(path.join(root, 'test.db'));
    const store = new PodStore(db);
    const projectDir = project(root, 'project');
    writeRequest(projectDir, 'g-done');
    writeState(projectDir, 'g-done', { reviewVerdict: 'PASS' });
    writeRequest(projectDir, 'g-discuss');
    const report = planPodGoalBackfill([projectDir]);

    const deps = {
      store,
      now: () => NOW,
      newId: (() => { let n = 0; return () => `id_${++n}`; })(),
    };
    const first = applyPodGoalBackfill(report, deps);
    const second = applyPodGoalBackfill(report, deps);

    expect(first.applied).toHaveLength(2);
    expect(second.applied).toHaveLength(0);
    expect(second.alreadyPresent).toHaveLength(2);
    const pod = store.getPodByProject(canonicalProjectDir(projectDir))!;
    expect(store.getGoal(pod.id, 'g-done')).toMatchObject({ status: 'done', verdict: 'PASS' });
    const discussion = store.getGoalRevision(pod.id, 'g-discuss', 1);
    expect(discussion).toMatchObject({ status: 'discussing' });
    db.close();
  });
});
