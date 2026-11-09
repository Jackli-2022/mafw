// CI regression guard: prevents index.ts from regressing to handwritten
// concurrency primitives (inflight Maps, boolean mutexes, promise chains).
// Spec: docs/superpowers/specs/2026-11-09-gateway-kernel-concurrency-design.md

import * as fs from 'fs';
import * as path from 'path';

describe('concurrency regression guard', () => {
  const indexSource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'index.ts'),
    'utf-8',
  );

  it('index.ts should not contain handwritten concurrency Map declarations', () => {
    // Pattern: private xxx = new Map<string, Promise<...>>
    expect(indexSource).not.toMatch(/private\s+\w+\s*=\s*new\s+Map<string,\s*Promise/);
  });

  it('index.ts should not contain xxxInflight Map declarations', () => {
    expect(indexSource).not.toMatch(/private\s+\w+Inflight\s*=\s*new\s+Map/);
  });

  it('index.ts should not contain boolean mutex patterns (xxInFlight = false)', () => {
    expect(indexSource).not.toMatch(/private\s+\w*[Ii]n[Ff]light\s*=\s*false/);
  });

  it('index.ts should not contain raw promise-chain queueing (xxx = xxx.then)', () => {
    expect(indexSource).not.toMatch(/this\.\w+Queue\s*=\s*this\.\w+Queue\s*\.then/);
  });

  it('index.ts should import concurrency primitives', () => {
    expect(indexSource).toMatch(/from\s+'\.\/concurrency\/guard'/);
    expect(indexSource).toMatch(/from\s+'\.\/concurrency\/mutex-queue'/);
    expect(indexSource).toMatch(/from\s+'\.\/concurrency\/ttl-map'/);
  });
});
