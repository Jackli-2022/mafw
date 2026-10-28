// gateway/tests/unit/mcp-list.test.ts
// B3：`opencode mcp list` 输出解析 + /api/mcp/servers 路由。
import * as http from 'http';
import { handleMcpList, parseMcpListOutput, resolveMcpListCommand } from '../../src/routes/mcp-list';

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
  test('.ps1 → 找兄弟官方 exe', () => {
    const normalize = (p: string) => p.replace(/\\/g, '/')
    const cmd = resolveMcpListCommand('C:/g/opencode.ps1', (p) => normalize(p) === 'C:/g/node_modules/@opencode/cli/bin/opencode.exe');
    expect(cmd?.shell).toBe(false);
    expect(normalize(cmd?.bin ?? '')).toBe('C:/g/node_modules/@opencode/cli/bin/opencode.exe');
  });
  test('.ps1 无兄弟 exe → null（不可用，避免 15s 挂死）', () => {
    expect(resolveMcpListCommand('C:/g/opencode.ps1', () => false)).toBeNull();
  });
  test('.cmd → shell:true', () => {
    expect(resolveMcpListCommand('C:/g/opencode.cmd', (p) => p === 'C:/g/opencode.cmd')).toEqual({ bin: 'C:/g/opencode.cmd', shell: true });
  });
  test('.exe → 直跑', () => {
    expect(resolveMcpListCommand('C:/g/opencode.exe', () => true)).toEqual({ bin: 'C:/g/opencode.exe', shell: false });
  });
});

function makeRes() {
  const out = { status: 0, body: '' as any };
  const res = {
    writeHead(status: number) { out.status = status; },
    end(body?: string) { out.body = body ? JSON.parse(body) : null; },
    setHeader() {},
  } as unknown as http.ServerResponse;
  return { res, out };
}

describe('GET /api/mcp/servers', () => {
  it('返回解析后的服务器列表', async () => {
    const { res, out } = makeRes();
    const handled = await handleMcpList({ method: 'GET' } as http.IncomingMessage, res, '/api/mcp/servers', {
      listMcpOutput: async () => '✓ mafw  connected',
    });
    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body.servers).toEqual([{ name: 'mafw', status: 'connected' }]);
  });
  it('CLI 失败 → 200 空列表 + error（fail-open）', async () => {
    const { res, out } = makeRes();
    await handleMcpList({ method: 'GET' } as http.IncomingMessage, res, '/api/mcp/servers', {
      listMcpOutput: async () => { throw new Error('opencode not found') },
    });
    expect(out.status).toBe(200);
    expect(out.body.servers).toEqual([]);
    expect(out.body.error).toContain('not found');
  });
  it('不匹配路径 → handled=false', async () => {
    const { res } = makeRes();
    expect(await handleMcpList({ method: 'GET' } as http.IncomingMessage, res, '/api/mcp', { listMcpOutput: async () => '' })).toBe(false);
  });
});
