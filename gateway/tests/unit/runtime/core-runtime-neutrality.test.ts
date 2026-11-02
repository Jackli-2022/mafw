// Task 6：gateway core 的中性能力门与 runtime 私有知识清理（设计 §7.1 / §7.2）。
//
// 断言四件事：
//   1. discovery / instructions / media 的能力门读 RuntimeAccess surface，不读裸 capabilities；
//   2. 快照树存储布局（opencode ~/.local/share/opencode/snapshot）只存在于 adapter；
//   3. manager session 归属只看显式 runtime 标签，不按 session id 前缀猜；
//   4. 组合根诊断信息由 RuntimeDiagnostics 视图提供。
import * as fs from 'fs';
import * as path from 'path';
import { DiscoveryService } from '../../../src/core/discovery/discovery-service';
import {
  canInstructionSync,
  InstructionSyncService,
} from '../../../src/core/instructions/instruction-sync-service';
import { canDiscovery } from '../../../src/core/discovery/discovery-service';
import {
  canCompletionChannel,
  canMediaSession,
  createMediaRuntimeExecutor,
} from '../../../src/media/media-runtime-executor';
import {
  resolveManagerRuntime,
  readManagerSlot,
  writeManagerSlot,
} from '../../../src/core/manager/manager-session-runtime';
import {
  computeTurnDiff,
  computeTurnDiffForRuntime,
  TurnDiffUnavailableError,
  type GitRunner,
} from '../../../src/core/diff/turn-diff';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';
import { buildRuntimeDiagnostics } from '../../../src/runtime/runtime-diagnostics';
import { createRuntimeFacade } from '../../../src/runtime/runtime-facade';

const ROOT = path.resolve(__dirname, '..', '..', '..');

/** access 的 can() 契约子集：未列出的 surface 一律 false（与 RuntimeAccess 的缺失面一致）。 */
function fakeAccess(over: Record<string, boolean> = {}) {
  return { can: (id: string) => over[id] ?? false };
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** 去掉注释再扫（文档允许解释被删掉的旧写法）。 */
function codeOf(rel: string): string {
  return readSource(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);

const PATCH = [
  'diff --git a/x.txt b/x.txt',
  '--- a/x.txt',
  '+++ b/x.txt',
  '@@ -1,2 +1,2 @@',
  ' a',
  '-b',
  '+c',
  '',
].join('\n');

describe('core capability gates use RuntimeAccess surfaces', () => {
  it('discovery/instructions/media read surfaces, not raw capabilities', () => {
    const denied = fakeAccess({
      'discovery.list': false,
      'discovery.loadSkill': false,
      'session.instructions.list': false,
      'session.instructions.put': false,
      'session.instructions.remove': false,
      'media.session': false,
    });
    expect(canDiscovery(denied)).toBe(false);
    expect(canInstructionSync(denied)).toBe(false);
    expect(canMediaSession(denied)).toBe(false);
    expect(canCompletionChannel(denied)).toBe(false);

    const allowed = fakeAccess({
      'discovery.list': true,
      'session.instructions.list': true,
      'session.instructions.put': true,
      'session.instructions.remove': true,
      'media.session': true,
    });
    expect(canDiscovery(allowed)).toBe(true);
    expect(canInstructionSync(allowed)).toBe(true);
    expect(canMediaSession(allowed)).toBe(true);
    expect(canCompletionChannel(fakeAccess({ 'completion.channel': true }))).toBe(true);

    // 缺任一条写面都不算可同步（服务确实会 list + put + remove）。
    expect(canInstructionSync(fakeAccess({
      'session.instructions.list': true,
      'session.instructions.put': true,
    }))).toBe(false);

    // 无 access（未接线）不是「默认允许」。
    expect(canDiscovery(null)).toBe(false);
    expect(canInstructionSync(undefined)).toBe(false);
    expect(canMediaSession(null)).toBe(false);
    expect(canCompletionChannel(undefined)).toBe(false);
  });

  it('discovery service degrades honestly when discovery.list is denied (no runtime call)', async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(require('os').tmpdir(), 'mafw-neutral-disc-')));
    const list = jest.fn(async () => ({ commands: [{ name: 'init' }], skills: [], warnings: [] }));
    const rt: any = { name: 'any-runtime', capabilities: { discoveryApi: true }, discovery: { list, loadSkill: jest.fn() } };
    const svc = new DiscoveryService({
      getRuntime: () => rt,
      getAccess: () => fakeAccess({ 'discovery.list': false, 'discovery.loadSkill': false }) as any,
      getMafwCommands: () => [],
      resolveDirectory: async (_sid, provided) => provided ?? dir,
      broadcast: jest.fn(),
      gatewayProjectDir: dir,
      mafwDir: path.join(dir, '.mafw'),
      homeDir: dir,
      globalConfigDir: path.join(dir, '.config', 'opencode'),
      discoverAgents: () => ({ instructions: [], warnings: [] }),
      now: () => 0,
    });
    const snap = await svc.get('s1', { directory: dir });
    expect(snap.degraded).toBe(true);
    expect(snap.degradedReason).toBe('capability_absent');
    expect(list).not.toHaveBeenCalled();
    await expect(svc.loadSkill('s1', 'init', { directory: dir })).rejects.toMatchObject({ status: 503 });
  });

  it('instruction sync is disabled by the surfaces and never touches the runtime', async () => {
    const list = jest.fn(async () => []);
    const put = jest.fn(async () => {});
    const rt: any = {
      name: 'any-runtime',
      capabilities: { instructionsApi: true },
      session: { instructions: { list, put, remove: jest.fn() } },
    };
    const svc = new InstructionSyncService({
      render: async () => ({ revision: 'r1' }),
      getRuntime: () => rt,
      getAccess: () => fakeAccess({ 'session.instructions.list': false }) as any,
      isEnabled: () => true,
      log: { info: jest.fn(), warn: jest.fn() },
    });
    expect(await svc.sync('s1')).toEqual({ managed: false, error: 'capability_absent' });
    expect(list).not.toHaveBeenCalled();
    expect((await svc.inspect('s1', { revision: 'r1' })).reason).toBe('capability_absent');
  });

  it('media sessions are created through the mediaSession channel, not session.create', async () => {
    const created: any[] = [];
    const sessionCreate = jest.fn(async () => ({ id: 'wrong' }));
    const rt: any = {
      name: 'any-runtime',
      capabilities: {},
      mediaSession: { create: async (o: any) => { created.push(o); return { id: 'media-1' }; } },
      session: {
        create: sessionCreate,
        promptAsync: jest.fn(async () => {}),
        messages: async () => ({
          data: [{ id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'a cat' }] }],
        }),
        abort: jest.fn(async () => {}),
        delete: jest.fn(async () => {}),
      },
    };
    const executor = createMediaRuntimeExecutor(rt, { projectDir: '/tmp/proj' });
    const out = await executor.prompt(
      [
        { type: 'file', url: 'data:image/png;base64,AAAA', mime: 'image/png' },
        { type: 'text', text: 'what?' },
      ],
      { providerID: 'p', modelID: 'm' },
    );
    expect(out).toBe('a cat');
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(created).toEqual([{ directory: '/tmp/proj' }]);
  });

  it('media executor fails loudly (no fake session fallback) when the channel is absent', async () => {
    const sessionCreate = jest.fn(async () => ({ id: 's1' }));
    const rt: any = {
      name: 'any-runtime',
      capabilities: {},
      session: { create: sessionCreate, promptAsync: jest.fn(), messages: jest.fn(), abort: jest.fn(), delete: jest.fn() },
    };
    const executor = createMediaRuntimeExecutor(rt, { projectDir: '/tmp/proj' });
    await expect(executor.prompt(
      [{ type: 'file', url: 'data:image/png;base64,AAAA', mime: 'image/png' }],
      { providerID: 'p', modelID: 'm' },
    )).rejects.toThrow(/media\.session/);
    expect(sessionCreate).not.toHaveBeenCalled();
  });
});

