/**
 * T2-2 修复：opencode 2.1 wire 消息 `{info, parts}`（SDK v2 已包装）在 adapter
 * 出口归一为 flat 时，parts 必须转成 content；info.text（runtime 生成的
 * resume/queue 提示）且 parts 为空时必须合成文本 part——否则历史静默丢正文。
 */
import { createOpencodeAdapter } from '../../../src/runtime/opencode-adapter';

const mockMessages = jest.fn();
jest.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: () => ({
    session: { messages: mockMessages },
  }),
}));

async function adapter() {
  return createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
}

describe('opencode adapter messages normalization', () => {
  beforeEach(() => mockMessages.mockReset());

  it('unwraps wire {info, parts}: assistant parts become content', async () => {
    mockMessages.mockResolvedValue({
      data: [{
        info: { id: 'a1', role: 'assistant', type: 'assistant', time: { created: 2 } },
        parts: [{ type: 'text', text: 'reply' }],
      }],
    });
    const rt = await adapter();
    const out = await rt.session.messages({ sessionID: 's1', limit: 10 });
    expect(out.data[0].role).toBe('assistant');
    expect(out.data[0].parts).toBeUndefined();
    expect(out.data[0].content).toEqual([{ id: 'a1-p0', type: 'text', text: 'reply' }]);
  });

  it('synthesizes content from info.text when a runtime-generated user message has empty parts', async () => {
    mockMessages.mockResolvedValue({
      data: [{
        info: { id: 'u1', role: 'user', type: 'user', text: '[MAFW 续跑] continue', time: { created: 1 } },
        parts: [],
      }],
    });
    const rt = await adapter();
    const out = await rt.session.messages({ sessionID: 's1', limit: 10 });
    expect(out.data).toHaveLength(1);
    expect(out.data[0].role).toBe('user');
    expect(out.data[0].content).toEqual([{ id: 'u1-p0', type: 'text', text: '[MAFW 续跑] continue' }]);
  });

  it('keeps plain flat messages working (text field, no wire envelope)', async () => {
    mockMessages.mockResolvedValue({
      data: [{ id: 'u2', type: 'user', text: 'flat', time: { created: 3 } }],
    });
    const rt = await adapter();
    const out = await rt.session.messages({ sessionID: 's1', limit: 10 });
    expect(out.data[0].role).toBe('user');
    expect(out.data[0].content[0].text).toBe('flat');
  });
});
