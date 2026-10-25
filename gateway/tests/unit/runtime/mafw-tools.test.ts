import {
  MAFW_TOOL_SPECS, buildMafwToolFactory, activateRuntimeTools,
  buildToolPartEvent, executeWithToolFrames, wrapRegistrationsWithEvents,
} from '../../../src/runtime/mafw-tools';
import { toolClassOf, clearToolClassOverlay } from '../../../src/runtime/tool-classes';
import { hashText } from '../../../src/runtime/host-adapter';
import type { AgentRuntime } from '../../../src/runtime/contract';

type Req = { url: string; method: string; body?: any };
type Res = { ok: boolean; json?: any };

function makeFakeFetch(routes: Array<{ match: (r: Req) => boolean; res: Res }>) {
  const calls: Req[] = [];
  const fetchImpl: any = async (url: string, init?: any) => {
    const req: Req = { url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(req);
    const hit = routes.find((r) => r.match(req));
    if (!hit) throw new Error(`no route for ${req.method} ${req.url}`);
    return { ok: hit.res.ok, json: async () => hit.res.json };
  };
  return { calls, fetchImpl };
}

const TEN = ['mafw_add_memory', 'mafw_media_ask', 'mafw_media_speak', 'mafw_media_upload', 'mafw_python', 'mafw_python_restart', 'mafw_submit_result', 'mafw_spawn_subagent', 'mafw_message_subagent', 'mafw_subagent_result'];

describe('MAFW_TOOL_SPECS（六件套静态清单）', () => {
  it('6 条、名字唯一、parameters 为 object 形状 JSON Schema', () => {
    expect(MAFW_TOOL_SPECS.map((s) => s.name).sort()).toEqual([...TEN].sort());
    expect(new Set(MAFW_TOOL_SPECS.map((s) => s.name)).size).toBe(10);
    for (const s of MAFW_TOOL_SPECS) {
      expect((s.parameters as any).type).toBe('object');
      expect(typeof (s.parameters as any).properties).toBe('object');
      expect(s.description.length).toBeGreaterThan(10);
    }
  });
});

describe('buildMafwToolFactory（会话亲和闭包）', () => {
  it('factory(sid) 产 6 个注册项；add_memory POST body 携带 sessionID', async () => {
    const { calls, fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/memory/add'), res: { ok: true, json: { success: true, id: 'mem_1' } } },
    ]);
    const regs = buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('pi_s9');
    expect(regs.map((r) => r.name).sort()).toEqual([...TEN].sort());
    const add = regs.find((r) => r.name === 'mafw_add_memory')!;
    const out = await add.execute({ content: '测试', cueAnchors: ['a'] });
    expect(out.isError).toBeUndefined();
    expect(out.text).toContain('mem_1');
    expect(calls[0].body).toMatchObject({ content: '测试', sessionID: 'pi_s9', cueAnchors: ['a'] });
  });

  it('spawn_subagent uses the parent session URL; result fetches typed body', async () => {
    const { calls, fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/sessions/pi_s1/subagents') && r.method === 'POST', res: { ok: true, json: { id: 'c1', parentID: 'pi_s1', depth: 1, status: 'running' } } },
      { match: (r) => r.url.includes('/api/sessions/pi_s1/subagents/c1/result'), res: { ok: true, json: { status: 'completed', structured: { ok: true } } } },
    ]);
    const regs = buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('pi_s1');
    const spawn = await regs.find((r) => r.name === 'mafw_spawn_subagent')!.execute({ prompt: 'do it', agent: 'general' });
    expect(spawn.text).toContain('c1');
    expect(calls.find((c) => c.url.includes('/subagents'))!.url).toContain('/api/sessions/pi_s1/subagents');
    expect(calls.find((c) => c.url.includes('/subagents'))!.body).toMatchObject({ prompt: 'do it', agent: 'general' });

    const result = await regs.find((r) => r.name === 'mafw_subagent_result')!.execute({ sessionID: 'c1' });
    expect(result.text).toContain('"structured":{"ok":true}');
  });

  it('add_memory 失败 → isError + 错误文本', async () => {
    const { fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/memory/add'), res: { ok: false, json: { error: 'bad' } } },
    ]);
    const regs = buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('s1');
    const out = await regs.find((r) => r.name === 'mafw_add_memory')!.execute({ content: 'x' });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('记忆写入失败');
  });

  it('submit_result 携带 sessionID；校验失败 → isError + errors', async () => {
    const okFetch = makeFakeFetch([
      { match: (r) => r.url.includes('/api/structured/submit'), res: { ok: true, json: { ok: true, errors: [] } } },
    ]);
    const okReg = buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl: okFetch.fetchImpl })('pi_s1')
      .find((r) => r.name === 'mafw_submit_result')!;
    expect(await okReg.execute({ data: { ok: true } })).toEqual({ text: '结构化结果已提交' });
    expect(okFetch.calls[0].body).toEqual({ sessionID: 'pi_s1', data: { ok: true } });

    const badFetch = makeFakeFetch([
      { match: (r) => r.url.includes('/api/structured/submit'), res: { ok: true, json: { ok: false, errors: ['$.ok: must be of type boolean'] } } },
    ]);
    const bad = await buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl: badFetch.fetchImpl })('pi_s1')
      .find((r) => r.name === 'mafw_submit_result')!.execute({ data: { ok: 'yes' } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('$.ok');
  });

  it('python 输出文本化（stdout/kernelRestarted/图片数）；错误带 traceback 尾部', async () => {
    const { fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/python/execute'), res: { ok: true, json: { status: 'ok', stdout: '42', kernelRestarted: true, attachments: [{}] } } },
    ]);
    const regs = buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('s1');
    const out = await regs.find((r) => r.name === 'mafw_python')!.execute({ code: 'print(42)' });
    expect(out.text).toContain('42');
    expect(out.text).toContain('python_kernel_reset');
    expect(out.text).toContain('1 张图片');

    const { fetchImpl: f2 } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/python/execute'), res: { ok: true, json: { status: 'error', error: { ename: 'ValueError', evalue: 'boom', traceback: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'] } } } },
    ]);
    const out2 = await buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl: f2 })('s1')
      .find((r) => r.name === 'mafw_python')!.execute({ code: 'x' });
    expect(out2.isError).toBe(true);
    expect(out2.text).toContain('ValueError: boom');
    expect(out2.text).toContain('l8');
    expect(out2.text).not.toContain('l1');
  });

  it('python 内核不可达 → isError 提示 mafw_python_restart', async () => {
    const { fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/python/execute'), res: { ok: false, json: {} } },
    ]);
    const out = await buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('s1')
      .find((r) => r.name === 'mafw_python')!.execute({ code: 'x' });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('mafw_python_restart');
  });

  it('media_speak → 带 djb2 hash 的语音标记', async () => {
    const { fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/tts'), res: { ok: true, json: { artifactId: 'art_9', voice: '茉莉' } } },
    ]);
    const out = await buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('s1')
      .find((r) => r.name === 'mafw_media_speak')!.execute({ text: '你好' });
    expect(out.text).toBe(`[语音回复 art:art_9 音色:茉莉 h:${hashText('你好')}]`);
  });

  it('media_ask taskID 链：GetTask → SendMessage(referenceTaskIds+contextId)', async () => {
    const { calls, fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/a2a') && r.body?.method === 'GetTask', res: { ok: true, json: { result: { task: { id: 't1', contextId: 'ctx1' } } } } },
      { match: (r) => r.url.includes('/a2a') && r.body?.method === 'SendMessage', res: { ok: true, json: { result: { task: { id: 't2', status: { state: 'TASK_STATE_COMPLETED', message: { parts: [{ text: '图里有只猫' }] } } } } } } },
    ]);
    const out = await buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('s1')
      .find((r) => r.name === 'mafw_media_ask')!.execute({ taskID: 't1', question: '图里有什么' });
    expect(out.text).toContain('图里有只猫');
    expect(out.text).toContain('t2');
    const send = calls.find((c) => c.body?.method === 'SendMessage');
    expect(send.body.params.message.referenceTaskIds).toEqual(['t1']);
    expect(send.body.params.message.contextId).toBe('ctx1');
  });

  it('media_ask 缺参数 → isError', async () => {
    const { fetchImpl } = makeFakeFetch([]);
    const out = await buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('s1')
      .find((r) => r.name === 'mafw_media_ask')!.execute({ question: 'q' });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('taskID');
  });
});

