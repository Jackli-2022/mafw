import type { MafwMessage } from '../../../src/runtime/canonical-types';
import { buildLeadHandoff, renderHandoffText } from '../../../src/core/lead/lead-handoff';

const msg = (id: string, role: 'user' | 'assistant', text: string): MafwMessage => ({
  id,
  role,
  content: [{ type: 'text', text }],
});

describe('buildLeadHandoff', () => {
  test('filters non-text and truncates head+tail', () => {
    const result = buildLeadHandoff({
      messages: [
        msg('m1', 'user', 'old'),
        msg('m2', 'assistant', 'a'.repeat(3000)),
        { id: 'm3', role: 'user', content: [{ type: 'tool', tool: 'read' } as any] },
        msg('m4', 'user', 'b'.repeat(3000)),
      ],
      fromMessageId: 'm1',
      maxChars: 4000,
    });

    expect(result.messageCount).toBe(2);
    expect(result.messageRange).toEqual({ from: 'm2', to: 'm4' });
    expect(result.truncated).toBe(true);
    expect(result.snapshot.startsWith('Assistant: aaaa')).toBe(true);
    expect(result.snapshot.endsWith('bbbb')).toBe(true);
    expect(result.snapshot).toContain('…');
  });

  test('keeps short text untouched and returns no range for empty input', () => {
    const short = buildLeadHandoff({ messages: [msg('m1', 'user', 'hi')] });
    expect(short).toEqual({
      snapshot: 'User: hi',
      messageRange: { from: 'm1', to: 'm1' },
      messageCount: 1,
      truncated: false,
    });
    expect(buildLeadHandoff({ messages: [] })).toEqual({
      snapshot: '',
      messageRange: null,
      messageCount: 0,
      truncated: false,
    });
  });

  test('renderHandoffText keeps the full joined text', () => {
    expect(renderHandoffText([msg('m1', 'user', 'hi'), msg('m2', 'assistant', 'there')]))
      .toBe('User: hi\n\nAssistant: there');
  });

  test('drops synthetic recall parts and the in-flight assistant message', () => {
    const synthetic = {
      id: 'm1',
      role: 'user',
      content: [
        { type: 'text', text: 'real question' },
        { type: 'text', text: '<recall>secret pointer</recall>', synthetic: true },
      ],
    } as any;
    const partial = {
      id: 'm2',
      role: 'assistant',
      content: [{ type: 'text', text: 'partial answer' }],
      time: { created: 1 },
    } as any;

    const result = buildLeadHandoff({ messages: [synthetic, partial] });
    expect(result.snapshot).toContain('real question');
    expect(result.snapshot).not.toContain('secret pointer');
    expect(result.snapshot).not.toContain('partial answer');
  });
});
