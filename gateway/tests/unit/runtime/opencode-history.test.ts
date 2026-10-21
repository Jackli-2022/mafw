/**
 * opencode-history —— {info, parts} wire → flat（MafwMessage）翻译契约测试。
 *
 * 零换名裁决（ledger Task 4）：UserMessage.model 为对象、AssistantMessage.modelID
 * 为字符串——翻译 = 纯信封搬移（info 字段全量同名展开到顶层，parts → content
 * 引用直通）。round-trip 恒等性由 Task 5 的 golden 承担，本文件钉翻译形状。
 */
import { normalizeOpencodeHistory } from '../../../src/runtime/opencode-history';
import { isMafwMessage } from '../../../src/runtime/canonical-types';

const assistantWire = {
  info: {
    id: 'ma_1', sessionID: 'ses_1', role: 'assistant',
    time: { created: 1, completed: 2 },
    finish: 'stop', modelID: 'glm-5.3', providerID: 'gateway',
    mode: 'primary', agent: 'build', path: { cwd: '/w', root: '/w' },
    cost: 0.01, tokens: { input: 10, output: 5 }, parentID: 'mu_1',
  },
  parts: [
    { id: 'p1', sessionID: 'ses_1', messageID: 'ma_1', type: 'text', text: 'hi' },
    { id: 'p2', sessionID: 'ses_1', messageID: 'ma_1', type: 'reasoning', text: 'hmm' },
    {
      id: 'p3', sessionID: 'ses_1', messageID: 'ma_1', type: 'tool', callID: 'c1', tool: 'bash',
      state: { status: 'completed', input: { command: 'ls' }, output: 'a\nb', title: 'bash', metadata: {}, time: { start: 1, end: 2 } },
    },
    { id: 'p4', sessionID: 'ses_1', messageID: 'ma_1', type: 'step-finish', reason: 'stop', cost: { total: 0.01 }, tokens: { input: 10 } },
    { id: 'p5', sessionID: 'ses_1', messageID: 'ma_1', type: 'compaction', tokensBefore: 100, custom: 'keep' },
  ],
};

const userWire = {
  info: {
    id: 'mu_1', sessionID: 'ses_1', role: 'user',
    time: { created: 0 },
    agent: 'build',
    model: { providerID: 'gateway', modelID: 'glm-5.3', variant: 'max' },
    summary: { title: 't', diffs: [] },
  },
  parts: [{ id: 'q1', type: 'text', text: '问题' }],
};

describe('normalizeOpencodeHistory', () => {
  it('assistant wire → flat：isMafwMessage 全真，info 字段同名展开零换名', () => {
    const [flat] = normalizeOpencodeHistory([assistantWire]);
    expect(isMafwMessage(flat)).toBe(true);
    expect(flat).toMatchObject({
      id: 'ma_1', sessionID: 'ses_1', role: 'assistant',
      time: { created: 1, completed: 2 },
      finish: 'stop', modelID: 'glm-5.3', providerID: 'gateway',
      cost: 0.01, parentID: 'mu_1',
    });
  });

  it('content 与原 parts 同引用（部件零拷贝零改写）', () => {
    const [flat] = normalizeOpencodeHistory([assistantWire]);
    expect(flat.content).toBe(assistantWire.parts);
    expect(flat.content![0]).toBe(assistantWire.parts[0]);
    expect((flat.content![4] as Record<string, unknown>).custom).toBe('keep'); // 透传部件字段保留
  });

  it('user wire：model 对象/summary 原样透传（零换名）', () => {
    const [flat] = normalizeOpencodeHistory([userWire]);
    expect(isMafwMessage(flat)).toBe(true);
    expect(flat).toMatchObject({
      id: 'mu_1', role: 'user',
      model: { providerID: 'gateway', modelID: 'glm-5.3', variant: 'max' },
      summary: { title: 't', diffs: [] },
    });
    expect(flat.content).toBe(userWire.parts);
  });

  it('非 {info, parts} 形状的项原样放行（防御：已是 flat 或异形数据）', () => {
    const alreadyFlat = { id: 'x', role: 'user', content: [] };
    const weird = { something: 'else' };
    const out = normalizeOpencodeHistory([alreadyFlat as any, weird as any]);
    expect(out[0]).toBe(alreadyFlat);
    expect(out[1]).toBe(weird);
  });

  it('批量顺序与数量保持', () => {
    const out = normalizeOpencodeHistory([userWire, assistantWire]);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('mu_1');
    expect(out[1].id).toBe('ma_1');
  });
});
