// mafw_ask_user 弹窗可见性契约：user_question SSE 事件必须携带 question/options，
// 否则桌面 QuestionWidget 无内容可渲染（2026-09-22「弹窗不显示问题/选项」事故）。
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleAskUser } from '../../../src/mcp/handlers/ask-user';
import { eventBus } from '../../../src/event-bus';
import { config } from '../../../src/config';

describe('handleAskUser — user_question 事件载荷', () => {
  let tmp: string;
  let spyCfg: jest.SpyInstance;
  let spyEmit: jest.SpyInstance;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-ask-'));
    spyCfg = jest.spyOn(config, 'resolvePath').mockReturnValue(tmp);
    spyEmit = jest.spyOn(eventBus, 'emit');
  });
  afterEach(() => {
    spyCfg.mockRestore();
    spyEmit.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('事件携带 question 与 options', async () => {
    await handleAskUser({ question: '继续吗？', options: ['A', 'B'], goalId: 'g1' });
    expect(spyEmit).toHaveBeenCalledWith('user_question', expect.objectContaining({
      type: 'user_question',
      goalId: 'g1',
      question: '继续吗？',
      options: ['A', 'B'],
    }));
  });

  test('无 options 时载荷仍带 question 且不抛错', async () => {
    await handleAskUser({ question: 'Q2' });
    const call = spyEmit.mock.calls.find((c) => c[0] === 'user_question');
    expect(call?.[1]).toEqual(expect.objectContaining({ question: 'Q2' }));
  });

  test('问题文件写入 user-questions/（approvals 列表数据源）', async () => {
    await handleAskUser({ question: 'Q3', options: ['x'] });
    const files = fs.readdirSync(path.join(tmp, 'user-questions'));
    expect(files.length).toBe(1);
    const data = JSON.parse(fs.readFileSync(path.join(tmp, 'user-questions', files[0]), 'utf-8'));
    expect(data.question).toBe('Q3');
    expect(data.status).toBe('pending');
  });
});
