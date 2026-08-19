import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { HarmonicIndexManager } from '../../../gateway/src/core/memory/harmonic-index';
import { TurnPipeline, sessionContext } from '../../../gateway/src/recall/turn-pipeline';
import { MemoryWorker } from '../../../gateway/src/recall/memory-worker';

describe('TurnPipeline (hourly batch compression → agent writes memories)', () => {
  let tmpDir: string;
  let t1db: GatewayDatabase;
  let index: HarmonicIndexManager;
  let fakeClient: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-tp-'));
    fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
    t1db = new GatewayDatabase(':memory:');
    index = new HarmonicIndexManager(tmpDir);
    fakeClient = {
      session: {
        create: jest.fn().mockImplementation(async () => ({ data: { id: `worker-${Math.random().toString(36).slice(2, 8)}` } })),
        prompt: jest.fn().mockResolvedValue({ data: { parts: [{ type: 'text', text: 'done' }] } }),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    };
  });

  afterEach(() => {
    t1db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const mkWorker = () => new MemoryWorker(fakeClient, { directory: tmpDir });

  const seedSession = (session: string, turns: Array<Array<[string, string]>>) => {
    turns.forEach((obs, i) => {
      const turn = i + 1;
      t1db.append({ session_id: session, turn_id: turn, source: 'user_input', content: `user msg ${turn}`, failure: 0 });
      for (const [source, content] of obs) {
        t1db.append({ session_id: session, turn_id: turn, source: source as any, content, failure: 0 });
      }
    });
  };

  test('batches all completed turns of a session into ONE prompt, then deletes them', async () => {
    seedSession('s1', [
      [['assistant_reply', 'checked auth'], ['tool_result', 'tests pass']],
      [['assistant_reply', 'fixed token expiry']],
    ]);

    const pipeline = new TurnPipeline({
      t1db,
      index,
      workerFor: () => mkWorker(),
      staleMs: 30_000,
    });
    const res = await pipeline.runOnce();

    expect(res.sessions).toBe(1);
    expect(res.turns).toBe(2);
    expect(res.deleted).toBe(2);
    expect(fakeClient.session.prompt).toHaveBeenCalledTimes(1); // ONE compression for the session
    const promptArg = fakeClient.session.prompt.mock.calls[0][0].body.parts[0].text;
    expect(promptArg).toContain('[USER] user msg 1');
    expect(promptArg).toContain('[USER] user msg 2');
    expect(promptArg).toContain('[TOOL] tests pass');
    // tool-instruction system prompt
    expect(fakeClient.session.prompt.mock.calls[0][0].body.system).toContain('mafw_add_memory');
    // t1 emptied
    expect(t1db.count()).toBe(0);
  });

  test('deletes turns even when the worker prompt fails (processed = done)', async () => {
    seedSession('s1', [[['assistant_reply', 'x']]]);
    fakeClient.session.prompt.mockRejectedValue(new Error('serve down'));

    const pipeline = new TurnPipeline({ t1db, index, workerFor: () => mkWorker(), staleMs: 30_000 });
    const res = await pipeline.runOnce();

    expect(res.failed).toBe(1);
    expect(res.deleted).toBe(1);
    expect(t1db.count()).toBe(0);
  });

  test('deletes turns even when the agent writes nothing (empty result)', async () => {
    seedSession('s1', [[['assistant_reply', 'nothing worth saving']]]);
    fakeClient.session.prompt.mockResolvedValue({ data: { parts: [{ type: 'text', text: 'no memories worth saving' }] } });

    const pipeline = new TurnPipeline({ t1db, index, workerFor: () => mkWorker(), staleMs: 30_000 });
    const res = await pipeline.runOnce();

    expect(res.deleted).toBe(1);
    expect(t1db.count()).toBe(0);
  });

  test('pending turns (no response, not stale) stay in T1', async () => {
    t1db.append({ session_id: 's1', turn_id: 1, source: 'user_input', content: 'user msg 1', failure: 0 });
    const pipeline = new TurnPipeline({ t1db, index, workerFor: () => mkWorker(), staleMs: 30_000 });
    const res = await pipeline.runOnce();
    expect(res.sessions).toBe(0);
    expect(t1db.count()).toBe(1);
  });

  test('sessions are independent', async () => {
    seedSession('sa', [[['assistant_reply', 'a done']]]);
    seedSession('sb', [[['assistant_reply', 'b done']]]);
    const pipeline = new TurnPipeline({ t1db, index, workerFor: () => mkWorker(), staleMs: 30_000 });
    const res = await pipeline.runOnce();
    expect(res.sessions).toBe(2);
    expect(fakeClient.session.prompt).toHaveBeenCalledTimes(2);
    expect(t1db.count()).toBe(0);
  });

  test('injects prior episodic context for the session', async () => {
    index.addEntry({
      id: 'ep-prior',
      type: 'episodic',
      primary_abstraction: 'previous hour: auth setup',
      cue_anchors: ['auth'],
      memory_value: 'v',
      energy: 0.7,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source_session_id: 's1',
    }, 'episodic');

    seedSession('s1', [[['assistant_reply', 'x']]]);
    const pipeline = new TurnPipeline({ t1db, index, workerFor: () => mkWorker(), staleMs: 30_000 });
    await pipeline.runOnce();
    const promptArg = fakeClient.session.prompt.mock.calls[0][0].body.parts[0].text;
    expect(promptArg).toContain('previous hour: auth setup');
  });
});

describe('sessionContext', () => {
  test('returns empty when the session has no prior episodes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-sc-'));
    const index = new HarmonicIndexManager(tmp);
    expect(sessionContext(index, 'nope')).toBe('');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('only counts the session’s own episodes, most recent K', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-sc-'));
    fs.mkdirSync(path.join(tmp, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(tmp);
    index.addEntry({
      id: 'a1', type: 'episodic', primary_abstraction: 's1 ep1', cue_anchors: [], memory_value: 'v',
      energy: 0.5, created_at: 't1', updated_at: 't1', source_session_id: 's1',
    }, 'episodic');
    index.addEntry({
      id: 'a2', type: 'episodic', primary_abstraction: 's1 ep2', cue_anchors: [], memory_value: 'v',
      energy: 0.5, created_at: 't2', updated_at: 't2', source_session_id: 's1',
    }, 'episodic');
    index.addEntry({
      id: 'b1', type: 'episodic', primary_abstraction: 's2 ep', cue_anchors: [], memory_value: 'v',
      energy: 0.5, created_at: 't3', updated_at: 't3', source_session_id: 's2',
    }, 'episodic');

    const ctx = sessionContext(index, 's1', 10);
    expect(ctx).toContain('s1 ep2');
    expect(ctx).not.toContain('s2 ep');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
