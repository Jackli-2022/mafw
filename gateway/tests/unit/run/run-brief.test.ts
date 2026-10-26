/**
 * T2-2 Task 2: 续跑简报 + 提示模板（纯函数）。
 */
import {
  buildResumeBrief,
  composeResumePrompt,
  RESUME_PREFIX,
} from '../../../src/core/run/run-brief';

const t = (n: number) => ({ created: 1_000 + n });
const text = (s: string) => ({ type: 'text', text: s });

function u(id: string, n: number, ...texts: string[]) {
  return { info: { id, role: 'user', time: t(n) }, parts: texts.map(text) };
}
function a(id: string, n: number, ...texts: string[]) {
  return { info: { id, role: 'assistant', time: t(n) }, parts: texts.map(text) };
}

describe('buildResumeBrief', () => {
  it('captures last user text, assistant tail and anchor id', () => {
    const brief = buildResumeBrief(
      [u('u1', 1, 'do the thing'), a('a1', 2, 'working'), a('a2', 3, 'last output')],
      2,
    );
    expect(brief).toEqual({
      lastUserText: 'do the thing',
      lastAssistantTail: 'last output',
      anchorMessageID: 'u1',
      queuedCount: 2,
    });
  });

  it('joins multiple text parts per message', () => {
    const brief = buildResumeBrief([u('u1', 1, 'line1', 'line2'), a('a1', 2, 'x')], 0);
    expect(brief!.lastUserText).toBe('line1\nline2');
  });

  it('skips synthetic [MAFW 续跑] user messages when choosing the anchor', () => {
    const brief = buildResumeBrief(
      [
        u('u1', 1, 'real request'),
        a('a1', 2, 'part'),
        u('u2', 3, `${RESUME_PREFIX} continue`),
        a('a2', 4, 'more'),
      ],
      0,
    );
    expect(brief!.lastUserText).toBe('real request');
    expect(brief!.anchorMessageID).toBe('u1');
  });

  it('truncates user text to 600 and assistant tail to 1200', () => {
    const brief = buildResumeBrief(
      [u('u1', 1, 'u'.repeat(700)), a('a1', 2, 'a'.repeat(1300))],
      0,
    );
    expect(brief!.lastUserText).toHaveLength(600);
    expect(brief!.lastAssistantTail).toHaveLength(1200);
    expect(brief!.lastAssistantTail.endsWith('a')).toBe(true);
  });

  it('null when there is no usable user message', () => {
    expect(buildResumeBrief([a('a1', 1, 'only assistant')], 0)).toBeNull();
    expect(buildResumeBrief([], 0)).toBeNull();
  });

  it('empty assistant tail when no assistant text exists', () => {
    const brief = buildResumeBrief([u('u1', 1, 'go')], 0);
    expect(brief!.lastAssistantTail).toBe('');
  });

  it('sorts by time.created regardless of input order', () => {
    const brief = buildResumeBrief([a('a1', 2, 'tail'), u('u1', 1, 'first')], 1);
    expect(brief!.lastUserText).toBe('first');
    expect(brief!.lastAssistantTail).toBe('tail');
  });

  it('handles bare messages (no info envelope)', () => {
    const brief = buildResumeBrief(
      [{ id: 'u1', role: 'user', time: t(1), parts: [text('bare')] }],
      0,
    );
    expect(brief!.lastUserText).toBe('bare');
  });

  it('handles runtime flat messages with content parts (opencode 2.1 normalized)', () => {
    const brief = buildResumeBrief([
      { id: 'u1', role: 'user', time: t(1), content: [text('flat request')] },
      { id: 'a1', role: 'assistant', time: t(2), content: [text('flat output')] },
    ], 0);
    expect(brief!.lastUserText).toBe('flat request');
    expect(brief!.lastAssistantTail).toBe('flat output');
  });

  it('falls back to message.text when there are no parts', () => {
    const brief = buildResumeBrief([
      { id: 'u1', role: 'user', time: t(1), text: 'text-only' },
    ], 0);
    expect(brief!.lastUserText).toBe('text-only');
  });
});

describe('composeResumePrompt', () => {
  it('contains prefix, both snippets and the no-repeat instruction', () => {
    const prompt = composeResumePrompt({
      lastUserText: 'refactor the parser',
      lastAssistantTail: 'done 2 of 3 files',
      anchorMessageID: 'u1',
      queuedCount: 0,
    });
    expect(prompt.startsWith(RESUME_PREFIX)).toBe(true);
    expect(prompt).toContain('refactor the parser');
    expect(prompt).toContain('done 2 of 3 files');
    expect(prompt).toContain('不要重复');
  });

  it('omits the assistant section when empty', () => {
    const prompt = composeResumePrompt({
      lastUserText: 'go',
      lastAssistantTail: '',
      anchorMessageID: 'u1',
      queuedCount: 0,
    });
    expect(prompt).not.toContain('最后输出');
  });
});