describe('turn diff knows no runtime-private storage layout', () => {
  it('turn-diff source has no opencode snapshot path knowledge', () => {
    const code = codeOf('src/core/diff/turn-diff.ts');
    expect(code).not.toMatch(/\.local\/share\/opencode|opencode\/snapshot|MAFW_OPENCODE_SNAPSHOT_ROOT|defaultSnapshotRoot/);
    expect(code).not.toContain('homedir');
  });

  it('computeTurnDiff asks the adapter channel to locate snapshot trees', async () => {
    const locate = jest.fn(async () => '/snapshots/proj/repo');
    const git: GitRunner = {
      async run(args) {
        expect(args).toContain('/snapshots/proj/repo');
        return { code: 0, stdout: PATCH, stderr: '' };
      },
    };
    const files = await computeTurnDiff({
      messages: [
        { id: 'u1', role: 'user', time: { created: 1 } },
        { id: 'a1', role: 'assistant', time: { created: 2 }, snapshot: { start: H1, end: H2 } },
      ],
      messageID: 'u1',
      projectID: 'proj',
      locate,
      git,
    });
    expect(locate).toHaveBeenCalledWith({ projectID: 'proj', start: H1, end: H2 });
    expect(files).toEqual([
      { file: 'x.txt', patch: PATCH, additions: 1, deletions: 1, status: 'modified' },
    ]);
  });

  it('per-turn diff is honestly unavailable when the runtime has no snapshotTree channel', async () => {
    const runtime: any = {
      session: {
        get: async () => ({ projectID: 'p' }),
        messages: async () => ({ data: [] }),
      },
    };
    await expect(computeTurnDiffForRuntime(runtime, 's1', 'u1')).rejects.toBeInstanceOf(TurnDiffUnavailableError);
  });
});

