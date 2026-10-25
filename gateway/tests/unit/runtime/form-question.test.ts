import { expiresAtOf, formAnswerOf, formToQuestion } from '../../../src/runtime/form-question';

const form = {
  id: 'f1', sessionID: 's1', title: 'T',
  metadata: { expiresAt: '2026-10-25T15:00:00Z', tool: { messageID: 'm1', callID: 'c1' } },
  fields: [
    { key: 'name', type: 'string', title: 'Name', required: true, placeholder: 'x', minLength: 2, pattern: '^A' },
    { key: 'count', type: 'integer', title: 'Count', minimum: 1, maximum: 5, default: 2 },
    { key: 'agree', type: 'boolean', title: 'Agree', default: true },
    { key: 'tags', type: 'multiselect', title: 'Tags', options: [{ value: 'a', label: 'A' }] },
    { key: 'link', type: 'external', title: 'Link', url: 'https://x' },
    { key: 'note', type: 'string', title: 'Note', when: [{ key: 'agree', op: 'eq', value: true }] },
    { key: 'hidden', type: 'string', title: 'Hidden', hidden: true },
  ],
};

describe('formToQuestion', () => {
  it('preserves typed field metadata', () => {
    const q = formToQuestion(form);
    expect(q.mode).toBe('url');
    expect(q.expiresAt).toBe(Date.parse('2026-10-25T15:00:00Z'));
    expect(q.questions).toHaveLength(6);
    expect(q.questions.find(x => x.id === 'count')).toMatchObject({
      type: 'integer', minimum: 1, maximum: 5, default: 2, required: false,
    });
    expect(q.questions.find(x => x.id === 'name')).toMatchObject({
      type: 'string', required: true, placeholder: 'x', minLength: 2, pattern: '^A', custom: true,
    });
    expect(q.questions.find(x => x.id === 'link')).toMatchObject({ type: 'external', url: 'https://x' });
    expect(q.questions.find(x => x.id === 'note')!.when).toEqual([{ key: 'agree', op: 'eq', value: true }]);
    expect(q.questions.find(x => x.id === 'hidden')).toBeUndefined();
    expect(q.questions.find(x => x.id === 'agree')!.options).toEqual([
      { label: '是', value: 'true' }, { label: '否', value: 'false' },
    ]);
  });

  it('keeps old question shape for fields without type', () => {
    const q = formToQuestion({ id: 'f2', sessionID: 's2', title: 'Old', fields: [{ key: 'x', title: 'X' }] });
    expect(q.questions[0]).toMatchObject({ id: 'x', question: 'X', type: undefined, custom: undefined });
  });
});

describe('formAnswerOf', () => {
  it('converts external to boolean and preserves typed values', () => {
    expect(formAnswerOf(form, [
      ['Alice'], ['3'], ['true'], ['a'], ['true'], ['ok'],
    ])).toEqual({
      name: 'Alice', count: 3, agree: true, tags: ['a'], link: true, note: 'ok',
    });
    expect(formAnswerOf(form, [
      ['Alice'], ['3'], ['false'], [], ['false'], [''],
    ]).link).toBe(false);
  });

  it('rejects URL string for external (boolean only)', () => {
    const out = formAnswerOf(form, [
      ['Alice'], ['3'], ['true'], [], ['https://x'], [''],
    ]);
    expect(out.link).toBe(false);
  });
});

describe('expiresAtOf', () => {
  it('accepts ISO / seconds / milliseconds and rejects bad values', () => {
    expect(expiresAtOf({ expiresAt: '2026-10-25T15:00:00Z' })).toBe(Date.parse('2026-10-25T15:00:00Z'));
    expect(expiresAtOf({ expires_at: 1790000000 })).toBe(1790000000000);
    expect(expiresAtOf({ expires: 1790000000000 })).toBe(1790000000000);
    expect(expiresAtOf({ expiresAt: 'nope' })).toBeUndefined();
    expect(expiresAtOf(undefined)).toBeUndefined();
  });
});
