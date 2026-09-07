import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReflectionPipeline } from '../../src/recall/reflection';

function makeMockIndex(entries: Array<{ id: string; pa: string; anchors?: string[]; superseded?: boolean }>) {
  return {
    getIndex: () => ({
      version: 2,
      updated_at: new Date().toISOString(),
      entries: entries.map(e => ({
        id: e.id,
        type: 'semantic' as const,
        primary_abstraction: e.pa,
        cue_anchors: e.anchors ?? [],
        tier: 'semantic',
        energy: 0.8,
        filePath: `concepts/semantic/${e.id}.md`,
        created_at: new Date().toISOString(),
        superseded_by: e.superseded ? 'some_id' : undefined,
      })),
    }),
    save: () => {},
  };
}

function makePipeline(index: any): ReflectionPipeline {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-reflect-'));
  return new ReflectionPipeline({
    index,
    baseDir: dir,
    workerFor: () => { throw new Error('not used in classify tests'); },
    cursor: { isReflected: () => false, markReflected: () => {}, prune: () => {} } as any,
  });
}

describe('ReflectionPipeline.classifyInsight', () => {
  test('exact duplicate of an existing entry → duplicate', () => {
    const index = makeMockIndex([{ id: 's1', pa: 'PowerShell 5.1 的 ErrorActionPreference 不捕获原生命令非零退出码' }]);
    const pipeline = makePipeline(index);
    const result = (pipeline as any).classifyInsight('PowerShell 5.1 的 ErrorActionPreference 不捕获原生命令非零退出码', []);
    expect(result.kind).toBe('duplicate');
  });

  test('duplicate of one segment of a merged blob → duplicate (anti-dilution)', () => {
    const index = makeMockIndex([{
      id: 'blob1',
      pa: 'Rail 指挥台重设计完成 | gateway 部署需要 npm install 全局安装再走 restart 令牌 | UsageDock 显示名映射修复',
    }]);
    const pipeline = makePipeline(index);
    const result = (pipeline as any).classifyInsight('gateway 部署需要 npm install 全局安装再走 restart 令牌', []);
    expect(result.kind).toBe('duplicate');
  });

  test('unrelated content → novel', () => {
    const index = makeMockIndex([{ id: 's2', pa: 'PowerShell 5.1 的 ErrorActionPreference 不捕获原生命令非零退出码' }]);
    const pipeline = makePipeline(index);
    const result = (pipeline as any).classifyInsight('Flutter 的 MaterialApp 主题配置支持 dark mode', []);
    expect(result.kind).toBe('novel');
  });

  test('superseded entries are ignored', () => {
    const index = makeMockIndex([{ id: 's3', pa: 'PowerShell 5.1 的 ErrorActionPreference 不捕获原生命令非零退出码', superseded: true }]);
    const pipeline = makePipeline(index);
    const result = (pipeline as any).classifyInsight('PowerShell 5.1 的 ErrorActionPreference 不捕获原生命令非零退出码', []);
    expect(result.kind).toBe('novel'); // 唯一匹配已被 superseded
  });
});
