import { TurnPipeline } from '../../src/recall/turn-pipeline';

function makePipeline(turns: any[], observations: any[]) {
  const prompts: string[] = [];
  const archived: string[] = [];
  const pipeline = new TurnPipeline({
    t1db: {
      listTurns: () => turns,
      readTurn: () => observations,
      archiveTurn: (sid: string, tid: number) => archived.push(`${sid}:${tid}`),
      logNoop: () => {},
    } as any,
    index: { getIndex: () => ({ entries: [] }) } as any,
    workerFor: () => ({ prompt: async (p: string) => { prompts.push(p); return 'ok'; } }),
    staleMs: 0,
    workerModel: { providerID: 'p', modelID: 'm' },
  });
  return { pipeline, prompts, archived };
}

function turn(sessionID: string, turnID: number) {
  const nowSec = Math.floor(Date.now() / 1000);
  return { session_id: sessionID, turn_id: turnID, count: 2, has_user_input: 1, response_count: 1, last_ts: nowSec - 1000 };
}

describe('TurnPipeline.runSession', () => {
  it('processes only the given session', async () => {
    const turns = [turn('s1', 1), turn('s2', 2)];
    const { pipeline, prompts, archived } = makePipeline(turns, [
      { source: 'user_input', content: 'hello' } as any,
    ]);
    const res = await pipeline.runSession('s1');
    expect(res.turns).toBe(1);
    expect(archived).toEqual(['s1:1']);
    expect(prompts).toHaveLength(1);
  });

  it('returns zeros when the session has no completed turns', async () => {
    const { pipeline } = makePipeline([], []);
    const res = await pipeline.runSession('nobody');
    expect(res).toEqual({ turns: 0, archived: 0, noops: 0, failed: 0 });
  });

  it('runOnce still aggregates across sessions (no regression)', async () => {
    const turns = [turn('s1', 1), turn('s2', 2)];
    const { pipeline, archived } = makePipeline(turns, [
      { source: 'user_input', content: 'hello' } as any,
    ]);
    const res = await pipeline.runOnce();
    expect(res.sessions).toBe(2);
    expect(res.turns).toBe(2);
    expect(archived.sort()).toEqual(['s1:1', 's2:2']);
  });
});
