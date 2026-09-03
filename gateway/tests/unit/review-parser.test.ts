import { parseReviewVerdict } from '../../src/core/langgraph/review-parser';

describe('parseReviewVerdict (review-parser)', () => {
  it('returns ERROR for empty content', () => {
    expect(parseReviewVerdict('')).toEqual({
      verdict: 'ERROR',
      feedback: 'Review response is empty',
    });
    expect(parseReviewVerdict('   \n  ').verdict).toBe('ERROR');
  });

  it('parses plain JSON content', () => {
    const content = JSON.stringify({ verdict: 'PASS', reason: 'all checks green', metrics: { t: 1 } });
    const result = parseReviewVerdict(content);
    expect(result.verdict).toBe('PASS');
    expect(result.feedback).toBe('all checks green');
  });

  it('parses fenced mafw-review block inside markdown report', () => {
    const content = [
      '# Review Report — loop 2',
      '',
      '```mafw-review',
      JSON.stringify({ verdict: 'FAIL', reason: 'tests missing', metrics: {} }),
      '```',
      '',
      'Free-form narrative for humans.',
    ].join('\n');
    const result = parseReviewVerdict(content);
    expect(result.verdict).toBe('FAIL');
    expect(result.feedback).toBe('tests missing');
  });

  it('maps any non-PASS JSON verdict to FAIL', () => {
    const content = JSON.stringify({ verdict: 'FAIL', reason: 'x' });
    expect(parseReviewVerdict(content).verdict).toBe('FAIL');
    const weird = JSON.stringify({ verdict: 'whatever', reason: 'y' });
    expect(parseReviewVerdict(weird).verdict).toBe('FAIL');
  });

  it('returns ERROR for free markdown text without JSON (no text fallback)', () => {
    const result = parseReviewVerdict('# Review\n\nThe implementation did not pass tests.\n');
    expect(result.verdict).toBe('ERROR');
  });

  it('never infers PASS from prose containing the word pass (regression)', () => {
    const result = parseReviewVerdict('Overall the goal did not pass. Please retry.');
    expect(result.verdict).not.toBe('PASS');
    expect(result.verdict).toBe('ERROR');
  });

  it('returns ERROR for malformed fenced block', () => {
    const content = ['```mafw-review', '{ not valid json', '```'].join('\n');
    expect(parseReviewVerdict(content).verdict).toBe('ERROR');
  });

  it('returns ERROR when fenced block JSON lacks verdict field', () => {
    const content = ['```mafw-review', JSON.stringify({ reason: 'no verdict key' }), '```'].join('\n');
    expect(parseReviewVerdict(content).verdict).toBe('ERROR');
  });
});
