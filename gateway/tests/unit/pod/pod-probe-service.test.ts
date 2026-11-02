import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodError, PodStore } from '../../../src/core/pod/pod-store';
import {
  PodProbeService,
  probeArtifactDir,
  probeReportPath,
  probeRequestPath,
  type ProbeRequestInput,
} from '../../../src/core/pod/pod-probe-service';

const NOW = '2026-11-02T00:00:00.000Z';

function requestInput(overrides: Partial<ProbeRequestInput> = {}): ProbeRequestInput {
  return {
    podId: 'pod_1',
    goalId: 'g1',
    question: 'Does the index handle prefix queries?',
    hypothesis: 'The BM25 index is sufficient.',
    scope: {
      paths: ['src'],
      commandClasses: ['read', 'test'],
      network: false,
      credentials: [],
    },
    budget: { maxMinutes: 10, maxUsd: 0.5 },
    evidenceRequired: ['p95 timing'],
    ...overrides,
  };
}

function report(probeId: string, overrides: Record<string, unknown> = {}) {
  return {
    probeId,
    conclusion: 'supports' as const,
    commands: ['npm test -- --runInBand'],
    keyOutput: 'p95 41ms',
    repro: ['npm run seed && npm test'],
    remainingAssumptions: ['production data is larger'],
    impact: { plan: 'keep BM25', goalEval: 'p95 < 50ms' },
    ...overrides,
  };
}

