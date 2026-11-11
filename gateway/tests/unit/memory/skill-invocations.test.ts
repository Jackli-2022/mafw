import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';

describe('skill_invocations', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-inv-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('records one row per callID and defaults to unknown', () => {
    expect(db.recordSkillInvocation({ skillName: 'ms-a', callId: 'call_1', sessionId: 's1' })).toBe(true);
    expect(db.recordSkillInvocation({ skillName: 'ms-a', callId: 'call_1', sessionId: 's1' })).toBe(false);
    expect(db.skillInvocationStats('ms-a')).toEqual({
      total: 1, success: 0, failure: 0, unknown: 1, lastAt: expect.any(Number),
    });
  });

  test('missing name or callID is rejected', () => {
    expect(db.recordSkillInvocation({ skillName: '', callId: 'c' })).toBe(false);
    expect(db.recordSkillInvocation({ skillName: 'ms-a', callId: '' })).toBe(false);
    expect(db.skillInvocationStats('ms-a').total).toBe(0);
  });

  test('a tool result error marks only the matching invocation failed', () => {
    db.recordSkillInvocation({ skillName: 'ms-a', callId: 'call_1' });
    db.recordSkillInvocation({ skillName: 'ms-b', callId: 'call_2' });
    expect(db.markSkillInvocationFailed('call_1', 'runtime.tool.result')).toBe(true);
    expect(db.markSkillInvocationFailed('call_missing')).toBe(false);
    expect(db.skillInvocationStats('ms-a')).toMatchObject({ total: 1, failure: 1, unknown: 0 });
    expect(db.skillInvocationStats('ms-b')).toMatchObject({ total: 1, failure: 0, unknown: 1 });
  });

  test('list stats groups by skill and uses the registry version when known', () => {
    db.recordSkillInstall({ name: 'ms-a', version: 2, sourceMemoryIds: ['m1'] });
    db.recordSkillInvocation({ skillName: 'ms-a', callId: 'call_1' });
    db.recordSkillInvocation({ skillName: 'ms-a', callId: 'call_2' });
    db.recordSkillInvocation({ skillName: 'ms-b', callId: 'call_3' });
    const all = db.listSkillInvocationStats();
    expect(all['ms-a']).toMatchObject({ total: 2, unknown: 2 });
    expect(all['ms-b']).toMatchObject({ total: 1 });
  });
});
