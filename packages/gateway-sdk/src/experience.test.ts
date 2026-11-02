import { test, expect, mock, beforeEach } from 'bun:test';
import { MafwClient } from './client';
import {
  EXPERIENCE_ACTION_IDS,
  EXPERIENCE_VERSION,
  MIN_CLIENT_EXPERIENCE_VERSION,
  action,
} from './experience-contract';
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
  fetchMock.mockResolvedValue(okJson({ experienceVersion: '2026.11.1', sessionID: 's1', actions: {} }));
  const client = new MafwClient('http://gw:3000');
  const result = await client.experience.actions('s1');
  expect(fetchMock.mock.calls[0][0]).toBe('http://gw:3000/api/experience/actions?sessionID=s1');
  expect(result.experienceVersion).toBe('2026.11.1');
  expect(result.sessionID).toBe('s1');
});

test('SDK version stays in sync with the generated contract', () => {
  const file = new URL('../contract/experience-contract.json', import.meta.url);
  const contract = JSON.parse(readFileSync(file, 'utf8'));
  expect(EXPERIENCE_VERSION).toBe('2026.11.1');
  expect(EXPERIENCE_VERSION).toBe(contract.experienceVersion);
  expect(MIN_CLIENT_EXPERIENCE_VERSION).toBe(contract.minClientVersion);
});

test('SDK action ids match the generated contract exactly', () => {
  const file = new URL('../contract/experience-contract.json', import.meta.url);
  const contract = JSON.parse(readFileSync(file, 'utf8'));
  expect(EXPERIENCE_ACTION_IDS).toHaveLength(20);
  expect([...EXPERIENCE_ACTION_IDS]).toEqual(contract.actions.map((a: { id: string }) => a.id));
});

test('SDK action helper enforces the supported/enabled invariant', () => {
  expect(action(true, false, 'busy')).toEqual({ supported: true, enabled: false, reason: 'busy' });
  expect(action(false, true)).toEqual({ supported: false, enabled: false, reason: 'unsupported' });
  expect(action(true, true, undefined, { boundary: 'tool' })).toEqual({
    supported: true,
    enabled: true,
    semantics: { boundary: 'tool' },
  });
});

test('experience.actions without session omits the query string', async () => {
  fetchMock.mockResolvedValue(okJson({ experienceVersion: '2026.11.1', actions: {} }));
  const client = new MafwClient('http://gw:3000');
  await client.experience.actions();
  expect(fetchMock.mock.calls[0][0]).toBe('http://gw:3000/api/experience/actions');
});
