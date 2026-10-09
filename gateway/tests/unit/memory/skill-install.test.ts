import * as path from 'path';
import { installSkillDraft } from '../../../src/memory/skill-install';

describe('installSkillDraft', () => {
  it('installs staged skill and rewrites source memory as pointer', async () => {
    const copied: any[] = [];
    let written: any = null;
    const r = await installSkillDraft(
      { name: 'ms-abcdef', memoryId: 'mem_1_abcdef' },
      {
        copyDir: (src, dst) => copied.push({ src, dst }),
        readMemory: async () => ({ id: 'mem_1_abcdef', memory_value: '1. a\n2. b', cue_anchors: ['serve'] }),
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
});
