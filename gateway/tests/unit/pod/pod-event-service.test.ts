// gateway/tests/unit/pod/pod-event-service.test.ts
// The DB is the runtime truth; the per-pod JSON file is a create-once audit
// snapshot. Losing the file must never lose the event.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodEventService } from '../../../src/core/pod/pod-event-service';

function make(mafwDir: string) {
  const store = new PodStore(new Database(':memory:'));
  const svc = new PodEventService({ store, mafwDir, now: () => '2026-11-04T10:00:00.000Z' });
  return { store, svc };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-events-'));
}

const base = {
  podId: 'pod_1',
  projectId: 'proj',
  goalId: 'g1',
  revision: 1,
  kind: 'goal.result',
  severity: 'p1' as const,
  reason: 'result' as const,
  title: '冒烟 · PASS',
  summary: null,
  refs: [],
  dedupeKey: 'goal.result:g1:r1',
  audience: 'human' as const,
};

it('records once and is idempotent on dedupeKey', () => {
  const { svc } = make(tmpDir());
  const a = svc.record(base);
  const b = svc.record({ ...base, title: 'different title' });
  expect(b.id).toBe(a.id);
  expect(b.title).toBe('冒烟 · PASS');
  expect(svc.list('pod_1').items).toHaveLength(1);
});

it('writes an audit file under <mafwDir>/pods/<podId>/events', () => {
  const dir = tmpDir();
  const { svc } = make(dir);
  const row = svc.record(base);
  const eventDir = path.join(dir, 'pods', 'pod_1', 'events');
  expect(fs.readdirSync(eventDir).some((f) => f.includes(row.id))).toBe(true);
});

it('revision 2 of the same goal produces a new event', () => {
  const { svc } = make(tmpDir());
  svc.record(base);
  svc.record({ ...base, revision: 2, dedupeKey: 'goal.result:g1:r2' });
  expect(svc.list('pod_1').items).toHaveLength(2);
});

it('seen is idempotent and scoped to one revision', () => {
  const { svc } = make(tmpDir());
  svc.record(base);
  svc.record({ ...base, revision: 2, dedupeKey: 'goal.result:g1:r2' });
  expect(svc.markSeenAll('pod_1', 'g1', 1)).toBe(1);
  expect(svc.markSeenAll('pod_1', 'g1', 1)).toBe(0);
  expect(svc.list('pod_1', { state: 'unread' }).items).toHaveLength(1);
});

it('a file write failure does not lose the event', () => {
  const { svc } = make(path.join(tmpDir(), 'nope', '\u0000invalid'));
  expect(() => svc.record(base)).not.toThrow();
  expect(svc.list('pod_1').items).toHaveLength(1);
});

it('lead/none events never count as unread', () => {
  const { svc } = make(tmpDir());
  svc.record({ ...base, audience: 'lead', severity: 'p2', kind: 'member.escalation', dedupeKey: 'm:1' });
  svc.record({ ...base, audience: 'none', severity: 'p3', kind: 'member.note', dedupeKey: 'm:2' });
  expect(svc.list('pod_1').unread).toBe(0);
  svc.record(base);
  expect(svc.list('pod_1').unread).toBe(1);
});

it('markSeen is idempotent and counts unread', () => {
  const { svc } = make(tmpDir());
  const row = svc.record(base);
  expect(svc.list('pod_1').unread).toBe(1);
  expect(svc.markSeen('pod_1', row.id)).toBe(true);
  expect(svc.markSeen('pod_1', row.id)).toBe(false);
  expect(svc.list('pod_1').unread).toBe(0);
});
