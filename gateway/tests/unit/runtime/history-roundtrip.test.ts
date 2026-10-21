/**
 * 历史 round-trip golden —— canonical v3 flat 化后 wire 输出语义不变的可执行证明。
 *
 * ① opencode 链：wire {info,parts} → normalizeOpencodeHistory → flat
 *    → toWireHistory → deep-equal 原 wire（零换名 = 恒等的构造性证明）
 * ② pi 链：pi 原始消息 → normalizePiMessages（新 flat）→ toWireHistory
 *    → deep-equal 旧实现（{info,parts} 时代）的 golden 输出——回归底线：
 *    桌面在 flat 化前后收到逐字段相同的数据。
 */
import { normalizeOpencodeHistory } from '../../../src/runtime/opencode-history';
import { normalizePiMessages } from '../../../src/runtime/pi/pi-message-normalize';
import { toWireHistory } from '../../../src/runtime/wire-compat';

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

describe('① opencode 历史 round-trip（flat 化后 wire 恒等）', () => {
  it('全量字段 deep-equal 往返（user model 对象 / assistant modelID / cost(number) / 透传部件）', () => {
    const round = toWireHistory(normalizeOpencodeHistory(opencodeWire) as any);
    expect(round).toEqual(opencodeWire);
  });

  it('往返后 parts 数组项身份保持（零拷贝链路）', () => {
    const flat = normalizeOpencodeHistory(opencodeWire);
    const round = toWireHistory(flat as any);
    expect((round[1] as any).parts[6]).toBe(opencodeWire[1].parts[6]); // compaction 透传部件
  });
});

// ---------------------------------------------------------------- ② pi golden

describe('② pi 历史 flat 化与旧实现等价（golden 回归底线）', () => {
  it('user + assistant + toolCall/result 全链：新旧 wire 输出逐字段相同', () => {
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
    // 旧实现（{info,parts} 时代，2026-10-21 前 main）的确定输出：
    const legacyGolden = [
      {
        info: { id: `piu_${T}_1`, role: 'user', time: { created: T } },
        parts: [{ id: `piu_${T}_1_t`, type: 'text', text: 'hi' }],
      },
      {
        info: { id: `pia_${T + 1}_2`, role: 'assistant', time: { created: T + 1, completed: T + 1 } },
        parts: [
          { id: `pia_${T + 1}_2_r1`, type: 'reasoning', text: 'hmm' },
          { id: `pia_${T + 1}_2_t2`, type: 'text', text: '看一下' },
          {
            id: 'toolpart_tc1', type: 'tool', tool: 'bash', callID: 'tc1',
            state: { status: 'completed', input: { command: 'ls' }, output: 'file.txt', title: 'bash', metadata: {}, time: { start: T + 1, end: T + 5 } },
          },
        ],
      },
    ];
    const round = toWireHistory(normalizePiMessages(raw));
    expect(round).toEqual(legacyGolden);
  });

  it('running 半截 + isError 误差路径等价', () => {
    const raw = [
      { role: 'assistant', timestamp: T, content: [{ type: 'toolCall', id: 'r1', name: 'read', arguments: {} }] },
      { role: 'assistant', timestamp: T + 2, content: [{ type: 'toolCall', id: 'e1', name: 'bash', arguments: {} }] },
      { role: 'toolResult', toolCallId: 'e1', toolName: 'bash', content: [{ type: 'text', text: 'boom' }], isError: true, timestamp: T + 3 },
    ];
    const legacyGolden = [
      {
        info: { id: `pia_${T}_1`, role: 'assistant', time: { created: T, completed: T } },
        parts: [{ id: 'toolpart_r1', type: 'tool', tool: 'read', callID: 'r1', state: { status: 'running', input: {}, time: { start: T } } }],
      },
      {
        info: { id: `pia_${T + 2}_2`, role: 'assistant', time: { created: T + 2, completed: T + 2 } },
        parts: [{ id: 'toolpart_e1', type: 'tool', tool: 'bash', callID: 'e1', state: { status: 'error', input: {}, error: 'boom', time: { start: T + 2, end: T + 3 } } }],
      },
    ];
    expect(toWireHistory(normalizePiMessages(raw))).toEqual(legacyGolden);
  });
});
