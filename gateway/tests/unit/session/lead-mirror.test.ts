// LeadSessionRegistry mirrors its bindings into the session registry
// (observe-only: all Lead logic — kv rows, liveness, snapshot/retire,
// conflict errors — is untouched).
// Plan: docs/superpowers/plans/2026-11-10-gateway-kernel-session-registry.md (Task 5)
import { SessionRegistry } from '../../../src/session';
import { LeadSessionRegistry } from '../../../src/core/manager/lead-session-registry';
import { canonicalProjectDir } from '../../../src/core/pod/pod-identity';

const PROJ_A = canonicalProjectDir('C:/proj/a');
const PROJ_B = canonicalProjectDir('C:/proj/b');

function makeDeps(over: Record<string, unknown> = {}) {
  const kv = new Map<string, unknown>();
  const archived: string[] = [];
  return {
    base: {
      kvGet: (_s: string, key: string) => kv.get(key),
      kvSet: (_s: string, key: string, value: unknown) => { kv.set(key, value); },
      kvAll: (_s: string) => Array.from(kv.entries()).map(([key, value]) => ({ key, value })),
      runtimeName: () => 'opencode',
      podByProject: () => null,
      activePodCoordination: (_podId: string) => null,
      createSession: async (dir: string) => `ses-${dir.replace(/[^a-z0-9]/gi, '')}`,
      isAlive: async () => true,
      registerLead: async () => {},
      archiveLead: async (sid: string) => { archived.push(sid); },
      bindPodLead: async () => {},
      now: () => '2026-11-10T00:00:00.000Z',
      ...over,
    },
    kv,
    archived,
  };
}

describe('LeadSessionRegistry session-registry mirror (Task 5)', () => {
  it('ensure (create path) mirrors a kind-lead record with the project scope', async () => {
    const registry = new SessionRegistry();
    const { base } = makeDeps();
    const lead = new LeadSessionRegistry({ ...base, sessionRegistry: registry } as any);
    const rec = await lead.ensure('C:/proj/a');
    const mirrored = registry.byScope({ kind: 'lead', projectId: PROJ_A });
    expect(mirrored.length).toBe(1);
    expect(mirrored[0].sessionID).toBe(rec.sessionId);
    expect(mirrored[0].runtimeName).toBe('opencode');
  });

  it('ensure reuses a live session → the record survives (one record per sid)', async () => {
    const registry = new SessionRegistry();
    const { base, kv } = makeDeps();
    kv.set(PROJ_A, { byRuntime: { opencode: { sessionId: 'ses-live', createdAt: '2026-11-01T00:00:00.000Z' } } });
    const lead = new LeadSessionRegistry({ ...base, sessionRegistry: registry } as any);
    const rec = await lead.ensure('C:/proj/a');
    expect(rec.sessionId).toBe('ses-live');
    expect(registry.byScope({ kind: 'lead' }).map((m) => m.sessionID)).toEqual(['ses-live']);
    // Second ensure → still one record (in-place update, not a duplicate).
    await lead.ensure('C:/proj/a');
    expect(registry.byScope({ kind: 'lead' }).length).toBe(1);
  });

  it('archiving a dead row unmirrors it', async () => {
    const registry = new SessionRegistry();
    const { base: base2 } = makeDeps({ isAlive: async (sid: string) => sid !== 'ses-dead' });
    const kv2 = new Map<string, unknown>([
      [PROJ_A, { byRuntime: { opencode: { sessionId: 'ses-dead', createdAt: '2026-11-01T00:00:00.000Z' } } }],
    ]);
    const lead = new LeadSessionRegistry({
      ...base2,
      kvGet: (_s: string, key: string) => kv2.get(key),
      kvSet: (_s: string, key: string, value: unknown) => { kv2.set(key, value); },
      kvAll: (_s: string) => Array.from(kv2.entries()).map(([key, value]) => ({ key, value })),
      sessionRegistry: registry,
    } as any);
    const rec = await lead.ensure('C:/proj/a');
    expect(rec.sessionId).not.toBe('ses-dead');
    const leadRecords = registry.byScope({ kind: 'lead' }).map((m) => m.sessionID);
    expect(leadRecords).toEqual([rec.sessionId]);
    expect(leadRecords).not.toContain('ses-dead'); // dead row unmirrored
  });

  it('mirror absent (no dep) → everything works as before', async () => {
    const { base } = makeDeps();
    const lead = new LeadSessionRegistry(base as any);
    const rec = await lead.ensure('C:/proj/a');
    expect(rec.sessionId).toBeDefined();
    expect(rec.source).toBe('created');
  });

  it('two projects → two records; byScope isolates them', async () => {
    const registry = new SessionRegistry();
    const { base } = makeDeps();
    const lead = new LeadSessionRegistry({ ...base, sessionRegistry: registry } as any);
    const a = await lead.ensure('C:/proj/a');
    const b = await lead.ensure('C:/proj/b');
    expect(registry.byScope({ kind: 'lead', projectId: PROJ_A }).map((m) => m.sessionID)).toEqual([a.sessionId]);
    expect(registry.byScope({ kind: 'lead', projectId: PROJ_B }).map((m) => m.sessionID)).toEqual([b.sessionId]);
    expect(registry.byScope({ kind: 'lead' }).length).toBe(2);
  });
});
