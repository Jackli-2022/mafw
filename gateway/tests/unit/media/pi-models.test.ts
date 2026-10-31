import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensurePiModels, XIAOMI_V26_MODELS } from '../../../src/core/media/pi-models';

describe('ensurePiModels', () => {
  it('缺失文件 → 创建并加入 v2.6 模型', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mafw-pi-models-'));
    const target = join(root, 'agent', 'models.json');
    const result = await ensurePiModels({ modelsPath: target });
    expect(result).toMatchObject({ ok: true, action: 'created' });
    const parsed = JSON.parse(readFileSync(target, 'utf8'));
    expect(parsed.providers.xiaomi.models.map((m: any) => m.id)).toEqual([
      'mimo-v2.6-pro',
      'mimo-v2.6-flash',
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it('保留其他 provider 与用户已有条目，只补缺失 id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mafw-pi-models-merge-'));
    const target = join(root, 'models.json');
    writeFileSync(target, JSON.stringify({
      providers: {
        ollama: { baseUrl: 'http://localhost:11434/v1', models: [{ id: 'llama3.1:8b' }] },
        xiaomi: { models: [{ id: 'mimo-v2.6-pro', name: 'user custom' }] },
      },
    }));
    const result = await ensurePiModels({ modelsPath: target });
    expect(result).toMatchObject({ ok: true, action: 'updated' });
    const parsed = JSON.parse(readFileSync(target, 'utf8'));
    expect(parsed.providers.ollama.models[0].id).toBe('llama3.1:8b');
    const xiaomi = parsed.providers.xiaomi.models;
    expect(xiaomi.find((m: any) => m.id === 'mimo-v2.6-pro').name).toBe('user custom');
    expect(xiaomi.map((m: any) => m.id)).toEqual(['mimo-v2.6-pro', 'mimo-v2.6-flash']);

    const again = await ensurePiModels({ modelsPath: target });
    expect(again).toMatchObject({ ok: true, action: 'unchanged' });
    rmSync(root, { recursive: true, force: true });
  });

  it('坏 JSON → invalid-json 且不覆盖', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mafw-pi-models-bad-'));
    const target = join(root, 'models.json');
    writeFileSync(target, '{not json');
    const result = await ensurePiModels({ modelsPath: target });
    expect(result).toMatchObject({ ok: false, reason: 'invalid-json' });
    expect(readFileSync(target, 'utf8')).toBe('{not json');
    rmSync(root, { recursive: true, force: true });
  });

  it('模型清单包含 image 输入（视觉质检前提）', () => {
    for (const model of XIAOMI_V26_MODELS) {
      expect(model.input).toContain('image');
    }
  });
});