describe('PodProbeService', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let mafwDir: string;
  let service: PodProbeService;

  const seedRevision = (
    goalId: string,
    status: 'planning' | 'completed' | 'implementing' = 'planning',
    revision = 1,
    podId = 'pod_1',
  ) => store.createGoalRevision({
    podId,
    goalId,
    revision,
    status,
    now: NOW,
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-probe-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    mafwDir = path.join(dir, 'mafw');
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: NOW });
    store.ensurePod({ id: 'pod_2', projectDir: '/proj/b', name: 'B', now: NOW });
    store.enqueueGoal({ id: 'pg_g1', podId: 'pod_1', goalId: 'g1', now: NOW });
    store.enqueueGoal({ id: 'pg_g2', podId: 'pod_1', goalId: 'g2', now: NOW });
    store.enqueueGoal({ id: 'pg_g3', podId: 'pod_2', goalId: 'g3', now: NOW });
    seedRevision('g1');
    seedRevision('g2', 'completed');
    seedRevision('g3', 'planning', 1, 'pod_2');

    let tick = 0;
    let ids = 0;
    service = new PodProbeService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => new Date(Date.parse(NOW) + tick++ * 60_000).toISOString(),
      newId: () => `probe_${++ids}`,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('queues probes and runs at most one per pod', () => {
    const a = service.request(requestInput());
    const b = service.request(requestInput());

    expect(service.claim('pod_1')).toMatchObject({ id: a.id, status: 'running' });
    expect(service.claim('pod_1')).toBeNull();

    service.complete(a.id, report(a.id));
    expect(service.claim('pod_1')).toMatchObject({ id: b.id, status: 'running' });

    // Other pods have their own single running slot.
    const other = service.request(requestInput({ podId: 'pod_2', goalId: 'g3' }));
    expect(service.claim('pod_2')).toMatchObject({ id: other.id });
    expect(service.list('pod_1').map((probe) => probe.status)).toEqual(['completed', 'running']);
  });

  test('persists the machine-readable request as a file and in the database', () => {
    const created = service.request(requestInput());
    const file = probeRequestPath(mafwDir, 'g1', created.id);

    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toMatchObject({
      id: created.id,
      revision: 1,
      scope: { paths: ['src'], commandClasses: ['read', 'test'], network: false, credentials: [] },
      budget: { maxMinutes: 10, maxUsd: 0.5 },
    });
    expect(store.getProbe(created.id)?.requestJson).toContain('"maxMinutes":10');
  });

  test('redacts report output before writing the database row and the report file', () => {
    const created = service.request(requestInput());
    service.claim('pod_1');

    const returned = service.complete(created.id, report(created.id, {
      keyOutput: 'token sk-secret leaked',
      commands: ['curl -H "Authorization: Bearer abcdefghijklmnopqrst"'],
    }));

    const reportPath = probeReportPath(mafwDir, 'g1', created.id);
    const fileText = fs.readFileSync(reportPath, 'utf-8');
    const rowText = store.getProbe(created.id)!.reportJson!;

    expect(returned.keyOutput).not.toContain('sk-secret');
    for (const text of [fileText, rowText]) {
      expect(text).not.toContain('sk-secret');
      expect(text).not.toContain('abcdefghijklmnopqrst');
      expect(text).toContain('[REDACTED]');
    }
  });

  test('completing twice updates the report (transport retry) without duplicating the probe', () => {
    const created = service.request(requestInput());
    service.claim('pod_1');

    service.complete(created.id, report(created.id));
    const updated = service.complete(created.id, report(created.id, { conclusion: 'refutes' }));

    expect(updated.conclusion).toBe('refutes');
    expect(service.list('pod_1')).toHaveLength(1);
    expect(store.getProbe(created.id)).toMatchObject({ status: 'completed' });
    expect(JSON.parse(fs.readFileSync(probeReportPath(mafwDir, 'g1', created.id), 'utf-8')))
      .toMatchObject({ conclusion: 'refutes' });
  });

  test('rejects a report for a different probe and unknown probes', () => {
    const created = service.request(requestInput());
    service.claim('pod_1');

    expect(() => service.complete(created.id, report('someone_else'))).toThrow(/probeId/);
    expect(() => service.complete('missing', report('missing'))).toThrow(PodError);

    const invalid = report(created.id, { conclusion: 'probably' });
    expect(() => service.complete(created.id, invalid as any)).toThrow(/conclusion/);
  });

  test('fail marks the probe failed, redacts the reason, and frees the slot', () => {
    const a = service.request(requestInput());
    const b = service.request(requestInput());
    service.claim('pod_1');

    const failed = service.fail(a.id, 'timeout with api_key=supersecretvalue');

    expect(failed).toMatchObject({ id: a.id, status: 'failed' });
    expect(failed.error).not.toContain('supersecretvalue');
    expect(store.getProbe(a.id)!.reportJson).toBeNull();
    expect(service.claim('pod_1')).toMatchObject({ id: b.id });
  });

  test('resolves the revision from the goal and refuses terminal revisions', () => {
    const created = service.request(requestInput());
    expect(created.revision).toBe(1);

    expect(() => service.request(requestInput({ goalId: 'g2' })))
      .toThrow(expect.objectContaining({ status: 409 }));
    expect(() => service.request(requestInput({ goalId: 'g2', revision: 2 })))
      .toThrow(expect.objectContaining({ status: 409 }));
    expect(() => service.request(requestInput({ goalId: 'nope' })))
      .toThrow(expect.objectContaining({ status: 404 }));
    expect(() => service.request(requestInput({ goalId: 'g1', revision: 9 })))
      .toThrow(expect.objectContaining({ status: 404 }));

    // A goal belongs to exactly one pod; other pods cannot probe it.
    expect(() => service.request(requestInput({ podId: 'pod_2', goalId: 'g1' })))
      .toThrow(expect.objectContaining({ status: 404 }));

    const otherPod = service.request(requestInput({ podId: 'pod_2', goalId: 'g3' }));
    expect(otherPod.podId).toBe('pod_2');
  });

  test('enforces the per-pod pending queue cap', () => {
    const capped = new PodProbeService({
      store,
      resolveMafwDir: () => mafwDir,
      limits: { maxPending: 1 },
      now: () => NOW,
    });

    capped.request(requestInput());
    expect(() => capped.request(requestInput()))
      .toThrow(expect.objectContaining({ status: 409 }));
  });

  test('rejects invalid requests with 400 instead of storing them', () => {
    expect(() => service.request(requestInput({ budget: { maxMinutes: 999, maxUsd: 0 } })))
      .toThrow(expect.objectContaining({ status: 400 }));
    expect(() => service.request(requestInput({ evidenceRequired: [] })))
      .toThrow(expect.objectContaining({ status: 400 }));

    expect(service.list('pod_1')).toEqual([]);
  });

  test('requires a resolvable goal directory', () => {
    const noDir = new PodProbeService({ store, resolveMafwDir: () => null, now: () => NOW });
    expect(() => noDir.request(requestInput()))
      .toThrow(expect.objectContaining({ status: 400 }));
    expect(store.listProbes('pod_1')).toEqual([]);
  });

  test('claimForGoal never steals another goal queue head in a shared pod', () => {
    store.enqueueGoal({ id: 'pg_g4', podId: 'pod_1', goalId: 'g4', now: NOW });
    seedRevision('g4');

    // g4 的探针先入队（created_at 更早）→ 它是 Pod-global 队头。
    const g4Probe = service.request(requestInput({ goalId: 'g4' }));
    const g1Probe = service.request(requestInput({ goalId: 'g1' }));

    // g1 不能抢占 g4 的队头：既不返回，也不能把 g4 的探针标成 running 后丢弃。
    expect(service.claimForGoal('pod_1', 'g1', [g1Probe.id])).toBeNull();
    expect(store.getProbe(g4Probe.id)?.status).toBe('queued');

    // g4 跑自己的；期间 g1 仍然拿不到运行槽。
    expect(service.claimForGoal('pod_1', 'g4', [g4Probe.id])).toMatchObject({
      id: g4Probe.id, status: 'running',
    });
    expect(service.claimForGoal('pod_1', 'g1', [g1Probe.id])).toBeNull();

    // g4 完成后轮到 g1；会话丢失后的重跑拿回同一条 running 探针。
    service.complete(g4Probe.id, report(g4Probe.id));
    expect(service.claimForGoal('pod_1', 'g1', [g1Probe.id])).toMatchObject({
      id: g1Probe.id, status: 'running',
    });
    expect(service.claimForGoal('pod_1', 'g1', [g1Probe.id])).toMatchObject({ id: g1Probe.id });
    // 另一个 goal 不能重跑 g1 的 running 探针。
    expect(service.claimForGoal('pod_1', 'g4', [])).toBeNull();
  });

  test('requestMany rolls back partially enqueued probes when a later one fails', () => {
    const capped = new PodProbeService({
      store,
      resolveMafwDir: () => mafwDir,
      limits: { maxPending: 1, maxMinutes: 10 },
      now: () => NOW,
      newId: (() => { let n = 0; return () => `batch_${++n}`; })(),
    });

    expect(() => capped.requestMany([requestInput(), requestInput()]))
      .toThrow(expect.objectContaining({ status: 409 }));

    const rows = service.list('pod_1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed' });
    expect(rows[0].error).toMatch(/rolled back/);
    // 回滚后排队槽位可用：下一条正常入队并可以被抢占。
    const next = service.request(requestInput());
    expect(service.claim('pod_1')).toMatchObject({ id: next.id, status: 'running' });
  });

  test('claimForGoal skips queued probes of terminal goals instead of blocking FIFO', () => {
    // 一个已取消/归档 goal 的探针排在队头：不能让后续 goal 永久等待。
    store.enqueueGoal({ id: 'pg_g5', podId: 'pod_1', goalId: 'g5', now: NOW });
    seedRevision('g5');
    const dead = service.request(requestInput({ goalId: 'g5' }));
    const live = service.request(requestInput({ goalId: 'g1' }));
    store.setGoalRevisionStatus({
      podId: 'pod_1',
      goalId: 'g5',
      revision: 1,
      status: 'aborted',
      now: NOW,
    });

    expect(service.claimForGoal('pod_1', 'g1', [live.id])).toMatchObject({ id: live.id, status: 'running' });
    expect(store.getProbe(dead.id)?.status).toBe('failed');
    expect(store.getProbe(dead.id)?.error).toMatch(/terminal|aborted/);
  });

  test('claim clears a stale running probe from a terminal goal so the pod unblocks', () => {
    const stale = service.request(requestInput());
    service.claim('pod_1');
    expect(store.getProbe(stale.id)?.status).toBe('running');

    // Goal 被中止：僵尸 running 不能继续占住 Pod 的唯一运行槽。
    store.setGoalRevisionStatus({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      status: 'aborted',
      now: NOW,
    });

    store.enqueueGoal({ id: 'pg_g6', podId: 'pod_1', goalId: 'g6', now: NOW });
    seedRevision('g6');
    const next = service.request(requestInput({ goalId: 'g6' }));

    expect(service.claimForGoal('pod_1', 'g6', [next.id])).toMatchObject({ id: next.id, status: 'running' });
    expect(store.getProbe(stale.id)?.status).toBe('failed');
  });

  test('requeue returns a running probe to the queue without losing it', () => {
    const probe = service.request(requestInput());
    service.claim('pod_1');

    expect(service.requeue(probe.id, 'transient 429')).toMatchObject({ id: probe.id, status: 'queued' });
    expect(service.claimForGoal('pod_1', 'g1', [probe.id])).toMatchObject({ id: probe.id, status: 'running' });
    // 非 running 状态不回退（已完成/已失败的探针）。
    service.complete(probe.id, report(probe.id));
    expect(service.requeue(probe.id)).toBeNull();
  });

  test('claim skips a probe whose goal revision became terminal without running it', () => {    store.enqueueGoal({ id: 'pg_g4', podId: 'pod_1', goalId: 'g4', now: NOW });
    seedRevision('g4');

    const stale = service.request(requestInput());
    const fresh = service.request(requestInput({ goalId: 'g4' }));

    // The Goal is aborted after the probe was queued: claim must not hand it out.
    store.setGoalRevisionStatus({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      status: 'completed',
      now: NOW,
    });

    expect(service.claim('pod_1')).toMatchObject({ id: fresh.id, status: 'running' });

    const staleRecord = service.list('pod_1').find((probe) => probe.id === stale.id)!;
    expect(staleRecord.status).toBe('failed');
    expect(staleRecord.error).toMatch(/terminal/);
    expect(staleRecord.report).toBeNull();

    // A pod whose only queued probes are stale yields no claim.
    service.fail(fresh.id, 'done for this test');
    const another = service.request(requestInput({ goalId: 'g4' }));
    store.setGoalRevisionStatus({
      podId: 'pod_1',
      goalId: 'g4',
      revision: 1,
      status: 'aborted',
      now: NOW,
    });
    expect(service.claim('pod_1')).toBeNull();
    expect(service.list('pod_1').find((probe) => probe.id === another.id)?.status).toBe('failed');
  });

  test('path builders reject unsafe goal/probe identifiers instead of sanitizing them', () => {
    expect(() => probeArtifactDir(mafwDir, '.')).toThrow(/safe identifier/);
    expect(() => probeArtifactDir(mafwDir, '..')).toThrow(/safe identifier/);
    expect(() => probeRequestPath(mafwDir, 'g1', '..')).toThrow(/safe identifier/);
    expect(() => probeRequestPath(mafwDir, '..', 'p1')).toThrow(/safe identifier/);
    expect(() => probeReportPath(mafwDir, 'g1', '../p1')).toThrow(/safe identifier/);
    expect(() => probeReportPath(mafwDir, 'g 1', 'p1')).toThrow(/safe identifier/);

    // Safe identifiers still resolve under the goal probe directory.
    expect(probeReportPath(mafwDir, 'g1', 'p1'))
      .toBe(path.join(mafwDir, 'goals', 'g1', 'probes', 'p1.report.json'));
  });

  test('fail redacts short probe-grade tokens, not only long API keys', () => {
    const created = service.request(requestInput());
    service.claim('pod_1');

    const failed = service.fail(created.id, 'crashed: token sk-secret / ghp_abcdef');

    expect(failed.error).not.toContain('sk-secret');
    expect(failed.error).not.toContain('ghp_abcdef');
    expect(failed.error).toContain('[REDACTED]');
    expect(store.getProbe(created.id)!.error).toBe(failed.error);
  });

  test('list filters by goal, revision, and status in queue order', () => {
    const a = service.request(requestInput());
    const b = service.request(requestInput());
    service.claim('pod_1');
    service.complete(a.id, report(a.id));
    service.claim('pod_1');

    expect(service.list('pod_1', { status: 'completed' }).map((probe) => probe.id)).toEqual([a.id]);
    expect(service.list('pod_1', { status: 'running' }).map((probe) => probe.id)).toEqual([b.id]);
    expect(service.list('pod_1', { goalId: 'g1', revision: 1 })).toHaveLength(2);
    expect(service.list('pod_1', { goalId: 'g2' })).toEqual([]);
    expect(service.list('pod_2')).toEqual([]);
  });

  test('claim returns null for a pod without queued probes', () => {
    expect(service.claim('pod_2')).toBeNull();
  });

  test('fail requires a non-empty reason and refuses completed probes', () => {
    const created = service.request(requestInput());
    service.claim('pod_1');
    service.complete(created.id, report(created.id));

    expect(() => service.fail(created.id, '   ')).toThrow(PodError);
    expect(() => service.fail(created.id, 'late failure')).toThrow(PodError);
    expect(() => service.fail('missing', 'reason')).toThrow(expect.objectContaining({ status: 404 }));
  });
});
