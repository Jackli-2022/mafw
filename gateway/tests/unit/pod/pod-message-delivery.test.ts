import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodMessageDelivery } from '../../../src/core/pod/pod-message-delivery';
import { PodStore } from '../../../src/core/pod/pod-store';

const NOW = '2026-10-30T00:00:00.000Z';

function makeDelivery(opts: { node: string | null; sessionId?: string; notify?: (podId: string) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-delivery-'));
  const db = new Database(path.join(dir, 'test.db'));
  const store = new PodStore(db);
  const pod = store.ensurePod({ id: 'pod_1', projectDir: '/p', name: 'P', now: NOW });
  const lead = store.upsertMember({ id: 'm_lead', podId: pod.id, role: 'lead', displayName: 'Lead', agentName: 'manager', modelProvider: null, modelId: null, status: 'available', configJson: null, now: NOW });
  const builder = store.upsertMember({ id: 'm_builder', podId: pod.id, role: 'builder', displayName: 'Builder', agentName: 'mafw-execute', modelProvider: null, modelId: null, status: 'available', configJson: null, now: NOW });
  const sessionId = opts.sessionId ?? 'ses_builder';
  if (opts.node !== null) {
    store.insertSession({
      id: 'ps1', podId: pod.id, memberId: builder.id, goalId: 'g1', node: opts.node,
      sessionId, status: 'active', transcriptRef: null, now: NOW,
    });
  }
  const message = store.insertMessage({
    id: 'm1', podId: pod.id, fromMemberId: lead.id, toMemberId: builder.id,
    kind: 'request', body: 'do it', protocol: 'a2a', externalMessageId: 'msg_1', now: NOW,
  });
  const prompts: any[] = [];
  const delivery = new PodMessageDelivery({
    store,
    promptAsync: async (input) => { prompts.push(input); },
    notify: opts.notify,
  });
  return { dir, db, store, pod, builder, message, prompts, delivery };
}

describe('PodMessageDelivery', () => {
  test('pushes to a coordination session once and marks delivered', async () => {
    const h = makeDelivery({ node: 'coordination' });
    expect(await h.delivery.deliver(h.message.id)).toBe('delivered');
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]).toMatchObject({ sessionID: 'ses_builder', delivery: 'queue' });
    expect(h.prompts[0].message).toContain('[POD HANDOFF]');
    expect(h.store.listMessages(h.pod.id)[0].deliveredAt).toBeTruthy();
    expect(await h.delivery.deliver(h.message.id)).toBe('skipped');
    h.db.close();
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  test('node session stays pending and is injected at the next prompt', async () => {
    const h = makeDelivery({ node: 'execute' });
    expect(await h.delivery.deliver(h.message.id)).toBe('pending');
    expect(h.prompts).toHaveLength(0);
    const claim = h.delivery.claimPendingForSession('ses_builder');
    expect(claim?.block).toContain('[POD HANDOFF]');
    expect(h.store.listMessages(h.pod.id)[0].deliveredAt).toBeNull();
    h.delivery.commitDelivered(claim!.ids, 'ses_builder');
    expect(h.store.listMessages(h.pod.id)[0].deliveredAt).toBeTruthy();
    expect(await h.delivery.pendingForSession('ses_builder')).toBeNull();
    h.db.close();
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  test('no active session keeps the message pending', async () => {
    const h = makeDelivery({ node: null });
    expect(await h.delivery.deliver(h.message.id)).toBe('pending');
    expect(h.prompts).toHaveLength(0);
    h.db.close();
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  test('force pushes a handoff into a goal-node session', async () => {
    const h = makeDelivery({ node: 'execute' });
    expect(await h.delivery.deliver(h.message.id)).toBe('pending');
    expect(await h.delivery.deliver(h.message.id, { force: true })).toBe('delivered');
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]).toMatchObject({ sessionID: 'ses_builder', delivery: 'queue' });
    expect(h.store.listMessages(h.pod.id)[0].deliveredAt).toBeTruthy();
    h.db.close();
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  test('broadcasts the pod after a push or a pulled delivery commits', async () => {
    const pushed: string[] = [];
    const push = makeDelivery({ node: 'coordination', notify: (podId) => pushed.push(podId) });
    await push.delivery.deliver(push.message.id);
    expect(pushed).toEqual([push.pod.id]);
    push.db.close();
    fs.rmSync(push.dir, { recursive: true, force: true });

    const pulled: string[] = [];
    const pull = makeDelivery({ node: 'execute', notify: (podId) => pulled.push(podId) });
    const claim = pull.delivery.claimPendingForSession('ses_builder');
    pull.delivery.commitDelivered(claim!.ids, 'ses_builder');
    expect(pulled).toEqual([pull.pod.id]);
    pull.db.close();
    fs.rmSync(pull.dir, { recursive: true, force: true });
  });
});

