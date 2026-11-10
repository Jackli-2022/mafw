import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ReflectionPipeline,
  REFLECT_SYSTEM,
  parseInsights,
  buildInsightUnit,
} from '../../../src/recall/reflection';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { ReflectCursor } from '../../../src/recall/reflect-cursor';
import { GatewayDatabase } from '../../../src/memory/gateway-db';

const trace = (id: string, content: string, source = 'user_input') => ({
  turn: {
    trace_id: id, session_id: 's1', turn_seq: 1,
    created_at: 1, archived_at: null, encoding_salience: null, legacy_ambiguous: 0,
  },
  rows: [{
    session_id: 's1', turn_id: 1, trace_id: id, observation_key: `t1o_${id}`,
    source, content, failure: 0, created_at: 1,
  }],
  archived: false,
}) as any;

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-refl-replay-'));
}

async function setup(workerPrompt: (prompt: string, system: string) => Promise<string>, replay?: any) {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  const now = new Date().toISOString();
  const store = new HarmonicUnitFileStore(dir, index);
  await store.write({
    id: 'ep1', type: 'episodic', primary_abstraction: 'deploy failed',
    cue_anchors: ['deploy'], memory_value: 'deploy failed with ECONNRESET',
    energy: 0.8, created_at: now, updated_at: now,
    source_session_id: 's1', source_trace_ids: ['t1t_exact'],
  } as any, 'episodic');

  const prompts: Array<{ prompt: string; system: string }> = [];
  const worker = {
    prompt: async (prompt: string, system: string) => {
      prompts.push({ prompt, system });
      return workerPrompt(prompt, system);
    },
  };
  const db = new GatewayDatabase(path.join(dir, 'db.sqlite'));
  const cursor = new ReflectCursor(db);
  const pipe = new ReflectionPipeline({
    index, baseDir: dir, workerFor: () => worker as any, cursor,
    ...(replay ? { t1Replay: replay } : {}),
  });
  return { dir, index, pipe, prompts, db };
}

afterEach(() => jest.restoreAllMocks());

describe('reflection raw T1 replay', () => {
  test('injects raw evidence, validates batch provenance and marks replay', async () => {
    const mark = jest.fn();
    const traces: Record<string, any> = {
      t1t_exact: trace('t1t_exact', 'exact raw evidence'),
      t1t_old: trace('t1t_old', 'old activated evidence', 'tool_result'),
      t1t_new: trace('t1t_new', 'new question evidence', 'assistant_reply'),
    };
    const { dir, index, pipe, prompts, db } = await setup(
      async (_p, system) => {
        if (system.includes('salient high-level questions')) {
          return JSON.stringify({ questions: ['why did deploy fail'] });
        }
        return JSON.stringify({
          insights: [{
            category: 'insight',
            content: 'deploy failed due to ECONNRESET',
            cue_anchors: ['deploy', 'ECONNRESET'],
            sourceTraceIds: ['t1t_exact', 't1t_foreign'],
          }],
        });
      },
      {
        deps: {
          readTrace: (id: string) => traces[id] ?? null,
          searchT1: async () => [{ traceId: 't1t_new', sessionId: 's1', turnId: 1, cosine: 0.8, excerpt: 'x' }],
          topActivatedTraces: () => [{ traceId: 't1t_old', activation: 0.5 }],
          markT1Replayed: mark,
        },
      },
    );

    const res = await pipe.runSession('s1');

    const distill = prompts.find((p) => p.system.includes('distill durable'))!;
    expect(distill.prompt).toContain('RAW T1 REPLAY START');
    expect(distill.prompt).toContain('[trace:t1t_exact][USER] exact raw evidence');
    expect(distill.prompt).toContain('[trace:t1t_old][TOOL] old activated evidence');
    expect(distill.prompt).toContain('[trace:t1t_new][ASSISTANT] new question evidence');

    const insight = index.getIndex().entries.find((e) => e.type === 'semantic' && e.primary_abstraction.includes('ECONNRESET'))!;
    expect((insight as any).source_trace_ids).toEqual(['t1t_exact']);
    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith(['t1t_exact', 't1t_old', 't1t_new']);
    expect(res.distilled).toBeGreaterThan(0);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('replay failure degrades to gist-only reflection', async () => {
    const { dir, index, pipe, prompts, db } = await setup(
      async (_p, system) => {
        if (system.includes('salient high-level questions')) return JSON.stringify({ questions: ['q'] });
        return JSON.stringify({ insights: [{ category: 'insight', content: 'gist-only insight', cue_anchors: ['x'] }] });
      },
      {
        deps: {
          readTrace: () => { throw new Error('db down'); },
          searchT1: async () => { throw new Error('search down'); },
          topActivatedTraces: () => { throw new Error('state down'); },
          markT1Replayed: jest.fn(),
        },
      },
    );

    const res = await pipe.runSession('s1');

    const distill = prompts.find((p) => p.system.includes('distill durable'))!;
    expect(distill.prompt).not.toContain('RAW T1 REPLAY START');
    expect(res.distilled).toBeGreaterThan(0);
    const insight = index.getIndex().entries.find((e) => e.type === 'semantic' && e.primary_abstraction.includes('gist-only'))!;
    expect((insight as any).source_trace_ids).toBeUndefined();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('worker failure does not mark replay and keeps the episode pending', async () => {
    const mark = jest.fn();
    const { dir, pipe, db } = await setup(
      async () => { throw new Error('worker down'); },
      { deps: { readTrace: () => trace('t1t_exact', 'raw'), markT1Replayed: mark } },
    );
    const res = await pipe.runSession('s1');
    expect(res.failed).toBeGreaterThan(0);
    expect(mark).not.toHaveBeenCalled();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('reflection insight provenance parsing', () => {
  test('parseInsights accepts sourceTraceIds', () => {
    const [insight] = parseInsights(JSON.stringify({
      insights: [{ category: 'insight', content: 'x', sourceTraceIds: ['t1t_a'] }],
    }));
    expect(insight.source_trace_ids).toEqual(['t1t_a']);
  });

  test('buildInsightUnit persists validated ids', () => {
    const unit = buildInsightUnit(
      { category: 'insight', content: 'x', cue_anchors: [], source_trace_ids: ['t1t_a'] },
      's1',
      new Date().toISOString(),
    );
    expect(unit.source_trace_ids).toEqual(['t1t_a']);
  });

  test('prompt asks for exact sourceTraceIds', () => {
    expect(REFLECT_SYSTEM).toContain('sourceTraceIds');
    expect(REFLECT_SYSTEM).toContain('[trace:');
  });
});
