// CI regression guard: prevents migrated files from regressing to handwritten
// concurrency primitives (inflight Maps, boolean mutexes, promise chains).
// Spec: docs/superpowers/specs/2026-11-09-gateway-kernel-concurrency-design.md

import * as fs from 'fs';
import * as path from 'path';

describe('concurrency regression guard', () => {
  const srcDir = path.join(__dirname, '..', '..', '..', 'src');

  /** Files that were migrated to consume concurrency/ primitives. */
  const guardedFiles = [
    'index.ts',
    'recall/session-worker-pool.ts',
    'memory/write-queue.ts',
    'core/instructions/instruction-sync-service.ts',
  ];

  const sources = guardedFiles.map((file) => ({
    file,
    content: fs.readFileSync(path.join(srcDir, file), 'utf-8'),
  }));

  it('guarded files should not contain handwritten concurrency Map declarations', () => {
    for (const { file, content } of sources) {
      expect(content).not.toMatch(
        /private\s+(?:readonly\s+)?\w+\s*=\s*new\s+Map<string,\s*Promise/,
        `${file} has a raw Map<string, Promise<...>> — use Singleflight or MutexQueue instead`,
      );
    }
  });

  it('guarded files should not contain xxxInflight Map declarations', () => {
    for (const { file, content } of sources) {
      expect(content).not.toMatch(
        /private\s+(?:readonly\s+)?\w+Inflight\s*=\s*new\s+Map/,
        `${file} has a raw xxxInflight Map — use TtlMap or Guard instead`,
      );
    }
  });

  it('index.ts should not contain boolean mutex patterns (xxInFlight = false)', () => {
    const index = sources.find((s) => s.file === 'index.ts')!;
    expect(index.content).not.toMatch(/private\s+\w*[Ii]n[Ff]light\s*=\s*false/);
  });

  it('index.ts should not contain raw promise-chain queueing (xxx = xxx.then)', () => {
    const index = sources.find((s) => s.file === 'index.ts')!;
    expect(index.content).not.toMatch(/this\.\w+Queue\s*=\s*this\.\w+Queue\s*\.then/);
  });

  it('index.ts should import concurrency primitives', () => {
    const index = sources.find((s) => s.file === 'index.ts')!;
    expect(index.content).toMatch(/from\s+'\.\/concurrency\/guard'/);
    expect(index.content).toMatch(/from\s+'\.\/concurrency\/mutex-queue'/);
    expect(index.content).toMatch(/from\s+'\.\/concurrency\/ttl-map'/);
  });

  it('session-worker-pool should use Singleflight (not raw Map)', () => {
    const pool = sources.find((s) => s.file === 'recall/session-worker-pool.ts')!;
    expect(pool.content).toMatch(/from\s+'\.\.\/concurrency'/);
    expect(pool.content).not.toMatch(/private\s+inflight\s*=\s*new\s+Map/);
  });

  it('write-queue should use MutexQueue (not raw promise chain)', () => {
    const wq = sources.find((s) => s.file === 'memory/write-queue.ts')!;
    expect(wq.content).toMatch(/from\s+'\.\.\/concurrency'/);
    expect(wq.content).not.toMatch(/private\s+processing\s*=\s*false/);
  });
});
