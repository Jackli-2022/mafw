import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventStore } from '../../../src/core/events/event-store';
import { EventOutbox } from '../../../src/core/events/event-outbox';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodEventService } from '../../../src/core/pod/pod-event-service';

const NOW = '2026-11-16T00:00:00.000Z';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lead-read-ack-'));
}

test('markSent records the session and ack only touches that session', () => {
  const store = new EventStore(new Database(':memory:'));
  const outbox = new EventOutbox({ store, now: () => NOW });
  store.insertChannel({ id: 'lead:p1', threadId: '*', kind: 'chat', address: {}, now: NOW });
  const a = outbox.enqueue({ channelId: 'lead:p1', dedupeKey: 'pod-event:e1', payload: { kind: 'pod-event' } });
  const b = outbox.enqueue({ channelId: 'lead:p1', dedupeKey: 'pod-event:e2', payload: { kind: 'pod-event' } });
  outbox.markSent(a.id, 'ses_a');
  outbox.markSent(b.id, 'ses_b');
  expect(store.markOutboxAckedBySession('ses_a', '2026-11-16T00:01:00.000Z')).toBe(1);
  expect(store.getOutbox(a.id)?.ackAt).toBe('2026-11-16T00:01:00.000Z');
  expect(store.getOutbox(b.id)?.ackAt).toBeNull();
});

test('markOutboxRead is idempotent', () => {
  const store = new EventStore(new Database(':memory:'));
  const outbox = new EventOutbox({ store, now: () => NOW });
  store.insertChannel({ id: 'lead:p1', threadId: '*', kind: 'chat', address: {}, now: NOW });
  const row = outbox.enqueue({ channelId: 'lead:p1', dedupeKey: 'pod-event:e1', payload: {} });
  expect(store.markOutboxRead([row.id], '2026-11-16T00:01:00.000Z')).toBe(1);
  expect(store.markOutboxRead([row.id], '2026-11-16T00:02:00.000Z')).toBe(0);
});

test('marking a pod event seen reads its outbox row', () => {
  const dir = tmpDir();
  const store = new PodStore(new Database(':memory:'));
  const seen: any[] = [];
  const svc = new PodEventService({
    store,
    mafwDir: dir,
    now: () => NOW,
    onSeen: (row) => seen.push(row),
  });
  const evt = svc.record({
    podId: 'pod_1',
    projectId: 'proj',
    kind: 'goal.failed',
    severity: 'p2',
    reason: 'failed',
    title: 'failed',
    dedupeKey: 'goal.failed:g1:r1',
    audience: 'lead',
  });
  svc.markWakeQueued(evt.id, 'outbox_1');
  svc.markSeen('pod_1', evt.id);
  expect(seen[0]?.wakeSessionId).toBe('outbox:outbox_1');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bulk seen reports each outbox-backed event once', () => {
  const dir = tmpDir();
  const store = new PodStore(new Database(':memory:'));
  const seen: string[] = [];
  const svc = new PodEventService({
    store,
    mafwDir: dir,
    now: () => NOW,
    onSeen: (row) => seen.push(row.goalId ?? ''),
  });
  svc.record({
    podId: 'pod_1', projectId: 'proj', goalId: 'g1', revision: 1,
    kind: 'goal.result', severity: 'p1', reason: 'result', title: 'done',
    dedupeKey: 'goal.result:g1:r1', audience: 'human',
  });
  expect(svc.markSeenAll('pod_1', 'g1', 1)).toBe(1);
  expect(seen).toEqual(['g1']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('markOutboxReadByGoal only marks delivered rows without an A2A message', () => {
  const store = new EventStore(new Database(':memory:'));
  const outbox = new EventOutbox({ store, now: () => NOW });
  store.insertChannel({ id: 'lead:p1', threadId: '*', kind: 'chat', address: {}, now: NOW });
  const sent = outbox.enqueue({
    channelId: 'lead:p1', dedupeKey: 'pod-event:e1', payload: { kind: 'pod-event', goalId: 'g1' },
  });
  outbox.markSent(sent.id, 'ses_a');
  const pending = outbox.enqueue({
    channelId: 'lead:p1', dedupeKey: 'pod-event:e2', payload: { kind: 'pod-event', goalId: 'g1' },
  });
  const a2a = outbox.enqueue({
    channelId: 'lead:p1', dedupeKey: 'pod-event:e3',
    payload: { kind: 'pod-event', goalId: 'g1', messageId: 'm1' },
  });
  outbox.markSent(a2a.id, 'ses_a');
  expect(store.markOutboxReadByGoal('p1', 'g1', '2026-11-16T00:01:00.000Z')).toBe(1);
  expect(store.getOutbox(sent.id)?.readAt).toBe('2026-11-16T00:01:00.000Z');
  expect(store.getOutbox(pending.id)?.readAt).toBeNull();
  expect(store.getOutbox(a2a.id)?.readAt).toBeNull();
});
