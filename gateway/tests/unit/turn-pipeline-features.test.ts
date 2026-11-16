import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';
import { TurnPipeline } from '../../src/recall/turn-pipeline';

describe('TurnPipeline writes the T1 sparse event code', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-feature-pipeline-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('builds a feature before archiving the turn', async () => {
    const turn = db.beginTurn('s1');
    db.append({
      session_id: 's1',
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'user_input',
      content: '修一下 reflection，为什么 unparseable',
      failure: 0,
    });
    db.append({
      session_id: 's1',
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'tool_result',
      content: 'read reflection.ts',
      failure: 0,
    });
    db.append({
      session_id: 's1',
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'assistant_reply',
      content: '决定 adapter 前置 system。',
      failure: 0,
    });
    db.getStore()
      .prepare(
        `INSERT INTO trajectory_events
           (project_id, session_id, turn_id, seq, event_type, tool_name, agent, time_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('p', 's1', turn.turn_seq, 1, 'tool', 'read', 'reviewer', Date.now());

    const index: any = { getIndex: () => ({ entries: [] }) };
    const prompts: string[] = [];
    const worker: any = {
      prompt: async (message: string) => {
        prompts.push(message);
        return '[EXTRACTED: 0]';
      },
    };
    const pipeline = new TurnPipeline({
      t1db: db,
      index,
      workerFor: () => worker,
      staleMs: 60_000,
      semanticAtomsFor: async (turns) =>
        new Map(
          turns.map((turn) => [
            turn.traceId,
            [{ termId: 'error:json_parse', cosine: 0.9 }],
          ]),
        ),
    });

    await pipeline.runOnce();

    const feature = db.getTurnFeature(turn.trace_id);
    expect(feature).not.toBeNull();
    expect(feature!.intent).toContain('修一下 reflection');
    expect(feature!.action).toContain('reflection.ts');
    expect(feature!.decision).toContain('adapter 前置 system');

    // Phase C: the same pass writes the episode code (actors/concepts/sparse)
    // by joining trajectory metadata, and marks the turn as encoded.
    expect(db.getTurnActors(turn.trace_id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorId: 'user:local', role: 'requester' }),
        expect.objectContaining({ actorId: 'agent:reviewer', role: 'reviewer' }),
        expect.objectContaining({ actorId: 'tool:read', role: 'instrument' }),
      ]),
    );
    expect(db.getTurnConcepts(turn.trace_id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conceptId: 'error:json_parse' }),
      ]),
    );
    expect(db.getSparseTerms(turn.trace_id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          termId: 'sem:error:json_parse',
          kind: 'semantic',
          model: 'sparse-embed-v1',
        }),
      ]),
    );
    expect(db.listTurnsMissingEncoding(10)).toEqual([]);

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('--- REPLAY START');
    expect(prompts[0]).toContain(`[trace:${turn.trace_id}][INTENT]`);
  });
});
