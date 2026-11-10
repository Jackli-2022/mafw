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
    // Phase B Task 4 removed the last Guard consumer (snapshotGuard →
    // scheduler); MutexQueue and TtlMap remain in use.
    const index = sources.find((s) => s.file === 'index.ts')!;
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

describe('scheduler migration guard (Phase B Task 3)', () => {
  const srcDir = path.join(__dirname, '..', '..', '..', 'src');
  const index = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf-8');
  const engine = fs.readFileSync(path.join(srcDir, 'automation-engine.ts'), 'utf-8');

  it('index.ts constructs the unified Scheduler and imports from scheduler/', () => {
    expect(index).toMatch(/new Scheduler\(/);
    expect(index).toMatch(/from\s+['"]\.\/scheduler['"]/);
  });

  it('index.ts no longer hand-rolls pipeline guards', () => {
    expect(index).not.toMatch(/runPipelineGuarded/);
    expect(index).not.toMatch(/pipelineGuard\s*=/);
  });

  it('index.ts no longer registers actions via the module-global actionRegistry', () => {
    expect(index).not.toMatch(/actionRegistry\.set/);
    expect(index).not.toMatch(/import\s*\{[^}]*actionRegistry[^}]*\}\s*from\s*["']\.\/automation-engine["']/);
  });

  it('automation-engine no longer exports the module-global actionRegistry', () => {
    expect(engine).not.toMatch(/export const actionRegistry/);
  });

  it('snapshot builds go through the scheduler as defer-to-idle (no snapshotGuard)', () => {
    expect(index).not.toMatch(/snapshotGuard\s*=/);
    expect(index).toMatch(/strategy:\s*['"]defer-to-idle['"]/);
    expect(index).toMatch(/mutexKey:\s*['"]snapshot['"]/);
  });

  it('NodeDriver uses MutexQueue, not a raw promise-chain mutex (B2 Task 2)', () => {
    const driver = fs.readFileSync(path.join(srcDir, 'core', 'goal', 'driver.ts'), 'utf-8');
    expect(driver).not.toMatch(/private\s+mutex\s*=\s*new\s+Map<string,\s*Promise/);
    expect(driver).toMatch(/new\s+MutexQueue\(\)/);
  });

  it('index.ts declares the registry wiring and drives a unified sweeper (Phase C)', () => {
    expect(index).toMatch(/from\s+['"]\.\/session['"]/);
    expect(index).toMatch(/sessionRegistry\.sweep\(\)/);
    expect(index).not.toMatch(/internalSessionRoles\s*=\s*new\s+Map/);
  });

  it('index.ts uses the DEFAULT registry singleton (no split-brain with worker-origin)', () => {
    // worker-origin falls back to getDefaultSessionRegistry(); the pool and
    // views must write the SAME instance or origin resolution silently
    // no-ops in production (final review C1).
    expect(index).toMatch(/sessionRegistry\s*=\s*getDefaultSessionRegistry\(\)/);
    expect(index).not.toMatch(/sessionRegistry\s*=\s*new\s+SessionRegistry\(\)/);
  });

  it('worker-origin is a registry view, not a module-level Map (Phase C)', () => {
    const workerOrigin = fs.readFileSync(path.join(srcDir, 'recall', 'worker-origin.ts'), 'utf-8');
    expect(workerOrigin).not.toMatch(/const\s+origins\s*=\s*new\s+Map/);
    expect(workerOrigin).toMatch(/getDefaultSessionRegistry/);
  });

  it('session-worker-pool registers worker sessions and consumes the registry (Phase C)', () => {
    const pool = fs.readFileSync(path.join(srcDir, 'recall', 'session-worker-pool.ts'), 'utf-8');
    expect(pool).toMatch(/registry\?:\s*SessionRegistry/);
    expect(pool).toMatch(/registerWorkerSession/);
  });

  it('index.ts wires the engine through the provider/scheduler/graph injections', () => {
    expect(index).toMatch(/setActionsProvider/);
    expect(index).toMatch(/setScheduler/);
    expect(index).toMatch(/setGraphProvider/);
    expect(index).toMatch(/registerAction\(/);
  });

  it('cron pipeline actions carry budget admission with the internal pipeline names', () => {
    // Names MUST match the pipelines' internal PipelineBudget.allow() calls
    // (turn-pipeline 'extract', reflection 'reflect', stale-verify 'review',
    // reconsolidate-pipeline 'reconsolidate', index.ts dream, axiomDistill).
    for (const name of ['extract', 'reflect', 'review', 'reconsolidate', 'dream', 'axiomDistill']) {
      expect(index).toMatch(
        new RegExp(`pipeline:\\s*['"]${name}['"]`),
        `missing budget taskOpts for pipeline "${name}"`,
      );
    }
  });
});
