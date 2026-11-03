import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  LeadSessionConflictError,
  LeadSessionRegistry,
  type LeadSessionRegistryDeps,
} from '../../src/core/manager/lead-session-registry';
import { writeManagerSlot } from '../../src/core/manager/manager-session-runtime';
import { canonicalProjectDir } from '../../src/core/pod/pod-identity';

interface FakePod {
  podId: string;
  projectDir: string;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-lead-registry-'));
  const projectDir = path.join(root, 'project');
  fs.mkdirSync(projectDir, { recursive: true });
  const canonical = canonicalProjectDir(projectDir);
  const kv = new Map<string, unknown>();
  const pods = new Map<string, FakePod>();
  const coordination = new Map<string, { sessionId: string }>();
  const alive = new Set<string>();
  const archives: Array<{ sessionId: string; projectDir: string }> = [];
  const registrations: Array<{ sessionId: string; projectDir: string }> = [];
  const bindings: Array<{ podId: string; sessionId: string }> = [];
  let created = 0;
  let next = 0;

  const deps = (overrides: Partial<LeadSessionRegistryDeps> = {}): LeadSessionRegistryDeps => ({
    kvGet: (scope, key) => kv.get(`${scope}\u0000${key}`),
    kvSet: (scope, key, value) => { kv.set(`${scope}\u0000${key}`, value); },
    kvAll: <T,>(scope: string) => [...kv.entries()]
      .filter(([key]) => key.startsWith(`${scope}\u0000`))
      .map(([key, value]) => ({ key: key.slice(scope.length + 1), value: value as T })),
    runtimeName: 'opencode',
    podByProject: (dir) => pods.get(canonicalProjectDir(dir)) ?? null,
    activePodCoordination: (podId) => coordination.get(podId) ?? null,
    createSession: async () => {
      created++;
      const id = `ses_created_${++next}`;
      alive.add(id);
      return id;
    },
    isAlive: async (sessionId) => alive.has(sessionId),
    registerLead: async (sessionId, dir) => { registrations.push({ sessionId, projectDir: dir }); },
    archiveLead: async (sessionId, dir) => { archives.push({ sessionId, projectDir: dir }); },
    bindPodLead: async (podId, sessionId) => { bindings.push({ podId, sessionId }); },
    now: () => '2026-11-03T00:00:00.000Z',
    ...overrides,
  });

  return {
    root,
    projectDir,
    canonical,
    kv,
    pods,
    coordination,
    alive,
    archives,
    registrations,
    bindings,
    created: () => created,
    deps,
    writeSlot(key: string, sessionId: string, runtime = 'opencode') {
      kv.set(`manager-session\u0000${key}`, writeManagerSlot(
        kv.get(`manager-session\u0000${key}`),
        runtime,
        { sessionId, createdAt: '2026-11-01T00:00:00.000Z' },
      ));
    },
    addPod(podId = 'pod_1', dir = projectDir) {
      pods.set(canonicalProjectDir(dir), { podId, projectDir: canonicalProjectDir(dir) });
      return podId;
    },
  };
}

