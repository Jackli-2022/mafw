/**
 * S4: three-value judge verdict parsing (update / create / separate).
 */
import { parseJudgeVerdict } from '../../../src/memory/consolidation-service';

describe('parseJudgeVerdict', () => {
  test('parses update', () => {
    expect(parseJudgeVerdict('{"action":"update","target_id":"y"}')).toEqual({ action: 'update', target_id: 'y' });
  });

  test('parses create', () => {
    expect(parseJudgeVerdict('{"action":"create"}')).toEqual({ action: 'create' });
  });

  test('parses separate with distinction', () => {
    expect(parseJudgeVerdict('{"action":"separate","target_id":"x","distinction":"region"}'))
      .toEqual({ action: 'separate', target_id: 'x', distinction: 'region' });
  });

  test('unknown action → create', () => {
    expect(parseJudgeVerdict('{"action":"weird"}')).toEqual({ action: 'create' });
  });

  test('no json braces → create', () => {
    expect(parseJudgeVerdict('no json here')).toEqual({ action: 'create' });
  });

  test('strips markdown fences', () => {
    expect(parseJudgeVerdict('```json\n{"action":"separate","target_id":"x"}\n```'))
      .toEqual({ action: 'separate', target_id: 'x' });
  });
});
