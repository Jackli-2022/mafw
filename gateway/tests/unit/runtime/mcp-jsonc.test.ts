// gateway/tests/unit/runtime/mcp-jsonc.test.ts
// JSONC 编辑纯函数：保注释/缩进、字段级合并保留未暴露字段、type 变更门、删除、子树恢复、密钥掩码、diff。
import {
  parseConfig,
  editServer,
  removeServerEntry,
  restoreServersSubtree,
  maskSecrets,
  renderDiff,
} from '../../../src/runtime/mcp-jsonc';

const FIXTURE = `{
  // top comment
  "$schema": "https://opencode.ai/config.json",
  "model": "gateway/keep-me",
  "mcp": {
    "servers": {
      // mafw comment
      "mafw": {
        "type": "remote",
        "url": "http://127.0.0.1:3000/mcp",
        "oauth": false,
        "disabled": false
      },
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

describe('parseConfig', () => {
  test('合法 JSONC → servers', () => {
    const r = parseConfig(FIXTURE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.servers).sort()).toEqual(['mafw', 'sentry']);
    }
  });

  test('非法 JSONC → 位置 + 不改文本', () => {
    const bad = '{ "mcp": { "servers": { "x": { "type": "remote", } } } '; // 缺右括号
    const r = parseConfig(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBeGreaterThan(0);
      expect(typeof r.error.message).toBe('string');
    }
  });
});

describe('editServer', () => {
  test('新增 remote：注释保留、键存在、其他配置不变', () => {
    const r = editServer(FIXTURE, { name: 'newone', type: 'remote', url: 'https://new.example/mcp' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain('// top comment');
      expect(r.text).toContain('// mafw comment');
      expect(r.text).toContain('"newone"');
      expect(r.text).toContain('https://new.example/mcp');
      expect(r.text).toContain('"model": "gateway/keep-me"');
    }
  });

  test('覆盖同名：headers/environment/timeout 保留（不再提交）', () => {
    const r = editServer(FIXTURE, {
      name: 'sentry',
      type: 'remote',
      url: 'https://new.example/mcp',
      overwrite: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain('"Authorization": "Bearer SECRET-TOKEN"');
      expect(r.text).toContain('"SENTRY_TOKEN": "abc"');
      expect(r.text).toContain('"timeout": 5000');
      expect(r.text).toContain('https://new.example/mcp');
      expect(r.preserved).toContain('headers');
      expect(r.preserved).toContain('environment');
      expect(r.preserved).toContain('timeout');
    }
  });

  test('同名未 overwrite → exists', () => {
    const r = editServer(FIXTURE, { name: 'sentry', type: 'remote', url: 'https://x' });
    expect(r).toMatchObject({ ok: false, code: 'exists' });
  });

  test('type 变更无 replace → type_mismatch；有 replace → 整体替换', () => {
    const bad = editServer(FIXTURE, { name: 'sentry', type: 'local', command: ['npx', 'x'], overwrite: true });
    expect(bad).toMatchObject({ ok: false, code: 'type_mismatch' });
    const ok = editServer(FIXTURE, { name: 'sentry', type: 'local', command: ['npx', 'x'], overwrite: true, replace: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.text).toContain('"command"');
      expect(ok.text).not.toContain('https://old.example/mcp');
      expect(ok.text).not.toContain('SECRET-TOKEN');
    }
  });
});

describe('removeServerEntry', () => {
  test('删除指定键，其他键与注释保留', () => {
    const r = removeServerEntry(FIXTURE, 'sentry');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).not.toContain('"sentry"');
      expect(r.text).toContain('"mafw"');
      expect(r.text).toContain('// top comment');
    }
  });

  test('不存在 → not_found', () => {
    expect(removeServerEntry(FIXTURE, 'nope')).toMatchObject({ ok: false, code: 'not_found' });
  });
});

describe('restoreServersSubtree', () => {
  test('只回滚 mcp.servers；其他键保持当前值', () => {
    const backup = FIXTURE;
    const current = FIXTURE
      .replace('"model": "gateway/keep-me"', '"model": "changed/later"')
      .replace('https://old.example/mcp', 'https://mutated.example/mcp');
    const r = restoreServersSubtree(current, backup);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain('"model": "changed/later"');
      expect(r.text).toContain('https://old.example/mcp');
    }
  });

  test('备份非法 → invalid', () => {
    expect(restoreServersSubtree(FIXTURE, '{oops')).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('maskSecrets', () => {
  test('headers/environment 值掩码；普通字段保留', () => {
    const masked = maskSecrets({
      type: 'remote',
      url: 'https://x',
      headers: { Authorization: 'Bearer SECRET' },
      environment: { TOKEN: 'abc' },
      apiKey: 'sk-123',
      note: 'keep',
    });
    expect(masked.headers.Authorization).toBe('••••');
    expect(masked.environment.TOKEN).toBe('••••');
    expect(masked.apiKey).toBe('••••');
    expect(masked.url).toBe('https://x');
    expect(masked.note).toBe('keep');
  });
});

describe('renderDiff', () => {
  test('标记新增/删除行', () => {
    const d = renderDiff('a\nb\n', 'a\nc\n');
    expect(d).toContain('-b');
    expect(d).toContain('+c');
    expect(d).toContain(' a');
  });
});
