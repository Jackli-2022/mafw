import { SCENARIOS, evaluateScenario } from '../../../src/runtime/conformance-scenarios';

const ev = (type: string, at = 0) => ({ type, at });

describe('S1 chat-roundtrip evaluator', () => {
  it('passes on delta + terminal sequence', () => {
    const events = [ev('part.updated', 1), ev('part.delta', 2), ev('turn.completed', 3)];
    expect(evaluateScenario('chat-roundtrip', events)).toEqual({ pass: true, failures: [] });
  });

  it('fails when no content event ever arrives (silent runtime)', () => {
    const events = [ev('turn.completed', 1)];
    const r = evaluateScenario('chat-roundtrip', events);
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes('content'))).toBe(true);
  });

  it('fails when no terminal event (turn never settles)', () => {
    const events = [ev('part.updated', 1), ev('part.delta', 2)];
    const r = evaluateScenario('chat-roundtrip', events);
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes('terminal'))).toBe(true);
  });

  it('fails on error terminal (counts as failure with error note)', () => {
    const events = [ev('part.updated', 1), ev('turn.failed', 2)];
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
  it('B2 历史形状断言：{info,parts[]} 合法通过；缺 parts fail；history 缺席 fail-open', () => {
    const ok = evaluateScenario('session-lifecycle', [], { created: true, deleted: true, history: [{ info: { id: 'm1' }, parts: [] }] });
    expect(ok.pass).toBe(true);
    const bad = evaluateScenario('session-lifecycle', [], { created: true, deleted: true, history: [{ info: {} }] });
    expect(bad.failures.some((f) => f.includes('history'))).toBe(true);
    const none = evaluateScenario('session-lifecycle', [], { created: true, deleted: true, history: undefined });
    expect(none.pass).toBe(true); // getMessages 失败不判死（fail-open）
  });
});

describe('catalog', () => {
  it('has 5 scenarios with prompts and timeouts', () => {
    expect(SCENARIOS.length).toBe(6);
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

describe('tool-visibility evaluator（spec 2026-10-20）', () => {
  const frame = (status: string, id = 'toolpart_p', toolClass?: string) => ({
    type: 'part.updated', sessionID: 'p1', at: 1,
    part: { id, type: 'tool', tool: 'mafw_conformance_probe', toolClass, state: { status, input: {}, ...(status === 'completed' ? { output: 'ok' } : {}) } },
  });

  it('两帧 running→completed 同 id + toolClass enrich → pass', () => {
    const r = evaluateScenario('tool-visibility', [frame('running'), frame('completed', 'toolpart_p', 'other')] as any);
    expect(r).toEqual({ pass: true, failures: [] });
  });

  it('零帧 → fail（显示链断）', () => {
    const r = evaluateScenario('tool-visibility', []);
    expect(r.pass).toBe(false);
    expect(r.failures[0]).toMatch(/2 tool part frames/);
  });

  it('缺 toolClass → fail；id 不一致 → fail；终态非 completed/error → fail', () => {
    const noClass = evaluateScenario('tool-visibility', [frame('running'), frame('completed')] as any);
    expect(noClass.failures.some((f) => f.includes('toolClass'))).toBe(true);
    const diffId = evaluateScenario('tool-visibility', [frame('running', 'a', 'other'), frame('completed', 'b', 'other')] as any);
    expect(diffId.failures.some((f) => f.includes('part.id'))).toBe(true);
    const badTerminal = evaluateScenario('tool-visibility', [frame('running'), frame('running', 'toolpart_p', 'other')] as any);
    expect(badTerminal.failures.some((f) => f.includes('terminal'))).toBe(true);
  });

  it('SCENARIOS 注册表含 tool-visibility（零 LLM 依赖）', () => {
    const sc = SCENARIOS.find((s) => s.id === 'tool-visibility');
    expect(sc).toBeDefined();
    expect(sc!.requires.eventStream).toBeFalsy();
    expect(sc!.timeoutMs).toBeLessThanOrEqual(15_000);
  });
});
