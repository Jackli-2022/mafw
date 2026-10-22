import { enrichBroadcastFrame } from '../../../src/events/broadcast-frame';
import { readFileSync as rf } from 'fs';
import { join as pjoin } from 'path';

describe('enrichBroadcastFrame（spec §5.2 v2 Q2：双层放置）', () => {
  it('扁平事件：顶层 seq + timestamp', () => {
    const out = enrichBroadcastFrame({ type: 'runtime_switched', runtime: 'pi' }, 42, '2026-10-22T00:00:00Z');
    expect(out).toEqual({ type: 'runtime_switched', runtime: 'pi', timestamp: '2026-10-22T00:00:00Z', seq: 42 });
  });
  it('信封事件：顶层 + data 内 seq（Review Focus #5）', () => {
    const out = enrichBroadcastFrame({ type: 'mafw_event', data: { type: 'turn.completed', properties: {} } }, 7, 'T');
    expect(out.seq).toBe(7);
    expect((out.data as any).seq).toBe(7);
  });
  it('seq null：无 seq 键（现状形状，C5）', () => {
    const out = enrichBroadcastFrame({ type: 'part.delta', data: { type: 'part.delta' } }, null, 'T');
    expect('seq' in out).toBe(false);
    expect('seq' in (out.data as any)).toBe(false);
  });
  it('data 非 object（字符串/null）：只放顶层', () => {
    const out1 = enrichBroadcastFrame({ type: 'x', data: null }, 1, 'T');
    expect(out1.seq).toBe(1);
    expect(out1.data).toBeNull();
    const out2 = enrichBroadcastFrame({ type: 'x', data: 'str' }, 2, 'T');
    expect((out2 as any).seq).toBe(2);
    expect((out2 as any).data).toBe('str');
  });
  it('不改变原事件对象（浅拷贝，无副作用）', () => {
    const event = { type: 'x', data: { type: 'y' } };
    enrichBroadcastFrame(event, 3, 'T');
    expect(event).toEqual({ type: 'x', data: { type: 'y' } }); // 原对象无 seq
  });
});

// wiring 断言（index.ts 实际调用——否则纯函数可能存在但未接线）：
const idxSrc = rf(pjoin(__dirname, '../../../src/index.ts'), 'utf8');
describe('index.ts broadcast 接线（wiring）', () => {
  it('broadcast 走 enrichBroadcastFrame + eventStore.append', () => {
    expect(idxSrc).toContain('enrichBroadcastFrame(');
    expect(idxSrc).toMatch(/eventStore\?\.append\(/);
    expect(idxSrc).toMatch(/maybePrune\(/);
  });
  it('EventStore 初始化受 config.events.persist 门控（fail-open）', () => {
    expect(idxSrc).toMatch(/config\.events\.persist/);
  });
});
