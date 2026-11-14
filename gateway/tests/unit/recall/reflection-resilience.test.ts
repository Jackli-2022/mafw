import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ReflectionPipeline,
  parseInsightsDetailed,
  selectRestoreSessions,
} from '../../../src/recall/reflection';
import { createBuiltinIdentityRegistry } from '../../../src/runtime/identity-registry';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { ReflectCursor } from '../../../src/recall/reflect-cursor';
import { GatewayDatabase } from '../../../src/memory/gateway-db';

interface SetupOpts {
  sessions?: Array<{ id: string; episodes: number }>;
  batchSize?: number;
  reflectReply?: (prompt: string) => string | Promise<string>;
  now?: () => number;
  maxRunMs?: number;
  maxSessionsPerRun?: number;
}

async function setup(opts: SetupOpts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-refl-resilience-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  const store = new HarmonicUnitFileStore(dir, index);
  const nowIso = new Date().toISOString();
  const ids: string[] = [];
  for (const session of opts.sessions ?? [{ id: 's1', episodes: 2 }]) {
    for (let i = 1; i <= session.episodes; i++) {
      const id = `${session.id}-ep${i}`;
      ids.push(id);
      await store.write({
        id,
        type: 'episodic',
        primary_abstraction: `${id} event`,
        cue_anchors: ['ep'],
        memory_value: `${id} body`,
        energy: 0.8,
        created_at: nowIso,
        updated_at: nowIso,
        source_session_id: session.id,
      } as any, 'episodic');
    }
  }

  const errors: Array<{ sessionID: string; error: string }> = [];
  const prompts: Array<{ prompt: string; system: string }> = [];
  const agents: string[] = [];
  const worker = {
    prompt: jest.fn(async (prompt: string, system: string, _model?: unknown, agent?: string) => {
      prompts.push({ prompt, system });
      if (agent) agents.push(agent);
      if (system.includes('salient high-level questions')) return JSON.stringify({ questions: [] });
      if (opts.reflectReply) return opts.reflectReply(prompt);
      return JSON.stringify({ insights: [] });
    }),
  };
  const db = new GatewayDatabase(path.join(dir, 'db.sqlite'));
  const cursor = new ReflectCursor(db);
  const pipe = new ReflectionPipeline({
    index,
    baseDir: dir,
    workerFor: () => worker as any,
    cursor,
    reflectionBatchSize: opts.batchSize ?? 10,
    now: opts.now,
    maxRunMs: opts.maxRunMs,
    maxSessionsPerRun: opts.maxSessionsPerRun,
    onError: (info) => errors.push(info),
  });
  return { dir, db, cursor, pipe, prompts, errors, agents, ids };
}

function cleanup(ctx: { dir: string; db: GatewayDatabase }) {
  ctx.db.close();
  fs.rmSync(ctx.dir, { recursive: true, force: true });
}

describe('parseInsightsDetailed', () => {
  test('extracts JSON after a prose preamble', () => {
    const res = parseInsightsDetailed(
      'Here is the reflection result:\n{"insights":[{"category":"insight","content":"keep the lock","cue_anchors":["lock"]}]}\nDone.',
    );
    expect(res.ok).toBe(true);
    expect(res.insights).toHaveLength(1);
    expect(res.insights[0].content).toBe('keep the lock');
  });

  test('a well-formed empty insights array is a successful parse', () => {
    expect(parseInsightsDetailed('{"insights":[]}')).toEqual({ ok: true, insights: [] });
  });

  test('non-JSON output is not a successful parse', () => {
    expect(parseInsightsDetailed('I could not find anything durable.').ok).toBe(false);
  });
});

