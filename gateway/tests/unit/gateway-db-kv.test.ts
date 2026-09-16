import { GatewayDatabase } from '../../src/memory/gateway-db';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('GatewayDatabase kvClearScope / kvPruneOlderThan', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwdb-kv-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  it('kvClearScope deletes every entry in the scope and returns the count', () => {
    const keep = { at: daysAgo(1) };
    db.kvSet('internal-session', 'a', { role: 'index-scan', at: daysAgo(1) });
    db.kvSet('internal-session', 'b', { role: 'extract', at: daysAgo(2) });
    db.kvSet('other', 'c', keep);
    expect(db.kvClearScope('internal-session')).toBe(2);
    expect(db.kvAll('internal-session')).toEqual([]);
    expect(db.kvGet('other', 'c')).toEqual(keep);
  });

  it('kvClearScope returns 0 for an empty or unknown scope', () => {
    expect(db.kvClearScope('nope')).toBe(0);
  });

  it('kvPruneOlderThan removes entries past the TTL and keeps fresh ones', () => {
    const oldAt = new Date(Date.now() - 7 * 86_400_000 - 60_000).toISOString();
    const freshAt = daysAgo(1);
    db.kvSet('internal-session', 'old', { role: 'index-scan', at: oldAt });
    db.kvSet('internal-session', 'fresh', { role: 'extract', at: freshAt });
    expect(db.kvPruneOlderThan('internal-session', 7)).toBe(1);
    expect(db.kvGet('internal-session', 'old')).toBeNull();
    expect(db.kvGet('internal-session', 'fresh')).toEqual({ role: 'extract', at: freshAt });
  });

  it('kvPruneOlderThan keeps entries just inside the TTL (strictly-greater rule)', () => {
    const at = new Date(Date.now() - 7 * 86_400_000 + 60_000).toISOString();
    db.kvSet('internal-session', 'edge', { role: 'reflect', at });
    expect(db.kvPruneOlderThan('internal-session', 7)).toBe(0);
    expect(db.kvGet('internal-session', 'edge')).not.toBeNull();
  });

  it('kvPruneOlderThan keeps entries without an `at` field (conservative)', () => {
    db.kvSet('internal-session', 'legacy', { role: 'manager' });
    expect(db.kvPruneOlderThan('internal-session', 7)).toBe(0);
    expect(db.kvGet('internal-session', 'legacy')).toEqual({ role: 'manager' });
  });

  it('pruned entries disappear from kvAll', () => {
    db.kvSet('internal-session', 'a', { role: 'extract', at: daysAgo(30) });
    db.kvPruneOlderThan('internal-session', 7);
    expect(db.kvAll('internal-session')).toEqual([]);
  });
});
