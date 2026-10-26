import { mergeDataPartsIntoWire } from '../../../src/core/data-parts/merge';
import type { SessionDataPartRow } from '../../../src/memory/gateway-db';

function row(id: string, messageID: string, type: string, data: unknown, at = '2026-10-26T01:00:00Z'): SessionDataPartRow {
  return {
    session_id: 's1', id, message_id: messageID, type,
    data_json: JSON.stringify(data), created_at: at, updated_at: at,
  };
}

describe('mergeDataPartsIntoWire', () => {
  it('appends overlay parts to the owning message in created order', () => {
    const wire: any[] = [
      { info: { id: 'a2' }, parts: [{ id: 't2', type: 'text', text: 'x' }] },
      { info: { id: 'a1' }, parts: [] },
    ];
    mergeDataPartsIntoWire(wire, [
      row('data_b', 'a1', 'data-b', { v: 2 }, '2026-10-26T02:00:00Z'),
      row('data_a', 'a1', 'data-a', { v: 1 }, '2026-10-26T01:00:00Z'),
    ]);
    expect(wire[1].parts.map((p: any) => p.id)).toEqual(['data_a', 'data_b']);
    expect(wire[1].parts[0]).toMatchObject({ type: 'data-a', data: { v: 1 }, sessionID: 's1', messageID: 'a1' });
    expect(wire[0].parts).toHaveLength(1);
  });

  it('runtime part with the same id wins (no duplicate)', () => {
    const wire: any[] = [{ info: { id: 'a1' }, parts: [{ id: 'data_x', type: 'data-x', data: { runtime: true } }] }];
    mergeDataPartsIntoWire(wire, [row('data_x', 'a1', 'data-x', { overlay: true })]);
    expect(wire[0].parts).toHaveLength(1);
    expect(wire[0].parts[0].data).toEqual({ runtime: true });
  });

  it('ignores rows for messages outside the page window', () => {
    const wire: any[] = [{ info: { id: 'a2' }, parts: [] }];
    mergeDataPartsIntoWire(wire, [row('data_old', 'a1', 'data-old', { v: 1 })]);
    expect(wire[0].parts).toHaveLength(0);
  });

  it('skips corrupted data_json rows', () => {
    const wire: any[] = [{ info: { id: 'a1' }, parts: [] }];
    mergeDataPartsIntoWire(wire, [{ ...row('data_bad', 'a1', 'data-bad', {}), data_json: '{oops' }]);
    expect(wire[0].parts).toHaveLength(0);
  });

  it('tolerates wire items without info/parts', () => {
    const wire: any[] = [{}, { info: { id: 'a1' } as any, parts: [] }];
    expect(() => mergeDataPartsIntoWire(wire, [row('data_x', 'a1', 'data-x', {})])).not.toThrow();
  });
});
