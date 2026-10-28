import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DiscoveryError, DiscoveryService, type DiscoveryServiceDeps } from '../../../../src/core/discovery/discovery-service';

function tempDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-discovery-')));
}

function fakeRuntime(over: any = {}) {
  return {
    capabilities: { discoveryApi: true },
    discovery: {
      list: jest.fn(async () => ({ commands: [{ name: 'init', description: 'i' }], skills: [], warnings: [] })),
      loadSkill: jest.fn(async () => null),
    },
    session: { get: jest.fn(async () => ({ directory: tempDir() })) },
    ...over,
  };
}

function deps(over: Partial<DiscoveryServiceDeps> & { runtime?: any; discoverAgents?: any; now?: () => number } = {}): DiscoveryServiceDeps {
  const dir = tempDir();
  const mafwDir = path.join(dir, '.mafw');
  const runtime = over.runtime ?? fakeRuntime();
  return {
    getRuntime: () => runtime,
    getMafwCommands: () => [{ name: 'goal', description: 'g', category: 'goals', kind: 'builtin' } as any],
    resolveDirectory: async (_sessionID, provided) => provided ?? dir,
    broadcast: jest.fn(),
    gatewayProjectDir: dir,
    mafwDir,
    homeDir: dir,
    globalConfigDir: path.join(dir, '.config/opencode'),
    discoverAgents: () => ({ instructions: [], warnings: [] }),
    now: () => 0,
    ...over,
  } as DiscoveryServiceDeps;
}

describe('DiscoveryService', () => {
  it('merges MAFW + runtime, caches by directory, force bypasses', async () => {
    const rt = fakeRuntime();
    const svc = new DiscoveryService(deps({ runtime: rt }));
    const a = await svc.get('s1', { directory: (rt as any).session.get ? undefined : undefined });
    const b = await svc.get('s2', { directory: a.directory });

    expect(a.revision).toBe(b.revision);
    expect(rt.discovery.list).toHaveBeenCalledTimes(1);
    await svc.get('s1', { directory: a.directory, force: true });
    expect(rt.discovery.list).toHaveBeenCalledTimes(2);
  });

  it('partial runtime failure keeps successful side', async () => {
    const rt = fakeRuntime();
    rt.discovery.list.mockResolvedValueOnce({
      commands: [{ name: 'init' }],
      skills: [],
      warnings: [{ source: 'skills', message: 'down' }],
    });
    const svc = new DiscoveryService(deps({ runtime: rt }));
    const snap = await svc.get('s1', { directory: tempDir() });

    expect(snap.degraded).toBe(true);
    expect(snap.degradedReason).toBe('partial');
    expect(snap.warnings.some((w) => w.source === 'skills')).toBe(true);
  });

  it('pi capability absence is degraded but cached 30s (no 5s rescan)', async () => {
    const dir = tempDir();
    let now = 0;
    const discoverAgents = jest.fn(() => ({ instructions: [], warnings: [] }));
    const rt = fakeRuntime({ capabilities: { discoveryApi: false }, discovery: undefined });
    const svc = new DiscoveryService(deps({ runtime: rt, discoverAgents, now: () => now, resolveDirectory: async () => dir }));

    const a = await svc.get('s1');
    expect(a.degradedReason).toBe('capability_absent');
    now = 10_000;
    await svc.get('s1');
    expect(discoverAgents).toHaveBeenCalledTimes(1);
    now = 31_000;
    await svc.get('s1');
    expect(discoverAgents).toHaveBeenCalledTimes(2);
  });

  it('loadSkill maps 404 / 409 / 413 / 503', async () => {
    const dir = tempDir();
    const rt = fakeRuntime();
    rt.discovery.list.mockResolvedValue({
      commands: [],
      skills: [
        { id: 'a', name: 'Same', contentLength: 2 },
        { id: 'b', name: 'Same', contentLength: 2 },
      ],
      warnings: [],
    });
    rt.discovery.loadSkill.mockResolvedValue({ id: 'a', name: 'Same', contentLength: 2, content: 'ok' });
    const svc = new DiscoveryService(deps({ runtime: rt }));

    await expect(svc.loadSkill('s1', 'nope', { directory: dir })).rejects.toMatchObject({ status: 404 });
    await expect(svc.loadSkill('s1', 'Same', { directory: dir })).rejects.toMatchObject({ status: 409 });
    expect((await svc.loadSkill('s1', 'a', { directory: dir })).content).toBe('ok');

    rt.discovery.loadSkill.mockResolvedValueOnce({
      id: 'a', name: 'Same', contentLength: 512 * 1024 + 1, content: 'x'.repeat(512 * 1024 + 1),
    });
    await expect(svc.loadSkill('s1', 'a', { directory: dir, force: true })).rejects.toMatchObject({ status: 413 });

    const noRuntime = new DiscoveryService(deps({ runtime: fakeRuntime({ capabilities: { discoveryApi: false }, discovery: undefined }) }));
    await expect(noRuntime.loadSkill('s1', 'a', { directory: dir })).rejects.toMatchObject({ status: 503 });
  });

  it('legacy commands are runtime-only and exclude MAFW names/aliases', async () => {
    const dir = tempDir();
    const rt = fakeRuntime();
    rt.discovery.list.mockResolvedValue({
      commands: [{ name: 'goal' }, { name: 'init', description: 'i' }],
      skills: [{ id: 'a', name: 'A', location: path.join(dir, 'a/SKILL.md'), contentLength: 2 }],
      warnings: [],
    });
    const svc = new DiscoveryService(deps({ runtime: rt }));

    const commands = await svc.getLegacyCommands(dir);
    expect(commands.commands).toEqual([{ name: 'init', description: 'i', source: 'command' }]);
    const skills = await svc.getLegacySkills(dir);
    expect(skills.skills[0]).toMatchObject({ id: 'a', name: 'A', scope: 'project' });
  });

  it('broadcastKnown emits session.commands with commands only and forget removes the session', async () => {
    const dir = tempDir();
    const broadcast = jest.fn();
    const svc = new DiscoveryService(deps({ broadcast }));
    await svc.get('s1', { directory: dir });

    await svc.broadcastKnown('commands_changed');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session.commands',
      sessionID: 's1',
      properties: expect.objectContaining({
        sessionID: 's1',
        reason: 'commands_changed',
        commands: expect.any(Array),
      }),
    }));

    broadcast.mockClear();
    svc.forget('s1');
    await svc.broadcastKnown('commands_changed');
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('rejects a relative directory with DiscoveryError 400', async () => {
    const svc = new DiscoveryService(deps());
    await expect(svc.get('s1', { directory: 'relative' })).rejects.toBeInstanceOf(DiscoveryError);
    await expect(svc.get('s1', { directory: 'relative' })).rejects.toMatchObject({ status: 400 });
  });
});
