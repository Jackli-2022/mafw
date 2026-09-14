import { handleGoalSessions } from '../../src/routes/goal-sessions';
import * as http from 'http';

function mockRes() {
  const res: any = {
    status: 0, body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string };
}

function mockReq(method: string): http.IncomingMessage {
  const req: any = { method };
  return req as http.IncomingMessage;
}

function depsWith(over: Partial<Parameters<typeof handleGoalSessions>[3]> = {}) {
  return {
    listGoalSessions: jest.fn(async () => [
      { session_id: 'ses_plan', phase: 'PLANNING', loop: 1 },
      { session_id: 'ses_exec', phase: 'EXECUTING', loop: 1 },
    ]),
    getSession: jest.fn(async (id: string) =>
      id === 'ses_plan' ? { id, title: 'plan worker', time: { created: 1, updated: 2 } } : null),
    ...over,
  };
}

describe('goal-sessions route', () => {
  it('non-matching path returns handled=false', async () => {
    const res = mockRes();
    const handled = await handleGoalSessions(mockReq('GET'), res, '/api/goals/g1/control', depsWith() as any);
    expect(handled).toBe(false);
  });

  it('lists goal sessions with enriched titles', async () => {
    const deps = depsWith();
    const res = mockRes();
    const handled = await handleGoalSessions(mockReq('GET'), res, '/api/goals/g1/sessions', deps as any);
    expect(handled).toBe(true);
    expect(deps.listGoalSessions).toHaveBeenCalledWith('g1');
    expect((res as any).status).toBe(200);
    const body = JSON.parse((res as any).body);
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0]).toMatchObject({ sessionID: 'ses_plan', phase: 'PLANNING', loop: 1, title: 'plan worker' });
    expect(body.sessions[1]).toMatchObject({ sessionID: 'ses_exec', phase: 'EXECUTING' });
    expect(body.sessions[1].title).toBeUndefined(); // enrich 失败不填 title，不崩
  });

  it('empty goal sessions returns empty array', async () => {
    const res = mockRes();
    await handleGoalSessions(mockReq('GET'), res, '/api/goals/g-none/sessions',
      depsWith({ listGoalSessions: jest.fn(async () => []) }) as any);
    expect((res as any).status).toBe(200);
    expect(JSON.parse((res as any).body)).toEqual({ sessions: [] });
  });

  it('db failure → 500 with error', async () => {
    const res = mockRes();
    await handleGoalSessions(mockReq('GET'), res, '/api/goals/g1/sessions',
      depsWith({ listGoalSessions: jest.fn(async () => { throw new Error('db locked'); }) }) as any);
    expect((res as any).status).toBe(500);
    expect(JSON.parse((res as any).body).error).toContain('db locked');
  });

  it('query string does not break matching', async () => {
    const res = mockRes();
    const handled = await handleGoalSessions(mockReq('GET'), res, '/api/goals/g1/sessions?limit=5', depsWith() as any);
    expect(handled).toBe(true);
    expect((res as any).status).toBe(200);
  });

  it('POST method returns handled=false', async () => {
    const res = mockRes();
    const handled = await handleGoalSessions(mockReq('POST'), res, '/api/goals/g1/sessions', depsWith() as any);
    expect(handled).toBe(false);
  });
});
