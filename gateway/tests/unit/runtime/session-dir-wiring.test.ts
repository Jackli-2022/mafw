/**
 * session 目录接线契约：gateway 侧只有 resolvedProjectDir() 一个解析点，
 * ctx 注入（插件 + 内置）与内部会话/worker/media/conformance 全走它。
 * （负断言"sdkConfig.directory 消失"归 Task 7 source-contract 测试。）
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('session directory wiring', () => {
  test('resolvedProjectDir helper exists and is the single resolution point', () => {
    expect(src).toContain('private resolvedProjectDir(): string');
    expect(src).toContain('resolvePluginProjectDir(this.currentProjectDir, config.raw.paths.projectDir)');
  });

  test('plugin-path ctx gets the absolute resolved project dir', () => {
    expect(src).toContain('createRuntimePluginContext(creds, {');
    expect(src).toContain('projectDir: this.resolvedProjectDir(),');
  });

  test('builtin-path ctx also gets projectDir (D 收敛后与插件同一激活路径)', () => {
    // activatePluginRuntime 单路径：builtin opencode creds=undefined，projectDir 恒传
    expect(src).toContain("const creds = name === 'opencode' ? undefined : await this.runtimeCredentialsForPlugin();");
  });

  test('internal session sites use resolvedProjectDir (pool / compress / btw)', () => {
    expect(src).toContain('directory: this.resolvedProjectDir(),'); // worker pool + eval deps
    expect(src).toContain('session.create({ directory: this.resolvedProjectDir() })'); // compress + btw
  });

  test('conformance harness defaults to resolvedProjectDir', () => {
    expect(src).toContain('directory: opts?.directory ?? this.resolvedProjectDir(),');
  });

  test('media executor is injected with resolvedProjectDir', () => {
    expect(src).toContain('createMediaRuntimeExecutor(this.runtime, { projectDir: this.resolvedProjectDir(), getApiKey: this.runtimeGetApiKey.bind(this) })');
  });
});
