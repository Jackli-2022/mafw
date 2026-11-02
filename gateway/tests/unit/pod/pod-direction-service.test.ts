import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodError, PodStore } from '../../../src/core/pod/pod-store';
import {
  PodDirectionService,
  directionArtifactPath,
} from '../../../src/core/pod/pod-direction-service';
import {
  emptyDirectionState,
  normalizeDirectionDecision,
  serializeDirectionState,
} from '../../../src/core/goal/direction-decision';

const NOW = '2026-11-02T00:00:00.000Z';
const LATER = '2026-11-02T00:10:00.000Z';
const LAST = '2026-11-02T00:20:00.000Z';

describe('PodDirectionService', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let mafwDir: string;
  let service: PodDirectionService;
  let notify: jest.Mock;

  const options = [
    { id: 'A', title: '方案 A', summary: '沿用当前架构' },
    { id: 'B', title: '方案 B', summary: '重写并行层' },
  ];

  const readArtifact = (goalId = 'g1') => JSON.parse(
    fs.readFileSync(directionArtifactPath(mafwDir, goalId), 'utf-8'),
  );

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-direction-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    mafwDir = path.join(dir, 'mafw');
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: NOW });
    store.enqueueGoal({ id: 'pg_g1', podId: 'pod_1', goalId: 'g1', now: NOW });
    store.createGoalRevision({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      status: 'discussing',
      now: NOW,
    });
    notify = jest.fn();
    service = new PodDirectionService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => LATER,
      newId: () => 'dirreq_1',
      notify,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('request stores options in the revision and the Goal artifact, setting pending attention state', () => {
    const result = service.request({
      goalId: 'g1',
      options,
      reason: '两种架构取舍需要用户裁定',
      requestedBy: 'ses_tech_lead',
    });

    expect(result).toMatchObject({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      revisionStatus: 'direction_review',
      directionStatus: 'pending',
      decision: null,
      artifactPath: directionArtifactPath(mafwDir, 'g1'),
    });
    expect(result.state).toMatchObject({ goalId: 'g1', revision: 1, status: 'pending' });
    expect(result.state.options.map((item) => item.id)).toEqual(['A', 'B']);
    expect(result.state.decisions).toEqual([]);
    expect(result.state.requests).toHaveLength(1);
    expect(result.state.requests[0]).toMatchObject({
      reason: '两种架构取舍需要用户裁定',
      requestedBy: 'ses_tech_lead',
      revision: 1,
    });

    const row = store.getGoalRevision('pod_1', 'g1', 1)!;
    expect(row.status).toBe('direction_review');
    expect(row.directionStatus).toBe('pending');
    expect(JSON.parse(row.directionJson!).requests[0].id).toBe('dirreq_1');
    expect(readArtifact().revisions['1'].requests).toEqual(result.state.requests);
    expect(notify).toHaveBeenCalledWith('pod_1');
  });

  test('decide appends user words, records option/reason/source, and moves the revision to planning', () => {
    service.request({ goalId: 'g1', options, reason: '需要裁定' });
    const words = '采用 A，禁止改并行架构';
    const result = service.decide({
      goalId: 'g1',
      decision: { userWords: words, optionId: 'A', reason: '成本最低', decidedAt: LAST },
    });

    expect(result.revisionStatus).toBe('planning');
    expect(result.directionStatus).toBe('decided');
    expect(result.state.status).toBe('decided');
    expect(result.state.decisions).toHaveLength(1);
    expect(result.decision).toMatchObject({
      userWords: words,
      optionId: 'A',
      reason: '成本最低',
      source: 'user',
      revision: 1,
      decidedAt: LAST,
    });
    // The decision snapshots the options the user was looking at.
    expect(result.decision!.options.map((item) => item.id)).toEqual(['A', 'B']);

    const row = store.getGoalRevision('pod_1', 'g1', 1)!;
    expect(row.status).toBe('planning');
    expect(row.directionStatus).toBe('decided');
    expect(JSON.parse(row.directionJson!).decisions[0].userWords).toBe(words);
  });

  test('keeps decisions append-only across several calls and mirrors the artifact into the revision', () => {
    service.request({ goalId: 'g1', options });
    const first = service.decide({
      goalId: 'g1',
      decision: { userWords: '先按 A 走', optionId: 'A', decidedAt: LATER },
    });
    const firstSnapshot = JSON.parse(JSON.stringify(first.decision));

    const second = service.decide({
      goalId: 'g1',
      decision: { userWords: '再补一条：并行层不许动', decidedAt: LAST },
    });

    expect(second.state.decisions).toHaveLength(2);
    expect(second.state.decisions[0]).toEqual(firstSnapshot);
    expect(second.state.decisions[1].userWords).toBe('再补一条：并行层不许动');

    const artifact = readArtifact();
    expect(artifact.revisions['1'].decisions).toEqual(second.state.decisions);
    const row = store.getGoalRevision('pod_1', 'g1', 1)!;
    expect(JSON.parse(row.directionJson!).decisions).toEqual(second.state.decisions);
  });

  test('a replayed identical decision does not append twice', () => {
    const decision = { userWords: '按 A 执行', optionId: 'A', decidedAt: LATER };
    service.decide({ goalId: 'g1', decision });
    const replay = service.decide({ goalId: 'g1', decision });
    expect(replay.state.decisions).toHaveLength(1);
  });

  test('markClear records a clear direction and never creates a pending/attention request', () => {
    const result = service.markClear({
      goalId: 'g1',
      userWords: '用户已说明按现有架构继续，不改并行层',
      reason: '方向已经明确',
    });

    expect(result.revisionStatus).toBe('planning');
    expect(result.directionStatus).toBe('decided');
    expect(result.state.status).toBe('decided');
    expect(result.state.requests).toEqual([]);
    expect(result.state.decisions).toHaveLength(1);
    expect(result.decision).toMatchObject({
      userWords: '用户已说明按现有架构继续，不改并行层',
      source: 'tech_lead_clear',
      revision: 1,
    });

    const row = store.getGoalRevision('pod_1', 'g1', 1)!;
    expect(row.status).toBe('planning');
    expect(row.directionStatus).toBe('decided');
    expect(notify).toHaveBeenCalledWith('pod_1');
  });

  test('markClear may resolve an existing pending direction review without losing its request history', () => {
    service.request({ goalId: 'g1', options, reason: '需要裁定' });
    const result = service.markClear({ goalId: 'g1', userWords: '按 A 走' });

    expect(result.state.requests).toHaveLength(1);
    expect(result.state.status).toBe('decided');
    expect(result.state.decisions[0].source).toBe('tech_lead_clear');
  });

  test('the artifact file is authoritative when the revision mirror is stale', () => {
    service.decide({ goalId: 'g1', decision: { userWords: '文件是权威', decidedAt: LATER } });
    const stale = serializeDirectionState(emptyDirectionState('g1', 1));
    store.setGoalRevisionStatus({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      status: 'planning',
      directionStatus: 'decided',
      directionJson: stale,
      now: NOW,
    });

    expect(service.state('g1').decisions).toHaveLength(1);
    expect(service.state('g1').decisions[0].userWords).toBe('文件是权威');
  });

  test('falls back to the revision mirror when no Goal artifact exists yet', () => {
    const decision = normalizeDirectionDecision({ userWords: '旧版本决定', revision: 1, decidedAt: NOW });
    const state = {
      ...emptyDirectionState('g1', 1),
      status: 'decided' as const,
      decisions: [decision],
    };
    store.setGoalRevisionStatus({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      status: 'planning',
      directionStatus: 'decided',
      directionJson: serializeDirectionState(state),
      now: NOW,
    });

    expect(service.state('g1').decisions).toHaveLength(1);
    expect(service.state('g1').decisions[0].userWords).toBe('旧版本决定');
  });

  test('rejects a corrupt artifact instead of silently overwriting it', () => {
    fs.mkdirSync(path.dirname(directionArtifactPath(mafwDir, 'g1')), { recursive: true });
    fs.writeFileSync(directionArtifactPath(mafwDir, 'g1'), '{not json', 'utf-8');

    expect(() => service.state('g1')).toThrow(PodError);
    try {
      service.decide({ goalId: 'g1', decision: { userWords: '按 A' } });
      throw new Error('expected a PodError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(PodError);
      expect(err.status).toBe(500);
      expect(err.message).toContain('direction artifact is not valid JSON');
    }
    expect(fs.readFileSync(directionArtifactPath(mafwDir, 'g1'), 'utf-8')).toBe('{not json');
  });

  test('keeps each revision direction history separate in the artifact', () => {
    service.decide({ goalId: 'g1', decision: { userWords: '第一版方向', decidedAt: LATER } });

    store.createGoalRevision({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 2,
      status: 'discussing',
      now: LATER,
    });
    store.setActiveRevision('pod_1', 'g1', 2);

    const result = service.decide({
      goalId: 'g1',
      decision: { userWords: '第二版方向', decidedAt: LAST },
    });

    expect(result.revision).toBe(2);
    expect(result.state.revision).toBe(2);
    expect(result.state.decisions[0].userWords).toBe('第二版方向');

    const artifact = readArtifact();
    expect(artifact.revisions['1'].decisions).toHaveLength(1);
    expect(artifact.revisions['1'].decisions[0].userWords).toBe('第一版方向');
    expect(artifact.revisions['2'].decisions).toHaveLength(1);
  });

  test('deciding without a pending request is allowed (user stated the direction)', () => {
    const result = service.decide({
      goalId: 'g1',
      decision: { userWords: '直接按 A 做', optionId: 'A' },
    });
    expect(result.state.requests).toEqual([]);
    expect(result.state.status).toBe('decided');
  });

  test('rejects an option that was never presented', () => {
    service.request({ goalId: 'g1', options });
    expect(() => service.decide({
      goalId: 'g1',
      decision: { userWords: '选 Z', optionId: 'Z' },
    })).toThrow('unknown direction option: Z');
  });

  test('refuses to modify a terminal revision', () => {
    store.setGoalRevisionStatus({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      status: 'completed',
      verdict: 'PASS',
      now: NOW,
    });

    expect(() => service.decide({ goalId: 'g1', decision: { userWords: '太晚了' } }))
      .toThrow(/revision .* is terminal/);
    expect(() => service.markClear({ goalId: 'g1', userWords: '太晚了' }))
      .toThrow(/revision .* is terminal/);
    expect(fs.existsSync(directionArtifactPath(mafwDir, 'g1'))).toBe(false);
  });

  test('refuses to open a direction review once planning has started', () => {
    store.setGoalRevisionStatus({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      status: 'planning',
      now: NOW,
    });
    expect(() => service.request({ goalId: 'g1', options }))
      .toThrow('direction review not allowed in revision status: planning');
  });

  test('reports missing goals/revisions and unresolved Goal directories without partial writes', () => {
    expect(() => service.request({ goalId: 'unknown', options })).toThrow(PodError);
    try {
      service.request({ goalId: 'unknown', options });
    } catch (err: any) {
      expect(err.status).toBe(404);
    }

    store.enqueueGoal({ id: 'pg_g2', podId: 'pod_1', goalId: 'g2', now: NOW });
    try {
      service.request({ goalId: 'g2', options });
    } catch (err: any) {
      expect(err).toBeInstanceOf(PodError);
      expect(err.status).toBe(404);
      expect(err.message).toContain('goal revision not found');
    }

    const noDir = new PodDirectionService({
      store,
      resolveMafwDir: () => null,
      now: () => LATER,
    });
    try {
      noDir.request({ goalId: 'g1', options });
    } catch (err: any) {
      expect(err).toBeInstanceOf(PodError);
      expect(err.status).toBe(400);
    }
    expect(store.getGoalRevision('pod_1', 'g1', 1)!.status).toBe('discussing');
    expect(fs.existsSync(directionArtifactPath(mafwDir, 'g1'))).toBe(false);
  });
});
