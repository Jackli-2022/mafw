/**
 * session-recall hook: short-increment fallback.
 *
 * The boundary-recall query is built from *incremental* messages (per-session
 * cursor). When the user replies with a very short message ("继续" / "好的")
 * after a quiet gap, the increment alone carries no retrieval signal — the
 * hook must then fold in the tail of the last assistant message so recall
 * still has topical context. Long increments are sent unchanged.
 */
import { sessionRecallHook } from '../../../src/hooks/session-recall';

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';

function userMsg(id: string, sessionID: string, text: string) {
  return { info: { id, role: 'user', sessionID }, parts: [{ type: 'text', text }] };
}
function assistantMsg(id: string, sessionID: string, text: string) {
  return { info: { id, role: 'assistant', sessionID }, parts: [{ type: 'text', text }] };
}

describe('sessionRecallHook short-increment fallback', () => {
  let capturedQueries: string[];
  const realFetch = global.fetch;

  beforeEach(() => {
    capturedQueries = [];
    global.fetch = (async (url: any) => {
      const u = new URL(String(url));
      capturedQueries.push(u.searchParams.get('query') || '');
      return { ok: true, json: async () => ({ pointers: null }) } as any;
    }) as any;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('long increment is sent unchanged (no assistant tail mixed in)', async () => {
    const sid = 'ses_test_long_increment';
    const longText = '请帮我重构 gateway 的事件订阅逻辑，要求支持断线重连与退避策略，并补充单元测试覆盖边界情况';
    await sessionRecallHook({}, { messages: [userMsg('m1', sid, longText)] });
    expect(capturedQueries).toHaveLength(1);
    expect(capturedQueries[0]).toBe(longText);
  });

  it('short increment after a prior turn folds in last assistant text tail', async () => {
    const sid = 'ses_test_short_fallback';
    const assistantText = '已完成事件订阅重构：重连退避 1/2/5/15s，新增 normalize 单测 12 例，全部通过。';
    // Turn 1: user asks, assistant answers — establishes the cursor.
    await sessionRecallHook({}, {
      messages: [
        userMsg('u1', sid, '重构事件订阅逻辑，要求断线重连与退避策略，补单元测试覆盖边界'),
        assistantMsg('a1', sid, assistantText),
      ],
    });
    // Turn 2: user replies with a bare "继续" — increment is just that.
    await sessionRecallHook({}, {
      messages: [
        userMsg('u1', sid, '重构事件订阅逻辑，要求断线重连与退避策略，补单元测试覆盖边界'),
        assistantMsg('a1', sid, assistantText),
        userMsg('u2', sid, '继续'),
      ],
    });
    expect(capturedQueries).toHaveLength(2);
    const q2 = capturedQueries[1];
    expect(q2).toContain('继续');
    expect(q2).toContain('重连退避'); // assistant tail folded in
    expect(q2.length).toBeLessThanOrEqual(500);
  });

  it('short increment with no assistant history sends the increment as-is', async () => {
    const sid = 'ses_test_short_no_assistant';
    await sessionRecallHook({}, { messages: [userMsg('u1', sid, '继续')] });
    expect(capturedQueries).toHaveLength(1);
    expect(capturedQueries[0]).toBe('继续');
  });

  it('never fetches when the increment is empty', async () => {
    const sid = 'ses_test_empty_increment';
    await sessionRecallHook({}, { messages: [] });
    expect(capturedQueries).toHaveLength(0);
  });
});
