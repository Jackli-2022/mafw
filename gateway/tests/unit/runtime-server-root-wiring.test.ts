import { MafwScheduler } from '../../src/index';

describe('runtime server root wiring', () => {
  it('startServe 把规范 runtime root 传给 spawnServe', async () => {
    const scheduler = new MafwScheduler('.');
    const spawnServe = jest.fn(async () => ({
      url: 'http://127.0.0.1:4096',
      close: jest.fn(),
    }));
    (scheduler as any).runtime = { agentProcess: { spawnServe } };

    await (scheduler as any).startServe();

    expect(spawnServe).toHaveBeenCalledWith(
      expect.objectContaining({
        rootDir: expect.stringMatching(/[\\/]\.mafw[\\/]runtime-root$/),
      }),
    );
  });
});
