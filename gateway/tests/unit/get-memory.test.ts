import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnitFileStore } from '../../src/memory/harmonic-file-store';
import { handleGetMemory } from '../../src/mcp/handlers/get-memory';

function makeUnit(id: string, abstraction: string) {
  const now = new Date().toISOString();
  return {
    id, type: 'semantic' as const,
    primary_abstraction: abstraction, cue_anchors: ['x'],
    memory_value: `全文:${abstraction}`, energy: 0.8,
    created_at: now, updated_at: now,
  };
}

describe('mafw_get_memory', () => {
  let dir: string;
  let store: HarmonicUnitFileStore;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-getmem-'));
    store = new HarmonicUnitFileStore(dir);
    await store.write(makeUnit('mem_1111111111_abc123', '旧偏好'));
    await store.write(makeUnit('mem_2222222222_def456', '新偏好'));
  });

  test('full id → returns complete unit incl. memory_value', async () => {
    const res = await handleGetMemory({ id: 'mem_1111111111_abc123' }, { mafwDir: dir } as any);
    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(true);
    expect(body.memory.id).toBe('mem_1111111111_abc123');
    expect(body.memory.memory_value).toBe('全文:旧偏好');
  });

  test('tail-6 pointer (#mem-abc123) resolves to the full unit', async () => {
    const res = await handleGetMemory({ id: 'abc123' }, { mafwDir: dir } as any);
    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(true);
    expect(body.memory.id).toBe('mem_1111111111_abc123');
  });

  test('bare-# pointer (#abc123) resolves like #mem-abc123', async () => {
    const res = await handleGetMemory({ id: '#abc123' }, { mafwDir: dir } as any);
    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(true);
    expect(body.memory.id).toBe('mem_1111111111_abc123');
  });

  test('superseded memory → response follows the chain to the latest', async () => {
    store.markSuperseded('mem_1111111111_abc123', 'mem_2222222222_def456');
    const res = await handleGetMemory({ id: 'mem_1111111111_abc123' }, { mafwDir: dir } as any);
    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(true);
    expect(body.memory.superseded_by).toBe('mem_2222222222_def456');
    expect(body.latest.id).toBe('mem_2222222222_def456');
    expect(body.latest.memory_value).toBe('全文:新偏好');
  });

  test('unknown id → error', async () => {
    const res = await handleGetMemory({ id: 'mem_nope' }, { mafwDir: dir } as any);
    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(false);
    expect(res.isError).toBe(true);
  });

  test('ambiguous tail → error listing candidates', async () => {
    await store.write(makeUnit('mem_3333333333_abc123', '另一条同尾'));
    const res = await handleGetMemory({ id: 'abc123' }, { mafwDir: dir } as any);
    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(false);
    expect(res.isError).toBe(true);
    expect(body.candidates).toContain('mem_1111111111_abc123');
    expect(body.candidates).toContain('mem_3333333333_abc123');
  });
});
