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

describe('resolveOpencodeBin（2.1.0 二进制解析）', () => {
  let resolveOpencodeBin: any;
  beforeEach(() => { jest.resetModules(); resolveOpencodeBin = require('../../src/runtime/serve-sidecar').resolveOpencodeBin; });

  test('显式 MAFW_OPENCODE_BIN / OPENCODE_BIN 优先', () => {
    const exists = () => false;
    expect(resolveOpencodeBin({ env: { MAFW_OPENCODE_BIN: 'C:/x/opencode.exe' }, platform: 'win32', exists }))
      .toBe('C:/x/opencode.exe');
    expect(resolveOpencodeBin({ env: { OPENCODE_BIN: '/usr/local/bin/opencode' }, platform: 'linux', exists }))
      .toBe('/usr/local/bin/opencode');
  });

  test('跳过 PATH 中的 node_modules/.bin dev shim（本地旧版 opencode 会拒绝 2.1.0 配置）', () => {
    const exists = (p: string) => p === 'C:\\work\\repo\\node_modules\\.bin\\opencode.cmd' || p === 'C:\\home\\bin\\opencode.cmd';
    const bin = resolveOpencodeBin({
      env: { Path: 'C:\\work\\repo\\node_modules\\.bin;C:\\home\\bin' },
      platform: 'win32',
      exists,
    });
    expect(bin).toBe('C:\\home\\bin\\opencode.cmd');
  });

  test('PATH 顺序取第一个存在的候选；全缺省回退裸名交由 cross-spawn', () => {
    const exists = (p: string) => p === '/opt/bin/opencode';
    expect(resolveOpencodeBin({ env: { PATH: '/none:/opt/bin' }, platform: 'linux', exists })).toBe('/opt/bin/opencode');
    expect(resolveOpencodeBin({ env: { PATH: '/none' }, platform: 'linux', exists })).toBe('opencode');
    expect(resolveOpencodeBin({ env: {}, platform: 'linux', exists })).toBe('opencode');
  });
});

describe('serve-sidecar spawn options', () => {
  let startServeSidecar: any;
  let crossSpawnMock: any;

  beforeEach(() => {
    jest.resetModules();
    crossSpawnMock = require('cross-spawn');
    if (crossSpawnMock.__reset) crossSpawnMock.__reset();
    startServeSidecar = require('../../src/runtime/serve-sidecar').startServeSidecar;
  });

  test('spawns opencode serve with windowsHide (no black console window)', async () => {
    await spawnAndGetChild();
    expect(crossSpawnMock).toHaveBeenCalledWith(
      expect.any(String),   // resolveOpencodeBin 解析出的绝对路径或回退裸名
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

  test('opencode 2.1.0 banner "server listening on <url>" (no "opencode" prefix) also resolves ready', async () => {
    // 2026-10-22 生产事故根因：opencode 2.1.0 改了启动横幅（丢 "opencode" 前缀），
    // startsWith('opencode server listening') 不再命中 → 健康 serve 被 30s 超时 treeKill。
    const pending = startServeSidecar({ host: '127.0.0.1', port: 4096, timeoutMs: 5000 });
    const child = crossSpawnMock.__lastChild();
    const stdoutHandler = child.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')[1];
    stdoutHandler(Buffer.from('server listening on http://127.0.0.1:4096\n'));
    const result = await pending;
    expect(result.url).toBe('http://127.0.0.1:4096');
  });

  test('password opt injects OPENCODE_SERVER_PASSWORD env (2.1.0 serve auth)', async () => {
    // 2026-10-22 第三层根因：2.1.0 serve 强制 Basic auth（未设 OPENCODE_SERVER_PASSWORD
    // 时随机生成密码打在横幅里，gateway 无从得知）→ API 请求全被喂 SPA HTML。
    // gateway 主动设密码 = 双方已知 → adapter 可注入 Authorization。
    const pending = startServeSidecar({ host: '127.0.0.1', port: 4096, timeoutMs: 5000, password: 'test-serve-pw' });
    const child = crossSpawnMock.__lastChild();
    const opts = crossSpawnMock.mock.calls[0][2];
    expect(opts.env.OPENCODE_SERVER_PASSWORD).toBe('test-serve-pw');
    const stdoutHandler = child.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')[1];
    stdoutHandler(Buffer.from('server listening on http://127.0.0.1:4096\n'));
    const result = await pending;
    expect(result.password).toBe('test-serve-pw');  // 回传供 adapter 构造 Basic header
  });

  test('no password opt → OPENCODE_SERVER_PASSWORD 不注入（外部 serve 模式兼容）', async () => {
    const pending = startServeSidecar({ host: '127.0.0.1', port: 4096, timeoutMs: 5000 });
    crossSpawnMock.__lastChild();
    const opts = crossSpawnMock.mock.calls[0][2];
    expect(opts.env.OPENCODE_SERVER_PASSWORD).toBeUndefined();
    const child = crossSpawnMock.__lastChild();
    const stdoutHandler = child.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')[1];
    stdoutHandler(Buffer.from('server listening on http://127.0.0.1:4096\n'));
    await pending;
  });

  test('tree-kills the child on close (taskkill on win32, SIGKILL elsewhere)', async () => {
    const execSyncSpy = jest.spyOn(require('child_process'), 'execSync').mockReturnValue(Buffer.from(''));
    const pending = startServeSidecar({ host: '127.0.0.1', port: 4096, timeoutMs: 5000 });
    const child = crossSpawnMock.__lastChild();
    const stdoutHandler = child.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')[1];
    stdoutHandler(Buffer.from('opencode server listening on http://127.0.0.1:4096\n'));
    const result = await pending;
    result.close();
    if (process.platform === 'win32') {
      expect(execSyncSpy).toHaveBeenCalledWith(
        expect.stringContaining('taskkill /F /T /PID 4321'),
        expect.objectContaining({ windowsHide: true }),
      );
    } else {
      expect(execSyncSpy).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    }
    execSyncSpy.mockRestore();
  });

  test('rejects on startup timeout and kills the child', async () => {
    jest.useFakeTimers();
    const execSyncSpy = jest.spyOn(require('child_process'), 'execSync').mockReturnValue(Buffer.from(''));
    const pending = startServeSidecar({ host: '127.0.0.1', port: 4096, timeoutMs: 50 });
    const child = crossSpawnMock.__lastChild();
    const assertion = expect(pending).rejects.toThrow(/Timeout waiting for opencode serve/);
    jest.advanceTimersByTime(60);
    await assertion;
    if (process.platform === 'win32') {
      expect(execSyncSpy).toHaveBeenCalledWith(
        expect.stringContaining('taskkill /F /T /PID 4321'),
        expect.anything(),
      );
    } else {
      expect(execSyncSpy).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    }
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
