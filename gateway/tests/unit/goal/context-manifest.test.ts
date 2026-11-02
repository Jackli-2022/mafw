import {
  buildContextManifest,
  renderContextManifest,
  stageBaseline,
  type ContextManifestRef,
  type ContextRefInput,
} from '../../../src/core/goal/context-manifest';

const ref = (path: string, extra: Partial<ContextRefInput> = {}): ContextRefInput => ({ path, ...extra });

const displayPaths = (refs: ContextManifestRef[]): string[] => refs.map((item) => item.displayPath);

describe('buildContextManifest cross-Goal isolation', () => {
  test('rejects a cross-Goal reference that the Lead did not allow', () => {
    expect(() => buildContextManifest({
      required: [ref('goal.md')],
      optional: [ref('other-goal/secret.md')],
      allowedCrossGoalRefs: [],
    })).toThrow('cross-goal reference not allowed');
  });

  test('rejects an explicit goalId cross-Goal reference without an allowlist entry', () => {
    expect(() => buildContextManifest({
      goalId: 'g1',
      stage: 'planning',
      optional: [ref('secret.md', { goalId: 'other-goal' })],
      allowedCrossGoalRefs: [],
    })).toThrow('cross-goal reference not allowed: other-goal/secret.md');
  });

  test('includes explicitly allowed cross-Goal refs in their own section', () => {
    const manifest = buildContextManifest({
      goalId: 'g1',
      stage: 'planning',
      optional: [ref('other-goal/secret.md')],
      allowedCrossGoalRefs: ['other-goal/secret.md'],
    });

    expect(displayPaths(manifest.crossGoal)).toEqual(['other-goal/secret.md']);
    expect(manifest.crossGoal[0]).toMatchObject({ goalId: 'other-goal', crossGoal: true, scope: 'cross-goal' });
    expect(manifest.optional).toEqual([]);
  });

  test('only allows the named cross-Goal reference, not every reference to that Goal', () => {
    expect(() => buildContextManifest({
      goalId: 'g1',
      stage: 'planning',
      optional: [ref('other-goal/secret.md'), ref('other-goal/private-discussion.md')],
      allowedCrossGoalRefs: ['other-goal/secret.md'],
    })).toThrow('cross-goal reference not allowed: other-goal/private-discussion.md');
  });

  test('supports whole-goal and wildcard allowlist entries', () => {
    expect(() => buildContextManifest({
      goalId: 'g1',
      stage: 'planning',
      optional: [ref('other-goal/secret.md')],
      allowedCrossGoalRefs: ['other-goal'],
    })).not.toThrow();

    const manifest = buildContextManifest({
      goalId: 'g1',
      stage: 'planning',
      optional: [ref('other-goal/reports/a.md'), ref('other-goal/b.md')],
      allowedCrossGoalRefs: ['other-goal/*'],
    });
    expect(displayPaths(manifest.crossGoal)).toEqual(['other-goal/reports/a.md', 'other-goal/b.md']);
  });
});

describe('buildContextManifest required baseline', () => {
  test('always includes the stage baseline even when the caller omits required files', () => {
    const manifest = buildContextManifest({ goalId: 'g1', stage: 'plan_review', required: [] });

    expect(displayPaths(manifest.required)).toEqual([
      'g1/goal.md',
      'g1/request.json',
      'g1/direction.json',
      'g1/waves.json',
      'g1/goal-eval.json',
    ]);
    expect(manifest.required.every((item) => item.required && item.baseline)).toBe(true);
    expect(manifest.optional).toEqual([]);
  });

  test('accepts node aliases and keeps the same baseline set', () => {
    expect(stageBaseline('execute')).toEqual(stageBaseline('implementing'));
    const manifest = buildContextManifest({ goalId: 'g1', stage: 'execute' });
    expect(displayPaths(manifest.required)).toEqual(stageBaseline('implementing').map((path) => `g1/${path}`));
  });

  test('merges explicit required refs after the baseline', () => {
    const manifest = buildContextManifest({
      goalId: 'g1',
      stage: 'implementing',
      required: [ref('g1/receipts/loop-2.json')],
      optional: [ref('g1/notes.md')],
    });

    expect(displayPaths(manifest.required).slice(-1)).toEqual(['g1/receipts/loop-2.json']);
    expect(displayPaths(manifest.optional)).toEqual(['g1/notes.md']);
  });

  test('promotes duplicates of a baseline file to required and never drops the baseline', () => {
    const manifest = buildContextManifest({
      goalId: 'g1',
      stage: 'planning',
      optional: [ref('g1/goal.md')],
    });

    expect(displayPaths(manifest.required)).toContain('g1/goal.md');
    expect(manifest.optional).toEqual([]);
  });

  test('deduplicates explicit required/optional refs with required winning', () => {
    const manifest = buildContextManifest({
      goalId: 'g1',
      stage: 'planning',
      required: [ref('g1/notes.md')],
      optional: [ref('g1/notes.md')],
    });

    expect(displayPaths(manifest.required).filter((path) => path === 'g1/notes.md')).toHaveLength(1);
    expect(manifest.optional).toEqual([]);
  });
});

