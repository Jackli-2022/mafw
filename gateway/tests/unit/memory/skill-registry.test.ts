import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';

describe('skill_registry', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-reg-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('records installs, bumps versions and persists source ids', () => {
    const first = db.recordSkillInstall({
      name: 'ms-abcdef',
      sourceMemoryIds: ['mem_1'],
      sourceTraceIds: ['t1t_a'],
    });
    expect(first.version).toBe(1);
    expect(db.getSkillRecord('ms-abcdef')).toMatchObject({
      name: 'ms-abcdef',
      version: 1,
      status: 'active',
      sourceMemoryIds: ['mem_1'],
      sourceTraceIds: ['t1t_a'],
    });

    const second = db.recordSkillInstall({
      name: 'ms-abcdef',
      sourceMemoryIds: ['mem_2'],
      sourceTraceIds: ['t1t_b'],
    });
    expect(second.version).toBe(2);
    expect(db.getSkillRecord('ms-abcdef')).toMatchObject({
      version: 2,
      sourceMemoryIds: ['mem_2'],
      sourceTraceIds: ['t1t_b'],
    });
  });

  test('explicit version wins; status/deopt reason update', () => {
    db.recordSkillInstall({ name: 'ms-v', version: 7, sourceMemoryIds: ['mem_1'] });
    expect(db.getSkillRecord('ms-v')!.version).toBe(7);

    expect(db.setSkillStatus('ms-v', 'paused', 'missing-runtime')).toBe(true);
    expect(db.getSkillRecord('ms-v')).toMatchObject({ status: 'paused', deoptReason: 'missing-runtime' });
    expect(db.listSkillRecords('paused').map((r) => r.name)).toEqual(['ms-v']);
    expect(db.listSkillRecords('active')).toEqual([]);
    expect(db.setSkillStatus('missing', 'paused')).toBe(false);
  });
});
