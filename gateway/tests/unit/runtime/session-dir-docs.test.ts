/**
 * 目录规则必须出现在插件作者会看的地方（SKILL/loader 注释）。
 * 背景：作者文档此前只写 `directory?: string`，从未提 ctx.projectDir，
 * 导致"建会话用哪个目录"无据可依（spec 2026-10-20-session-directory-contract-design）。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

describe('session directory rule is documented where authors look', () => {
  test('plugin authoring skill states the rule', () => {
    const skill = read('../../../../.opencode/skills/runtime-plugin-authoring/SKILL.md');
    expect(skill).toContain('opts.directory');
    expect(skill).toMatch(/必填/);
    expect(skill).toContain('ctx.projectDir');
  });

  test('loader context marks projectDir as start-up info (not session cwd)', () => {
    const loader = read('../../../src/runtime/loader.ts');
    expect(loader).toMatch(/projectDir\?: string;/);
    // 注释（字段声明前）必须写明绝对路径 + 启动期语义
    expect(loader).toMatch(/绝对路径/);
    expect(loader).toMatch(/启动期信息/);
    expect(loader).toMatch(/不用于 session cwd/);
  });
});
