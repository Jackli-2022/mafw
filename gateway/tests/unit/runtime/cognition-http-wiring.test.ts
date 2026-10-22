// 路由单测（deps 注入模式）：
import { handleCognitionGate } from '../../../src/routes/cognition';

describe('POST /api/cognition/gate 路由（deps 注入）', () => {
  function fakeRes() {
    return { statusCode: 0, body: null as any, writeHead(c: number) { this.statusCode = c; return this; }, end(b?: string) { if (b) this.body = JSON.parse(b); } } as any;
  }
  it('tool_call 载荷 → decision 透传', async () => {
    const res = fakeRes();
    await handleCognitionGate({
      body: { sessionID: 's1', kind: 'tool_call', tool: 'bash', input: { command: 'rm -rf /' } },
      gate: { gateToolCall: () => ({ decision: 'deny', reason: 'destructive' }), gatePrompt: () => ({ decision: 'allow' }) } as any,
      res,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.decision).toBe('deny');
  });
  it('prompt 载荷 → gatePrompt 透传（内部豁免在服务层）', async () => {
    const res = fakeRes();
    await handleCognitionGate({
      body: { sessionID: 's_goal', kind: 'prompt', text: 'deploy' },
      gate: { gateToolCall: () => null, gatePrompt: () => ({ decision: 'allow' }) } as any,
      res,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.decision).toBe('allow');
  });
  it('坏 kind → 400', async () => {
    const res = fakeRes();
    await handleCognitionGate({ body: { sessionID: 's', kind: 'bogus' }, gate: {} as any, res });
    expect(res.statusCode).toBe(400);
  });
});

// wiring 断言（index.ts 巨类源码模式）：
import { readFileSync } from 'fs';
import { join } from 'path';
const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');
describe('index.ts cognition 接线', () => {
  it('CognitionGate 实例 + isInternalSession 接 internalSessionRoles（C5）', () => {
    expect(src).toMatch(/createCognitionGate\(/);
    expect(src).toMatch(/internalSessionRoles\.has/);
  });
  it('cognition_gate 扁平事件经 broadcast（Review Focus #4）', () => {
    expect(src).toMatch(/type: 'cognition_gate'/);
  });
  it('HTTP 动词注册 + loopback 门', () => {
    expect(src).toMatch(/\/api\/cognition\/gate/);
  });
});
// desktop：TAIL_ACCOUNTED_PREFIXES 含 cognition:
const desktopSrc = readFileSync(join(__dirname, '../../../../packages/desktop/src/renderer/mafw/session-events.ts'), 'utf8');
describe('desktop cognition_gate 消费（builder check D 裁定）', () => {
  it('TAIL_ACCOUNTED_PREFIXES 含 cognition: 前缀', () => {
    expect(desktopSrc).toMatch(/TAIL_ACCOUNTED_PREFIXES = \["plugin:", "cognition:"\]/);
  });
});
