/**
 * validateRuntimeShape —— runtime 插件返回值"声明 vs 实现"一致性校验。
 * 插件声明 sessionApi: true 却没实现 session.prompt 之类的错位，
 * 以前要到运行时深处才炸；现在激活/切换期就给出字段级诊断。
 */
import { validateRuntimeShape } from '../../../src/runtime/validate';
import { minimalCapabilities } from '../../../src/runtime/contract';

const OK_RT = (over: any = {}) => ({
  name: 'rt',
  capabilities: { ...minimalCapabilities(), ...over.caps },
  session: {
    create: async () => ({}),
    promptAsync: async () => undefined,
    prompt: async () => ({}),
    messages: async () => ({ data: [] }),
  },
  global: { event: async function* () {} },
  ...over,
});

describe('validateRuntimeShape', () => {
  it('complete runtime passes (no issues)', () => {
    expect(validateRuntimeShape(OK_RT() as any, 'x')).toEqual([]);
  });

  it('non-object -> single issue', () => {
    const issues = validateRuntimeShape(null as any, 'x');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/must be an object/i);
  });

  it('missing name -> issue', () => {
    const rt = OK_RT(); delete (rt as any).name;
    expect(validateRuntimeShape(rt as any, 'x')[0]).toMatch(/name/i);
  });

  it('declares sessionApi but session missing -> field-level issue', () => {
    const rt = OK_RT(); delete (rt as any).session;
    const issues = validateRuntimeShape(rt as any, 'my-rt');
    expect(issues.some((i) => i.includes('sessionApi') && i.includes('session is missing'))).toBe(true);
  });

  it('declares sessionApi but session.messages missing -> names the method', () => {
    const rt = OK_RT(); delete (rt as any).session.messages;
    const issues = validateRuntimeShape(rt as any, 'my-rt');
    expect(issues.some((i) => i.includes('session.messages'))).toBe(true);
  });

  it('declares eventStream but global.event missing -> issue', () => {
    const rt = OK_RT({ caps: { eventStream: true } }); delete (rt as any).global;
    const issues = validateRuntimeShape(rt as any, 'my-rt');
    expect(issues.some((i) => i.includes('eventStream') && i.includes('global.event'))).toBe(true);
  });

  it('optional methods not required (permissionReply/question/fork absent ok)', () => {
    const rt = OK_RT();
    expect(validateRuntimeShape(rt as any, 'x')).toEqual([]);
  });

  it('issues carry source name for diagnosis', () => {
    const rt = OK_RT(); delete (rt as any).session;
    const issues = validateRuntimeShape(rt as any, 'my-rt');
    expect(issues.every((i) => i.includes('my-rt'))).toBe(true);
  });
});
