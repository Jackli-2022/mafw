import { createMafwApprovalExtension } from '../../../src/runtime/pi/pi-approval-extension';
import { createMafwHostExtension } from '../../../src/runtime/pi/pi-mafw-host-extension';
import type { GateDecision } from '../../../src/core/cognition/rules';

function fakeEmitter() {
  const handlers: Record<string, Function> = {};
  return { on: (n: string, fn: Function) => { handlers[n] = fn; }, handlers };
}

describe('审批扩展 gate 步（C1-C4；Review Focus #2/#3）', () => {
  function setup(evaluateGate?: Function, evaluatePermission?: Function) {
    const emit: any[] = [];
    const ext = createMafwApprovalExtension(
      {
        ask: async () => ({ decision: 'once' }),
        request: async () => ({ decision: 'once' }),   // human 流兜底（链落 human 时防炸）
        lastDecision: () => null,
      } as any,
      (e: any) => emit.push(e),
      { autoApprove: [], autoDeny: [] },
      'ses_gateway',
      evaluatePermission as any,
      evaluateGate as any,                                    // 第 6 参（新）
    );
    const em = fakeEmitter();
    ext.on(em as any);
    return { handler: em.handlers['tool_call'], emit };
  }
  it('规则 deny → block 且不走政策链（C4：更严终局）', async () => {
    const { handler } = setup(
      () => ({ decision: 'deny', reason: 'no-root-wipe' }) as GateDecision,
      () => { throw new Error('policy should not run after deny'); },
    );
    const ev = { toolName: 'bash', input: { command: 'rm -rf /' } };
    const r = await handler(ev, {});
    expect(r).toEqual({ block: true, reason: 'no-root-wipe' });
  });
  it('规则 rewrite → 逐键改 input 且继续政策链复评（C2/C3/Review Focus #3）', async () => {
    const seen: any[] = [];
    const { handler } = setup(
      () => ({ decision: 'rewrite', input: { command: 'docker run nginx --rm' } }) as GateDecision,
      (_sid: string, c: any) => { seen.push(c); return null; },
    );
    const ev = { toolName: 'bash', input: { command: 'docker run nginx' } };
    const r = await handler(ev, {});
    expect(r).toBeUndefined();                               // 未 block
    expect(ev.input.command).toBe('docker run nginx --rm');  // 原地逐键改
    expect(seen[0].metadata.args.command).toBe('docker run nginx --rm'); // 政策收到改写后（复评 C3）
  });
  it('规则 ask → 跳过政策直落 human（emit permission.asked）', async () => {
    const { handler, emit } = setup(() => ({ decision: 'ask' }) as GateDecision);
    await handler({ toolName: 'bash', input: {} }, {});
    expect(emit[0]?.payload?.type).toBe('permission.asked');
  });
  it('gate 步异常 → 放行继续链（C1/Review Focus #2：pi fail-CLOSED 被我方包裹）', async () => {
    let policyRan = false;
    const { handler } = setup(
      () => { throw new Error('gate boom'); },
      () => { policyRan = true; return null; },
    );
    const r = await handler({ toolName: 'bash', input: {} }, {});
    expect(r).toBeUndefined();
    expect(policyRan).toBe(true);
  });
  it('无 evaluateGate 注入 → 行为与现状一致（既有调用方零破坏）', async () => {
    const { handler } = setup(undefined, () => null);
    const r = await handler({ toolName: 'bash', input: {} }, {});
    expect(r).toBeUndefined();
  });
});

describe('宿主扩展 input/tool_result 钩', () => {
  function makeHost(cognition?: any) {
    const ext = createMafwHostExtension({
      sessionId: 's1', baseUrl: 'http://x',
      cognition,
    } as any);
    const em = fakeEmitter();
    ext.on(em as any);
    return em.handlers;
  }
  it('input：deny → handled；transform → 插值；allow → continue', async () => {
    const h = makeHost({
      gatePrompt: (_sid: string, text: string) =>
        text === 'deploy' ? { decision: 'deny', reason: 'needs goal' }
        : text.startsWith('TODO') ? { decision: 'transform', text: text + '\n(q)' }
        : { decision: 'allow' },
    });
    expect(await h['input']({ text: 'deploy' }, {})).toEqual({ action: 'handled' });
    expect(await h['input']({ text: 'TODO: x' }, {})).toEqual({ action: 'transform', text: 'TODO: x\n(q)' });
    expect(await h['input']({ text: 'hello' }, {})).toEqual({ action: 'continue' });
  });
  it('input：无 cognition deps → continue（向后兼容）', async () => {
    const h = makeHost(undefined);
    expect(await h['input']({ text: 'x' }, {})).toEqual({ action: 'continue' });
  });
  it('tool_result：redact 变换 content 原地；非文本透传（C7）', async () => {
    const h = makeHost({
      applyToolResultRedact: (_s: string, _t: string, content: any[]) =>
        content.map((c: any) => c.type === 'text' ? { ...c, text: c.text.replace(/sk-\w+/, '[R]') } : c),
    });
    const ev = {
      toolName: 'bash', isError: false, content: [
        { type: 'text', text: 'sk-abc' },
        { type: 'image', data: 'x' },
      ],
    };
    await h['tool_result'](ev, {});
    expect(ev.content[0].text).toBe('[R]');   // 原地变换
    expect(ev.content[1]).toEqual({ type: 'image', data: 'x' }); // 透传
  });
});
