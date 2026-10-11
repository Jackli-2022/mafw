import { registerWorkerOrigin, resolveWorkerOrigin, clearWorkerOrigins } from '../../../src/recall/worker-origin';
import { SessionWorkerPool } from '../../../src/recall/session-worker-pool';

describe('worker-origin registry', () => {
  test('register + resolve + unknown → null', () => {
    clearWorkerOrigins();
    registerWorkerOrigin('w1', 'src-1');
    expect(resolveWorkerOrigin('w1')).toBe('src-1');
    expect(resolveWorkerOrigin('nope')).toBeNull();
    clearWorkerOrigins();
    expect(resolveWorkerOrigin('w1')).toBeNull();
  });
});

describe('SessionWorkerPool registers origin on session creation', () => {
  test('worker session id maps back to the source session', async () => {
    clearWorkerOrigins();
    let seq = 0;
    const client = {
      session: {
        create: async () => ({ id: `w-${++seq}` }),
        prompt: async () => ({ parts: [{ type: 'text', text: 'ok' }] }),
        summarize: async () => true,
        delete: async () => {},
      },
    };
    const created: Array<[string, string]> = [];
    const pool = new SessionWorkerPool({
      client: client as any,
      directory: '/tmp',
      ttlMs: 60_000,
      onSessionCreated: (sid, role) => created.push([sid, role]),
    });
    const worker = pool.getWorker('src-42', 'extract');
    await worker.prompt('hi', 'sys');
    const mapped = resolveWorkerOrigin('w-1');
    expect(mapped).toBe('src-42');
    expect(created).toContainEqual(['w-1', 'extract']);
    await pool.disposeAll();
  });
});
