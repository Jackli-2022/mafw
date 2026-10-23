import { injectServeAuth } from '../../../src/runtime/proxy-auth';

describe('injectServeAuth（2.1.0 反代 Basic 注入）', () => {
  const auth = { Authorization: 'Basic abc' };

  it('移除入站 Authorization（大小写不敏感）并注入 serve Basic', () => {
    const out = injectServeAuth({ authorization: 'Bearer gateway-token', Authorization: 'Bearer again', accept: 'application/json' }, auth);
    expect(out.Authorization).toBe('Basic abc');
    expect(out.authorization).toBeUndefined();
    expect(out.accept).toBe('application/json');
  });

  it('无入站头时仅注入 auth', () => {
    expect(injectServeAuth(undefined, auth)).toEqual({ Authorization: 'Basic abc' });
  });
});
