import { wrapToolPartAssembly } from '../../../src/runtime/tool-part-assembler';

async function* streamOf(events: any[]) { for (const e of events) yield e; }
function fakeRuntime(events: any[]) {
  return { global: { event: async () => ({ stream: streamOf(events) }) } };
}
async function collect(stream: AsyncIterable<any>) {
  const out: any[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe('wrapToolPartAssembly', () => {
  test('非原语事件原样透传（opencode 恒等 oracle）', async () => {
    const events = [
      { payload: { type: 'message.part.updated', properties: { part: { id: 'p1', messageID: 'm1', type: 'text', text: 'hi' } } }, sessionID: 's1' },
      { payload: { type: 'session.idle', properties: { sessionID: 's1' } }, sessionID: 's1' },
    ];
    const rt = fakeRuntime(events);
    wrapToolPartAssembly(rt);
    const result = await rt.global.event();
    expect(await collect(result.stream)).toEqual(events);
  });

  test('tool.call → message.part.updated ToolPart 快照', async () => {
    const rt = fakeRuntime([
      { payload: { type: 'tool.call', properties: { sessionID: 's1', callID: 'c1', tool: 'bash', input: { command: 'ls' } } }, sessionID: 's1' },
    ]);
    wrapToolPartAssembly(rt);
    const out = await collect((await rt.global.event()).stream);
    const partEvt = out.find((e) => e.payload.type === 'message.part.updated');
    expect(partEvt.payload.properties.part.id).toBe('toolpart_c1');
    expect(partEvt.payload.properties.part.state.status).toBe('running');
  });

  test('call→result 序列：同 part.id 两帧，终帧 completed', async () => {
    const rt = fakeRuntime([
      { payload: { type: 'tool.call', properties: { sessionID: 's1', callID: 'c1', tool: 'read', input: { filePath: '/a' } } }, sessionID: 's1' },
      { payload: { type: 'tool.result', properties: { sessionID: 's1', callID: 'c1', output: [{ type: 'text', text: 'data' }] } }, sessionID: 's1' },
    ]);
    wrapToolPartAssembly(rt);
    const out = await collect((await rt.global.event()).stream);
    const parts = out.filter((e) => e.payload.type === 'message.part.updated');
    expect(parts).toHaveLength(2);
    expect(parts[0].payload.properties.part.id).toBe('toolpart_c1');
    expect(parts[1].payload.properties.part.id).toBe('toolpart_c1');
    expect(parts[1].payload.properties.part.state.status).toBe('completed');
    expect(parts[1].payload.properties.part.state.output).toBe('data');
  });

  test('锚点学习：先过 text part，后续工具 part 挂同一 messageID', async () => {
    const rt = fakeRuntime([
      { payload: { type: 'message.part.updated', properties: { part: { id: 'p1', messageID: 'm-real', type: 'text', text: 'x' } } }, sessionID: 's1' },
      { payload: { type: 'tool.call', properties: { sessionID: 's1', callID: 'c1', tool: 'bash', input: {} } }, sessionID: 's1' },
    ]);
    wrapToolPartAssembly(rt);
    const out = await collect((await rt.global.event()).stream);
    const toolEvt = out.filter((e) => e.payload.type === 'message.part.updated').at(-1);
    expect(toolEvt.payload.properties.part.messageID).toBe('m-real');
  });

  test('无 async iterable 的结果原样返回', async () => {
    const rt = { global: { event: async () => 42 as any } };
    wrapToolPartAssembly(rt);
    expect(await rt.global.event()).toBe(42);
  });
});
