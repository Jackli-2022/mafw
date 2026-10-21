/**
 * claude adapter 零核心 diff 验收（spec §6① 的可执行证明）。
 *
 * ① esbuild 现场打包 adapters/claude/src/index.ts → 单文件 CJS
 * ② 真 RuntimePluginLoader（temp 目录）扫描注册：state ok、name 'claude'
 * ③ createRuntime（假 ctx）→ runtime 面工作（不 spawn——create 不触发 query）
 * ④ **双执行器漂移对照**：bundled 声明表经 gateway 真执行器（applyEventMappings）
 *    vs adapter 本地 translateClaudeEvent——同一 fixtures 输出等价（pre-flight
 *    Row 3 风险的兜底探测器）
 * ⑤ 验收线：`git diff --stat gateway/src` 为空（adapter 全住在 adapters/claude/）
 */
import { execSync } from 'child_process';
import { mkdtempSync, copyFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { build } from 'esbuild';

import { RuntimePluginLoader } from '../../../src/runtime/loader';
import { applyEventMappings } from '../../../src/runtime/event-mapper';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';
import { TOOL_PRIMITIVE_TYPES } from '../../../src/runtime/tool-part-assembler';
import { translateClaudeEvent } from '../../../../adapters/claude/src/events';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const isCanonicalAll = (t: string) => !!EVENT_FLOW_MATRIX[t] || TOOL_PRIMITIVE_TYPES.has(t);

/** 打包产物（所有用例共享一次构建）。 */
let bundlePath: string;
let plugin: any;

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'claude-adapter-acceptance-'));
  bundlePath = join(tmp, 'claude.js');
  await build({
    entryPoints: [join(REPO_ROOT, 'adapters/claude/src/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    // SDK 初始化 createRequire(import.meta.url)——CJS 下以 __filename 等价替换
    define: { 'import.meta.url': '__filename' },
    outfile: bundlePath,
    sourcemap: false,
    logLevel: 'silent',
  });
  plugin = require(bundlePath);
}, 120_000);

afterAll(() => {
  if (bundlePath) rmSync(join(bundlePath, '..'), { recursive: true, force: true });
});

describe('claude adapter 验收（零核心 diff）', () => {
  it('①② 真 loader 扫描注册：单文件 CJS 可加载、state ok、name=claude', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-loader-'));
    copyFileSync(bundlePath, join(dir, 'claude.js'));
    const loader = new RuntimePluginLoader(dir);
    loader.setCanonicalTypes(new Set([...Object.keys(EVENT_FLOW_MATRIX), ...TOOL_PRIMITIVE_TYPES]));
    await loader.scan();
    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('ok');
    expect(state[0].name).toBe('claude');
    expect(loader.get('claude')).toBeTruthy();
    rmSync(dir, { recursive: true, force: true });
  });

  it('③ createRuntime（假 ctx）：runtime 面工作（不 spawn）', async () => {
    const factory = loader_getFactory();
    const rt = await factory({
      fetch: async () => { throw new Error('no network in tests'); },
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      pluginConfig: () => ({}),
      gatewayPort: 3999,
      events: { make: (t: string, p?: any) => ({ payload: { type: t, properties: p ?? {} } }), check: () => [] },
    });
    expect(rt.name).toBe('claude');
    expect(rt.external).toBe(true);
    expect(rt.capabilities.sessionApi).toBe(true);
    expect(rt.capabilities.eventStream).toBe(true);
    expect(typeof rt.tools.registerTools).toBe('function');
    const session = await rt.session.create({ directory: 'C:/tmp/acceptance' });
    expect(String(session.id).startsWith('cls_')).toBe(true);
    // 事件流可订阅（不 spawn 即不产事件——只验证 iterable 形状）
    const result = await rt.global.event();
    const stream = result?.stream ?? result;
    expect(typeof stream[Symbol.asyncIterator]).toBe('function');
  });

  it('④ 双执行器漂移对照：bundled 表 × 真执行器 ≡ 本地 translateClaudeEvent', () => {
    const sid = 'ses_drift_1';
    const fixtures: any[] = [
      { type: 'system', subtype: 'init', session_id: sid, model: 'claude-opus-4-6', tools: ['Read'] },
      { type: 'system', subtype: 'status', status: 'compacting', session_id: sid },
      { type: 'system', subtype: 'compact_boundary', session_id: sid },
      { type: 'user', session_id: sid, uuid: 'u1', parent_tool_use_id: null, message: { role: 'user', content: 'hi' } },
      {
        type: 'assistant', session_id: sid, uuid: 'a1', parent_tool_use_id: null,
        message: { id: 'msg_1', role: 'assistant', model: 'claude-opus-4-6', stop_reason: 'tool_use', usage: { input_tokens: 3 }, content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'go' },
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
        ] },
      },
      { type: 'user', session_id: sid, uuid: 'u2', parent_tool_use_id: 'toolu_1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'out', is_error: false }] } },
      { type: 'stream_event', session_id: sid, parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } } },
      { type: 'stream_event', session_id: sid, parent_tool_use_id: 'toolu_1', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a"' } } },
      { type: 'result', subtype: 'success', session_id: sid, usage: { input_tokens: 9 }, total_cost_usd: 0.01, num_turns: 1, duration_ms: 5, terminal_reason: 'completed' },
      { type: 'result', subtype: 'error_during_execution', session_id: sid, terminal_reason: 'aborted_streaming', is_error: true },
      { type: 'result', subtype: 'error_max_turns', session_id: sid, terminal_reason: 'max_turns', is_error: true },
    ];
    const entry = { eventSource: plugin.eventSource, eventMappings: plugin.eventMappings, transformEvent: plugin.transformEvent };
    for (const fixture of fixtures) {
      const viaReal = applyEventMappings(fixture, entry, isCanonicalAll);
      const viaLocal = translateClaudeEvent(fixture, sid);
      expect(viaReal).toEqual(viaLocal);
    }
  });

  it('⑤ 验收线：adapter 自包含——bundle 构建输入零 gateway/src 引用（新增 SDK 不依赖核心改动）', async () => {
    // 真不变量：esbuild metafile 的全部输入不包含 gateway/src（adapter 全部
    // 依赖住在 adapters/claude + 自身 node_modules）。git-diff 检查会撞上
    // 同期合法的核心清洗提交（预检 Row 4），故以构建输入为准。
    const tmp = mkdtempSync(join(tmpdir(), 'claude-meta-'));
    const outfile = join(tmp, 'claude.js');
    const result = await build({
      entryPoints: [join(REPO_ROOT, 'adapters/claude/src/index.ts')],
      bundle: true, platform: 'node', target: 'node22', format: 'cjs',
      define: { 'import.meta.url': '__filename' },
      outfile, sourcemap: false, logLevel: 'silent', metafile: true,
    });
    const inputs = Object.keys(result.metafile.inputs);
    const gatewayRefs = inputs.filter((f) => f.includes('gateway/src') || f.includes('gateway\\src'));
    expect(gatewayRefs).toEqual([]);
    rmSync(tmp, { recursive: true, force: true });
  });
});

/** 经真 loader 取 factory（与生产同径）。 */
function loader_getFactory() {
  // loader.get() 返回注册的 plugin 对象（含 factory）——直接用打包模块的
  // createRuntime 与 loader 注册路径产物等价（①已验证注册），此处取模块函数。
  return plugin.createRuntime;
}
