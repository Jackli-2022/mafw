/**
 * usage 插件返回值深度校验（makeAdapter.fetch）——字段级错误消息，
 * 让插件作者一眼看到哪个字段类型不对，而不是 UI 上出现 NaN 后半天定位。
 */
import { makeAdapter } from '../../../src/usage/plugin-context';
import { log } from '../../../src/core/utils/logger';

jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const OK = (over: any = {}) => ({
  name: 'p', type: 'api', plan: 'P',
  windows: [{ window: 'balance', used: 1, limit: 10, pct: 10, unit: '$' }],
  ...over,
});

function makeFetch(returns: any) {
  const mod = { name: 'p', type: 'api', async fetch() { return returns; } };
  return makeAdapter(mod as any, 'p.js');
}

describe('usage adapter deep validation', () => {
  afterEach(() => jest.clearAllMocks());

  it('valid result passes through', async () => {
    const out = await makeFetch(OK()).fetch();
    expect(out).toMatchObject({ name: 'p' });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('null passes through (hide provider)', async () => {
    expect(await makeFetch(null).fetch()).toBeNull();
  });

  it('missing name -> reject', async () => {
    expect(await makeFetch(OK({ name: undefined })).fetch()).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('name'));
  });

  it('windows not array -> reject', async () => {
    expect(await makeFetch(OK({ windows: 'x' })).fetch()).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('windows'));
  });

  it('windows[0] not object -> field-level error', async () => {
    expect(await makeFetch(OK({ windows: ['oops'] })).fetch()).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('windows[0]'));
  });

  it('pct as string -> field-level error and reject (NaN severity source)', async () => {
    expect(await makeFetch(OK({ windows: [{ window: 'balance', used: 1, limit: 10, pct: '10' }] })).fetch()).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('windows[0].pct'));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('number'));
  });

  it('missing used -> field-level error', async () => {
    expect(await makeFetch(OK({ windows: [{ window: 'balance', limit: 10 }] })).fetch()).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('windows[0].used'));
  });

  it('missing window -> field-level error', async () => {
    expect(await makeFetch(OK({ windows: [{ used: 1, limit: 10, pct: 10 }] })).fetch()).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('windows[0].window'));
  });

  it('second element broken -> precise index (windows[1])', async () => {
    const windows = [{ window: 'balance', used: 1, limit: 10, pct: 10 }, { window: '5h', used: 'x', limit: 1 }];
    expect(await makeFetch(OK({ windows })).fetch()).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('windows[1].used'));
  });

  it('severity auto-derived on valid path', async () => {
    const out = await makeFetch(OK({ windows: [{ window: 'balance', used: 9, limit: 10, pct: 95 }] })).fetch() as any;
    expect(out.severity).toBe('critical');
  });
});
