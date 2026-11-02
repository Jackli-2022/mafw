/**
 * 历史 flat golden —— adapter 原生历史 → MAFW View DTO 的回归底线。
 *
 * ① opencode 链：wire {info,parts} → normalizeOpencodeHistory → flat
 *    （部件引用直通、规范 model/stopReason 补齐）。
 * ② pi 链：pi 原始消息 → normalizePiMessages（flat）→ 与冻结 golden 逐字段相同。
 *
 * Task 15 删除 wire egress 后，本文件不再做 flat→wire round-trip。
 */
import { normalizeOpencodeHistory } from '../../../src/runtime/opencode-history';
import { normalizePiMessages } from '../../../src/runtime/pi/pi-message-normalize';

const T = 1_700_000_000_000;

// ---------------------------------------------------------------- ① opencode

const opencodeWire = [
  {
    info: {
      id: 'mu_1', sessionID: 'ses_1', role: 'user', time: { created: 0 },
      agent: 'build',
      model: { providerID: 'gateway', modelID: 'glm-5.3', variant: 'max' },
      summary: { title: 't', diffs: [] },
    },
    parts: [{ id: 'q1', type: 'text', text: '问题' }],
  },
  {
    info: {
      id: 'ma_1', sessionID: 'ses_1', role: 'assistant',
      time: { created: 1, completed: 2 },
      finish: 'stop', modelID: 'glm-5.3', providerID: 'gateway',
      mode: 'primary', agent: 'build', path: { cwd: '/w', root: '/w' },
      cost: 0.01, tokens: { input: 10, output: 5 }, parentID: 'mu_1',
    },
    parts: [
      { id: 'p1', type: 'text', text: '回答' },
      { id: 'p2', type: 'reasoning', text: '思考' },
      {
        id: 'p3', type: 'tool', callID: 'c1', tool: 'bash',
        state: { status: 'completed', input: { command: 'ls' }, output: 'a\nb', title: 'bash', metadata: {}, time: { start: 1, end: 2 } },
      },
      {
        id: 'p4', type: 'tool', callID: 'c2', tool: 'grep',
        state: { status: 'error', input: { pattern: 'x' }, error: 'not found', time: { start: 1, end: 2 } },
      },
      { id: 'p5', type: 'step-start' },
      { id: 'p6', type: 'step-finish', reason: 'stop', cost: { total: 0.01 }, tokens: { input: 10 } },
      { id: 'p7', type: 'compaction', tokensBefore: 100, custom: 'kept' },
    ],
  },
  { info: { id: 'ma_2', role: 'assistant', time: { created: 3, completed: 4 } }, parts: [] }, // 空 parts
  { info: { id: 'mu_2', role: 'user' }, parts: [{ id: 'q2', type: 'text', text: '继续' }] }, // 最小 info
];

describe('① opencode 历史 → flat（部件引用直通 + 规范字段）', () => {
  it('原生字段保留 + 规范字段 additive（model/stopReason）', () => {
    const flat = normalizeOpencodeHistory(opencodeWire) as any[];

    // user / 最小消息：身份与内容直通
    expect(flat[0]).toMatchObject({ id: 'mu_1', role: 'user', sessionID: 'ses_1' });
    expect(flat[0].content).toBe(opencodeWire[0].parts);
    expect(flat[2].id).toBe('ma_2');
    expect(flat[2].content).toEqual([]);
    expect(flat[3]).toMatchObject({ id: 'mu_2', role: 'user' });

    // assistant：规范 model/stopReason，原生透传字段保留
    const assistant = flat[1];
    expect(assistant).toMatchObject({
      id: 'ma_1', role: 'assistant', modelID: 'glm-5.3', providerID: 'gateway',
      finish: 'stop', parentID: 'mu_1',
    });
    expect(assistant.model).toEqual({ providerID: 'gateway', modelID: 'glm-5.3' });
    expect(assistant.stopReason).toBe('end_turn');
    expect(assistant.content).toBe(opencodeWire[1].parts); // 部件引用直通（零拷贝）
  });

  it('透传部件身份保持（compaction 等未知扩展不被重写）', () => {
    const flat = normalizeOpencodeHistory(opencodeWire) as any[];
    expect(flat[1].content[6]).toBe(opencodeWire[1].parts[6]);
  });

  it('已是 flat 的数据幂等（重复归一不产生新对象）', () => {
    const once = normalizeOpencodeHistory(opencodeWire) as any[];
    const twice = normalizeOpencodeHistory(once) as any[];
    expect(twice[1]).toBe(once[1]);
  });
});

// ---------------------------------------------------------------- ② pi golden

describe('② pi 历史 flat golden（adapter 输出契约）', () => {
  it('user + assistant + toolCall/result 全链逐字段稳定', () => {
    const raw = [
      { role: 'user', content: 'hi', timestamp: T },
      {
        role: 'assistant', timestamp: T + 1, content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: '看一下' },
          { type: 'toolCall', id: 'tc1', name: 'bash', arguments: { command: 'ls' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'tc1', toolName: 'bash', content: [{ type: 'text', text: 'file.txt' }], isError: false, timestamp: T + 5 },
    ];
    const golden = [
      {
        id: `piu_${T}`, role: 'user', time: { created: T },
        content: [{ id: `piu_${T}_t`, type: 'text', text: 'hi' }],
      },
      {
        id: `pia_${T + 1}`, role: 'assistant', time: { created: T + 1, completed: T + 1 },
        content: [
          { id: `pia_${T + 1}_r1`, type: 'reasoning', text: 'hmm' },
          { id: `pia_${T + 1}_t2`, type: 'text', text: '看一下' },
          {
            id: 'toolpart_tc1', type: 'tool', tool: 'bash', callID: 'tc1',
            state: { status: 'completed', input: { command: 'ls' }, output: 'file.txt', title: 'bash', metadata: {}, time: { start: T + 1, end: T + 5 } },
          },
        ],
      },
    ];
    expect(normalizePiMessages(raw)).toEqual(golden);
  });

  it('running 半截 + isError 误差路径稳定', () => {
    const raw = [
      { role: 'assistant', timestamp: T, content: [{ type: 'toolCall', id: 'r1', name: 'read', arguments: {} }] },
      { role: 'assistant', timestamp: T + 2, content: [{ type: 'toolCall', id: 'e1', name: 'bash', arguments: {} }] },
      { role: 'toolResult', toolCallId: 'e1', toolName: 'bash', content: [{ type: 'text', text: 'boom' }], isError: true, timestamp: T + 3 },
    ];
    const golden = [
      {
        id: `pia_${T}`, role: 'assistant', time: { created: T, completed: T },
        content: [{ id: 'toolpart_r1', type: 'tool', tool: 'read', callID: 'r1', state: { status: 'running', input: {}, time: { start: T } } }],
      },
      {
        id: `pia_${T + 2}`, role: 'assistant', time: { created: T + 2, completed: T + 2 },
        content: [{ id: 'toolpart_e1', type: 'tool', tool: 'bash', callID: 'e1', state: { status: 'error', input: {}, error: 'boom', time: { start: T + 2, end: T + 3 } } }],
      },
    ];
    expect(normalizePiMessages(raw)).toEqual(golden);
  });
});
