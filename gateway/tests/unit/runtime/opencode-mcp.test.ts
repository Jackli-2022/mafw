// gateway/tests/unit/runtime/opencode-mcp.test.ts
// opencode MCP 适配器（RuntimeMcpChannel 实现）单测：CLI 解析、Windows shim 处置、
// 配置文档 + 运行时状态合并、HTTP 失败回退 CLI、connect/disconnect 映射。
import {
  parseMcpListOutput,
  resolveMcpListCommand,
  createOpencodeMcpChannel,
} from '../../../src/runtime/opencode-mcp';

describe('parseMcpListOutput', () => {
  test('connected / failed / needs_auth / disabled', () => {
    const out = parseMcpListOutput([
      '✓ mafw  connected',
      '✗ broken  failed: spawn ENOENT',
      '! sentry  needs authentication',
      '✓ local-x  disabled',
      '',
      'random noise line',
    ].join('\n'));
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ name: 'mafw', status: 'connected' });
    expect(out[1]).toMatchObject({ name: 'broken', status: 'failed' });
    expect(out[2]).toMatchObject({ name: 'sentry', status: 'needs_auth' });
    expect(out[3]).toMatchObject({ name: 'local-x', status: 'disabled' });
  });

  test('ANSI 颜色剥离', () => {
    const out = parseMcpListOutput('\x1b[32m✓\x1b[0m mafw  connected');
    expect(out[0]).toMatchObject({ name: 'mafw', status: 'connected' });
  });

  test('空输出 → []', () => {
    expect(parseMcpListOutput('')).toEqual([]);
  });
});

describe('resolveMcpListCommand（Windows shim 处置）', () => {
  const normalize = (p: string) => p.replace(/\\/g, '/');

  test('.ps1 → 找兄弟官方 exe', () => {
    const cmd = resolveMcpListCommand('C:/g/opencode.ps1', (p) => normalize(p) === 'C:/g/node_modules/@opencode/cli/bin/opencode.exe');
    expect(cmd?.shell).toBe(false);
    expect(normalize(cmd?.bin ?? '')).toBe('C:/g/node_modules/@opencode/cli/bin/opencode.exe');
  });

  test('.ps1 无兄弟 exe → null（避免 15s 挂死）', () => {
    expect(resolveMcpListCommand('C:/g/opencode.ps1', () => false)).toBeNull();
  });

  test('.cmd → shell:true', () => {
    expect(resolveMcpListCommand('C:/g/opencode.cmd', (p) => p === 'C:/g/opencode.cmd')).toEqual({
      bin: 'C:/g/opencode.cmd',
      shell: true,
    });
  });

  test('.exe → 直跑', () => {
    expect(resolveMcpListCommand('C:/g/opencode.exe', () => true)).toEqual({
      bin: 'C:/g/opencode.exe',
      shell: false,
    });
  });
});

describe('createOpencodeMcpChannel', () => {
  const docs = [
    {
      type: 'document',
      path: 'C:/Users/u/.config/opencode/opencode.jsonc',
      info: {
        mcp: {
          servers: {
            mafw: { type: 'remote', url: 'http://127.0.0.1:3000/mcp', oauth: false, disabled: false },
            localx: { type: 'local', command: ['npx', '-y', 'x'] },
            off: { type: 'remote', url: 'https://off.example/mcp', disabled: true },
          },
        },
      },
    },
  ];

  function makeChannel(overrides: Partial<Parameters<typeof createOpencodeMcpChannel>[0]> = {}) {
    const calls: Array<{ url: string; method?: string }> = [];
    const channel = createOpencodeMcpChannel({
      getBaseUrl: () => 'http://127.0.0.1:4096/',
      headers: () => ({ Authorization: 'Basic x' }),
      getConfigDocuments: async () => docs,
      listCliOutput: async () => '✓ cli-only  connected',
      fetchImpl: (async (url: any, init: any) => {
        calls.push({ url: String(url), method: init?.method });
        return {
          ok: true,
          json: async () => ({
            location: { directory: 'C:/w' },
            data: [
              { name: 'mafw', status: { status: 'connected' } },
              { name: 'runtime-only', status: { status: 'failed', error: 'boom' } },
            ],
          }),
        };
      }) as any,
      ...overrides,
    });
    return { channel, calls };
  }

  test('合并配置文档 + 运行时状态（含运行时-only；按名排序；带来源）', async () => {
    const { channel, calls } = makeChannel();
    const list = await channel.list();
    expect(calls[0].url).toBe('http://127.0.0.1:4096/api/mcp');
    expect(list.map((s) => s.name)).toEqual(['localx', 'mafw', 'off', 'runtime-only']);
    const mafw = list.find((s) => s.name === 'mafw')!;
    expect(mafw).toMatchObject({ status: 'connected', type: 'remote', url: 'http://127.0.0.1:3000/mcp', source: 'opencode.jsonc' });
    expect(list.find((s) => s.name === 'off')).toMatchObject({ disabled: true, status: 'unknown' });
    expect(list.find((s) => s.name === 'runtime-only')).toMatchObject({ status: 'failed', detail: 'boom' });
  });

  test('HTTP 不可用且配置为空 → CLI 回退', async () => {
    const { channel } = makeChannel({
      getConfigDocuments: async () => [],
      fetchImpl: (async () => { throw new Error('ECONNREFUSED') }) as any,
      listCliOutput: async () => '✓ cli-only  connected',
    });
    expect(await channel.list()).toEqual([
      { name: 'cli-only', status: 'connected' },
    ]);
  });

  test('connect/disconnect 映射 v2 experimental 路径', async () => {
    const { channel, calls } = makeChannel();
    expect(await channel.connect('mafw')).toBe(true);
    expect(await channel.disconnect('mafw')).toBe(true);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'POST /api/experimental/mcp/mafw/connect',
      'POST /api/experimental/mcp/mafw/disconnect',
    ]);
  });

  test('directory → location 查询参数', async () => {
    const { channel, calls } = makeChannel();
    await channel.list({ directory: 'C:/work x' });
    expect(calls[0].url).toBe('http://127.0.0.1:4096/api/mcp?location=C%3A%2Fwork%20x');
    await channel.connect('a b', { directory: 'C:/p' });
    expect(new URL(calls[1].url!).searchParams.get('location')).toBe('C:/p');
    expect(new URL(calls[1].url!).pathname).toBe('/api/experimental/mcp/a%20b/connect');
  });
});
