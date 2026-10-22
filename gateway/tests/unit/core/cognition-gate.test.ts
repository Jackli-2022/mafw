import { createCognitionGate } from '../../../src/core/cognition/cognition-gate';
import { CognitionRule } from '../../../src/core/cognition/rules';

function makeGate(rules: CognitionRule[], internal: string[] = []) {
  let src = rules;
  const events: any[] = [];
  const gate = createCognitionGate({
    getRules: () => src,
    isInternalSession: (sid) => internal.includes(sid),
    onEvent: (e) => events.push(e),
    redact: (s) => s.replace(/sk-\w+/g, '[REDACTED]'),
  });
  return { gate, events, setRules: (r: CognitionRule[]) => { src = r; } };
}

describe('CognitionGate（spec §5.3；C5 豁免）', () => {
  it('gateToolCall：deny 命中 + cognition_gate 事件', () => {
    const { gate, events } = makeGate([{ on: 'tool_call', tool: 'bash', match: 'rm -rf /', action: 'deny', reason: 'destructive', name: 'no-root-wipe' }]);
    const d = gate.gateToolCall('s_user', { tool: 'bash', input: { command: 'rm -rf /' } })!;
    expect(d.decision).toBe('deny');
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('deny');
    expect(events[0].rule).toBe('no-root-wipe');
  });
  it('gateToolCall：rewrite 输出插值 input', () => {
    const { gate } = makeGate([{ on: 'tool_call', tool: 'bash', match: '^docker run', action: 'rewrite', input: { command: '{{command}} --rm' } }]);
    const d = gate.gateToolCall('s_user', { tool: 'bash', input: { command: 'docker run nginx' } })!;
    expect(d.decision).toBe('rewrite');
    expect((d as any).input.command).toBe('docker run nginx --rm');
  });
  it('gatePrompt：内部会话恒 allow（C5/Review Focus #1）', () => {
    const { gate, events } = makeGate([{ on: 'prompt', match: 'deploy', action: 'deny' }], ['s_goal_node']);
    expect(gate.gatePrompt('s_goal_node', 'deploy to prod')).toEqual({ decision: 'allow' });
    expect(events).toHaveLength(0);  // 豁免不是事件
  });
  it('gatePrompt：用户会话 deny + transform', () => {
    const { gate } = makeGate([
      { on: 'prompt', match: 'deploy', action: 'deny', reason: 'needs goal' },
      { on: 'prompt', match: '^TODO:', action: 'transform', text: '{{text}}\n(queued)' },
    ]);
    const d = gate.gatePrompt('s_user', 'deploy prod');
    expect(d.decision).toBe('deny');
    const t = gate.gatePrompt('s_user', 'TODO: fix');
    expect(t.decision).toBe('transform');
    expect((t as any).text).toBe('TODO: fix\n(queued)');
  });
  it('gatePrompt：内部豁免不依赖规则集（空规则同豁免）', () => {
    const { gate } = makeGate([], ['s_manager']);
    expect(gate.gatePrompt('s_manager', 'anything')).toEqual({ decision: 'allow' });
  });
  it('gateToolCall：异常 fail-open 返 null（Review Focus #2 的服务层半）', () => {
    const gate = createCognitionGate({ getRules: () => { throw new Error('boom'); }, isInternalSession: () => false });
    expect(gate.gateToolCall('s', { tool: 'bash', input: {} })).toBeNull();
    expect(gate.gatePrompt('s', 'x')).toEqual({ decision: 'allow' });
  });
  it('applyToolResultRedact：命中 on:tool_result 规则才变换', () => {
    const { gate } = makeGate([{ on: 'tool_result', tool: 'bash', action: 'redact' }]);
    const out = gate.applyToolResultRedact('s_user', 'bash', [{ type: 'text', text: 'sk-abc' }]);
    expect(out[0].text).toBe('[REDACTED]');
    const untouched = gate.applyToolResultRedact('s_user', 'edit', [{ type: 'text', text: 'sk-abc' }]);
    expect(untouched[0].text).toBe('sk-abc');  // tool 不匹配——原样
  });
  it('规则现读：getRules 每次调用（热重载语义 C9）', () => {
    const { gate, setRules } = makeGate([]);
    expect(gate.gatePrompt('s_user', 'deploy')).toEqual({ decision: 'allow' });
    setRules([{ on: 'prompt', match: 'deploy', action: 'deny' }]);
    expect(gate.gatePrompt('s_user', 'deploy').decision).toBe('deny');
  });
});
