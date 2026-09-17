import { RouteRegistry } from '../../src/routes/registry';
import { buildRouteCatalog } from '../../src/routes/route-catalog';
import { attachWave1Handlers } from '../../src/routes/wave1-handlers';
import type { AgentRuntime } from '../../src/runtime/contract';
import { Readable } from 'stream';

/**
 * 回归测试（2026-09-17）：P5 Wave1 attach 用字面量快照传 opencodeClient，
 * attach 早于 runtime 初始化 → session.fork 永远 503 "runtime 'none'"。
 * attach 字面量必须用 getter（活引用）——本测试锁定该语义。
 */

function fakeReq(url: string, body: unknown): any {
  const r = new Readable({ read() { this.push(JSON.stringify(body)); this.push(null); } });
  (r as any).headers = {};
  (r as any).url = url;
  (r as any).method = 'POST';
  return r;
}

function fakeRes(): any {
  const out: any = { status: 0, body: '' };
  out.setHeader = () => out;
  out.writeHead = (s: number) => { out.status = s; return out; };
  out.end = (b?: string) => { out.body = b ?? ''; };
  return out;
}

describe('wave1 attach: opencodeClient is a live reference (getter), not a snapshot', () => {
  test('session.fork resolves runtime assigned AFTER attach', async () => {
    const state = { opencodeClient: null as AgentRuntime | null };
    const gw = {
      get opencodeClient() { return state.opencodeClient; },
      get runtimeCaps() { return {} as any; },
      getGatewayDb: () => ({ listGoalSessions: () => [] }),
      rotateDeps: () => { throw new Error('not used'); },
      embeddingConfigDeps: () => { throw new Error('not used'); },
      modelConfigDeps: () => { throw new Error('not used'); },
      usagePluginsDeps: () => { throw new Error('not used'); },
      broadcast: () => {},
    } as any;

    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachWave1Handlers(registry, gw);

    // attach 之后（模拟启动顺序：startApiServer 先于 runtime 初始化）
    state.opencodeClient = {
      name: 'opencode',
      capabilities: { sessionBranchApi: true },
      session: {
        fork: async () => ({ id: 'forked-1' }),
      },
    } as unknown as AgentRuntime;

    const matched = registry.match('POST', '/api/sessions/s1/fork');
    expect(matched?.def.handler).toBeTruthy();
    const res = fakeRes();
    const ret = await matched!.def.handler!(
      fakeReq('/api/sessions/s1/fork', { messageID: 'm1' }), res, matched!.params);
    expect(ret).not.toBe(false); // 路径命中且已处理
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).session.id).toBe('forked-1');
  }, 10_000);
});
