import {
  EXPERIENCE_ACTION_IDS,
  EXPERIENCE_VERSION,
  MIN_CLIENT_EXPERIENCE_VERSION,
  action,
  type ActionDescriptor,
  type ExperienceActionId,
} from '../../../src/experience/experience-contract';
import {
  EXPERIENCE_ACTION_SURFACES,
  projectExperienceActions,
} from '../../../src/experience/experience-projector';
import { handleExperienceActions } from '../../../src/routes/experience-actions';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';
import * as http from 'http';

/** 当前 manifest 的真实 surface 集合：fake 不得凭空点亮未声明的 surface。 */
const MANIFEST_SURFACES = new Set(buildRuntimeContractManifest().surfaces.map((s) => s.id));

/** 中性 PTY surface 由 terminal 任务加入 manifest；在此之前 attach 必须 unsupported。 */
const PENDING_SURFACES = new Set(['terminal.pty']);

function semanticsOf(access: any, id: string): Record<string, unknown> {
  return (access.semantics?.(id) ?? {}) as Record<string, unknown>;
}

function fakeAccess(over: Partial<Record<string, boolean>> = {}) {
  return {
    can: (id: string) => over[id] ?? false,
    semantics: (id: string) => semanticsOf({}, id),
  } as any;
}

function fakeAccessAll() {
  return {
    can: (id: string) => MANIFEST_SURFACES.has(id),
    semantics: () => ({}),
  } as any;
}

const SAMPLE_SEMANTIC_SURFACES = new Set(['branch.revert', 'prompt.delivery.steer', 'mcp.list']);

function fakeAccessWithSemantics(over: Partial<Record<string, boolean>>, semantics: Record<string, unknown>) {
  return {
    can: (id: string) => over[id] ?? false,
    semantics: (id: string) => (SAMPLE_SEMANTIC_SURFACES.has(id) ? semantics : {}),
  } as any;
}