describe('activateRuntimeTools（激活期接线）', () => {
  afterEach(() => clearToolClassOverlay());

  function makeRt(over: any = {}): AgentRuntime {
    return {
      name: 'rt',
      tools: {
        registerTools: jest.fn(async () => {}),
        nativeTools: jest.fn(() => [{ name: 'my_read', toolClass: 'readonly' }, { name: 'bad', toolClass: 'nonsense' }, { name: '', toolClass: 'web' }]),
        ...over,
      },
    } as any;
  }

  it('registerTools 收到可执行 factory；nativeTools 好条目进 overlay、坏条目跳过', async () => {
    const rt = makeRt();
    await activateRuntimeTools(rt, 'test:rt', { baseUrl: 'http://gw' });
    const factory = (rt.tools.registerTools as jest.Mock).mock.calls[0][0] as (sid: string) => any[];
    expect(factory('s1').map((r) => r.name).sort()).toEqual([...TEN].sort());
    expect(toolClassOf('my_read')).toBe('readonly');
    expect(toolClassOf('bad')).toBe('other');
  });

  it('registerTools 抛错 → 不阻断（fail-open）；nativeTools 抛错 → 清 overlay', async () => {
    const rt = makeRt({ registerTools: jest.fn(async () => { throw new Error('nope'); }) });
    await expect(activateRuntimeTools(rt, 'test:rt', { baseUrl: 'http://gw' })).resolves.toBeUndefined();
    const rt2 = makeRt({ nativeTools: jest.fn(() => { throw new Error('boom'); }) });
    await activateRuntimeTools(rt2, 'test:rt2', { baseUrl: 'http://gw' });
    expect(toolClassOf('my_read')).toBe('other');
  });
});

