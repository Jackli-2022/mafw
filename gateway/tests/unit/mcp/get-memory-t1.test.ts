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
