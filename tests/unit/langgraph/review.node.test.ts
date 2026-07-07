import { parseReviewVerdict } from '../../../src/langgraph/nodes/review.node';

describe('parseReviewVerdict', () => {
  it('parses PASS verdict from JSON', () => {
    const result = parseReviewVerdict(
      '{"verdict":"PASS","reason":"All tests pass","metrics":{"coverage":90}}',
    );
    expect(result.verdict).toBe('PASS');
    expect(result.feedback).toContain('All tests pass');
  });

  it('parses FAIL verdict from JSON', () => {
    const result = parseReviewVerdict(
      '{"verdict":"FAIL","reason":"Coverage below 80%","metrics":{"coverage":65}}',
    );
    expect(result.verdict).toBe('FAIL');
  });

  it('falls back to keyword matching when JSON is malformed', () => {
    const result = parseReviewVerdict('PASS: everything looks good');
    expect(result.verdict).toBe('PASS');
  });

  it('returns ERROR on empty content', () => {
    const result = parseReviewVerdict('');
    expect(result.verdict).toBe('ERROR');
  });

  it('returns FAIL on unrecognized content', () => {
    const result = parseReviewVerdict('some ambiguous text');
    expect(result.verdict).toBe('FAIL');
  });
});
