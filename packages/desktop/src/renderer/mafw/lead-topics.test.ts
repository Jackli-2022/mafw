import { describe, expect, test } from 'bun:test';
import { buildTopicList, leadTopicStateLabel, proposedBoundaries } from './lead-topics';

describe('lead topic list model', () => {
  test('labels states and hides session ids', () => {
    const model = buildTopicList([
      { id: 't1', title: 'SQLite', summary: '决定：A', state: 'warm', lastActiveAt: '2026-11-10T00:00:00.000Z', goalId: 'g1', resumedFrom: null },
      { id: 't2', title: 'UI', summary: null, state: 'resident', lastActiveAt: '2026-11-10T01:00:00.000Z', goalId: 'g2', resumedFrom: 't1' },
    ] as any);

    expect(model[0]).toMatchObject({ id: 't1', stateLabel: '近期' });
    expect(model[1]).toMatchObject({ id: 't2', stateLabel: '当前', summary: '' });
    expect(JSON.stringify(model)).not.toContain('ses_');
  });

  test('state label falls back to the raw value', () => {
    expect(leadTopicStateLabel('resident')).toBe('当前');
    expect(leadTopicStateLabel('cold')).toBe('更早');
    expect(leadTopicStateLabel('archived')).toBe('已归档');
    expect(leadTopicStateLabel('custom')).toBe('custom');
  });

  test('only proposed boundaries stay actionable', () => {
    const items = [
      { id: 'b1', status: 'proposed' },
      { id: 'b2', status: 'accepted' },
      { id: 'b3', status: 'merged' },
      { id: 'b4', status: 'undone' },
    ] as any;
    expect(proposedBoundaries(items).map((item) => item.id)).toEqual(['b1']);
  });
});
