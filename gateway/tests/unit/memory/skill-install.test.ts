import * as path from 'path';
import { installSkillDraft, deoptSkill } from '../../../src/memory/skill-install';

describe('installSkillDraft', () => {
  it('installs staged skill and rewrites source memory as pointer', async () => {
    const copied: any[] = [];
    let written: any = null;
    const r = await installSkillDraft(
      { name: 'ms-abcdef', memoryId: 'mem_1_abcdef' },
      {
        copyDir: (src, dst) => copied.push({ src, dst }),
        readMemory: async () => ({
          id: 'mem_1_abcdef', type: 'procedural', primary_abstraction: 'serve playbook',
          memory_value: '1. a\n2. b', cue_anchors: ['serve'], energy: 0.8,
        }),
        writeMemory: async (u) => { written = u; },
        stagingDir: '/stg',
        skillsDir: '/skills',
      },
    );
    expect(r.installed).toBe('ms-abcdef');
    expect(copied[0]).toEqual({ src: path.join('/stg', 'ms-abcdef'), dst: path.join('/skills', 'ms-abcdef') });
    expect(written.memory_value).toContain('已物化为 skill:ms-abcdef');
    expect(written.cue_anchors).toContain('skill:ms-abcdef');
    expect(written.cue_anchors).toContain('serve');
    // The full unit must survive the pointer rewrite (type/abstraction are
    // required by the OKF writer; truncating them made the write fail silently).
    expect(written.type).toBe('procedural');
    expect(written.primary_abstraction).toBe('serve playbook');
  });

  it('missing memory still copies the skill (fail-open on pointer rewrite)', async () => {
    const copied: any[] = [];
    const r = await installSkillDraft(
      { name: 'ms-x', memoryId: 'mem_gone' },
      {
        copyDir: (src, dst) => copied.push({ src, dst }),
        readMemory: async () => null,
        writeMemory: async () => {},
        stagingDir: '/stg',
        skillsDir: '/skills',
      },
    );
    expect(r.installed).toBe('ms-x');
    expect(copied).toHaveLength(1);
  });

  it('records version and source ids after a successful install', async () => {
    const records: any[] = [];
    await installSkillDraft(
      { name: 'ms-v2', memoryId: 'mem_1', version: 2, sourceMemoryIds: ['mem_1', 'mem_2'], sourceTraceIds: ['t1t_a'] },
      {
        copyDir: () => {},
        readMemory: async () => null,
        writeMemory: async () => {},
        stagingDir: '/stg',
        skillsDir: '/skills',
        recordInstall: (r) => records.push(r),
      },
    );
    expect(records).toEqual([{
      name: 'ms-v2', version: 2,
      sourceMemoryIds: ['mem_1', 'mem_2'], sourceTraceIds: ['t1t_a'],
    }]);
  });
});

describe('deoptSkill', () => {
  it('moves the skill out of discovery scope and marks it paused', () => {
    const renames: any[] = [];
    const statuses: any[] = [];
    const r = deoptSkill('ms-abcdef', 'source-superseded', {
      skillsDir: '/skills',
      renameDir: (src, dst) => renames.push({ src, dst }),
      ensureDir: () => {},
      recordStatus: (name, status, reason) => statuses.push({ name, status, reason }),
      now: () => new Date('2026-11-11T00:00:00.000Z'),
    });
    expect(r.deopted).toBe(true);
    expect(renames[0].src).toBe(path.join('/skills', 'ms-abcdef'));
    expect(renames[0].dst).toContain(path.join('/skills', '.disabled', 'ms-abcdef-'));
    expect(statuses).toEqual([{ name: 'ms-abcdef', status: 'paused', reason: 'source-superseded' }]);
  });

  it('missing or unsupported names are not deopted (fail-open)', () => {
    expect(deoptSkill('../escape', 'x', {
      skillsDir: '/skills',
      renameDir: () => {},
    }).deopted).toBe(false);
    expect(deoptSkill('ms-x', 'x', {
      skillsDir: '/skills',
      renameDir: () => { throw new Error('ENOENT'); },
    }).deopted).toBe(false);
  });
});
