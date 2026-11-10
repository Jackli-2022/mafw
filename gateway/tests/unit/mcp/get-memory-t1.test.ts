import { handleGetMemory } from '../../../src/mcp/handlers/get-memory';

const parse = (res: any) => JSON.parse(res.content[0].text);

describe('handleGetMemory t1 pointer redemption', () => {
  const rows = [
    { session_id: 'ses_FULL123456', turn_id: 5, source: 'user_input', content: 'what did the deploy say' },
    { session_id: 'ses_FULL123456', turn_id: 5, source: 'tool_result', content: 'deploy ok in 3s' },
  ];
  test('t1:<tail>:<turn> resolves through resolveT1 and returns rows', async () => {
    const res = await handleGetMemory({ id: 't1:123456:5' }, {
      resolveT1: (tail: string, turn: number) => (tail === '123456' && turn === 5 ? (rows as any) : []),
    } as any);
    const body = parse(res);
    expect(body.success).toBe(true);
    expect(body.t1.sessionId).toBe('ses_FULL123456');
    expect(body.t1.turnId).toBe(5);
    expect(body.t1.rows).toHaveLength(2);
    expect(body.t1.rows[1].content).toBe('deploy ok in 3s');
  });
  test('no matches → success false with helpful error', async () => {
    const res = await handleGetMemory({ id: 't1:zzzzzz:9' }, { resolveT1: () => [] } as any);
    const body = parse(res);
    expect(body.success).toBe(false);
    expect(String(body.error)).toContain('t1');
  });
  test('t1:<traceId> resolves through readTrace with archive metadata', async () => {
    const recorded: any[] = [];
    const res = await handleGetMemory({ id: 't1:t1t_abc' }, {
      readTrace: (traceId: string) => traceId === 't1t_abc' ? {
        turn: { trace_id: 't1t_abc', session_id: 'ses_FULL', turn_seq: 4, created_at: 1, archived_at: 2, encoding_salience: 0.5, legacy_ambiguous: 1 },
        rows: [{ session_id: 'ses_FULL', turn_id: 4, trace_id: 't1t_abc', observation_key: 'obs_1', source: 'user_input', content: 'raw q', failure: 0, created_at: 1 }],
        archived: true,
      } : null,
      recordT1Retrieval: (traceId: string, kind: string) => recorded.push({ traceId, kind }),
    } as any);
    const body = parse(res);
    expect(body.success).toBe(true);
    expect(body.t1).toMatchObject({
      traceId: 't1t_abc',
      sessionId: 'ses_FULL',
      turnId: 4,
      archived: true,
      legacyAmbiguous: true,
    });
    expect(body.t1.rows[0]).toMatchObject({ source: 'user_input', content: 'raw q', observationKey: 'obs_1' });
    expect(recorded).toEqual([{ traceId: 't1t_abc', kind: 'redeem' }]);
  });
  test('unknown trace id → helpful t1 error', async () => {
    const res = await handleGetMemory({ id: 't1:t1t_missing' }, { readTrace: () => null } as any);
    const body = parse(res);
    expect(body.success).toBe(false);
    expect(String(body.error)).toContain('t1');
  });
  test('legacy t1 pointer records a redeem event when the row has a trace id', async () => {
    const recorded: any[] = [];
    const rowsWithTrace = [
      { session_id: 'ses_FULL123456', turn_id: 5, trace_id: 't1t_old', source: 'user_input', content: 'q' },
    ];
    const res = await handleGetMemory({ id: 't1:123456:5' }, {
      resolveT1: () => rowsWithTrace as any,
      recordT1Retrieval: (traceId: string, kind: string) => recorded.push({ traceId, kind }),
    } as any);
    expect(parse(res).success).toBe(true);
    expect(recorded).toEqual([{ traceId: 't1t_old', kind: 'redeem' }]);
  });
  test('non-t1 id → t1 branch not triggered', async () => {
    let called = false;
    const memory = { harmonicIndex: { getIndex: () => ({ entries: [] }) } };
    const res = await handleGetMemory({ id: 'mem_1234567890_abcdef' }, {
      memory,
      resolveT1: () => { called = true; return []; },
    } as any);
    const body = parse(res);
    expect(called).toBe(false);
    expect(body.success).toBe(false);
  });
});
