/**
 * Task 15 删除守卫：wire 兼容层与本批 legacy 客户端面必须物理消失。
 *
 * 这些断言不是"helper 存在"，而是反向守卫——任何人把 shim 加回来（或生成物
 * 重新引入旧 operation）都会在这里变红。spec 2026-11-02 §9.1 / §11。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as http from 'http';
import { handleSessionHistory } from '../../../src/routes/session-history';

const GATEWAY = join(__dirname, '..', '..', '..');
const REPO = join(GATEWAY, '..');

function read(...parts: string[]): string {
  return readFileSync(join(...parts), 'utf-8');
}

/** 递归列出目录下匹配后缀的文件（守卫扫描用）。 */
function walk(dir: string, match: (file: string) => boolean): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, match));
    else if (match(name)) out.push(full);
  }
  return out;
}

/**
 * 旧 wire / legacy 路由字符串（客户端或脚本不得再碰）。只匹配「作为 URL 使用」
 * 的形态：引号/模板紧邻的 `/command`、`/skill`，以及 `/api/command`、`/api/skill`、
 * `/api/skill/content`、`/api/opencode-config`、`format=flat`。prompt 文本里的
 * `/skill mafw-*` 指令与 `/api/session/:id/command` 不属于删除面。
 */
const LEGACY_ROUTE_PATTERN = /['"`]\/(?:command|skill)(?:\?|['"`])|\/api\/(?:command|skill)\b(?:\?|['"`])|\/api\/(?:skill\/content|opencode-config)\b|format=flat/;
/** 旧历史双形状读取（仅用于消息消费文件；原生协议 parts 不在扫描面）。 */
const LEGACY_SHAPE_PATTERN = /\.info\s*\?\?|\.info\s*\|\|\s*[A-Za-z_$]|\.parts\s*\?\?|\bm\??\.parts\b|\bmsg\??\.parts\b|Array\.isArray\(\s*m\??\.parts\s*\)/;
/**
 * adapter 内部 native 翻译 + A2A/media 协议载体（spec §9.2 保留）：它们接触的是
 * 运行时原生协议或 Agent2Agent 消息，不是客户端历史兼容面。
 */
const NATIVE_PROTOCOL_FILES = new Set([
  join(GATEWAY, 'src', 'runtime', 'opencode-adapter.ts'),
  join(GATEWAY, 'src', 'runtime', 'opencode-history.ts'),
  join(GATEWAY, 'src', 'runtime', 'opencode-events.ts'),
  join(GATEWAY, 'src', 'runtime', 'host-adapter.ts'),
  join(GATEWAY, 'src', 'core', 'pod', 'pod-a2a-bridge.ts'),
  join(GATEWAY, 'src', 'core', 'pod', 'pod-a2a-mapping.ts'),
  join(GATEWAY, 'src', 'media', 'media-agent.ts'),
]);

function violationsIn(files: string[], pattern: RegExp): string[] {
  return files
    .filter((file) => !NATIVE_PROTOCOL_FILES.has(file))
    .filter((file) => pattern.test(readFileSync(file, 'utf-8')))
    .map((file) => file.slice(REPO.length + 1));
}


describe('wire / legacy surfaces are physically gone', () => {
  test('wire-compat module and its contract test are deleted', () => {
    expect(existsSync(join(GATEWAY, 'src', 'runtime', 'wire-compat.ts'))).toBe(false);
    expect(existsSync(join(GATEWAY, 'tests', 'unit', 'runtime', 'wire-compat.test.ts'))).toBe(false);
  });

  test('index.ts has no wire egress, no flat opt-in and no info payload reference', () => {
    const src = read(GATEWAY, 'src', 'index.ts');
    expect(src).not.toMatch(/toWireHistory|toWireInfo|handleSessionHistoryFlat/);
    expect(src).not.toMatch(/properties\.info/);
    expect(src).not.toMatch(/format\s*===\s*'flat'/);
    // 唯一历史出口必须是 flat handler（不是内联 wire 分支）。
    expect(src).toContain('handleSessionHistory(');
  });

  test('normalize-messages has no zero-consumer legacy channels', () => {
    const src = read(GATEWAY, 'src', 'runtime', 'normalize-messages.ts');
    expect(src).not.toMatch(/applyNormalizeMessages|wrapRuntimeMessages/);
  });

  test('facade history has no wire rescue: adapters must deliver flat', () => {
    const src = read(GATEWAY, 'src', 'runtime', 'normalize-messages.ts');
    expect(src).not.toMatch(/normalizeOpencodeHistory/);
  });

  test('wire merge helper is deleted with its only caller', () => {
    expect(existsSync(join(GATEWAY, 'src', 'core', 'data-parts', 'merge.ts'))).toBe(false);
    expect(existsSync(join(GATEWAY, 'tests', 'unit', 'data-parts', 'merge.test.ts'))).toBe(false);
  });

  test('tool history enrich only reads flat content', () => {
    const src = read(GATEWAY, 'src', 'runtime', 'tool-classes.ts');
    expect(src).not.toMatch(/m\?\.parts/);
  });

  test('legacy command/skill routes and catalog entries are gone', () => {
    const catalog = read(GATEWAY, 'src', 'routes', 'route-catalog.ts');
    expect(catalog).not.toMatch(/command\.list|skill\.list|skill\.content/);
    expect(catalog).not.toMatch(/opencodeConfig\./);
    const handlers = read(GATEWAY, 'src', 'routes', 'wave1-handlers.ts');
    expect(handlers).not.toMatch(/command\.list|skill\.list/);
    const discovery = read(GATEWAY, 'src', 'core', 'discovery', 'discovery-service.ts');
    expect(discovery).not.toMatch(/getLegacyCommands|getLegacySkills/);
    expect(existsSync(join(GATEWAY, 'src', 'routes', 'skill-content.ts'))).toBe(false);
  });

  test('SDK legacy namespaces and probe are deleted', () => {
    const client = read(REPO, 'packages', 'gateway-sdk', 'src', 'client.ts');
    expect(client).not.toMatch(/opencodeConfig|requestRuntime/);
    expect(client).not.toMatch(/shells\s*=/);
    expect(client).not.toMatch(/command\s*=/);
    expect(client).not.toMatch(/skill\s*=/);
    expect(client).not.toMatch(/\bhistory\s*:/);
    const types = read(REPO, 'packages', 'gateway-sdk', 'src', 'types.ts');
    expect(types).not.toMatch(/SessionMessageWire|SessionMessageInfo|SessionMessagePart/);
    expect(types).not.toMatch(/opencodeConfig/);
    // format 的必填/可选两种写法都不得残留（`format: 'flat'` / `format?: 'flat'`）。
    for (const src of [client, types]) {
      expect(src).not.toMatch(/format\s*\??:\s*['"]flat['"]/);
      expect(src).not.toMatch(/\bformat\b\s*\??:/);
      expect(src).not.toMatch(/searchParams\.get\(\s*['"]format['"]\s*\)/);
    }
    expect(existsSync(join(REPO, 'packages', 'gateway-sdk', 'src', 'message-history.probe.ts'))).toBe(false);
  });

  test('generated contract no longer advertises legacy operations or wire history', () => {
    for (const file of ['openapi.json', 'gateway-paths.json', 'runtime-contract.json']) {
      const contract = read(REPO, 'packages', 'gateway-sdk', 'contract', file);
      expect(contract).not.toMatch(/opencodeConfig|command\.list|skill\.list|skill\.content/);
      expect(contract).not.toMatch(/format=flat|legacy wire envelope/);
    }
    const gen = read(REPO, 'packages', 'gateway-sdk', 'src', 'api-schema.gen.ts');
    expect(gen).not.toMatch(/opencodeConfig|command\.list|skill\.list|skill\.content/);
    expect(gen).not.toMatch(/format=flat|legacy wire envelope|Default response is the legacy wire/);
  });

  test('preload aliases and history helper are removed', () => {
    const api = read(REPO, 'packages', 'desktop', 'src', 'preload', 'mafw-api.ts');
    const types = read(REPO, 'packages', 'desktop', 'src', 'preload', 'mafw-types.ts');
    for (const src of [api, types]) {
      expect(src).not.toMatch(/opencodeConfig/);
      expect(src).not.toMatch(/history:\s*\(/);
      expect(src).not.toMatch(/^\s*command:\s*\{/m);
      expect(src).not.toMatch(/^\s*skill:\s*\{/m);
    }
  });

  test('preload has no generic invoke escape hatch', () => {
    const api = read(REPO, 'packages', 'desktop', 'src', 'preload', 'mafw-api.ts');
    const types = read(REPO, 'packages', 'desktop', 'src', 'preload', 'mafw-types.ts');
    expect(api).not.toMatch(/^\s*invoke:\s*\(namespace/m);
    expect(types).not.toMatch(/^\s*invoke:\s*\(namespace/m);
    const rendererFiles = walk(join(REPO, 'packages', 'desktop', 'src', 'renderer'), (f) => f.endsWith('.ts') || f.endsWith('.tsx'));
    const hits = rendererFiles.filter((file) => /window\.api\.mafw\.invoke\s*\(/.test(readFileSync(file, 'utf-8')));
    expect(hits).toEqual([]);
  });

  test('gateway source and smoke scripts do not speak deleted routes or old history shapes', () => {
    const srcFiles = walk(join(GATEWAY, 'src'), (f) => f.endsWith('.ts'));
    const scriptFiles = walk(join(GATEWAY, 'scripts'), (f) => f.endsWith('.mjs'));
    expect(violationsIn(srcFiles, LEGACY_ROUTE_PATTERN)).toEqual([]);
    expect(violationsIn(scriptFiles, LEGACY_ROUTE_PATTERN)).toEqual([]);
    // 旧历史双形状只允许出现在 adapter 原生翻译（NATIVE_TRANSLATION_FILES）。
    expect(violationsIn(srcFiles, LEGACY_SHAPE_PATTERN)).toEqual([]);
    expect(violationsIn(scriptFiles, LEGACY_SHAPE_PATTERN)).toEqual([]);
    // 反向 fixture：扫描器本身必须能抓到旧形状/路由（防假绿）。
    expect(LEGACY_ROUTE_PATTERN.test("fetch('/command')")).toBe(true);
    expect(LEGACY_ROUTE_PATTERN.test("fetch('/api/sessions/s/messages?format=flat')")).toBe(true);
    expect(LEGACY_SHAPE_PATTERN.test('const m = list.map((x) => x.info ?? x)')).toBe(true);
    expect(LEGACY_SHAPE_PATTERN.test('const p = Array.isArray(m.parts) ? m.parts : []')).toBe(true);
  });

  test('desktop history consumers use session.messages only', () => {
    for (const file of ['MafwShell.tsx', join('components', 'ChatPane.tsx')]) {
      expect(read(REPO, 'packages', 'desktop', 'src', 'renderer', 'mafw', file))
        .not.toMatch(/sessions\.history/);
    }
  });

  test('desktop ingestion no longer expands wire envelopes', () => {
    const src = read(REPO, 'packages', 'desktop', 'src', 'renderer', 'mafw', 'ingest', 'messages.ts');
    expect(src).not.toMatch(/raw\.info|flat\.parts|raw\.parts/);
  });

  test('TUI and mobile consume flat messages without a format opt-in', () => {
    for (const file of [join('src', 'store', 'chat-store.ts'), join('src', 'ui', 'goals-tab.ts')]) {
      expect(read(REPO, 'packages', 'tui', file)).not.toMatch(/session\.history/);
    }
    const dart = read(REPO, 'mobile', 'lib', 'src', 'network', 'gateway_client.dart');
    expect(dart).not.toMatch(/'format':\s*'flat'|format=flat/);
  });
});

function mockRes() {
  const res: any = {
    status: 0,
    body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string };
}

describe('history default is flat', () => {
  test('GET /api/sessions/:id/messages without a format returns flat content', async () => {
    const messages = [
      { id: 'm1', sessionID: 'ses_1', role: 'user', content: [{ id: 'p1', type: 'text', text: 'hi' }] },
    ];
    const runtime = { session: { messages: jest.fn(async () => ({ data: messages, nextCursor: null })) } };
    const res = mockRes();
    const handled = await handleSessionHistory(
      { method: 'GET', url: '/api/sessions/ses_1/messages' } as http.IncomingMessage,
      res,
      '/api/sessions/ses_1/messages',
      { getRuntime: () => runtime as any },
    );
    expect(handled).toBe(true);
    const body = JSON.parse(res.body);
    expect(body.data[0].content).toEqual([{ id: 'p1', type: 'text', text: 'hi' }]);
    expect(body.data[0].info).toBeUndefined();
    expect(body.data[0].parts).toBeUndefined();
  });

  test('the removed format parameter is ignored, not re-routed', async () => {
    const runtime = {
      session: { messages: jest.fn(async () => ({ data: [{ id: 'm1', role: 'user', content: [] }], nextCursor: null })) },
    };
    const res = mockRes();
    await handleSessionHistory(
      { method: 'GET', url: '/api/sessions/ses_1/messages?format=wire' } as http.IncomingMessage,
      res,
      '/api/sessions/ses_1/messages?format=wire',
      { getRuntime: () => runtime as any },
    );
    const body = JSON.parse(res.body);
    expect(body.data[0].info).toBeUndefined();
    expect(Array.isArray(body.data[0].content)).toBe(true);
  });
});
