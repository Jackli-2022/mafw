import { EVENT_FLOW_MATRIX, assertMatrixComplete } from '../../../src/runtime/event-flow-matrix';
import { RUNTIME_EVENT_TYPES, FLAT_EVENT_TYPES } from '../../../../packages/gateway-sdk/src/events';

describe('event flow matrix', () => {
  it('covers every canonical runtime event type', () => {
    for (const t of RUNTIME_EVENT_TYPES) {
      expect(EVENT_FLOW_MATRIX[t]).toBeDefined();
    }
  });

  it('covers every flat broadcast type', () => {
    for (const t of FLAT_EVENT_TYPES) {
      expect(EVENT_FLOW_MATRIX[t]).toBeDefined();
    }
  });

  it('has no stale rows for removed event types', () => {
    const known = new Set<string>([...RUNTIME_EVENT_TYPES, ...FLAT_EVENT_TYPES]);
    for (const key of Object.keys(EVENT_FLOW_MATRIX)) {
      expect(known.has(key) || key.startsWith('plugin:')).toBe(true);
    }
  });

  it('every cell is explicitly filled (no empty dispositions)', () => {
    expect(assertMatrixComplete()).toEqual([]);
  });

  it('normalize.ts facet consumers are a subset of matrix normalizeFacet claims', () => {
    // session.idle 必须声明 chatSignal+broadcast 两个 facet 消费（index.ts 现状）
    expect(EVENT_FLOW_MATRIX['session.idle'].normalizeFacet).toContain('chatSignal');
    expect(EVENT_FLOW_MATRIX['session.idle'].normalizeFacet).toContain('broadcast');
    // session.idle 在 Mode A 被改写为 message.complete（MafwShell 注释印证）
    expect(EVENT_FLOW_MATRIX['session.idle'].modeA).toBe('rewrite');
  });
});
