import * as http from 'http';
import { Readable } from 'stream';
import { DiscoveryError } from '../../../src/core/discovery/discovery-service';
import {
  handleSessionDiscovery,
  handleSessionDiscoveryRefresh,
  handleSessionDiscoverySkill,
  handleSessionDiscoverySkillInvoke,
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

  it('skill invoke route forwards args and maps DiscoveryError status', async () => {
    const discovery = fakeService({
      invokeSkill: jest.fn(async () => ({ ok: true, skill: 'superpowers' })),
    });
    const { res, out } = mockRes();
    const req = Object.assign(
      Readable.from([JSON.stringify({ args: 'x' })]),
      { method: 'POST', url: '/api/sessions/s1/discovery/skills/superpowers/invoke?directory=%2Fproj' },
    );
    await handleSessionDiscoverySkillInvoke(
      req as any,
      res,
      { id: 's1', key: 'superpowers' },
      { discovery: discovery as any },
    );
    expect(discovery.invokeSkill).toHaveBeenCalledWith('s1', 'superpowers', 'x', {
      directory: '/proj',
      force: false,
    });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true, skill: 'superpowers' });

    discovery.invokeSkill.mockRejectedValueOnce(new DiscoveryError(503, 'skill invocation unavailable'));
    const unavailable = mockRes();
    await handleSessionDiscoverySkillInvoke(
      Object.assign(Readable.from([JSON.stringify({ args: '' })]), {
        method: 'POST',
        url: '/api/sessions/s1/discovery/skills/superpowers/invoke',
      }) as any,
      unavailable.res,
      { id: 's1', key: 'superpowers' },
      { discovery: discovery as any },
    );
    expect(unavailable.out.status).toBe(503);
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
});
