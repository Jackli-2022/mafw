import * as http from 'http';
import { DiscoveryError } from '../../../src/core/discovery/discovery-service';
import {
  handleLegacyCommand,
  handleLegacySkill,
  handleSessionDiscovery,
  handleSessionDiscoveryRefresh,
  handleSessionDiscoverySkill,
} from '../../../src/routes/session-discovery';

const snapshot = {
  sessionID: 's1',
  directory: '/proj',
  revision: 'r'.repeat(64),
  commandsRevision: 'c'.repeat(64),
  generatedAt: '2026-10-28T00:00:00.000Z',
  commands: [],
  skills: [],
  instructions: [],
  degraded: false,
  warnings: [],
};
const skill = { id: 'mafw-plan', name: 'mafw-plan', slash: false, scope: 'project' as const, contentLength: 2 };

function fakeService(over: any = {}) {
  return {
    get: jest.fn(async () => snapshot),
    refresh: jest.fn(async () => snapshot),
    loadSkill: jest.fn(async () => ({ ...skill, content: '# x' })),
    getLegacyCommands: jest.fn(async () => ({
      commands: [{ name: 'init', source: 'command' as const }],
      location: { directory: '/proj' },
      warnings: [],
    })),
    getLegacySkills: jest.fn(async () => ({
      skills: [skill],
      location: { directory: '/proj' },
      warnings: [],
    })),
    ...over,
  };
}

function mockRes() {
  const out = { status: 0, body: '', contentType: '' };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      out.status = status;
      out.contentType = headers?.['Content-Type'] ?? '';
    },
    end(body: string) { out.body = body; },
  } as unknown as http.ServerResponse;
  return { res, out };
}

describe('session discovery routes', () => {
  it('GET discovery passes directory/force and returns JSON', async () => {
    const discovery = fakeService();
    const { res, out } = mockRes();
    const handled = await handleSessionDiscovery(
      { method: 'GET', url: '/api/sessions/s1/discovery?force=1' } as any,
      res,
      { id: 's1' },
      { discovery: discovery as any },
    );

    expect(handled).toBe(true);
    expect(discovery.get).toHaveBeenCalledWith('s1', { directory: undefined, force: true });
    expect(out.status).toBe(200);
    expect(out.contentType).toBe('application/json');
    expect(JSON.parse(out.body).revision).toBe(snapshot.revision);
  });

  it('POST refresh delegates and returns the refreshed snapshot', async () => {
    const discovery = fakeService();
    const { res, out } = mockRes();
    await handleSessionDiscoveryRefresh(
      { method: 'POST', url: '/api/sessions/s1/discovery/refresh?directory=%2Fproj' } as any,
      res,
      { id: 's1' },
      { discovery: discovery as any },
    );

    expect(discovery.refresh).toHaveBeenCalledWith('s1', { directory: '/proj' });
    expect(out.status).toBe(200);
  });

  it('skill route passes decoded key and maps DiscoveryError status', async () => {
    const discovery = fakeService();
    const { res, out } = mockRes();
    await handleSessionDiscoverySkill(
      { method: 'GET', url: '/api/sessions/s1/discovery/skills/mafw-plan' } as any,
      res,
      { id: 's1', key: 'mafw-plan' },
      { discovery: discovery as any },
    );
    expect(discovery.loadSkill).toHaveBeenCalledWith('s1', 'mafw-plan', { directory: undefined, force: false });
    expect(out.status).toBe(200);

    discovery.loadSkill.mockRejectedValueOnce(new DiscoveryError(409, 'ambiguous skill name; use id'));
    const conflict = mockRes();
    await handleSessionDiscoverySkill(
      { method: 'GET', url: '/api/sessions/s1/discovery/skills/Same' } as any,
      conflict.res,
      { id: 's1', key: 'Same' },
      { discovery: discovery as any },
    );
    expect(conflict.out.status).toBe(409);
  });

  it('returns 503 when the service is unavailable', async () => {
    const { res, out } = mockRes();
    await handleSessionDiscovery(
      { method: 'GET', url: '/api/sessions/s1/discovery' } as any,
      res,
      { id: 's1' },
      { discovery: null },
    );
    expect(out.status).toBe(503);
  });

  it('legacy /command returns JSON commands and delegates directory', async () => {
    const discovery = fakeService();
    const { res, out } = mockRes();
    await handleLegacyCommand(
      { method: 'GET', url: '/command?directory=%2Fproj&force=1' } as any,
      res,
      { discovery: discovery as any },
    );

    expect(discovery.getLegacyCommands).toHaveBeenCalledWith('/proj', { force: true });
    expect(out.status).toBe(200);
    expect(out.contentType).toBe('application/json');
    expect(JSON.parse(out.body).commands[0].name).toBe('init');
  });

  it('legacy /skill returns JSON skill metadata', async () => {
    const discovery = fakeService();
    const { res, out } = mockRes();
    await handleLegacySkill(
      { method: 'GET', url: '/skill?directory=%2Fproj' } as any,
      res,
      { discovery: discovery as any },
    );

    expect(discovery.getLegacySkills).toHaveBeenCalledWith('/proj', { force: false });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).skills[0].id).toBe('mafw-plan');
  });
});