describe('manager session ownership is explicit', () => {
  it('resolveManagerRuntime returns the explicit tag or null — never id-prefix inference', () => {
    expect(resolveManagerRuntime({ id: 'pi_123' })).toBeNull();
    expect(resolveManagerRuntime({ id: 'ses_123' })).toBeNull();
    expect(resolveManagerRuntime({ id: 'pi_123', runtime: 'pi' })).toBe('pi');
    expect(resolveManagerRuntime({ runtime: '  ' })).toBeNull();
  });

  it('legacy v1 entries without a runtime tag stay dormant (never guessed)', () => {
    expect(readManagerSlot({ sessionId: 'pi_9f2c' }, 'pi')).toBeNull();
    expect(readManagerSlot({ sessionId: 'ses_f60d' }, 'opencode')).toBeNull();
    expect(readManagerSlot({ sessionId: 'x', runtime: 'pi' }, 'pi')).toEqual({ sessionId: 'x' });
  });

  it('write preserves unattributed legacy entries instead of dropping or guessing them', () => {
    const out = writeManagerSlot({ sessionId: 'pi_9f2c' }, 'opencode', { sessionId: 'ses_new' });
    expect(out.byRuntime).toEqual({ opencode: { sessionId: 'ses_new' } });
    expect(out.unattributed).toEqual({ sessionId: 'pi_9f2c' });
    // A tagged legacy entry migrates into its own slot.
    const tagged = writeManagerSlot({ sessionId: 'x', runtime: 'pi' }, 'opencode', { sessionId: 'ses_new' });
    expect(tagged.byRuntime).toEqual({ pi: { sessionId: 'x' }, opencode: { sessionId: 'ses_new' } });
  });
});

describe('runtime diagnostics view', () => {
  it('exposes name/capabilities/activeDialect for the composition root only', () => {
    const caps = { sessionApi: true };
    const view = buildRuntimeDiagnostics({ name: 'any-runtime', capabilities: caps as any, activeDialect: 'v21' })!;
    expect(view).toEqual({ name: 'any-runtime', capabilities: caps, activeDialect: 'v21' });
    expect(view.capabilities).not.toBe(caps); // copy, not a live alias
    expect(buildRuntimeDiagnostics(null)).toBeNull();
  });

  it('reflects an adaptive dialect probe that lands after facade creation', async () => {
    const raw: any = { name: 'adaptive', capabilities: { sessionApi: true }, session: {} };
    const facade = await createRuntimeFacade(raw, { entry: {}, isCanonical: () => false });
    const view = buildRuntimeDiagnostics(facade)!;
    // 探测前：/api/runtime 不再读到快照里的 null。
    expect(view.activeDialect).toBeUndefined();
    raw.activeDialect = 'v21'; // resolveEventEntry / rewire 之后写入
    expect(view.activeDialect).toBe('v21');
    // facade 自身也保持同一实时值（诊断视图经 getter 读取）。
    expect(facade.activeDialect).toBe('v21');
  });

  it('capabilities are read live (post-activation downgrade is visible)', () => {
    const caps: any = { sessionApi: true, completionApi: true };
    const view = buildRuntimeDiagnostics({ name: 'any-runtime', capabilities: caps })!;
    expect(view.capabilities.completionApi).toBe(true);
    caps.completionApi = false; // 激活期能力降级写回
    expect(view.capabilities.completionApi).toBe(false);
    expect(view.capabilities).not.toBe(caps); // still a copy per read
  });
});

describe('contract surfaces and composition-root wiring', () => {
  const manifest = buildRuntimeContractManifest();
  const surface = (id: string) => manifest.surfaces.find((s) => s.id === id);

  it('declares media.session and session.snapshotTree as presence-probed optional channels', () => {
    expect(surface('media.session')).toMatchObject({
      direction: 'gateway->runtime',
      domain: 'media',
      obligation: 'optional',
      verification: 'presence',
      probe: ['mediaSession', 'create'],
    });
    expect(surface('session.snapshotTree')).toMatchObject({
      domain: 'branch',
      obligation: 'optional',
      verification: 'presence',
      probe: ['snapshotTree', 'locate'],
    });
    expect(surface('completion.channel')).toMatchObject({
      domain: 'process',
      obligation: 'optional',
      verification: 'presence',
      probe: ['completion', 'complete'],
    });
  });

  it('only pi declares the media.session carrier (opencode keeps stateless completion)', () => {
    expect(codeOf('src/runtime/opencode-adapter.ts')).not.toContain('mediaSession');
    expect(codeOf('src/runtime/opencode-runtime.ts')).not.toContain('mediaSession');
    expect(codeOf('src/runtime/plugins/pi-runtime.ts')).toContain('mediaSession');
  });

  it('index.ts picks the media executor by surface, not by runtime name', () => {
    const code = codeOf('src/index.ts');
    expect(code).toContain("can('media.session')");
    expect(code).not.toMatch(/name\s*===\s*'pi'/);
  });

  it('policy service no longer takes a runtime name argument', () => {
    const code = codeOf('src/core/approval/policy-service.ts');
    expect(code).not.toContain('runtimeName');
  });

  it('manager slot helpers do not infer owners from session id prefixes', () => {
    const code = codeOf('src/core/manager/manager-session-runtime.ts');
    expect(code).not.toMatch(/startsWith\('pi_'\)|startsWith\('ses_'\)/);
  });
});
