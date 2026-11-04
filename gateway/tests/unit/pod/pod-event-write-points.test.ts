// gateway/tests/unit/pod/pod-event-write-points.test.ts
// C-A regression: agent messages (mafw_pod_message -> A2A bridge) bypass
// PodMessageService and call PodStore.insertMessage directly. The event hook
// must live on the store, or the default agent channel produces no events.
import Database from 'better-sqlite3';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodMessageService } from '../../../src/core/pod/pod-message-service';
import { classifyMemberMessage } from '../../../src/core/pod/pod-event-model';

const NOW = '2026-11-04T10:00:00.000Z';

function seed() {
  const store = new PodStore(new Database(':memory:'));
  store.ensurePod({ id: 'p', projectDir: '/p', name: 'P', now: NOW });
  store.upsertMember({ id: 'lead', podId: 'p', role: 'lead', displayName: 'Lead', agentName: 'lead', modelProvider: null, modelId: null, status: 'available', configJson: null, now: NOW });
  store.upsertMember({ id: 'builder', podId: 'p', role: 'builder', displayName: 'Builder', agentName: 'mafw-execute', modelProvider: null, modelId: null, status: 'available', configJson: null, now: NOW });
  return store;
}

it('insertMessage fires the registered hook for every write path', () => {
  const store = seed();
  const seen: string[] = [];
  store.onMessageInserted((row) => seen.push(row.id));
  store.insertMessage({ id: 'm1', podId: 'p', fromMemberId: 'builder', toMemberId: 'lead', kind: 'escalation', body: 'x', now: NOW });
  store.insertMessage({ id: 'm2', podId: 'p', fromMemberId: 'builder', toMemberId: null, kind: 'note', body: 'y', now: NOW });
  expect(seen).toEqual(['m1', 'm2']);
});

it('PodMessageService.send goes through the same choke point', () => {
  const store = seed();
  const seen: string[] = [];
  store.onMessageInserted((row) => seen.push(row.kind));
  const service = new PodMessageService({ store, now: () => NOW, newId: () => 'm3', notify: () => {} });
  service.send({ podId: 'p', fromMemberId: 'builder', toMemberId: 'lead', kind: 'escalation', body: 'blocked' });
  expect(seen).toEqual(['escalation']);
});

it('an A2A-shaped escalation to the lead classifies as p2 through the hook', () => {
  const store = seed();
  const events: any[] = [];
  store.onMessageInserted((row) => {
    events.push(classifyMemberMessage({ kind: row.kind, toMemberId: row.toMemberId, leadMemberId: 'lead' }));
  });
  // Bridge writes with protocol/externalMessageId — same store method, no service.
  store.insertMessage({
    id: 'm4', podId: 'p', fromMemberId: 'builder', toMemberId: 'lead',
    kind: 'escalation', body: 'blocked', protocol: 'a2a', externalMessageId: 'ext-1', now: NOW,
  });
  expect(events[0]).toMatchObject({ severity: 'p2', audience: 'lead' });
});

it('a failing hook does not break message insertion', () => {
  const store = seed();
  store.onMessageInserted(() => { throw new Error('boom'); });
  expect(() => store.insertMessage({ id: 'm5', podId: 'p', fromMemberId: 'builder', toMemberId: 'lead', kind: 'note', body: 'z', now: NOW })).not.toThrow();
});