describe('LeadSessionRegistry', () => {
  test('reads byRuntime slot instead of assuming v1 value', () => {
    const f = fixture();
    f.writeSlot(f.projectDir, 'ses_slot');
    const registry = new LeadSessionRegistry(f.deps());
    expect(registry.current(f.projectDir)).toMatchObject({
      sessionId: 'ses_slot',
      createdAt: '2026-11-01T00:00:00.000Z',
      source: 'slot',
    });
  });

  test('adopts active Pod coordination when kv is missing', async () => {
    const f = fixture();
    const podId = f.addPod();
    f.coordination.set(podId, { sessionId: 'ses_pod' });
    f.alive.add('ses_pod');
    const registry = new LeadSessionRegistry(f.deps());

    await registry.ensure(f.projectDir);

    expect(f.created()).toBe(0);
    expect(registry.current(f.projectDir)).toMatchObject({ sessionId: 'ses_pod', source: 'slot' });
    expect(f.registrations).toContainEqual({ sessionId: 'ses_pod', projectDir: f.canonical });
    expect(f.bindings).toContainEqual({ podId, sessionId: 'ses_pod' });
  });

  test('does not adopt a dormant non-active runtime slot', async () => {
    const f = fixture();
    f.writeSlot(f.projectDir, 'ses_pi', 'pi');
    f.alive.add('ses_pi');
    const registry = new LeadSessionRegistry(f.deps());

    expect(registry.current(f.projectDir)).toBeNull();
    const ensured = await registry.ensure(f.projectDir);
    expect(ensured.sessionId).toBe('ses_created_1');
    expect(ensured.source).toBe('created');
  });

  test('reuses Pod when kv points to a dead session', async () => {
    const f = fixture();
    f.writeSlot(f.projectDir, 'ses_dead');
    const podId = f.addPod();
    f.coordination.set(podId, { sessionId: 'ses_pod' });
    f.alive.add('ses_pod');
    const registry = new LeadSessionRegistry(f.deps());

    await registry.ensure(f.projectDir);

    expect(f.created()).toBe(0);
    expect(registry.current(f.projectDir)?.sessionId).toBe('ses_pod');
    expect(f.archives).toContainEqual({ sessionId: 'ses_dead', projectDir: f.canonical });
  });

  test('creates one replacement when both kv and Pod are dead', async () => {
    const f = fixture();
    f.writeSlot(f.projectDir, 'ses_dead');
    f.addPod();
    f.coordination.set('pod_1', { sessionId: 'ses_dead_pod' });
    const registry = new LeadSessionRegistry(f.deps());

    const out = await registry.ensure(f.projectDir);

    expect(f.created()).toBe(1);
    expect(out).toMatchObject({ sessionId: 'ses_created_1', source: 'created' });
    expect(f.archives).toContainEqual({ sessionId: 'ses_dead', projectDir: f.canonical });
    expect(registry.current(f.projectDir)?.sessionId).toBe('ses_created_1');
  });

  test('archives the dead/diverged old Lead exactly once', async () => {
    const f = fixture();
    f.writeSlot(f.projectDir, 'ses_dead');
    f.addPod();
    f.coordination.set('pod_1', { sessionId: 'ses_pod' });
    f.alive.add('ses_pod');
    const registry = new LeadSessionRegistry(f.deps());

    await registry.ensure(f.projectDir);
    await registry.ensure(f.projectDir);

    expect(f.archives.filter((x) => x.sessionId === 'ses_dead')).toHaveLength(1);
  });

  test('multiple canonical-equivalent live keys without Pod conflict and create nothing', async () => {
    const f = fixture();
    const variantA = f.projectDir + path.sep;
    const variantB = f.projectDir + path.sep + '.';
    f.writeSlot(variantA, 'ses_a');
    f.writeSlot(variantB, 'ses_b');
    f.alive.add('ses_a');
    f.alive.add('ses_b');
    const registry = new LeadSessionRegistry(f.deps());

    await expect(registry.ensure(f.projectDir)).rejects.toBeInstanceOf(LeadSessionConflictError);
    expect(f.created()).toBe(0);
  });

  test('findBySessionId only matches active runtime slots', () => {
    const f = fixture();
    f.writeSlot(f.projectDir, 'ses_active');
    f.writeSlot(path.join(f.root, 'other'), 'ses_other');
    const value = f.kv.get('manager-session\u0000' + path.join(f.root, 'other'));
    f.kv.set('manager-session\u0000' + path.join(f.root, 'other'), writeManagerSlot(value, 'pi', {
      sessionId: 'ses_pi_only',
      createdAt: '2026-11-01T00:00:00.000Z',
    }));
    const registry = new LeadSessionRegistry(f.deps());

    expect(registry.findBySessionId('ses_active')).toMatchObject({ projectDir: f.canonical });
    expect(registry.findBySessionId('ses_pi_only')).toBeNull();
  });

  test('ensure is idempotent when called twice', async () => {
    const f = fixture();
    f.writeSlot(f.projectDir, 'ses_slot');
    f.alive.add('ses_slot');
    const registry = new LeadSessionRegistry(f.deps());

    const first = await registry.ensure(f.projectDir);
    const second = await registry.ensure(f.projectDir);

    expect(first.sessionId).toBe('ses_slot');
    expect(second.sessionId).toBe('ses_slot');
    expect(f.created()).toBe(0);
  });
});
