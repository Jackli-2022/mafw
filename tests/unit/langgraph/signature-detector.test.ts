import { matchesSignature } from '../../../gateway/src/core/langgraph/signature-detector';

describe('matchesSignature', () => {
  it('returns true for identical feedback', () => {
    expect(matchesSignature('missing error handling', 'missing error handling')).toBe(true);
  });

  it('returns true after normalization (whitespace + punctuation)', () => {
    expect(matchesSignature('Missing error handling!', 'missing error handling...')).toBe(true);
  });

  it('returns false for different feedback', () => {
    expect(matchesSignature('missing error handling', 'incorrect algorithm choice')).toBe(false);
  });
});
