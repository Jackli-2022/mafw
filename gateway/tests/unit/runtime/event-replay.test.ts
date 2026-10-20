import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeOpencodeEvent } from '../../../src/runtime/normalize';
import { mafwBroadcast } from '../../../src/runtime/event-broadcast';
import { applyEventMappings } from '../../../src/runtime/event-mapper';
import { OPENCODE_EVENT_SOURCE, OPENCODE_EVENT_MAPPINGS } from '../../../src/runtime/opencode-events';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';

/** v2 全链路 golden：opencode 原生（GlobalEvent 信封）→ 翻译表 → canonical → facets。 */
const OC_ENTRY = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_EVENT_MAPPINGS,
};

describe('event replay (golden, v2 pipeline: opencode raw → translate → normalize)', () => {
  const lines = readFileSync(join(__dirname, '../../fixtures/events/runtime-raw-session.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  const canonical = lines.flatMap((e) => applyEventMappings(e, OC_ENTRY, (t) => !!EVENT_FLOW_MATRIX[t]));
  const facets = canonical.map((e) => normalizeOpencodeEvent(e));

  it('opencode raw events translate to v2 canonical + expected facet sequence', () => {
    expect(canonical.map((e: any) => e.payload.type)).toEqual([
      'session.updated', 'message.updated', 'part.updated', 'part.updated', 'turn.completed',
    ]);
    // 回合完整性：恰好一个 step 结算 + 一个 turn.completed
    expect(facets.filter((f) => f.step).length).toBe(1);
    expect(facets.filter((f) => f.type === 'turn.completed').length).toBe(1);
    // 流式 delta：text part 产生 chatSignal delta
    expect(facets.filter((f) => f.chatSignal === 'delta').length).toBe(1);
    // 翻译后的信封 sessionID/directory 重注入
    expect((canonical[4] as any).sessionID).toBe('s1');
    expect((canonical[4] as any).directory).toBe('/p');
  });

  it('session.next.* legacy family is dropped by the explicit drop rows', () => {
    const dropped = applyEventMappings(
      { directory: '/p', payload: { type: 'session.next.tool.started', properties: { sessionID: 's1' } } },
      OC_ENTRY,
      (t) => !!EVENT_FLOW_MATRIX[t],
    );
    expect(dropped).toEqual([]);
  });

  it('broadcast envelopes match wire contract (flat keys, no undefined leaking)', () => {
    const env = mafwBroadcast({ type: 'turn.completed', sessionID: 's1' });
    expect(env.type).toBe('mafw_event');
    expect(env.data.type).toBe('turn.completed');
    expect('internal' in env.data).toBe(false);
  });

  it('Mode A rewrite is gone: turn.completed broadcasts as itself (passthrough)', () => {
    // v2：session.idle→message.complete 改写 hack 已删除——翻译层直接产 turn.completed
    const facets = normalizeOpencodeEvent({ type: 'turn.completed', properties: { sessionID: 's1' } });
    expect(facets.chatSignal).toBe('complete');
    expect(mafwBroadcast({ type: 'turn.completed', sessionID: 's1' }).data.type).toBe('turn.completed');
  });
});
