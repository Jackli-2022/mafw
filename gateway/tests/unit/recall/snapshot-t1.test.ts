import { SNAPSHOT_DEFAULTS } from '../../../src/recall/recall-snapshot';
import { config } from '../../../src/config';

describe('t1 snapshot config defaults', () => {
  test('SNAPSHOT_DEFAULTS carries t1K/t1MaxChars', () => {
    expect((SNAPSHOT_DEFAULTS as any).t1K).toBe(3);
    expect((SNAPSHOT_DEFAULTS as any).t1MaxChars).toBe(600);
  });
  test('config.recall.t1Recall defaults enabled', () => {
    expect((config.recall as any).t1Recall?.enabled).toBe(true);
    expect((config.recall as any).t1Recall?.k).toBe(3);
  });
});
