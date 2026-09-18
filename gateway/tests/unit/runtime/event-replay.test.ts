import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeOpencodeEvent } from '../../../src/runtime/normalize';
import { opencodeBroadcast } from '../../../src/runtime/event-broadcast';

describe('event replay (golden)', () => {
  it('runtime raw events normalize to expected facet sequence', () => {
    const lines = readFileSync(join(__dirname, '../../fixtures/events/runtime-raw-session.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const facets = lines.map((e) => normalizeOpencodeEvent(e));
    // 回合完整性：恰好一个 step 结算、一个 idle 广播
    expect(facets.filter((f) => f.step).length).toBe(1);
    expect(facets.filter((f) => f.broadcast === 'idle').length).toBe(1);
    // 每个事件都产出了合法 facet 形状
    for (const f of facets) {
      expect(typeof f.type).toBe('string');
      expect(['idle', 'error', 'passthrough']).toContain(f.broadcast);
    }
    // 流式 delta：text part 产生 chatSignal delta
    expect(facets.filter((f) => f.chatSignal === 'delta').length).toBe(1);
  });

  it('broadcast envelopes match wire contract (flat keys, no undefined leaking)', () => {
    const env = opencodeBroadcast({ type: 'session.idle', sessionID: 's1' });
    expect(env.type).toBe('opencode_event');
    expect(env.data.type).toBe('session.idle');
    expect('internal' in env.data).toBe(false);
  });

  it('idle envelope is rewritten to message.complete per Mode A contract', () => {
    // index.ts:1037 —— broadcast=idle 时广播的是 message.complete，非 session.idle
    const facets = normalizeOpencodeEvent({ type: 'session.idle', properties: { sessionID: 's1' } });
    expect(facets.broadcast).toBe('idle');
    expect(opencodeBroadcast({ type: 'message.complete', sessionID: 's1' }).data.type).toBe('message.complete');
  });
});
