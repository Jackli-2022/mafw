import { parseJudgeVerdict } from '../../src/memory/consolidation-service';

describe('parseJudgeVerdict', () => {
  test('parses a plain JSON verdict', () => {
    expect(parseJudgeVerdict('{"action":"update","target_id":"mem_1"}')).toEqual({
      action: 'update',
      target_id: 'mem_1',
    });
  });

  test('parses fenced JSON', () => {
    expect(parseJudgeVerdict('```json\n{"action":"create"}\n```')).toEqual({ action: 'create' });
  });

  test('prose without JSON still means create (legacy)', () => {
    expect(parseJudgeVerdict('I would create a new entry.')).toEqual({ action: 'create' });
  });

  test('unknown action falls back to create', () => {
    expect(parseJudgeVerdict('{"action":"bogus"}')).toEqual({ action: 'create' });
  });

  test('malformed JSON is a judge failure, not a verdict', () => {
    expect(parseJudgeVerdict('{not json}')).toBeNull();
  });

  // A reasoning model whose thinking eats the token budget returns empty
  // content with finish_reason=length. Treating that as "create" silently
  // biases every judged pair toward CREATE — the two-week outage's sibling bug.
  test('empty / whitespace-only content is a judge failure', () => {
    expect(parseJudgeVerdict('')).toBeNull();
    expect(parseJudgeVerdict('   \n\t ')).toBeNull();
    expect(parseJudgeVerdict(null as any)).toBeNull();
    expect(parseJudgeVerdict(undefined as any)).toBeNull();
  });
});
