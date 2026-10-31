import { resolveEventDeclaration } from '../../../src/runtime/event-declaration';

describe('resolveEventDeclaration', () => {
  test('self without declarations keeps eventStream', () => {
    expect(resolveEventDeclaration({ eventStream: true }, { eventTranslation: 'self' }))
      .toEqual({ mode: 'self', eventStream: true, issues: [] });
  });

  test('self contradicting mappings → declared wins + issue', () => {
    const r = resolveEventDeclaration({ eventStream: true }, {
      eventTranslation: 'self',
      eventSource: { typePath: '$.type' },
      eventMappings: [{ from: 'x', to: 'turn.completed' }],
    });
    expect(r.mode).toBe('declared');
    expect(r.eventStream).toBe(true);
    expect(r.issues.join(' ')).toContain('contradicts');
  });

  test('self contradicting transformEvent → declared wins + issue', () => {
    const r = resolveEventDeclaration({ eventStream: true }, {
      eventTranslation: 'self',
      transformEvent: () => null,
    });
    expect(r.mode).toBe('declared');
    expect(r.issues).toHaveLength(1);
  });

  test('declarations without flag → declared, no issues', () => {
    const r = resolveEventDeclaration({ eventStream: true }, {
      eventSource: { typePath: '$.type' },
      eventMappings: [{ from: 'x', to: 'turn.completed' }],
    });
    expect(r).toEqual({ mode: 'declared', eventStream: true, issues: [] });
  });

  test('eventStream without declarations still downgrades', () => {
    const r = resolveEventDeclaration({ eventStream: true }, {});
    expect(r.eventStream).toBe(false);
    expect(r.mode).toBe('declared');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toContain('no eventMappings');
  });

  test('eventStream false: no downgrade noise; self still annotated', () => {
    expect(resolveEventDeclaration({ eventStream: false }, {})).toEqual({
      mode: 'declared', eventStream: false, issues: [],
    });
    expect(resolveEventDeclaration({ eventStream: false }, { eventTranslation: 'self' })).toEqual({
      mode: 'self', eventStream: false, issues: [],
    });
  });

  test('eventStream false + mappings → cross issue (never applied)', () => {
    const r = resolveEventDeclaration({ eventStream: false }, {
      eventSource: { typePath: '$.type' },
      eventMappings: [{ from: 'x', to: 'turn.completed' }],
    });
    expect(r.issues.join(' ')).toContain('never applied');
  });

  test('eventSource without translations → dead config issue', () => {
    const r = resolveEventDeclaration({ eventStream: true }, {
      eventSource: { typePath: '$.type' },
    });
    expect(r.issues.join(' ')).toContain('dead config');
  });
});
