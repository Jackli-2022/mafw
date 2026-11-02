import { test, expect, mock, beforeEach } from 'bun:test';
import { MafwClient } from './client';
import { EXPERIENCE_VERSION } from './experience-contract';
import { readFileSync } from 'node:fs';

let fetchMock: ReturnType<typeof mock>;

beforeEach(() => {
  fetchMock = mock();
  globalThis.fetch = fetchMock as any;
});

function okJson(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) } as Response);
}

test('experience.actions GETs the session-scoped action descriptor', async () => {
  fetchMock.mockResolvedValue(okJson({ experienceVersion: '2026.11.0', sessionID: 's1', actions: {} }));
  const client = new MafwClient('http://gw:3000');
  const result = await client.experience.actions('s1');
  expect(fetchMock.mock.calls[0][0]).toBe('http://gw:3000/api/experience/actions?sessionID=s1');
  expect(result.experienceVersion).toBe('2026.11.0');
  expect(result.sessionID).toBe('s1');
});

test('SDK version stays in sync with the generated contract', () => {
  const file = new URL('../contract/experience-contract.json', import.meta.url);
  expect(EXPERIENCE_VERSION).toBe(JSON.parse(readFileSync(file, 'utf8')).experienceVersion);
});

test('experience.actions without session omits the query string', async () => {
  fetchMock.mockResolvedValue(okJson({ experienceVersion: '2026.11.0', actions: {} }));
  const client = new MafwClient('http://gw:3000');
  await client.experience.actions();
  expect(fetchMock.mock.calls[0][0]).toBe('http://gw:3000/api/experience/actions');
});
