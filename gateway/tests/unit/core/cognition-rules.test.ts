import {
  CognitionRule, validateRules, ruleMatches, interpolateTemplate,
  evaluateGateRules, applyRedact, MATCH_TEXT_CAP,
} from '../../../src/core/cognition/rules';

describe('validateRules（C6 prompt+ask 拒绝；C8 坏正则跳过）', () => {
  it('合法规则集通过', () => {
    const r = validateRules([
      { on: 'tool_call', tool: 'bash', match: '^docker run', action: 'rewrite', input: { command: '{{command}} --rm' }, name: 'docker-rm' },
      { on: 'prompt', match: 'deploy', action: 'deny', reason: 'no prod' },
      { on: 'tool_result', action: 'redact' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(3);
  });
  it('prompt+ask 组合被拒（C6）', () => {
    const r = validateRules([{ on: 'prompt', match: 'x', action: 'ask' }]);
    expect(r.valid).toHaveLength(0);
    expect(r.errors[0]).toMatch(/ask.*prompt|prompt.*ask/i);
  });
  it('坏正则条目跳过 + error（C8 编译期）', () => {
    const r = validateRules([{ on: 'tool_call', match: '([unclosed', action: 'deny' }]);
    expect(r.valid).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
  });
  it('非对象条目跳过', () => {
    const r = validateRules(['nonsense', null, { on: 'tool_call', action: 'deny' }] as any);
    expect(r.valid).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
  });
});

describe('ruleMatches（on/tool/match 三级）', () => {
  const base = { on: 'tool_call', tool: 'bash', match: 'rm -rf', action: 'deny' } as CognitionRule;
  it('on/tool/match 全中', () => {
    expect(ruleMatches(base, { kind: 'tool_call', tool: 'bash', text: 'rm -rf /tmp/x' })).toBe(true);
  });
  it('tool 不匹配 → false', () => {
    expect(ruleMatches(base, { kind: 'tool_call', tool: 'edit', text: 'rm -rf' })).toBe(false);
  });
  it('kind 不匹配 → false', () => {
    expect(ruleMatches(base, { kind: 'prompt', tool: 'bash', text: 'rm -rf' })).toBe(false);
  });
  it('match 缺省 = 只按 on/tool 过滤', () => {
    const r = { ...base, match: undefined };
    expect(ruleMatches(r, { kind: 'tool_call', tool: 'bash', text: 'anything' })).toBe(true);
  });
  it('match 文本超帽截断（C8：规则侧超长不整段命中）', () => {
    const r = { ...base, match: `rm -rf${'x'.repeat(MATCH_TEXT_CAP)}` };
    expect(ruleMatches(r, { kind: 'tool_call', tool: 'bash', text: 'rm -rf' })).toBe(false);
  });
});

describe('interpolateTemplate', () => {
  it('{{field}} 插值原值；缺字段→空串', () => {
    expect(interpolateTemplate('{{command}} --rm', { command: 'docker run nginx' })).toBe('docker run nginx --rm');
    expect(interpolateTemplate('a {{missing}} b', { command: 'x' })).toBe('a  b');
  });
});

describe('evaluateGateRules（首条命中；模板用原始 input 插值）', () => {
  it('deny 命中带 reason/rule', () => {
    const d = evaluateGateRules(
      [{ on: 'tool_call', tool: 'bash', match: 'rm -rf /', action: 'deny', reason: 'destructive', name: 'no-root-wipe' }],
      { kind: 'tool_call', tool: 'bash', text: 'rm -rf /', input: { command: 'rm -rf /' } },
    )!;
    expect(d.decision).toBe('deny');
    expect((d as any).rule).toBe('no-root-wipe');
  });
  it('rewrite：input 模板插值自原始 input', () => {
    const d = evaluateGateRules(
      [{ on: 'tool_call', tool: 'bash', match: '^docker run', action: 'rewrite', input: { command: '{{command}} --rm' } }],
      { kind: 'tool_call', tool: 'bash', text: 'docker run nginx', input: { command: 'docker run nginx' } },
    )!;
    expect(d.decision).toBe('rewrite');
    expect((d as any).input).toEqual({ command: 'docker run nginx --rm' });
  });
  it('无命中 → null', () => {
    expect(evaluateGateRules([{ on: 'tool_call', action: 'deny' }], { kind: 'prompt', text: 'x' })).toBeNull();
  });
  it('transform 规则不经 evaluateGateRules（input 门单独消费 evaluateTransformRule）', () => {
    expect(evaluateGateRules([{ on: 'prompt', match: 'x', action: 'transform', text: 't' }], { kind: 'prompt', text: 'x' })).toBeNull();
  });
});

describe('applyRedact（C7 图片透传）', () => {
  it('text 部件变换、image 部件原样在场（Review Focus #5）', () => {
    const content = [
      { type: 'text', text: 'key=sk-secret123' },
      { type: 'image', data: 'base64...', mimeType: 'image/png' },
      { type: 'text', text: 'clean' },
    ];
    const out = applyRedact(content, (s) => s.replace(/sk-\w+/g, '[REDACTED]'));
    expect(out[0].text).toBe('key=[REDACTED]');
    expect(out[1]).toEqual(content[1]);  // image 原样
    expect(out[2].text).toBe('clean');
  });
});
