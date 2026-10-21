/**
 * wrapDialectEventStream —— 方言感知的事件流接线契约测试。
 *
 * 机制：首次接线保存 runtime 的原始 global.event（__mafwRawGlobalEvent），
 * 每次（重）接线 = 恢复原始 → 按解析出的 entry 重包（mapper → assembler），
 * 幂等无双重包装。静态 entry 是 fail-safe（@v1）；rt.resolveEventEntry 存在
 * （自适应 opencode）时经探测覆盖。
 */
import { wrapDialectEventStream } from '../../../src/runtime/event-stream-wiring';
import { OPENCODE_EVENT_SOURCE, OPENCODE_V1_EVENT_MAPPINGS, OPENCODE_V2_EVENT_MAPPINGS } from '../../../src/runtime/opencode-events';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';
import { TOOL_PRIMITIVE_TYPES } from '../../../src/runtime/tool-part-assembler';

const isCanonicalAll = (t: string) => !!EVENT_FLOW_MATRIX[t] || TOOL_PRIMITIVE_TYPES.has(t);
const STATIC_ENTRY = { eventSource: OPENCODE_EVENT_SOURCE, eventMappings: OPENCODE_V1_EVENT_MAPPINGS };
const V2_ENTRY = { eventSource: OPENCODE_EVENT_SOURCE, eventMappings: OPENCODE_V2_EVENT_MAPPINGS };

/** 一次性事件流的假 runtime：global.event() → { stream } */
function fakeRt(events: Array<Record<string, unknown>>) {
  return {
    name: 'opencode',
    global: {
      event: async () => ({
        stream: (async function* () {
          for (const e of events) yield e;
        })(),
      }),
    },
  } as any;
}

async function collect(rt: any): Promise<Array<{ payload: { type: string; properties?: any } }>> {
  const result = await rt.global.event();
  const out: Array<{ payload: { type: string; properties?: any } }> = [];
  for await (const e of result.stream ?? result) out.push(e as any);
  return out;
}

describe('wrapDialectEventStream', () => {
  it('无 resolveEventEntry → 静态 fail-safe entry 生效（@v1 翻译）', async () => {
    const rt = fakeRt([{ directory: '/p', payload: { type: 'session.idle', properties: { sessionID: 's1' } } }]);
    await wrapDialectEventStream(rt, STATIC_ENTRY, isCanonicalAll, {});
    const out = await collect(rt);
    expect(out.map((e) => e.payload.type)).toEqual(['turn.completed']);
  });

  it('resolveEventEntry 返回 @v2 → 重包后 next 族被翻译（prompted → turn.started）', async () => {
    const rt = fakeRt([{ directory: '/p', payload: { type: 'session.next.prompted', properties: { sessionID: 's1', messageID: 'm1' } } }]);
    (rt as any).resolveEventEntry = async () => V2_ENTRY;
    await wrapDialectEventStream(rt, STATIC_ENTRY, isCanonicalAll, {});
    const out = await collect(rt);
    expect(out.map((e) => e.payload.type)).toEqual(['turn.started']);
  });

  it('幂等：两次接线后消费一事件恰产一个 canonical（无双重包装）', async () => {
    const rt = fakeRt([{ directory: '/p', payload: { type: 'session.idle', properties: { sessionID: 's1' } } }]);
    await wrapDialectEventStream(rt, STATIC_ENTRY, isCanonicalAll, {});
    await wrapDialectEventStream(rt); // 无参重入（subscribeToEvents 复用存储的接线参数）
    const out = await collect(rt);
    expect(out).toHaveLength(1);
    expect(out[0].payload.type).toBe('turn.completed');
  });

  it('方言切换重包：先 v1 接线消费、后解析出 v2 再接 → 同一 runtime 流按 v2 翻译', async () => {
    const events = [
      { directory: '/p', payload: { type: 'session.idle', properties: { sessionID: 's1' } } },
      { directory: '/p', payload: { type: 'session.next.prompted', properties: { sessionID: 's1' } } },
    ];
    const rt = fakeRt(events);
    await wrapDialectEventStream(rt, STATIC_ENTRY, isCanonicalAll, {});
    let out = await collect(rt);
    expect(out.map((e) => e.payload.type)).toEqual(['turn.completed']); // @v1：idle 翻译；prompted 被 drop

    (rt as any).resolveEventEntry = async () => V2_ENTRY;
    await wrapDialectEventStream(rt); // 重解析重包（无参复用存储的接线参数）
    out = await collect(rt);
    expect(out.map((e) => e.payload.type)).toEqual(['turn.completed', 'turn.started']); // @v2：两者都翻译
  });

  it('resolveEventEntry 抛错 → 回退静态 entry（fail-safe 不炸）', async () => {
    const rt = fakeRt([{ directory: '/p', payload: { type: 'session.idle', properties: { sessionID: 's1' } } }]);
    (rt as any).resolveEventEntry = async () => { throw new Error('probe blew up'); };
    await wrapDialectEventStream(rt, STATIC_ENTRY, isCanonicalAll, {});
    const out = await collect(rt);
    expect(out.map((e) => e.payload.type)).toEqual(['turn.completed']);
  });
});
