// gateway/tests/unit/trajectory-collector-model.test.ts
// opencode v2：assistant message 的模型在 info.model = { id, providerID }；
// v1 在顶层 modelID/providerID。两者都必须写入 trajectory_turns，否则
// /api/usage 的「按模型」统计（WHERE model IS NOT NULL）会丢掉这些回合。
import { TrajectoryCollector } from '../../src/trajectory/collector';

function makeCollector() {
  const turns: any[] = [];
  let n = 0;
  const store: any = {
    currentTurnId: () => 0,
    nextTurnId: () => ++n,
    recordEvent: () => {},
    upsertTurn: (t: any) => turns.push(t),
    pruneOlderThan: () => {},
  };
  const c = new TrajectoryCollector(store, {} as any, 'C:/proj');
  return { c, turns };
}

function userMsg(id: string) {
  return {
    message: { id, role: 'user', sessionID: 's1', time: { created: 1000 }, summary: { body: 'hi' } },
  };
}

describe('TrajectoryCollector model identity', () => {
  test('v2 shape: info.model = { id, providerID } → turn.model/provider 落库', () => {
    const { c, turns } = makeCollector();
    c.handleEvent('message.updated', userMsg('u1'), 'C:/proj');
    c.handleEvent('message.updated', {
      message: {
        id: 'a1',
        role: 'assistant',
        sessionID: 's1',
        model: { id: 'deepseek-v4.1-flash', providerID: 'opencode-go', variant: 'max' },
        finish: 'stop',
        tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 5, write: 0 } },
      },
    }, 'C:/proj');
    const turn = c.onIdle('s1');
    expect(turn?.model).toBe('deepseek-v4.1-flash');
    expect(turn?.provider).toBe('opencode-go');
    expect(turns.at(-1)).toMatchObject({ model: 'deepseek-v4.1-flash', provider: 'opencode-go' });
  });

  test('v1 shape: 顶层 modelID/providerID 仍兼容', () => {
    const { c } = makeCollector();
    c.handleEvent('message.updated', userMsg('u2'), 'C:/proj');
    c.handleEvent('message.updated', {
      message: {
        id: 'a2',
        role: 'assistant',
        sessionID: 's1',
        modelID: 'gpt-5',
        providerID: 'gateway',
        finish: 'stop',
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    }, 'C:/proj');
    const turn = c.onIdle('s1');
    expect(turn).toMatchObject({ model: 'gpt-5', provider: 'gateway' });
  });

  test('v2 模型切换会计入 agentSwitchCount', () => {
    const { c } = makeCollector();
    c.handleEvent('message.updated', userMsg('u3'), 'C:/proj');
    const asst = (id: string, modelID: string) => c.handleEvent('message.updated', {
      message: {
        id,
        role: 'assistant',
        sessionID: 's1',
        model: { id: modelID, providerID: 'p' },
      },
    }, 'C:/proj');
    asst('a3', 'm1');
    asst('a4', 'm2');
    const turn = c.onIdle('s1');
    expect(turn?.agentSwitchCount).toBe(1);
  });
});
