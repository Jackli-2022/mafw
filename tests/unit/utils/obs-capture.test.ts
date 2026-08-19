import { extractTextFromParts, toolFailureText } from '../../../src/utils/obs-capture';

describe('obs-capture helpers', () => {
  test('extracts text parts only', () => {
    const parts = [
      { type: 'text', text: 'hello' },
      { type: 'file', text: 'ignored' },
      { type: 'tool', input: '{}' },
      { type: 'text', text: ' world' },
    ];
    expect(extractTextFromParts(parts)).toBe('hello\n world');
  });

  test('handles missing/invalid parts', () => {
    expect(extractTextFromParts(undefined)).toBe('');
    expect(extractTextFromParts([])).toBe('');
    expect(extractTextFromParts([{ type: 'reasoning', text: 'nope' }])).toBe('');
  });

  test('toolFailureText formats tool + error', () => {
    expect(toolFailureText({ tool: 'bash', error: { message: 'command failed' } })).toBe('[bash] command failed');
    expect(toolFailureText({ error: 'plain error' })).toBe('plain error');
    expect(toolFailureText({})).toBe('tool failed');
  });
});
