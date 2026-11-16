import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReflectionPipeline } from '../../../src/recall/reflection';
import { TOOL_EXTRACTION_SYSTEM } from '../../../src/recall/turn-pipeline';

function cursor() {
  const reflected = new Set<string>();
  return {
    isReflected: (sessionID: string, id: string) => reflected.has(`${sessionID}:${id}`),
    markReflected: (sessionID: string, ids: string[]) => {
      for (const id of ids) reflected.add(`${sessionID}:${id}`);
    },
    prune: () => {},
    reflected,
  } as any;
}

describe('reflection over T1 episodes', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-episodes-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('turnCompress prompt no longer offers episodic', () => {
    expect(TOOL_EXTRACTION_SYSTEM).not.toMatch(/-\s*episodic:/i);
    expect(TOOL_EXTRACTION_SYSTEM).toContain('episodes already live in T1');
    expect(TOOL_EXTRACTION_SYSTEM).toContain('episodic');
  });

  test('reflects an episode using stored intent/outcome/traceIds', async () => {
    const c = cursor();
    const prompts: string[] = [];
    const worker = {
      prompt: async (prompt: string) => {
        prompts.push(prompt);
        return prompts.length === 1
          ? '{"questions":[]}'
          : '{"insights":[{"category":"insight","content":"baseline evidence matters","cue_anchors":["baseline"]}]}';
      },
    };
    const pipeline = new ReflectionPipeline({
      index: {
        getIndex: () => ({ entries: [] }),
        searchScored: () => [],
      } as any,
      baseDir: dir,
      workerFor: () => worker as any,
      cursor: c,
      reflectionInput: 'episodes',
      maxRunMs: 5000,
      episodeSource: {
        list: () => [{
          episodeId: 't1ep_a',
          sessionId: 's1',
          startTurn: 1,
          endTurn: 3,
          status: 'closed',
          startedAt: 1,
          endedAt: 2,
          boundarySource: 'declared',
          boundaryReason: 'agent_declared',
          confidence: 1,
          intent: 'review embedding',
          outcome: 'baseline missing',
          actors: [],
          conceptIds: [],
          sourceTraceIds: ['t1t_1', 't1t_2'],
        }],
      },
    });

    const result = await pipeline.runSession('s1');
    expect(result.reviewed).toBe(1);
    expect(prompts[0]).toContain('review embedding');
    expect(prompts[0]).toContain('baseline missing');
    expect(c.reflected.has('s1:t1ep_a')).toBe(true);

    const files = fs.readdirSync(dir, { recursive: true }).map(String);
    const markdown = files.find((file) => file.endsWith('.md'));
    expect(markdown).toBeTruthy();
    const content = fs.readFileSync(path.join(dir, markdown!), 'utf-8');
    expect(content).toContain('episode_id: t1ep_a');
  });

  test('skips internal sessions', async () => {
    const c = cursor();
    const worker = { prompt: async () => '{"questions":[]}' };
    const pipeline = new ReflectionPipeline({
      index: { getIndex: () => ({ entries: [] }), searchScored: () => [] } as any,
      baseDir: dir,
      workerFor: () => worker as any,
      cursor: c,
      episodeSource: {
        list: () => [{
          episodeId: 't1ep_i', sessionId: 'worker', startTurn: 1, endTurn: 2,
          status: 'closed', startedAt: 1, endedAt: 2, boundarySource: 'declared',
          boundaryReason: 'agent_declared', confidence: 1, actors: [], conceptIds: [], sourceTraceIds: [],
        }],
        isInternalSession: (id: string) => id === 'worker',
      },
    });
    const result = await pipeline.runSession('worker');
    expect(result.reviewed).toBe(0);
  });
});