describe('reflection resilience', () => {
  test('the reflector identity disables every tool', () => {
    const spec = createBuiltinIdentityRegistry().get('memory-reflector');
    expect(spec).toBeTruthy();
    expect(spec?.nativeTools).toEqual({ '*': false });
  });

  test('reflection prompts run on the tool-free memory-reflector identity', async () => {
    const ctx = await setup({ reflectReply: () => '{"insights":[]}' });
    await ctx.pipe.runSession('s1');
    expect(ctx.agents.length).toBeGreaterThan(0);
    expect(new Set(ctx.agents)).toEqual(new Set(['memory-reflector']));
    cleanup(ctx);
  });

  test('boot restore is bounded and skips sessions below the pending threshold', () => {
    const pending: Record<string, number> = { a: 5, b: 1, c: 4, d: 9 };
    expect(selectRestoreSessions(Object.keys(pending), (id) => pending[id], 3, 2)).toEqual(['a', 'c']);
    expect(selectRestoreSessions(Object.keys(pending), (id) => pending[id], 3, 0)).toEqual([]);
  });

  test('accepts a JSON result wrapped in prose and advances the cursor', async () => {
    const ctx = await setup({
      reflectReply: () =>
        'Reflection:\n{"insights":[{"category":"insight","content":"prose-wrapped insight","cue_anchors":["prose"]}]}',
    });
    const res = await ctx.pipe.runSession('s1');
    expect(res.distilled).toBe(1);
    expect(ctx.cursor.isReflected('s1', 's1-ep1')).toBe(true);
    expect(ctx.cursor.isReflected('s1', 's1-ep2')).toBe(true);
    cleanup(ctx);
  });

  test('a valid empty result advances the cursor instead of reprocessing forever', async () => {
    const ctx = await setup({ reflectReply: () => '{"insights":[]}' });
    const res = await ctx.pipe.runSession('s1');
    expect(res.failed).toBe(0);
    expect(ctx.cursor.isReflected('s1', 's1-ep1')).toBe(true);
    expect(ctx.cursor.isReflected('s1', 's1-ep2')).toBe(true);
    cleanup(ctx);
  });

  test('unparseable output keeps episodes pending and reports the reason', async () => {
    const ctx = await setup({ reflectReply: () => 'not json at all' });
    const res = await ctx.pipe.runSession('s1');
    expect(res.failed).toBe(1);
    expect(ctx.cursor.isReflected('s1', 's1-ep1')).toBe(false);
    expect(ctx.errors).toHaveLength(1);
    expect(ctx.errors[0].sessionID).toBe('s1');
    expect(ctx.errors[0].error).toContain('unparseable');
    cleanup(ctx);
  });

  test('worker failures report session plus error and keep episodes pending', async () => {
    const ctx = await setup({
      reflectReply: () => {
        throw new Error('worker down');
      },
    });
    const res = await ctx.pipe.runSession('s1');
    expect(res.failed).toBe(1);
    expect(ctx.cursor.isReflected('s1', 's1-ep1')).toBe(false);
    expect(ctx.errors[0]).toEqual({ sessionID: 's1', error: 'worker down' });
    cleanup(ctx);
  });

  test('runAll respects maxSessionsPerRun so one cron tick cannot run forever', async () => {
    const ctx = await setup({
      sessions: [
        { id: 's1', episodes: 2 },
        { id: 's2', episodes: 2 },
      ],
      maxSessionsPerRun: 1,
    });
    const res = await ctx.pipe.runAll();
    expect(res.reviewed).toBe(2);
    expect(res.deferredSessions).toBe(1);
    expect(ctx.cursor.isReflected('s1', 's1-ep1')).toBe(true);
    expect(ctx.cursor.isReflected('s2', 's2-ep1')).toBe(false);
    cleanup(ctx);
  });

  test('runAll stops between batches once the wall-clock budget is spent', async () => {
    let clock = 0;
    const ctx = await setup({
      sessions: [{ id: 's1', episodes: 4 }],
      batchSize: 2,
      maxRunMs: 50,
      now: () => clock,
      reflectReply: () => {
        clock += 100; // two prompts in batch 1 push the clock past the budget
        return '{"insights":[]}';
      },
    });
    const res = await ctx.pipe.runAll();
    expect(res.reviewed).toBe(2);
    expect(ctx.cursor.isReflected('s1', 's1-ep1')).toBe(true);
    expect(ctx.cursor.isReflected('s1', 's1-ep2')).toBe(true);
    expect(ctx.cursor.isReflected('s1', 's1-ep3')).toBe(false);
    expect(ctx.cursor.isReflected('s1', 's1-ep4')).toBe(false);
    cleanup(ctx);
  });
});
