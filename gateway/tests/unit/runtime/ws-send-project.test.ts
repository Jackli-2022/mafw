/**
 * E1-3 WS send 项目选择（spec §E1-3 / A4a）。
 *
 * 缺陷：`/api/ws` 的 `send` 帧省略 `sessionID` 时，在**第一个注册项目**建会话
 * （`sendEnrichedInternal` 取 `registeredProjects.values().next()`）——多项目下
 * 消息落到错误项目。
 *
 * 契约：与 promptAsync 一致用 `resolvedProjectDir()`（当前项目）；没有任何注册
 * 项目时回 `ws_error` 且不建会话（不落到任意项目）。
 */
import * as path from 'path';
import { MafwScheduler } from '../../../src/kernel';

const FIRST = path.resolve(__dirname, 'ws-proj-first');
const SECOND = path.resolve(__dirname, 'ws-proj-second');
const DEFAULT = path.resolve(__dirname, 'ws-proj-default');

function makeScheduler(opts: { projects: string[]; current: string | null }) {
  const scheduler = new MafwScheduler(DEFAULT) as any;
  scheduler.registeredProjects = new Map(
    opts.projects.map((dir) => [dir, { projectDir: dir, mafwDir: path.join(dir, '.mafw') }]),
  );
  scheduler.currentProjectDir = opts.current;
  const create = jest.fn(async () => ({ id: 'ses_new' }));
  const promptAsync = jest.fn(async () => ({ ok: true }));
  scheduler.runtime = { session: { create, promptAsync } };
  scheduler.memoryService = null;
  return { scheduler, create, promptAsync };
}

function fakeWs() {
  const sent: any[] = [];
  const ws = {
    readyState: 1,
    send: (frame: string) => { sent.push(JSON.parse(frame)); },
  };
  return { ws, sent };
}

async function sendFrame(scheduler: any, payload: unknown): Promise<any[]> {
  const { ws, sent } = fakeWs();
  await scheduler.handleWsMessage(ws, Buffer.from(JSON.stringify(payload)));
  return sent;
}

describe('WS send 无 sessionID 的项目选择（E1-3）', () => {
  it('两个注册项目、当前=第二个 → 在第二个项目建会话', async () => {
    const { scheduler, create, promptAsync } = makeScheduler({ projects: [FIRST, SECOND], current: SECOND });
    const sent = await sendFrame(scheduler, { type: 'send', message: 'hello' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ directory: SECOND });
    expect(promptAsync).toHaveBeenCalledTimes(1);
    expect(sent.at(-1)).toEqual({ type: 'send_ack', sessionID: 'ses_new' });
  });

  it('无注册项目 → ws_error，且不建会话、不发 prompt', async () => {
    const { scheduler, create, promptAsync } = makeScheduler({ projects: [], current: null });
    const sent = await sendFrame(scheduler, { type: 'send', message: 'hello' });

    expect(create).not.toHaveBeenCalled();
    expect(promptAsync).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('ws_error');
    expect(String(sent[0].error)).toMatch(/project/i);
  });

  it('带 sessionID 的 send 不建会话（既有行为不变）', async () => {
    const { scheduler, create, promptAsync } = makeScheduler({ projects: [FIRST, SECOND], current: SECOND });
    const sent = await sendFrame(scheduler, { type: 'send', sessionID: 'ses_known', message: 'hello' });

    expect(create).not.toHaveBeenCalled();
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 'ses_known' }));
    expect(sent.at(-1)).toEqual({ type: 'send_ack', sessionID: 'ses_known' });
  });
});
