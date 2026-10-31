import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodError, PodStore } from '../../../src/core/pod/pod-store';
import { PodMessageService } from '../../../src/core/pod/pod-message-service';

describe('PodMessageService', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let notifications: string[];
  let seq: number;
  let service: PodMessageService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-messages-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: '2026-10-29T00:00:00.000Z' });
    store.upsertMember({
      id: 'm_lead', podId: 'pod_1', role: 'lead', displayName: 'Lead', agentName: 'manager',
      modelProvider: null, modelId: null, status: 'available', configJson: null,
      now: '2026-10-29T00:00:00.000Z',
    });
    store.upsertMember({
      id: 'm_builder', podId: 'pod_1', role: 'builder', displayName: 'Builder', agentName: 'mafw-execute',
      modelProvider: null, modelId: null, status: 'available', configJson: null,
      now: '2026-10-29T00:00:00.000Z',
    });
    notifications = [];
    seq = 0;
    service = new PodMessageService({
      store,
      now: () => `2026-10-29T00:00:0${seq}.000Z`,
      newId: () => `msg_${++seq}`,
      notify: (podId) => notifications.push(podId),
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('send/list/markRead supports broadcast and direct messages', () => {
    const first = service.send({
      podId: 'pod_1',
      fromMemberId: 'm_lead',
      kind: 'note',
      body: 'all hands',
    });
    const second = service.send({
      podId: 'pod_1',
      fromMemberId: 'm_builder',
      toMemberId: 'm_lead',
      kind: 'request',
      body: 'review please',
    });

    expect(first.toMemberId).toBeNull();
    expect(second.toMemberId).toBe('m_lead');
    expect(service.list('pod_1').map((m) => m.id)).toEqual(['msg_2', 'msg_1']);
    expect(service.markRead(first.id)).toBe(true);
    expect(service.list('pod_1').find((m) => m.id === first.id)?.readAt).toBeTruthy();
    expect(notifications).toEqual(['pod_1', 'pod_1', 'pod_1']);
    expect(service.markRead('missing')).toBe(false);
    expect(notifications).toEqual(['pod_1', 'pod_1', 'pod_1']);
  });

  test('rejects empty bodies and unknown recipients', () => {    expect(() => service.send({
      podId: 'pod_1', fromMemberId: 'm_lead', kind: 'note', body: '  ',
    })).toThrow(PodError);
    expect(() => service.send({
      podId: 'pod_1', fromMemberId: 'm_lead', toMemberId: 'missing', kind: 'note', body: 'x',
    })).toThrow(PodError);
  });
});
