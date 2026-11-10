import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { handleAddMemory } from '../../../src/mcp/handlers/add-memory';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { normalizeSourceTraceIds } from '../../../src/core/memory/provenance';
import { DEFINITIONS } from '../../../src/mcp/tool-registry';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prov-write-'));
}

afterEach(() => jest.restoreAllMocks());

describe('normalizeSourceTraceIds', () => {
  test('strips t1: prefix, dedupes, drops unknown/non-strings and caps at 20', () => {
    const known = new Set(['t1t_a', 't1t_b', ...Array.from({ length: 25 }, (_, i) => `t1t_${i}`)]);
    const ids = normalizeSourceTraceIds(
      ['t1:t1t_a', 't1t_b', 't1t_a', 't1t_missing', 42, null, '', ...Array.from({ length: 25 }, (_, i) => `t1t_${i}`)],
      (id) => known.has(id),
    );
    expect(ids[0]).toBe('t1t_a');
    expect(ids[1]).toBe('t1t_b');
    expect(ids).not.toContain('t1t_missing');
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  test('non-array input → empty', () => {
    expect(normalizeSourceTraceIds('t1t_a', () => true)).toEqual([]);
    expect(normalizeSourceTraceIds(undefined, () => true)).toEqual([]);
  });

  test('existence callback failure drops the id instead of throwing', () => {
    expect(normalizeSourceTraceIds(['t1t_a'], () => { throw new Error('db down'); })).toEqual([]);
  });
});

describe('GatewayDatabase.hasTrace', () => {
  test('true only for an allocated trace id', () => {
    const dir = tmp();
    const db = new GatewayDatabase(path.join(dir, 'test.db'));
    try {
      const t = db.beginTurn('s1');
      expect(db.hasTrace(t.trace_id)).toBe(true);
      expect(db.hasTrace('t1t_missing')).toBe(false);
      expect(db.hasTrace('')).toBe(false);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('mafw_add_memory sourceTraceIds', () => {
  test('stores validated ids on the unit and returns them', async () => {
    const dir = tmp();
    try {
      const res: any = await handleAddMemory(
        {
          content: 'exact provenance content',
          memoryType: 'semantic',
          cueAnchors: ['prov'],
          primaryAbstraction: 'prov',
          importance: 5,
          sourceTraceIds: ['t1:t1t_ok', 't1t_missing'],
        },
        { mafwDir: dir, hasTrace: ((id: string) => id === 't1t_ok') as any } as any,
      );
      const body = JSON.parse(res.content[0].text);
      expect(body.success).toBe(true);
      expect(body.sourceTraceIds).toEqual(['t1t_ok']);
      const stored = await new HarmonicUnitFileStore(dir).read(body.id);
      expect(stored?.source_trace_ids).toEqual(['t1t_ok']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('worker non-compliance (no ids) still writes the memory', async () => {
    const dir = tmp();
    try {
      const res: any = await handleAddMemory(
        { content: 'no provenance content', memoryType: 'semantic', cueAnchors: [], primaryAbstraction: 'np', importance: 5 },
        { mafwDir: dir } as any,
      );
      const body = JSON.parse(res.content[0].text);
      expect(body.success).toBe(true);
      expect(body.sourceTraceIds).toBeUndefined();
      const stored = await new HarmonicUnitFileStore(dir).read(body.id);
      expect(stored?.source_trace_ids).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tool schema exposes sourceTraceIds', () => {
    const def = DEFINITIONS.find((d) => d.name === 'mafw_add_memory')!;
    expect((def.inputSchema.properties as any).sourceTraceIds).toBeDefined();
  });
});
