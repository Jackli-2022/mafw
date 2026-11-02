import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodService } from '../../../src/core/pod/pod-service';
import { roleForNode } from '../../../src/core/pod/pod-identity';
import { createBuiltinIdentityRegistry } from '../../../src/runtime/identity-registry';

// spec: docs/superpowers/specs/2026-11-02-pod-collaborative-goal-loop-design.md §3
// Pod roster 固定为 Lead / Tech Lead / Builder / Reviewer 四个角色成员。
const registry = createBuiltinIdentityRegistry();

describe('pod four-role vocabulary', () => {
  test('roleForNode maps discussion/plan to tech lead, probe/execute to builder, review to reviewer', () => {
    expect(roleForNode('discussion')).toBe('tech_lead');
    expect(roleForNode('plan')).toBe('tech_lead');
    expect(roleForNode('probe')).toBe('builder');
    expect(roleForNode('execute')).toBe('builder');
    expect(roleForNode('review')).toBe('reviewer');
  });

  test('identities expose lead + mafw-tech-lead and keep manager as a deprecated alias', () => {
    expect(registry.list().map((x) => x.name)).toEqual(expect.arrayContaining(['lead', 'mafw-tech-lead']));
    expect(registry.get('manager')?.deprecated).toBe(true);
  });

  test('PodStore orders the roster lead → tech_lead → builder → reviewer', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-roles-'));
    const db = new Database(path.join(dir, 'test.db'));
    try {
      const store = new PodStore(db);
      const now = '2026-11-02T00:00:00.000Z';
      store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now });
      for (const [role, agentName] of [
        ['reviewer', 'mafw-review'],
        ['builder', 'mafw-execute'],
        ['tech_lead', 'mafw-tech-lead'],
        ['lead', 'lead'],
      ] as const) {
        store.upsertMember({
          id: `m_${role}`,
          podId: 'pod_1',
          role,
          displayName: role,
          agentName,
          modelProvider: null,
          modelId: null,
          status: 'available',
          configJson: null,
          now,
        });
      }
      expect(store.listMembers('pod_1').map((m) => m.role)).toEqual([
        'lead', 'tech_lead', 'builder', 'reviewer',
      ]);
      expect(store.getMemberByRole('pod_1', 'tech_lead')?.agentName).toBe('mafw-tech-lead');
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('PodService.ensure creates the four roster members exactly once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-roles-svc-'));
    const db = new Database(path.join(dir, 'test.db'));
    try {
      const store = new PodStore(db);
      const projectDir = path.join(dir, 'project');
      fs.mkdirSync(projectDir, { recursive: true });
      let seq = 0;
      const service = new PodService({
        store,
        now: () => new Date(Date.UTC(2026, 10, 2, 0, 0, seq++)).toISOString(),
        newId: () => `id_${++seq}`,
        broadcast: () => {},
        getManagerSession: async () => 'ses_lead',
        getSession: async () => ({ time: { idle: 1 } }),
        messages: async () => [],
        memoryRoot: path.join(dir, 'pods'),
        listRegisteredProjectDirs: () => [projectDir],
        ensureMemory: () => {},
      });

      const first = await service.ensure(projectDir);
      const second = await service.ensure(projectDir);

      expect(first.members.map((m) => m.role)).toEqual(['lead', 'tech_lead', 'builder', 'reviewer']);
      expect(first.members.find((m) => m.role === 'tech_lead')?.agentName).toBe('mafw-tech-lead');
      expect(first.members.find((m) => m.role === 'tech_lead')?.displayName).toBe('Tech Lead');
      // 重复 ensure 不复制成员
      expect(second.members).toHaveLength(4);
      expect(second.members.some((m) => m.role === ('curator' as never))).toBe(false);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
