import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodSessionSupervisor } from '../../../src/core/pod/pod-session-supervisor';
import { PodTechLeadService } from '../../../src/core/pod/pod-tech-lead-service';
import { PodWorktreeService } from '../../../src/core/pod/pod-worktree-service';
import { tmpGitRepo } from '../worktree/tmp-git';

describe('Pod Tech Lead worktree session', () => {
  test('creates the discussion session in the revision worktree', async () => {
    const repo = tmpGitRepo('mafw-pod-tl-wt-');
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-tl-db-'));
    const mafwDir = path.join(dbDir, '.mafw');
    const db = new Database(path.join(dbDir, 'test.db'));
    try {
      const store = new PodStore(db);
      const now = '2026-11-09T00:00:00.000Z';
      store.ensurePod({ id: 'pod_1', projectDir: repo, name: 'repo', now });
      const techLead = store.upsertMember({
        id: 'm_tl', podId: 'pod_1', role: 'tech_lead', displayName: 'Tech Lead',
        agentName: 'mafw-tech-lead', modelProvider: null, modelId: null,
        status: 'available', configJson: null, now,
      });
      const detail = {
        pod: store.getPod('pod_1')!,
        members: store.listMembers('pod_1'),
        goals: [],
        tasks: [],
        sessions: store.listSessions('pod_1'),
      };
      const worktrees = new PodWorktreeService({ store, now: () => now });
      const runtime = {
        createSession: jest.fn(async () => 'ses_tl'),
        promptAsync: jest.fn(async () => ({})),
        messages: jest.fn(async () => ({ data: [], nextCursor: null })),
      };
      const supervisor = new PodSessionSupervisor({
        store,
        now: () => now,
        newId: () => 'podsess_1',
      });
      const service = new PodTechLeadService({
        store,
        pods: { ensure: jest.fn(async () => detail) },
        sessions: supervisor,
        runtime,
        worktrees,
        resolveProject: () => ({ projectDir: repo, mafwDir }),
        now: () => now,
        newId: () => 'pg_1',
        newGoalId: () => 'goal-wt-1',
        registerInternalSession: jest.fn(),
        emitGoalCreated: jest.fn(),
        notify: jest.fn(),
      });

      await service.createGoal({ podId: 'pod_1', projectDir: repo, title: 'WT', objective: 'x' });

      const row = store.getGoalWorktree('pod_1', 'goal-wt-1', 1);
      expect(row?.dir).toBeTruthy();
      expect(runtime.createSession).toHaveBeenCalledWith(expect.objectContaining({
        projectDir: row!.dir,
        goalId: 'goal-wt-1',
        revision: 1,
      }));
      expect(runtime.createSession.mock.calls[0][0].projectDir).not.toBe(repo);
      expect(techLead.id).toBe('m_tl');
    } finally {
      db.close();
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(dbDir, { recursive: true, force: true });
    }
  });
});