describe('显示链：合成 tool part 事件（spec 2026-10-20）', () => {
  it('buildToolPartEvent 形状：扁平 part.updated + tool part + state 按序携带 output/error', () => {
    const r = buildToolPartEvent({ sessionID: 's1', partId: 'toolpart_x', tool: 'mafw_python', status: 'running', input: { code: '1' } });
    expect(r).toEqual({
      type: 'part.updated',
      properties: { sessionID: 's1', part: { id: 'toolpart_x', type: 'tool', tool: 'mafw_python', state: { status: 'running', input: { code: '1' } } } },
    });
    const c = buildToolPartEvent({ sessionID: 's1', partId: 'toolpart_x', tool: 't', status: 'completed', input: {}, output: 'ok' });
    expect(c.properties.part.state).toEqual({ status: 'completed', input: {}, output: 'ok' });
    const e = buildToolPartEvent({ sessionID: 's1', partId: 'toolpart_x', tool: 't', status: 'error', input: {}, error: 'boom' });
    expect(e.properties.part.state).toEqual({ status: 'error', input: {}, error: 'boom' });
  });

  function makeReg(over: any = {}): any {
    return { name: 'mafw_probe', description: 'd', parameters: { type: 'object', properties: {} }, execute: jest.fn(async () => ({ text: 'done' })), ...over };
  }

  it('executeWithToolFrames：running→completed 两帧同 part.id；isError → error 帧（D5）', async () => {
    const frames: any[] = [];
    const reg = makeReg();
    const out = await executeWithToolFrames(reg, { x: 1 }, 's1', (f) => frames.push(f));
    expect(out).toEqual({ text: 'done' });
    expect(frames.map((f) => f.properties.part.state.status)).toEqual(['running', 'completed']);
    expect(frames[0].properties.part.id).toBe(frames[1].properties.part.id);
    expect(frames[0].properties.part.id).toMatch(/^toolpart_/);
    expect(frames[1].properties.part.state.output).toBe('done');

    const frames2: any[] = [];
    const reg2 = makeReg({ execute: jest.fn(async () => ({ text: 'bad', isError: true })) });
    await executeWithToolFrames(reg2, {}, 's1', (f) => frames2.push(f));
    expect(frames2[1].properties.part.state.status).toBe('error');
    expect(frames2[1].properties.part.state.error).toBe('bad');
  });

  it('execute 抛错 → error 帧 + 重抛；emit 抛错不阻断（D6）；signal 透传', async () => {
    const frames: any[] = [];
    const boom = new Error('kaboom');
    const reg = makeReg({ execute: jest.fn(async () => { throw boom; }) });
    await expect(executeWithToolFrames(reg, {}, 's1', (f) => { frames.push(f); if (frames.length === 1) throw new Error('emit broken'); }, 'sig' as any)).rejects.toThrow('kaboom');
    expect(frames.map((f) => f.properties.part.state.status)).toEqual(['running', 'error']);
    expect(frames[1].properties.part.state.error).toBe('kaboom');
    expect(reg.execute).toHaveBeenCalledWith({}, 'sig');
  });

  it('wrapRegistrationsWithEvents：包装后 execute 自发两帧，原结果保留', async () => {
    const frames: any[] = [];
    const wrapped = wrapRegistrationsWithEvents([makeReg()], 's9', (f) => frames.push(f));
    expect(wrapped).toHaveLength(1);
    const out = await wrapped[0].execute({ a: 1 });
    expect(out).toEqual({ text: 'done' });
    expect(frames.map((f) => f.properties.part.state.status)).toEqual(['running', 'completed']);
    expect(frames[0].properties.sessionID).toBe('s9');
    expect(frames[0].properties.part.tool).toBe('mafw_probe');
  });
});
