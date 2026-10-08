import { SCENARIOS, evaluateScenario } from '../../../src/runtime/conformance-scenarios';

const ev = (type: string, at = 0) => ({ type, at });

describe('S1 chat-roundtrip evaluator', () => {
  it('passes on delta + terminal sequence', () => {
    const events = [ev('message.part.updated', 1), ev('message.part.delta', 2), ev('message.complete', 3)];
    expect(evaluateScenario('chat-roundtrip', events)).toEqual({ pass: true, failures: [] });
  });

  it('fails when no content event ever arrives (silent runtime)', () => {
    const events = [ev('session.idle', 1)];
    const r = evaluateScenario('chat-roundtrip', events);
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes('content'))).toBe(true);
  });

  it('fails when no terminal event (turn never settles)', () => {
    const events = [ev('message.part.updated', 1), ev('message.part.delta', 2)];
    const r = evaluateScenario('chat-roundtrip', events);
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes('terminal'))).toBe(true);
  });

  it('fails on error terminal (counts as failure with error note)', () => {
    const events = [ev('message.part.updated', 1), ev('message.error', 2)];
    const r = evaluateScenario('chat-roundtrip', events);
    expect(r.pass).toBe(false);
  });
});

describe('S2 session-lifecycle evaluator', () => {
  it('passes when created and deleted both observed via API', () => {
    expect(evaluateScenario('session-lifecycle', [], { created: true, deleted: true })).toEqual({ pass: true, failures: [] });
  });
  it('fails when created missing', () => {
    const r = evaluateScenario('session-lifecycle', [], { created: false, deleted: true });
    expect(r.pass).toBe(false);
  });
  it('fails when deleted missing (session leaked)', () => {
    const r = evaluateScenario('session-lifecycle', [], { created: true, deleted: false });
    expect(r.pass).toBe(false);
  });
});

describe('catalog', () => {
  it('has 5 scenarios with prompts and timeouts', () => {
    expect(SCENARIOS.length).toBe(5);
    for (const s of SCENARIOS) {
      expect(s.id).toBeTruthy();
      expect(s.timeoutMs).toBeGreaterThan(1000);
    }
  });
});

describe('S3 cognition-observe evaluator', () => {
  it('passes when user_input + tool_result + assistant_reply all present', () => {
    const r = evaluateScenario('cognition-observe', [], undefined, {
      sources: ['user_input', 'tool_result', 'assistant_reply'],
    });
    expect(r).toEqual({ pass: true, failures: [] });
  });

  it('fails and names the missing source (tool_result)', () => {
    const r = evaluateScenario('cognition-observe', [], undefined, {
      sources: ['user_input', 'assistant_reply'],
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join()).toContain('tool_result');
  });

  it('fails when no observations at all (host observe verb missing)', () => {
    const r = evaluateScenario('cognition-observe', [], undefined, { sources: [] });
    expect(r.pass).toBe(false);
    expect(r.failures).toHaveLength(3);
  });
});

describe('S4 cognition-inject evaluator', () => {
  it('passes on guide echo + recall touch', () => {
    const r = evaluateScenario('cognition-inject', [], undefined, {
      sources: ['user_input', 'assistant_reply'],
      recallCalledAt: 123,
      guideEcho: '## 记忆',
    });
    expect(r).toEqual({ pass: true, failures: [] });
  });

  it('fails when recall never called (injectContext not wired)', () => {
    const r = evaluateScenario('cognition-inject', [], undefined, {
      sources: ['user_input', 'assistant_reply'],
      recallCalledAt: null,
      guideEcho: '## 记忆',
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join()).toContain('recall');
  });

  it('fails when guide did not reach the model (no echo)', () => {
    const r = evaluateScenario('cognition-inject', [], undefined, {
      sources: ['user_input', 'assistant_reply'],
      recallCalledAt: 123,
      guideEcho: 'I have no such block',
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join()).toContain('memory-guide');
  });
});

describe('S5 identity-roundtrip evaluator', () => {
  // non-internal conformance session → allowlist 命中落穿档位（bash=human），
  // 非白名单/deny 一律 auto-deny（无人值守 auto-approve 由 policy-service 单测覆盖）。
  const goodPolicy = [
    { tool: 'bash', action: 'human' },
    { tool: 'webfetch', action: 'auto-deny' },
    { tool: 'edit', action: 'auto-deny' },
  ];

  it('passes on identity echo + deny/allowlist gating', () => {
    const r = evaluateScenario('identity-roundtrip', [], undefined, undefined, {
      identityEcho: '[MAFW MANAGER IDENTITY]',
      policy: goodPolicy,
    });
    expect(r).toEqual({ pass: true, failures: [] });
  });

  it('fails when identity did not reach the model (lane 1 broken)', () => {
    const r = evaluateScenario('identity-roundtrip', [], undefined, undefined, {
      identityEcho: '',
      policy: goodPolicy,
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join()).toContain('identity');
  });

  it('fails when edit is not denied by policy', () => {
    const r = evaluateScenario('identity-roundtrip', [], undefined, undefined, {
      identityEcho: '[MAFW MANAGER IDENTITY]',
      policy: [
        { tool: 'bash', action: 'human' },
        { tool: 'webfetch', action: 'auto-deny' },
        { tool: 'edit', action: 'auto-approve' },
      ],
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join()).toContain('edit');
  });

  it('fails when a non-allowlisted tool is not denied', () => {
    const r = evaluateScenario('identity-roundtrip', [], undefined, undefined, {
      identityEcho: '[MAFW MANAGER IDENTITY]',
      policy: [
        { tool: 'bash', action: 'human' },
        { tool: 'webfetch', action: 'human' },
        { tool: 'edit', action: 'auto-deny' },
      ],
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join()).toContain('webfetch');
  });

  it('fails when an allowlisted tool is wrongly denied', () => {
    const r = evaluateScenario('identity-roundtrip', [], undefined, undefined, {
      identityEcho: '[MAFW MANAGER IDENTITY]',
      policy: [
        { tool: 'bash', action: 'auto-deny' },
        { tool: 'webfetch', action: 'auto-deny' },
        { tool: 'edit', action: 'auto-deny' },
      ],
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join()).toContain('bash');
  });
});
