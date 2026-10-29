import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodError, PodStore } from '../../../src/core/pod/pod-store';
import { PodAccess } from '../../../src/core/pod/pod-access';

describe('PodAccess', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let access: PodAccess;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-access-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    store.ensurePod({ id: 'pod_1', projectDir: '/proj', name: 'P', now: '2026-10-29T00:00:00.000Z' });
    store.upsertMember({
      id: 'm_lead', podId: 'pod_1', role: 'lead', displayName: 'Lead', agentName: 'manager',
      modelProvider: null, modelId: null, status: 'available', configJson: null, now: '2026-10-29T00:00:00.000Z',
    });
    store.upsertMember({
      id: 'm_builder', podId: 'pod_1', role: 'builder', displayName: 'Builder', agentName: 'mafw-execute',
      modelProvider: null, modelId: null, status: 'available', configJson: null, now: '2026-10-29T00:00:00.000Z',
    });
    store.insertSession({
      id: 'ps_lead', podId: 'pod_1', memberId: 'm_lead', goalId: null, node: 'coordination',
      sessionId: 's1', status: 'active', transcriptRef: null, now: '2026-10-29T00:00:00.000Z',
    });
    access = new PodAccess(store);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('returns the member when the role is allowed', () => {
    expect(access.requireMember('s1', ['lead']).id).toBe('m_lead');
  });

  test('rejects the wrong role and unknown sessions with 403', () => {
    expect(() => access.requireMember('s1', ['builder'])).toThrow(PodError);
    expect(() => access.requireMember('missing', ['lead'])).toThrow(PodError);
    try {
      access.requireMember('s1', ['builder']);
    } catch (err: any) {
      expect(err.status).toBe(403);
    }
  });

  test('rejects a member from another pod', () => {
    store.ensurePod({ id: 'pod_2', projectDir: '/proj2', name: 'P2', now: '2026-10-29T00:00:00.000Z' });
    store.upsertMember({
      id: 'm_lead2', podId: 'pod_2', role: 'lead', displayName: 'Lead', agentName: 'manager',
      modelProvider: null, modelId: null, status: 'available', configJson: null, now: '2026-10-29T00:00:00.000Z',
    });
    store.insertSession({
      id: 'ps_lead2', podId: 'pod_2', memberId: 'm_lead2', goalId: null, node: 'coordination',
      sessionId: 's2', status: 'active', transcriptRef: null, now: '2026-10-29T00:00:00.000Z',
    });

    expect(() => access.requireMember('s2', ['lead'], 'pod_1')).toThrow(PodError);
    expect(() => access.requireMember('s1', ['lead'], 'pod_2')).toThrow(PodError);
    expect(access.requireMember('s1', ['lead'], 'pod_1').id).toBe('m_lead');
  });
});
