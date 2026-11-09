import { applyPiPolicyHooks } from '../../../src/runtime/pi/pi-policy';

function fakeRegistry() {
  const calls: any = {};
  return {
    calls,
    setPermissionEvaluator(fn: any) { calls.permission = fn; },
    setCognitionGate(fn: any) { calls.gate = fn; },
    setCognitionHost(host: any) { calls.host = host; },
  };
}

it('wires the permission evaluator and swallows its errors', () => {
  const registry = fakeRegistry();
  applyPiPolicyHooks(registry as any, {
    evaluatePermission: () => ({ decision: 'allow' }),
  });
  expect(typeof registry.calls.permission).toBe('function');
  expect(registry.calls.permission('s1', { tool: 'bash' })).toEqual({ decision: 'allow' });

  const throwing = fakeRegistry();
  applyPiPolicyHooks(throwing as any, { evaluatePermission: () => { throw new Error('boom'); } });
  expect(throwing.calls.permission('s1', {})).toBeNull();
});

it('wires the cognition gate and host', () => {
  const registry = fakeRegistry();
  applyPiPolicyHooks(registry as any, {
    gateToolCall: (_sid, payload) => ({ action: 'allow', tool: payload.tool }),
    gatePrompt: () => ({ action: 'allow' }),
    redactToolResult: (_sid, _tool, content) => content,
  });
  expect(registry.calls.gate('s1', { tool: 'read', input: {} })).toEqual({ action: 'allow', tool: 'read' });
  expect(registry.calls.host.gatePrompt('s1', 'hi')).toEqual({ action: 'allow' });
  expect(registry.calls.host.applyToolResultRedact('s1', 'read', ['x'])).toEqual(['x']);
});

it('does nothing without a policy', () => {
  const registry = fakeRegistry();
  applyPiPolicyHooks(registry as any, undefined);
  expect(registry.calls).toEqual({});
});
