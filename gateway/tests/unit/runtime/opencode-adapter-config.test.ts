/**
 * 死通道钉扎：`directory` 曾是第 5 个来源（sdkConfig.directory / adapter config /
 * OpencodeRuntimeConfig），实测 0 读取（opencode-adapter 从不读 config.directory）。
 * 本测试防止它复活——目录来源只有 opts.directory（+ ctx.projectDir 启动期信息）。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

describe('dead directory channel removed', () => {
  const adapter = read('../../../src/opencode-adapter.ts');
  const runtime = read('../../../src/runtime/opencode-runtime.ts');
  const index = read('../../../src/index.ts');

  test('adapter config no longer declares directory', () => {
    expect(adapter).not.toMatch(/createOpencodeAdapter\(config:\s*\{[\s\S]{0,200}?directory/);
  });

  test('OpencodeRuntimeConfig no longer declares directory', () => {
    expect(runtime).not.toMatch(/interface OpencodeRuntimeConfig\s*\{[\s\S]{0,200}?directory/);
  });

  test('no sdkConfig site passes directory: this.projectDir', () => {
    expect(index).not.toMatch(/sdkConfig[\s\S]{0,160}?directory:\s*this\.projectDir/);
    expect(index).not.toContain('directory: this.projectDir');
  });
});
