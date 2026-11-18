import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import type { MemoryReceipt } from '../../../src/recall/receipt';

function receipt(over: Partial<MemoryReceipt> = {}): MemoryReceipt {
  return {
    version: 1,
    status: 'inject',
    tookMs: 10,
    createdAt: '2026-11-18T06:30:00.000Z',
    updatedAt: '2026-11-18T06:30:00.000Z',
    topic: null,
    memories: [{
      id: 'mem_a',
      type: 'semantic',
      abstraction: 'a',
      date: null,
      available: true,
    }],
    t1: [],
    filteredT1: 0,
    counts: { memories: 1, t1: 0 },
    ...over,
  };
}

describe('memory_receipts', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-receipts-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('upserts and merges receipts for the same anchor', () => {
    db.upsertMemoryReceipt({ sessionId: 's1', anchorKey: 'turn_a', receipt: receipt() });
    db.upsertMemoryReceipt({
      sessionId: 's1',
      anchorKey: 'turn_a',
      receipt: receipt({
        updatedAt: '2026-11-18T06:32:00.000Z',
        memories: [
          { id: 'mem_a', type: 'semantic', abstraction: 'a2', date: null, available: true },
          { id: 'mem_b', type: 'procedural', abstraction: 'b', date: null, available: true },
        ],
        counts: { memories: 2, t1: 0 },
      }),
    });

    const items = db.listMemoryReceipts('s1');
    expect(items).toHaveLength(1);
    expect(items[0].anchorKey).toBe('turn_a');
    expect(items[0].receipt.memories).toHaveLength(2);
    expect(items[0].receipt.memories[0].abstraction).toBe('a2');
    expect(items[0].receipt.updatedAt).toBe('2026-11-18T06:32:00.000Z');
  });

  test('lists newest first and honors the limit', () => {
    db.upsertMemoryReceipt({
      sessionId: 's1', anchorKey: 'turn_a',
      receipt: receipt({ updatedAt: '2026-11-18T06:30:00.000Z' }),
    });
    db.upsertMemoryReceipt({
      sessionId: 's1', anchorKey: 'turn_b',
      receipt: receipt({ updatedAt: '2026-11-18T06:31:00.000Z' }),
    });

    expect(db.listMemoryReceipts('s1').map((item) => item.anchorKey)).toEqual(['turn_b', 'turn_a']);
    expect(db.listMemoryReceipts('s1', { limit: 1 }).map((item) => item.anchorKey)).toEqual(['turn_b']);
  });

  test('prunes older anchors down to the keep count', () => {
    for (let i = 0; i < 3; i++) {
      db.upsertMemoryReceipt({
        sessionId: 's1',
        anchorKey: `turn_${i}`,
        receipt: receipt({ updatedAt: `2026-11-18T06:3${i}:00.000Z` }),
      });
    }
    expect(db.pruneMemoryReceipts('s1', 2)).toBe(1);
    expect(db.listMemoryReceipts('s1').map((item) => item.anchorKey)).toEqual(['turn_2', 'turn_1']);
  });
});
