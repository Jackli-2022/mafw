import { describe, expect, it } from '@jest/globals';
import * as fs from 'node:fs';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureGlobalOfficeSkill, officeSkillTarget } from '../../../src/core/office/global-skill';

describe('ensureGlobalOfficeSkill', () => {
  it('安装 → 幂等 → 源变更后更新', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mafw-office-skill-'));
    const srcDir = join(root, 'skills', 'office-editing');
    mkdirSync(srcDir, { recursive: true });
    const source = join(srcDir, 'SKILL.md');
    writeFileSync(source, 'v1');
    const skillsDir = join(root, 'global-skills');

    const first = await ensureGlobalOfficeSkill({ sourceRoot: root, skillsDir });
    expect(first).toMatchObject({ ok: true, action: 'installed' });
    expect(readFileSync(officeSkillTarget(skillsDir), 'utf8')).toBe('v1');

    const second = await ensureGlobalOfficeSkill({ sourceRoot: root, skillsDir });
    expect(second).toMatchObject({ ok: true, action: 'unchanged' });

    writeFileSync(source, 'v2');
    const third = await ensureGlobalOfficeSkill({ sourceRoot: root, skillsDir });
    expect(third).toMatchObject({ ok: true, action: 'updated' });
    expect(readFileSync(officeSkillTarget(skillsDir), 'utf8')).toBe('v2');

    rmSync(root, { recursive: true, force: true });
  });

  it('源缺失 → source-missing（不抛）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mafw-office-skill-missing-'));
    const result = await ensureGlobalOfficeSkill({ sourceRoot: root, skillsDir: join(root, 'skills') });
    expect(result).toMatchObject({ ok: false, reason: 'source-missing' });
    expect(fs.existsSync(join(root, 'skills'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
