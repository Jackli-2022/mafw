jest.mock('cross-spawn', () => {
  const spawnCalls: any[] = [];
  const makeChild = () => ({
    pid: 4321,
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn(),
    kill: jest.fn(),
  });
  let child: any = null;
  const mock: any = jest.fn(() => { child = makeChild(); spawnCalls.push(child); return child; });
  mock.__spawnCalls = spawnCalls;
  mock.__reset = () => { spawnCalls.length = 0; child = null; };
  mock.__lastChild = () => child;
  return mock;
});

describe('serve-sidecar spawn options', () => {
  let startServeSidecar: any;
  let crossSpawnMock: any;

  beforeEach(() => {
    jest.resetModules();
    crossSpawnMock = require('cross-spawn');
    if (crossSpawnMock.__reset) crossSpawnMock.__reset();
    startServeSidecar = require('../../src/serve-sidecar').startServeSidecar;
  });

  test('spawns opencode serve with windowsHide (no black console window)', async () => {
    await spawnAndGetChild();
    expect(crossSpawnMock).toHaveBeenCalledWith(
      'opencode',
      expect.arrayContaining(['serve', '--hostname=127.0.0.1', '--port=4096']),
      expect.objectContaining({ windowsHide: true }),
    );
  });

  test('passes OPENCODE_CONFIG_CONTENT env like the SDK contract', async () => {
    await spawnAndGetChild();
    const opts = crossSpawnMock.mock.calls[0][2];
    expect(opts.env.OPENCODE_CONFIG_CONTENT).toBe('{}');
    expect(opts.env.Path ?? opts.env.PATH).toBeDefined(); // Windows uses Path
  });

  test('pipes stdio to detect the ready line', async () => {
    await spawnAndGetChild();
    const opts = crossSpawnMock.mock.calls[0][2];
    expect(opts.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });

  test('resolves url from "opencode server listening on <url>" and forwards output', async () => {
    const chunks: string[] = [];
    const pending = startServeSidecar({
      host: '127.0.0.1',
      port: 4096,
      timeoutMs: 5000,
      onOutput: (c: string) => chunks.push(c),
    });
    const child = crossSpawnMock.__lastChild();
    const stdoutHandler = child.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')[1];
    stdoutHandler(Buffer.from('some noise\nopencode server listening on http://127.0.0.1:4096\n'));
    const result = await pending;
    expect(result.url).toBe('http://127.0.0.1:4096');
    expect(chunks.join('')).toContain('opencode server listening');
  });

  test('tree-kills the child on close (cmd wrapper + opencode.exe)', async () => {
    const execSyncSpy = jest.spyOn(require('child_process'), 'execSync').mockReturnValue(Buffer.from(''));
    const pending = startServeSidecar({ host: '127.0.0.1', port: 4096, timeoutMs: 5000 });
    const child = crossSpawnMock.__lastChild();
    const stdoutHandler = child.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')[1];
    stdoutHandler(Buffer.from('opencode server listening on http://127.0.0.1:4096\n'));
    const result = await pending;
    result.close();
    expect(execSyncSpy).toHaveBeenCalledWith(
      expect.stringContaining('taskkill /F /T /PID 4321'),
      expect.objectContaining({ windowsHide: true }),
    );
    execSyncSpy.mockRestore();
  });

  test('rejects on startup timeout and kills the child', async () => {
    jest.useFakeTimers();
    const execSyncSpy = jest.spyOn(require('child_process'), 'execSync').mockReturnValue(Buffer.from(''));
    const pending = startServeSidecar({ host: '127.0.0.1', port: 4096, timeoutMs: 50 });
    const assertion = expect(pending).rejects.toThrow(/Timeout waiting for opencode serve/);
    jest.advanceTimersByTime(60);
    await assertion;
    expect(execSyncSpy).toHaveBeenCalledWith(
      expect.stringContaining('taskkill /F /T /PID 4321'),
      expect.anything(),
    );
    execSyncSpy.mockRestore();
    jest.useRealTimers();
  });

  test('rejects when the child exits before the ready line', async () => {
    const pending = startServeSidecar({ host: '127.0.0.1', port: 4096, timeoutMs: 5000 });
    const child = crossSpawnMock.__lastChild();
    const exitHandler = child.on.mock.calls.find((c: any[]) => c[0] === 'exit')[1];
    exitHandler(1);
    await expect(pending).rejects.toThrow(/exited with code 1/);
  });

  async function spawnAndGetChild(): Promise<any> {
    const pending = startServeSidecar({ host: '127.0.0.1', port: 4096, timeoutMs: 5000 });
    const child = crossSpawnMock.__lastChild();
    const stdoutHandler = child.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')[1];
    stdoutHandler(Buffer.from('opencode server listening on http://127.0.0.1:4096\n'));
    await pending;
    return child;
  }
});
