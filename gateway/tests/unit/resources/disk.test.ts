/**
 * E4-2 disk sampling: statfs → bytes + threshold state, fail-open on error.
 * Spec: docs/superpowers/specs/2026-11-11-gateway-e4-resource-ledger-design.md §4.2
 */
import { sampleDisk, DEFAULT_DISK_THRESHOLDS, StatfsFn } from '../../../src/resources/disk';

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

function statfs(free: number, opts?: { bsize?: number; blocks?: number }): StatfsFn {
  const bsize = opts?.bsize ?? 1;
  const blocks = opts?.blocks ?? 8 * GiB;
  return async () => ({ bsize, blocks, bavail: free });
}

describe('sampleDisk', () => {
  const t = DEFAULT_DISK_THRESHOLDS;

  test('default thresholds are 2 GiB warn / 512 MiB critical', () => {
    expect(t).toEqual({ warnFreeBytes: 2 * GiB, criticalFreeBytes: 512 * MiB });
  });

  test('computes totalBytes = blocks*bsize and freeBytes = bavail*bsize', async () => {
    const sample = await sampleDisk('/data', async () => ({
      bsize: 4096,
      blocks: 1_000_000,
      bavail: (3 * GiB) / 4096,
    }));
    expect(sample.totalBytes).toBe(4096 * 1_000_000);
    expect(sample.freeBytes).toBe(3 * GiB);
    expect(sample.state).toBe('ok');
    expect(sample.error).toBeUndefined();
  });

  test('threshold edges: > warn ok, (critical, warn] warn, <= critical critical', async () => {
    expect((await sampleDisk('/d', statfs(2 * GiB + 1))).state).toBe('ok');
    expect((await sampleDisk('/d', statfs(2 * GiB))).state).toBe('warn');
    expect((await sampleDisk('/d', statfs(512 * MiB + 1))).state).toBe('warn');
    expect((await sampleDisk('/d', statfs(512 * MiB))).state).toBe('critical');
    expect((await sampleDisk('/d', statfs(1))).state).toBe('critical');
  });

  test('honours injected thresholds', async () => {
    const custom = { warnFreeBytes: 100, criticalFreeBytes: 10 };
    expect((await sampleDisk('/d', statfs(101), custom)).state).toBe('ok');
    expect((await sampleDisk('/d', statfs(100), custom)).state).toBe('warn');
    expect((await sampleDisk('/d', statfs(11), custom)).state).toBe('warn');
    expect((await sampleDisk('/d', statfs(10), custom)).state).toBe('critical');
  });

  test('statfs failure → unknown with error message, never throws', async () => {
    const failing: StatfsFn = async () => {
      throw new Error('ENOENT: no such file or directory');
    };
    const sample = await sampleDisk('/missing', failing);
    expect(sample.state).toBe('unknown');
    expect(sample.error).toContain('ENOENT');
    expect(sample.totalBytes).toBe(0);
    expect(sample.freeBytes).toBe(0);
  });

  test('non-Error rejection still yields unknown with a message', async () => {
    const failing: StatfsFn = async () => {
      throw 'statfs exploded';
    };
    const sample = await sampleDisk('/missing', failing);
    expect(sample.state).toBe('unknown');
    expect(sample.error).toBe('statfs exploded');
  });

  test('negative bsize/blocks/bavail → unknown, never clamped into critical', async () => {
    for (const stats of [
      { bsize: -4096, blocks: 100, bavail: 50 },
      { bsize: 4096, blocks: -100, bavail: 50 },
      { bsize: 4096, blocks: 100, bavail: -50 },
    ]) {
      const sample = await sampleDisk('/d', async () => stats);
      expect(sample.state).toBe('unknown');
      expect(sample.error).toBe('invalid statfs values');
      expect(sample.totalBytes).toBe(0);
      expect(sample.freeBytes).toBe(0);
    }
  });

  test('non-finite statfs values → unknown (never classify garbage)', async () => {
    const sample = await sampleDisk('/d', async () => ({ bsize: NaN, blocks: 1, bavail: 1 }));
    expect(sample.state).toBe('unknown');
    expect(sample.error).toBeTruthy();
  });
});
