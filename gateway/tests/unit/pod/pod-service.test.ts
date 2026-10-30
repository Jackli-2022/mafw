import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodService } from '../../../src/core/pod/pod-service';
import { PodError } from '../../../src/core/pod/pod-store';

describe('PodService', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let memoryRoot: string;
  let projectDir: string;
  let broadcasts: Array<{ type: string; properties?: Record<string, unknown> }>;
  let logs: string[];
  let managerCalls: number;
  let managerSessionId: string;
  let seq: number;
  let clock: number;
  let getSessionImpl: (sessionID: string) => Promise<{ time?: { idle?: number; completed?: number }; parentID?: string }>;
  let messagesImpl: (sessionID: string, limit: number) => Promise<unknown[]>;
  let service: PodService;

  const now = () => new Date(Date.UTC(2026, 9, 29, 0, 0, clock++)).toISOString();
  const newId = () => `id_${++seq}`;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-service-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    memoryRoot = path.join(dir, 'pods');
    projectDir = path.join(dir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });
    broadcasts = [];
    logs = [];
    managerCalls = 0;
    managerSessionId = 'ses_manager';
    seq = 0;
    clock = 0;
    getSessionImpl = async () => ({ time: { idle: 1 } });
    messagesImpl = async () => [{ role: 'assistant', text: 'done' }];
    service = new PodService({
      store,
      now,
      newId,
      broadcast: (event) => broadcasts.push(event as any),
      getManagerSession: async () => {
        managerCalls++;
        return managerSessionId;
      },
      getSession: (sessionID) => getSessionImpl(sessionID),
      messages: (sessionID, limit) => messagesImpl(sessionID, limit),
      memoryRoot,
      listRegisteredProjectDirs: () => [projectDir],
      ensureMemory: () => {},
      log: (message) => logs.push(message),
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('ensure creates one pod with three members and does not duplicate the lead session', async () => {
    const first = await service.ensure(projectDir);
    const second = await service.ensure(projectDir);

    expect(second.pod.id).toBe(first.pod.id);
    expect(first.members.map((m) => m.role)).toEqual(['lead', 'builder', 'reviewer']);
    expect(first.members.find((m) => m.role === 'lead')?.agentName).toBe('manager');
    expect(first.members.find((m) => m.role === 'builder')?.agentName).toBe('mafw-execute');
    expect(first.members.find((m) => m.role === 'reviewer')?.agentName).toBe('mafw-review');
    expect(managerCalls).toBe(2);
    expect(store.listSessions(first.pod.id).filter((s) => s.node === 'coordination' && !s.endedAt)).toHaveLength(1);
  });

  test('ensure rebinds Lead when the Manager session rotates', async () => {
    const first = await service.ensure(projectDir);
    expect(store.getMemberBySession('ses_manager')?.role).toBe('lead');

    managerSessionId = 'ses_manager_rotated';
    await service.ensure(projectDir);

    const active = store.listSessions(first.pod.id).filter((s) => s.node === 'coordination' && !s.endedAt);
    expect(active.map((s) => s.sessionId)).toEqual(['ses_manager_rotated']);
    expect(store.getMemberBySession('ses_manager')).toBeNull();
    expect(store.getMemberBySession('ses_manager_rotated')?.role).toBe('lead');
  });

  test('ensure stays usable when Manager binding or memory init fails', async () => {
    const failing = new PodService({
      store,
      now,
      newId,
      broadcast: () => {},
      getManagerSession: async () => { throw new Error('manager unavailable'); },
      getSession: (sessionID) => getSessionImpl(sessionID),
      messages: (sessionID, limit) => messagesImpl(sessionID, limit),
      memoryRoot,
      listRegisteredProjectDirs: () => [projectDir],
      ensureMemory: () => { throw new Error('read-only memory root'); },
      log: (message) => logs.push(message),
    });

    const detail = await failing.ensure(projectDir);
    expect(detail.members).toHaveLength(3);
    expect(detail.sessions.filter((s) => s.node === 'coordination')).toHaveLength(0);
    expect(logs.some((line) => line.includes('lead binding failed'))).toBe(true);
    expect(logs.some((line) => line.includes('memory init failed'))).toBe(true);
  });

  test('bindSession resolves goal to pod/member and marks the member working', async () => {
    const detail = await service.ensure(projectDir);
    store.enqueueGoal({
      id: 'pg_1',
      podId: detail.pod.id,
      goalId: 'g1',
      now: now(),
    });

    const session = service.bindSession('g1', 'execute', 'ses_builder');
    const builder = store.getMemberByRole(detail.pod.id, 'builder');

    expect(session?.memberId).toBe(builder?.id);
    expect(session?.node).toBe('execute');
    expect(store.getMemberByRole(detail.pod.id, 'builder')?.status).toBe('working');
    expect(service.getPodIdForGoal('g1')).toBe(detail.pod.id);
    expect(service.getPodIdForGoal('missing')).toBeNull();
    expect(broadcasts.some((e) => e.type === 'pod.updated' && e.properties?.kind === 'member')).toBe(true);
  });

  test('snapshotSession writes transcript, stores snapshot, ends session, and frees member', async () => {
    const detail = await service.ensure(projectDir);
    store.enqueueGoal({ id: 'pg_1', podId: detail.pod.id, goalId: 'g1', now: now() });
    service.bindSession('g1', 'execute', 'ses_builder');

    const transcriptPath = await service.snapshotSession('ses_builder');
    const expectedPath = path.join(memoryRoot, detail.pod.id, 'sessions', 'ses_builder.json');

    expect(transcriptPath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);
    const payload = JSON.parse(fs.readFileSync(expectedPath, 'utf-8'));
    expect(payload.sessionID).toBe('ses_builder');
    expect(payload.messages).toHaveLength(1);
    expect(store.getSnapshot('ses_builder')?.path).toBe(expectedPath);
    expect(store.getSessionBySessionId('ses_builder')?.transcriptRef).toBe(expectedPath);
    expect(store.listActiveSessions(detail.pod.id).map((s) => s.sessionId)).toEqual(['ses_manager']);
    expect(store.getMemberByRole(detail.pod.id, 'builder')?.status).toBe('available');
  });

  test('snapshotSession does not finalize the session when transcript fetch fails', async () => {
    const detail = await service.ensure(projectDir);
    store.enqueueGoal({ id: 'pg_1', podId: detail.pod.id, goalId: 'g1', now: now() });
    service.bindSession('g1', 'execute', 'ses_builder');
    messagesImpl = async () => { throw new Error('transcript down'); };

    await expect(service.snapshotSession('ses_builder')).rejects.toBeInstanceOf(PodError);
    expect(store.getSnapshot('ses_builder')).toBeNull();
    expect(store.listActiveSessions(detail.pod.id).some((s) => s.sessionId === 'ses_builder')).toBe(true);
    expect(store.getMemberByRole(detail.pod.id, 'builder')?.status).toBe('working');
  });

  test('reconcile ends dead goal sessions but leaves the coordination session alive', async () => {
    const detail = await service.ensure(projectDir);
    const builder = store.getMemberByRole(detail.pod.id, 'builder')!;
    store.insertSession({
      id: 'ps_dead',
      podId: detail.pod.id,
      memberId: builder.id,
      goalId: 'g1',
      node: 'execute',
      sessionId: 'ses_dead',
      status: 'active',
      transcriptRef: null,
      now: now(),
    });
    getSessionImpl = async (sessionID) => {
      if (sessionID === 'ses_dead') throw new Error('session gone');
      return { time: { idle: 1 } };
    };

    await expect(service.reconcile()).resolves.toBeUndefined();
    expect(store.getSnapshot('ses_dead')).not.toBeNull();
    expect(logs.some((line) => line.includes('ses_dead'))).toBe(true);
    expect(store.listActiveSessions(detail.pod.id).some((s) => s.node === 'coordination')).toBe(true);
  });

  test('reconcile finalizes a deleted session when transcript fetch also fails', async () => {
    const detail = await service.ensure(projectDir);
    const builder = store.getMemberByRole(detail.pod.id, 'builder')!;
    store.insertSession({
      id: 'ps_dead',
      podId: detail.pod.id,
      memberId: builder.id,
      goalId: 'g1',
      node: 'execute',
      sessionId: 'ses_dead',
      status: 'active',
      transcriptRef: null,
      now: now(),
    });
    getSessionImpl = async () => { throw new Error('session gone'); };
    messagesImpl = async () => { throw new Error('messages gone'); };

    await expect(service.reconcile()).resolves.toBeUndefined();

    const snapshot = store.getSnapshot('ses_dead');
    expect(snapshot).not.toBeNull();
    expect(JSON.parse(fs.readFileSync(snapshot!.path, 'utf-8')).unavailable).toBe(true);
    expect(store.getSessionBySessionId('ses_dead')?.endedAt).toBeTruthy();
    expect(store.getMemberByRole(detail.pod.id, 'builder')?.status).toBe('available');
  });

  test('reconcile does not tombstone a live session on a transcript error', async () => {
    const detail = await service.ensure(projectDir);
    const builder = store.getMemberByRole(detail.pod.id, 'builder')!;
    store.insertSession({
      id: 'ps_live',
      podId: detail.pod.id,
      memberId: builder.id,
      goalId: 'g1',
      node: 'execute',
      sessionId: 'ses_live',
      status: 'active',
      transcriptRef: null,
      now: now(),
    });
    getSessionImpl = async () => ({ time: { idle: 1 } });
    messagesImpl = async () => { throw new Error('messages temporarily unavailable'); };

    await expect(service.reconcile()).resolves.toBeUndefined();

    expect(store.getSnapshot('ses_live')).toBeNull();
    expect(store.listActiveSessions(detail.pod.id).some((s) => s.sessionId === 'ses_live')).toBe(true);
  });

  test('reconcile leaves a session active on a transient session lookup error', async () => {
    const detail = await service.ensure(projectDir);
    const builder = store.getMemberByRole(detail.pod.id, 'builder')!;
    store.insertSession({
      id: 'ps_warm',
      podId: detail.pod.id,
      memberId: builder.id,
      goalId: 'g1',
      node: 'execute',
      sessionId: 'ses_warm',
      status: 'active',
      transcriptRef: null,
      now: now(),
    });
    getSessionImpl = async () => { throw new Error('transport timeout'); };
    messagesImpl = async () => { throw new Error('runtime warming up'); };

    await expect(service.reconcile()).resolves.toBeUndefined();

    expect(store.getSnapshot('ses_warm')).toBeNull();
    expect(store.listActiveSessions(detail.pod.id).some((s) => s.sessionId === 'ses_warm')).toBe(true);
  });

  test('rejects an unregistered project without creating a pod', async () => {
    const unknown = path.join(dir, 'unknown-project');
    fs.mkdirSync(unknown, { recursive: true });

    await expect(service.ensure(unknown)).rejects.toBeInstanceOf(PodError);
    expect(store.listPods()).toHaveLength(0);
  });

  test('lookup returns the pod for a registered project without creating one', async () => {
    expect(service.lookup(projectDir)).toBeNull();
    const detail = await service.ensure(projectDir);
    expect(service.lookup(projectDir)?.pod.id).toBe(detail.pod.id);
    expect(service.lookup('/not-registered')).toBeNull();
  });

  test('lookup maps a worktree directory back to the parent pod', async () => {
    const detail = await service.ensure(projectDir);
    const worktree = path.join(path.dirname(projectDir), `${path.basename(projectDir)}-wt-feature`);
    expect(service.lookup(worktree)?.pod.id).toBe(detail.pod.id);
  });
});
