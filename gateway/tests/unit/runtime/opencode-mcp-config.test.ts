// gateway/tests/unit/runtime/opencode-mcp-config.test.ts
// opencode MCP 持久化通道：preview 不写盘 / token 乐观锁 / 备份 / 原子写 / 删除顺序 / 子树恢复 / 掩码。
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createOpencodeMcpConfigChannel,
  McpConfigError,
} from '../../../src/runtime/opencode-mcp-config';

const FIXTURE = `{
  // top comment
  "model": "gateway/keep-me",
  "mcp": {
    "servers": {
      "sentry": {
        "type": "remote",
        "url": "https://old.example/mcp",
        "headers": { "Authorization": "Bearer SECRET-TOKEN" },
        "environment": { "SENTRY_TOKEN": "abc" },
        "timeout": 5000
      }
    }
  }
}
`;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-b4-'));
  const configPath = path.join(dir, 'opencode.jsonc');
  fs.writeFileSync(configPath, FIXTURE, 'utf-8');
  const calls = { apply: [] as Array<{ name: string; config: any }>, remove: [] as string[], backup: [] as string[] };
  const deps = {
    configPath: () => configPath,
    exists: (p: string) => fs.existsSync(p),
    readFile: (p: string) => fs.readFileSync(p, 'utf-8'),
    backup: (p: string) => {
      const b = `${p}.bak-mafw-${Date.now() + calls.backup.length}`;
      fs.copyFileSync(p, b);
      calls.backup.push(b);
      return b;
    },
    writeFileAtomic: (p: string, text: string) => {
      const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmp, text, 'utf-8');
      fs.renameSync(tmp, p);
    },
    applyRuntime: async (name: string, config: any) => {
      calls.apply.push({ name, config });
      return true;
    },
    removeRuntime: async (name: string) => {
      calls.remove.push(name);
      return true;
    },
    now: () => 1000,
    listBackups: (p: string) =>
      fs.readdirSync(path.dirname(p))
        .filter((f) => f.startsWith(path.basename(p) + '.bak-mafw-'))
        .map((f) => path.join(path.dirname(p), f)),
  };
  const channel = createOpencodeMcpConfigChannel(deps);
  return { dir, configPath, deps, channel, calls };
}

describe('opencode mcp config channel', () => {
  test('preview：不写盘、token 稳定、diff 不含密钥原文、保留字段列出', async () => {
    const { configPath, channel } = setup();
    const before = fs.readFileSync(configPath, 'utf-8');
    const p = await channel.preview({ name: 'sentry', type: 'remote', url: 'https://new.example/mcp', overwrite: true });
    expect(p.token).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(p.target).toBe(configPath);
    expect(p.preserved).toEqual(expect.arrayContaining(['headers', 'environment', 'timeout']));
    expect(p.diff).not.toContain('SECRET-TOKEN');
    expect(p.diff).not.toContain('"abc"');
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
    const p2 = await channel.preview({ name: 'sentry', type: 'remote', url: 'https://new.example/mcp', overwrite: true });
    expect(p2.token).toBe(p.token);
  });

  test('apply：备份 = 原文、写入成功、runtime apply 带 config；token 不匹配 → etag_mismatch', async () => {
    const { configPath, channel, calls } = setup();
    const preview = await channel.preview({ name: 'sentry', type: 'remote', url: 'https://new.example/mcp', overwrite: true });
    const r = await channel.apply({
      name: 'sentry', type: 'remote', url: 'https://new.example/mcp', overwrite: true,
      token: preview.token, confirm: true,
    });
    expect(r.applied).toBe(true);
    expect(r.runtimeApplied).toBe(true);
    expect(fs.readFileSync(r.backup!, 'utf-8')).toBe(FIXTURE);
    const next = fs.readFileSync(configPath, 'utf-8');
    expect(next).toContain('https://new.example/mcp');
    expect(next).toContain('SECRET-TOKEN');
    expect(calls.apply[0]).toMatchObject({ name: 'sentry', config: { type: 'remote', url: 'https://new.example/mcp' } });

    await expect(
      channel.apply({ name: 'x', type: 'remote', url: 'https://x', token: preview.token, confirm: true }),
    ).rejects.toMatchObject({ code: 'etag_mismatch' });
  });

  test('remove：先文件后运行时；文件写失败 → runtime 未调用', async () => {
    const ok = setup();
    const p = await ok.channel.preview({ name: 'sentry', type: 'remote', url: 'https://x', overwrite: true });
    const r = await ok.channel.remove('sentry', { token: p.token, confirm: true });
    expect(r.applied).toBe(true);
    expect(fs.readFileSync(ok.configPath, 'utf-8')).not.toContain('"sentry"');
    expect(ok.calls.remove).toEqual(['sentry']);

    const bad = setup();
    const p2 = await bad.channel.preview({ name: 'sentry', type: 'remote', url: 'https://x', overwrite: true });
    const channel = createOpencodeMcpConfigChannel({
      ...bad.deps,
      writeFileAtomic: () => { throw new Error('EACCES'); },
    });
    await expect(channel.remove('sentry', { token: p2.token, confirm: true })).rejects.toThrow('EACCES');
    expect(bad.calls.remove).toEqual([]);
  });

  test('restore：只回滚 mcp.servers，其他键保持；生成当前文件备份', async () => {
    const { configPath, channel } = setup();
    const backupPath = `${configPath}.bak-mafw-999`;
    fs.writeFileSync(backupPath, FIXTURE, 'utf-8');
    // 当前文件：model 被改 + URL 被改
    fs.writeFileSync(configPath, FIXTURE.replace('"gateway/keep-me"', '"changed/later"').replace('https://old.example/mcp', 'https://mutated/mcp'), 'utf-8');
    const preview = await channel.preview({ name: 'sentry', type: 'remote', url: 'https://new.example/mcp', overwrite: true });
    const r = await channel.restore({ token: preview.token, confirm: true, backupPath });
    expect(r.applied).toBe(true);
    expect(r.runtimeApplied).toBe(false);
    const next = fs.readFileSync(configPath, 'utf-8');
    expect(next).toContain('"changed/later"');
    expect(next).toContain('https://old.example/mcp');
    expect(r.backup).toBeTruthy();
    expect(fs.readFileSync(r.backup!, 'utf-8')).toContain('https://mutated/mcp');
  });

  test('restore：非白名单 backupPath → invalid', async () => {
    const { channel } = setup();
    const preview = await channel.preview({ name: 'sentry', type: 'remote', url: 'https://x', overwrite: true });
    await expect(
      channel.restore({ token: preview.token, confirm: true, backupPath: 'C:/evil.txt' }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  test('校验：非法 name / url / command', async () => {
    const { channel } = setup();
    await expect(channel.preview({ name: '../x', type: 'remote', url: 'https://x' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(channel.preview({ name: 'ok', type: 'remote', url: 'ftp://x' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(channel.preview({ name: 'ok', type: 'local', command: [] })).rejects.toMatchObject({ code: 'invalid' });
  });

  test('新增（非覆盖）不保留旧字段；错误类型是 McpConfigError', async () => {
    const { channel } = setup();
    await expect(
      channel.preview({ name: 'sentry', type: 'remote', url: 'https://x' }),
    ).rejects.toBeInstanceOf(McpConfigError);
  });
});