describe('buildContextManifest scope validation', () => {
  test('allows in-Goal optional refs without an allowlist', () => {
    const manifest = buildContextManifest({
      goalId: 'g1',
      stage: 'planning',
      optional: [ref('g1/notes.md')],
      allowedCrossGoalRefs: [],
    });
    expect(displayPaths(manifest.optional)).toEqual(['g1/notes.md']);
  });

  test('allows explicit project refs that stay inside the project root', () => {
    const manifest = buildContextManifest({
      goalId: 'g1',
      stage: 'planning',
      required: [ref('AGENTS.md', { scope: 'project' })],
    });
    const projectRef = manifest.required.find((item) => item.scope === 'project');
    expect(projectRef?.displayPath).toBe('project:AGENTS.md');
    expect(projectRef?.crossGoal).toBe(false);
  });

  test('rejects path traversal, absolute paths, and NUL bytes', () => {
    expect(() => buildContextManifest({ goalId: 'g1', required: [ref('../escape.md')] }))
      .toThrow('context reference escapes goal root');
    expect(() => buildContextManifest({ goalId: 'g1', required: [ref('C:/absolute.md')] }))
      .toThrow('context reference must be relative');
    expect(() => buildContextManifest({ goalId: 'g1', required: [ref('bad\0name.md')] }))
      .toThrow('context reference contains invalid characters');
    expect(() => buildContextManifest({ goalId: 'g1', required: [ref('   ')] }))
      .toThrow('context reference path is required');
  });

  test('rejects an unknown stage', () => {
    expect(() => buildContextManifest({ goalId: 'g1', stage: 'shipping' as never }))
      .toThrow('unknown context stage: shipping');
  });
});

describe('buildContextManifest existence probes', () => {
  const exists = (item: ContextManifestRef): boolean => !item.displayPath.includes('missing');

  test('rejects a missing required file', () => {
    expect(() => buildContextManifest({
      goalId: 'g1',
      stage: 'planning',
      required: [ref('g1/missing.md')],
      exists,
    })).toThrow('required context missing: g1/missing.md');
  });

  test('rejects an unreadable optional file', () => {
    expect(() => buildContextManifest({
      goalId: 'g1',
      stage: 'planning',
      optional: [ref('g1/missing.md')],
      exists,
    })).toThrow('context reference not readable: g1/missing.md');
  });
});

describe('renderContextManifest', () => {
  const manifest = buildContextManifest({
    goalId: 'g1',
    revision: 2,
    stage: 'implementing',
    role: 'builder',
    required: [ref('g1/receipts/loop-2.json')],
    optional: [ref('other-goal/secret.md')],
    allowedCrossGoalRefs: ['other-goal/secret.md'],
  });

  test('renders a deterministic files-only block', () => {
    const block = renderContextManifest(manifest);
    expect(block).toContain('[CONTEXT MANIFEST]');
    expect(block).toContain('goal: g1');
    expect(block).toContain('revision: 2');
    expect(block).toContain('stage: implementing');
    expect(block).toContain('role: builder');
    expect(block).toContain('g1/goal.md');
    expect(block).toContain('g1/receipts/loop-2.json');
    expect(block).toContain('other-goal/secret.md');
    expect(block).toContain('authoritative');
    expect(block).not.toContain('other-goal/private-discussion');
    expect(block).toBe(renderContextManifest(manifest));
  });

  test('omits empty optional and cross-Goal sections', () => {
    const block = renderContextManifest(buildContextManifest({ goalId: 'g1', stage: 'planning' }));
    expect(block).not.toContain('Optional:');
    expect(block).not.toContain('Cross-goal');
  });
});
