import { mergeDataPartsIntoFlat } from '../../../src/core/data-parts/merge-flat';
import type { SessionDataPartRow } from '../../../src/memory/gateway-db';
import type { MafwMessage } from '../../../src/runtime/canonical-types';

function row(id: string, messageID: string, type: string, data: unknown, at = '2026-10-26T01:00:00Z'): SessionDataPartRow {
  return {
    session_id: 's1', id, message_id: messageID, type,
    data_json: JSON.stringify(data), created_at: at, updated_at: at,
  };
}

function msg(id: string, content: any[] = []): MafwMessage {
  return { id, sessionID: 's1', role: content.length > 0 && content[0]?.type === 'text' && content[0]?.text === 'q' ? 'user' : 'assistant', content };
}

describe('mergeDataPartsIntoFlat', () => {
  it('appends overlay parts to the owning flat message in created order', () => {
    const messages = [msg('a2', [{ id: 't2', type: 'text', text: 'x' }]), msg('a1')];
    const out = mergeDataPartsIntoFlat(messages, [
      row('data_b', 'a1', 'data-b', { v: 2 }, '2026-10-26T02:00:00Z'),
      row('data_a', 'a1', 'data-a', { v: 1 }, '2026-10-26T01:00:00Z'),
    ]);
    expect((out[1].content ?? []).map((p) => p.id)).toEqual(['data_a', 'data_b']);
    expect(out[1].content?.[0]).toMatchObject({ type: 'data-a', data: { v: 1 }, sessionID: 's1', messageID: 'a1' });
    expect(out[0].content).toHaveLength(1);
  });

  it('runtime part with the same id wins (no duplicate)', () => {
    const messages = [msg('a1', [{ id: 'data_x', type: 'data-x', data: { runtime: true } } as any])];
    const out = mergeDataPartsIntoFlat(messages, [row('data_x', 'a1', 'data-x', { overlay: true })]);
    expect(out[0].content).toHaveLength(1);
    expect((out[0].content?.[0] as any).data).toEqual({ runtime: true });
  });

  it('ignores rows for messages outside the page window', () => {
    const messages = [msg('a2')];
    const out = mergeDataPartsIntoFlat(messages, [row('data_old', 'a1', 'data-old', { v: 1 })]);
    expect(out[0].content).toHaveLength(0);
  });

  it('skips corrupted data_json rows', () => {
    const messages = [msg('a1')];
    const out = mergeDataPartsIntoFlat(messages, [
      { ...row('data_bad', 'a1', 'data-bad', {}), data_json: '{oops' },
    ]);
    expect(out[0].content).toHaveLength(0);
  });

  it('does not mutate the input messages or their content arrays', () => {
    const original = msg('a1', [{ id: 't1', type: 'text', text: 'hi' }]);
    const originalContent = original.content;
    const messages = [original];
    const out = mergeDataPartsIntoFlat(messages, [row('data_x', 'a1', 'data-x', { v: 1 })]);
    expect(original.content).toBe(originalContent);
    expect(original.content).toHaveLength(1);
    expect(out).not.toBe(messages);
    expect(out[0]).not.toBe(original);
  });

  it('creates content when the flat message has none yet', () => {
    const messages: MafwMessage[] = [{ id: 'a1', role: 'assistant' }];
    const out = mergeDataPartsIntoFlat(messages, [row('data_x', 'a1', 'data-x', { v: 1 })]);
    expect(out[0].content).toEqual([
      { id: 'data_x', type: 'data-x', data: { v: 1 }, sessionID: 's1', messageID: 'a1' },
    ]);
  });

  it('tolerates invalid arguments and messages without ids', () => {
    expect(mergeDataPartsIntoFlat([], undefined as any)).toEqual([]);
    expect(mergeDataPartsIntoFlat(undefined as any, [])).toBeUndefined();
    const messages: MafwMessage[] = [{ role: 'assistant' }, msg('a1')];
    expect(() => mergeDataPartsIntoFlat(messages, [row('data_x', 'a1', 'data-x', {})])).not.toThrow();
  });
});