describe('Experience contract', () => {
  it('declares the v2 action set and version', () => {
    expect(EXPERIENCE_VERSION).toBe('2026.11.1');
    expect(MIN_CLIENT_EXPERIENCE_VERSION).toBe('2026.11.0');
    expect(EXPERIENCE_ACTION_IDS).toEqual([
      'checkpoint.restore',
      'checkpoint.create',
      'branch.fork',
      'branch.revert',
      'branch.unrevert',
      'branch.diff',
      'run.control',
      'session.worktree',
      'session.summarize',
      'session.switch-agent',
      'session.switch-model',
      'session.discovery',
      'approval.permission',
      'approval.question',
      'background.jobs',
      'terminal.attach',
      'prompt.steer',
      'session.background',
      'mcp.manage',
      'mcp.config.write',
    ]);
    expect(new Set(EXPERIENCE_ACTION_IDS).size).toBe(20);
  });

  it('normalizes the supported/enabled invariant through the action helper', () => {
    expect(action(true, true)).toEqual({ supported: true, enabled: true });
    expect(action(true, false, 'busy')).toEqual({ supported: true, enabled: false, reason: 'busy' });
    // enabled=true 必须 supported=true；supported=false 一律 unsupported。
    expect(action(false, true)).toEqual({ supported: false, enabled: false, reason: 'unsupported' });
    expect(action(false, false, 'busy')).toEqual({ supported: false, enabled: false, reason: 'unsupported' });
    expect(action(true, true, 'busy')).toEqual({ supported: true, enabled: true });
    expect(action(true, true, undefined, { files: true })).toEqual({
      supported: true,
      enabled: true,
      semantics: { files: true },
    });
    expect(action(true, true, undefined, {})).toEqual({ supported: true, enabled: true });
  });

  it('supported/enabled invariant and all action ids project', () => {
    const actions = projectExperienceActions(fakeAccessAll(), { busy: true });
    expect(Object.keys(actions).sort()).toEqual([...EXPERIENCE_ACTION_IDS].sort());
    for (const a of Object.values(actions)) {
      if (!a.supported) expect(a.enabled).toBe(false);
      if (a.enabled) expect(a.supported).toBe(true);
    }
    expect(actions['run.control']).toMatchObject({ supported: true, enabled: false, reason: 'busy' });
    expect(actions['branch.fork'].supported).toBe(true);
    expect(actions['branch.fork'].enabled).toBe(false);
  });

  it('unsupported and busy are distinct', () => {
    const noAccess = projectExperienceActions(null, { busy: false });
    expect(noAccess['branch.fork']).toEqual({ supported: false, enabled: false, reason: 'unsupported' });

    const busy = projectExperienceActions(fakeAccessAll(), { busy: true });
    expect(busy['branch.fork']).toEqual({ supported: true, enabled: false, reason: 'busy' });
  });

  it('projects unsupported actions explicitly, never as silently enabled', () => {
    const actions = projectExperienceActions(fakeAccess(), { sessionID: 's1' });
    for (const id of EXPERIENCE_ACTION_IDS) {
      // 纯本地动作没有 runtime surface 依赖，不受「无能力」影响。
      if (EXPERIENCE_ACTION_SURFACES[id].length === 0) continue;
      expect(actions[id]).toEqual<ActionDescriptor>({ supported: false, enabled: false, reason: 'unsupported' });
    }
    expect(actions['background.jobs']).toMatchObject({ supported: true, enabled: true });
  });

  it('keeps read-only and busy-only actions enabled while a turn is running', () => {
    const actions = projectExperienceActions(fakeAccessAll(), { sessionID: 's1', busy: true });
    for (const id of [
      'branch.diff',
      'session.discovery',
      'session.switch-agent',
      'session.switch-model',
      'session.worktree',
      'approval.permission',
      'approval.question',
      'background.jobs',
      'prompt.steer',
      'session.background',
      'mcp.manage',
      'mcp.config.write',
    ] as ExperienceActionId[]) {
      expect(actions[id].supported).toBe(true);
      expect(actions[id].enabled).toBe(true);
      expect(actions[id].reason).toBeUndefined();
    }
  });

  it('blocks only mutations that need an idle session', () => {
    const actions = projectExperienceActions(fakeAccessAll(), { busy: true });
    for (const id of [
      'checkpoint.restore',
      'checkpoint.create',
      'branch.fork',
      'branch.revert',
      'branch.unrevert',
      'run.control',
      'session.summarize',
    ] as ExperienceActionId[]) {
      expect(actions[id]).toMatchObject({ supported: true, enabled: false, reason: 'busy' });
    }
  });

  it('marks checkpoint restore busy but keeps server-backed semantics', () => {
    const access = {
      can: (id: string) => id === 'branch.checkpoint' || id === 'branch.revert',
      semantics: (id: string) => (id === 'branch.revert' ? { files: true, undo: true } : {}),
    } as any;
    const actions = projectExperienceActions(access, { sessionID: 's1', busy: true });
    expect(actions['checkpoint.restore']).toMatchObject({ supported: true, enabled: false, reason: 'busy' });
    expect(actions['checkpoint.restore'].semantics).toEqual({ sessionBacked: true, files: true, undo: true });
  });

  it('projects branch semantics from the adapter', () => {
    const access = fakeAccessWithSemantics({ 'branch.revert': true }, { files: false, undo: true });
    const actions = projectExperienceActions(access, {});
    expect(actions['branch.revert']).toEqual({
      supported: true,
      enabled: true,
      semantics: { files: false, undo: true },
    });
  });

  it('projects run control verbs and requires busy for suspend', () => {
    const actions = projectExperienceActions(fakeAccessAll(), {});
    expect(actions['run.control']).toEqual({
      supported: true,
      enabled: true,
      semantics: { suspend: true, resume: true, discard: true, requireBusy: true },
    });
  });

  it('projects discovery, worktree and checkpoint create from their own surfaces', () => {
    const only = (id: string) => fakeAccess({ [id]: true });
    expect(projectExperienceActions(only('discovery.list'), {})['session.discovery'].supported).toBe(true);
    expect(projectExperienceActions(only('session.worktree'), {})['session.worktree'].supported).toBe(true);
    expect(projectExperienceActions(only('session.summarize'), {})['session.summarize'].supported).toBe(true);
    expect(projectExperienceActions(only('branch.checkpoint'), {})['checkpoint.create'].supported).toBe(true);
    expect(projectExperienceActions(only('discovery.list'), {})['session.worktree'].supported).toBe(false);
  });

  it('requires the patch surface for diff review, not just the diff reader', () => {
    const readOnly = fakeAccess({ 'branch.diff': true });
    expect(projectExperienceActions(readOnly, {})['branch.diff']).toMatchObject({ supported: false });
    const full = fakeAccess({ 'branch.diff': true, 'branch.vcs': true });
    expect(projectExperienceActions(full, {})['branch.diff']).toMatchObject({ supported: true, enabled: true });
  });

  it('treats MAFW tasks as a local background source without a runtime surface', () => {
    const actions = projectExperienceActions(fakeAccess(), { sessionID: 's1' });
    expect(actions['background.jobs'].supported).toBe(true);
    expect(actions['background.jobs'].enabled).toBe(true);
    expect(actions['background.jobs'].semantics?.sources).toEqual(['mafw-task']);
  });

  it('never fakes a terminal when no neutral PTY surface exists', () => {
    const actions = projectExperienceActions(fakeAccessAll(), {});
    expect(actions['terminal.attach']).toEqual({ supported: false, enabled: false, reason: 'unsupported' });
  });

  it('only references declared runtime surfaces (pending protocol excepted)', () => {
    for (const [id, surfaces] of Object.entries(EXPERIENCE_ACTION_SURFACES)) {
      for (const surface of surfaces) {
        if (PENDING_SURFACES.has(surface)) continue;
        expect({ id, surface, declared: MANIFEST_SURFACES.has(surface) }).toEqual({
          id,
          surface,
          declared: true,
        });
      }
    }
  });

  it('projects MCP actions only when all required surfaces exist', () => {
    const access = {
      can: (id: string) =>
        ['mcp.list', 'mcp.connect', 'mcp.disconnect', 'mcp.config.preview', 'mcp.config.apply', 'mcp.config.remove', 'mcp.config.restore'].includes(id),
      semantics: (id: string) => (id === 'mcp.list' ? { authCommandTemplate: 'opencode mcp auth {name}' } : {}),
    } as any;
    const actions = projectExperienceActions(access, {});
    expect(actions['mcp.manage']).toMatchObject({ supported: true, enabled: true });
    expect(actions['mcp.manage'].semantics?.authCommandTemplate).toBe('opencode mcp auth {name}');
    expect(actions['mcp.config.write']).toMatchObject({ supported: true, enabled: true });
    // 缺一个 surface 就整体不支持，避免半可用配置面。
    const partial = projectExperienceActions({ can: (id: string) => id !== 'mcp.config.restore', semantics: () => ({}) } as any, {});
    expect(partial['mcp.config.write']).toEqual({ supported: false, enabled: false, reason: 'unsupported' });
  });

  it('projects background only when the neutral surface exists', () => {
    const access = {
      can: (id: string) => id === 'session.background',
      semantics: () => ({}),
    } as any;
    expect(projectExperienceActions(access, { sessionID: 's1' })['session.background'])
      .toEqual({ supported: true, enabled: true });
  });

  it('projects steer boundary from adapter semantics', () => {
    const access = {
      can: (id: string) => id === 'prompt.delivery.steer',
      semantics: (id: string) => (id === 'prompt.delivery.steer' ? { boundary: 'tool' } : {}),
    } as any;
    const actions = projectExperienceActions(access, { sessionID: 's1' });
    expect(actions['prompt.steer']).toEqual({
      supported: true,
      enabled: true,
      semantics: { boundary: 'tool', queue: true },
    });
  });
});

describe('GET /api/experience/actions', () => {
  it('returns version, min client version, session id and all projected actions', async () => {
    const out: any = { status: 0, body: null };
    const res = {
      writeHead(status: number) { out.status = status; },
      end(body: string) { out.body = JSON.parse(body); },
    } as unknown as http.ServerResponse;
    const handled = await handleExperienceActions(
      { method: 'GET' } as http.IncomingMessage,
      res,
      '/api/experience/actions?sessionID=s1',
      { project: (ctx) => projectExperienceActions(fakeAccessAll(), ctx) },
    );
    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body.experienceVersion).toBe(EXPERIENCE_VERSION);
    expect(out.body.minClientVersion).toBe(MIN_CLIENT_EXPERIENCE_VERSION);
    expect(out.body.sessionID).toBe('s1');
    expect(Object.keys(out.body.actions)).toHaveLength(EXPERIENCE_ACTION_IDS.length);
    for (const id of EXPERIENCE_ACTION_IDS) {
      expect(out.body.actions[id]).toHaveProperty('supported');
      expect(out.body.actions[id]).toHaveProperty('enabled');
    }
  });
});
