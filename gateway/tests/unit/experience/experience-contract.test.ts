import {
  EXPERIENCE_ACTION_IDS,
  EXPERIENCE_VERSION,
  type ActionDescriptor,
} from '../../../src/experience/experience-contract';
import { projectExperienceActions } from '../../../src/experience/experience-projector';
import { handleExperienceActions } from '../../../src/routes/experience-actions';
import * as http from 'http';

function fakeAccess(over: Partial<Record<string, boolean>> = {}) {
  return { can: (id: string) => over[id] ?? false } as any;
}

describe('Experience contract', () => {
  it('declares the initial action set and version', () => {
    expect(EXPERIENCE_VERSION).toBe('2026.11.0');
    expect(EXPERIENCE_ACTION_IDS).toEqual([
      'checkpoint.restore', 'prompt.steer', 'session.background', 'mcp.manage', 'mcp.config.write',
    ]);
  });

  it('projects unsupported actions explicitly, never as silently enabled', () => {
    const actions = projectExperienceActions(fakeAccess(), { sessionID: 's1' });
    for (const id of EXPERIENCE_ACTION_IDS) {
      expect(actions[id]).toMatchObject<Partial<ActionDescriptor>>({ enabled: false, reason: 'unsupported' });
    }
  });

  it('marks checkpoint restore busy when the session is running', () => {
    const access = { can: (id: string) => id === 'branch.checkpoint', semantics: () => ({}) } as any;
    const actions = projectExperienceActions(access, { sessionID: 's1', busy: true });
    expect(actions['checkpoint.restore']).toMatchObject({ enabled: false, reason: 'busy' });
  });

  it('projects MCP actions only when all required surfaces exist', () => {
    const access = {
      can: (id: string) => ['mcp.list', 'mcp.connect', 'mcp.disconnect', 'mcp.config.preview', 'mcp.config.apply', 'mcp.config.remove', 'mcp.config.restore'].includes(id),
      semantics: (id: string) => id === 'mcp.list' ? { authCommandTemplate: 'opencode mcp auth {name}' } : {},
    } as any;
    const actions = projectExperienceActions(access, {});
    expect(actions['mcp.manage'].enabled).toBe(true);
    expect(actions['mcp.manage'].semantics?.authCommandTemplate).toBe('opencode mcp auth {name}');
    expect(actions['mcp.config.write'].enabled).toBe(true);
  });

  it('projects background only when the neutral surface exists', () => {
    const access = {
      can: (id: string) => id === 'session.background',
      semantics: () => ({}),
    } as any;
    expect(projectExperienceActions(access, { sessionID: 's1' })['session.background'])
      .toEqual({ enabled: true });
  });

  it('projects steer boundary from adapter semantics', () => {
    const access = {
      can: (id: string) => id === 'prompt.delivery.steer',
      semantics: (id: string) => id === 'prompt.delivery.steer' ? { boundary: 'tool' } : {},
    } as any;
    const actions = projectExperienceActions(access, { sessionID: 's1' });
    expect(actions['prompt.steer']).toEqual({
      enabled: true,
      semantics: { boundary: 'tool', queue: true },
    });
  });
});

describe('GET /api/experience/actions', () => {
  it('returns version, session id and projected actions', async () => {
    const out: any = { status: 0, body: null };
    const res = {
      writeHead(status: number) { out.status = status; },
      end(body: string) { out.body = JSON.parse(body); },
    } as unknown as http.ServerResponse;
    const handled = await handleExperienceActions(
      { method: 'GET' } as http.IncomingMessage,
      res,
      '/api/experience/actions?sessionID=s1',
      { project: (ctx) => projectExperienceActions(fakeAccess(), ctx) },
    );
    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body.experienceVersion).toBe(EXPERIENCE_VERSION);
    expect(out.body.sessionID).toBe('s1');
    expect(Object.keys(out.body.actions)).toHaveLength(EXPERIENCE_ACTION_IDS.length);
  });
});
