import { describe, expect, it } from '@jest/globals';
import * as fs from 'node:fs';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  ensurePluginCreatorSkill,
  pluginCreatorSkillTarget,
} from '../../../src/skills/plugin-creator-skill-install';

describe('ensurePluginCreatorSkill', () => {
  it('安装 → 幂等 → 源变更后更新', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mafw-plugin-creator-skill-'));
    const srcDir = join(root, 'skills', 'plugin-creator');
    mkdirSync(srcDir, { recursive: true });
    const source = join(srcDir, 'SKILL.md');
    writeFileSync(source, 'v1');
    const skillsDir = join(root, 'global-skills');

    const first = await ensurePluginCreatorSkill({ sourceRoot: root, skillsDir });
    expect(first).toMatchObject({ ok: true, action: 'installed' });
    expect(readFileSync(pluginCreatorSkillTarget(skillsDir), 'utf8')).toBe('v1');

    const second = await ensurePluginCreatorSkill({ sourceRoot: root, skillsDir });
    expect(second).toMatchObject({ ok: true, action: 'unchanged' });

    writeFileSync(source, 'v2');
    const third = await ensurePluginCreatorSkill({ sourceRoot: root, skillsDir });
    expect(third).toMatchObject({ ok: true, action: 'updated' });
    expect(readFileSync(pluginCreatorSkillTarget(skillsDir), 'utf8')).toBe('v2');

    rmSync(root, { recursive: true, force: true });
  });

  it('源缺失 → source-missing（不抛、不建目录）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mafw-plugin-creator-skill-missing-'));
    const skillsDir = join(root, 'global-skills');
    const result = await ensurePluginCreatorSkill({ sourceRoot: root, skillsDir });
    expect(result).toMatchObject({ ok: false, reason: 'source-missing' });
    expect(fs.existsSync(skillsDir)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('安装目标始终落在给定 skills 目录内的 plugin-creator/ 下', () => {
    const skillsDir = join(tmpdir(), 'mafw-skills-guard');
    const target = pluginCreatorSkillTarget(skillsDir);
    expect(target).toBe(join(skillsDir, 'plugin-creator', 'SKILL.md'));
    expect(target.startsWith(`${skillsDir}${sep}`)).toBe(true);
  });

  it('sourceFile 覆盖优先于 sourceRoot', async () => {    const root = mkdtempSync(join(tmpdir(), 'mafw-plugin-creator-skill-explicit-'));
    const source = join(root, 'explicit-skill.md');
    writeFileSync(source, 'explicit');
    const skillsDir = join(root, 'global-skills');

    const result = await ensurePluginCreatorSkill({ sourceFile: source, skillsDir });
    expect(result).toMatchObject({ ok: true, action: 'installed' });
    expect(readFileSync(pluginCreatorSkillTarget(skillsDir), 'utf8')).toBe('explicit');

    rmSync(root, { recursive: true, force: true });
  });

  it('随包技能真实存在于仓库 skills/plugin-creator/SKILL.md 并可由默认源根安装', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mafw-plugin-creator-skill-shipped-'));
    const skillsDir = join(root, 'global-skills');

    const result = await ensurePluginCreatorSkill({ skillsDir });
    expect(result).toMatchObject({ ok: true, action: 'installed' });

    const installed = readFileSync(pluginCreatorSkillTarget(skillsDir), 'utf8');
    expect(installed).toContain('name: plugin-creator');
    expect(installed).toContain('.mafw/plugin-drafts/<packageName>');
    expect(installed).toContain('PLUGIN_UI_LIMITS');
    expect(installed).toContain('plugin:<package>:<event>');
    expect(installed).toContain('requestId');

    rmSync(root, { recursive: true, force: true });
  });
});
