import * as http from 'http';
import { handleDryEvent } from '../../../src/routes/dry-event';

async function post(body: unknown, deps?: any): Promise<{ status: number; json: any }> {
  const req = {
    on: (_ev: string, cb: (d?: string) => void) => {
      if (_ev === 'data') setTimeout(() => cb(JSON.stringify(body)), 0);
      if (_ev === 'end') setTimeout(() => cb(), 5);
      return req;
    },
  } as unknown as http.IncomingMessage;
  let status = 0;
  let payload = '';
  const res = {
    writeHead: (s: number) => { status = s; return res; },
    end: (b: string) => { payload = b; return res; },
  } as unknown as http.ServerResponse;
  await handleDryEvent(req, res, deps);
  return { status, json: JSON.parse(payload) };
}

describe('POST /api/runtime/dry-event', () => {
  it('reports facets + matrix flow for a well-formed session.idle', async () => {
    const { status, json } = await post({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    expect(status).toBe(200);
    expect(json.known).toBe(true);
    expect(json.facets.broadcast).toBe('idle');
    expect(json.facets.chatSignal).toBe('complete');
    expect(json.flow.modeA).toBe('rewrite');
    expect(json.flow.desktop).toBe('handled');
    expect(json.warnings).toEqual([]);
  });

  it('warns on unknown type with plugin advice', async () => {
    const { json } = await post({ event: { type: 'my_custom_event', properties: {} } });
    expect(json.known).toBe(false);
    expect(json.warnings.some((w: string) => w.includes('plugin:'))).toBe(true);
    expect(json.flow).toBeUndefined();
  });

  it('warns on missing fields (session.idle without sessionID)', async () => {
    const { json } = await post({ event: { type: 'session.idle', properties: {} } });
    expect(json.warnings.some((w: string) => w.includes('sessionID'))).toBe(true);
  });

  it('accepts the event object directly at top level (no envelope)', async () => {
    const { json } = await post({ type: 'session.idle', properties: { sessionID: 's1' } });
    expect(json.facets.broadcast).toBe('idle');
  });

  it('rejects non-object body with 400', async () => {
    const { status } = await post('nope');
    expect(status).toBe(400);
  });

  it('echoes approval facet (previously missing)', async () => {
    const { json } = await post({ event: { type: 'permission.asked', properties: { sessionID: 's1', id: 'r1', permission: 'bash' } } });
    expect(json.facets.approval).toMatchObject({ requestId: 'r1', toolName: 'bash' });
  });
});

describe('POST /api/runtime/dry-event with plugin mapping hop', () => {
  const entry = {
    eventSource: { typePath: '$.type', sessionIdPath: '$.sessionID' },
    eventMappings: [{ from: 'done', to: 'session.idle' }, { from: 'noise', to: 'drop' }],
  };
  const deps = {
    getPluginEventEntry: (name: string) => (name === 'fake' ? entry : null),
    listPlugins: () => ['fake'],
  };

  it('maps a native event and reports the mapping hop', async () => {
    const { status, json } = await post({ plugin: 'fake', event: { type: 'done', sessionID: 's1' } }, deps);
    expect(status).toBe(200);
    expect(json.mapping).toEqual({ matched: true, to: 'session.idle' });
    expect(json.type).toBe('session.idle');
    expect(json.facets.broadcast).toBe('idle');
  });

  it('reports dropped mapping', async () => {
    const { json } = await post({ plugin: 'fake', event: { type: 'noise', sessionID: 's1' } }, deps);
    expect(json.mapping).toEqual({ matched: false, dropped: true });
  });

  it('400 for unknown plugin with available list', async () => {
    const { status, json } = await post({ plugin: 'nope', event: { type: 'x' } }, deps);
    expect(status).toBe(400);
    expect(json.available).toEqual(['fake']);
  });

  it('400 distinguishes registered-but-no-mappings from unknown plugin', async () => {
    const deps2 = {
      getPluginEventEntry: (name: string) => (name === 'fake' ? entry : null),
      listPlugins: () => ['fake', 'bare'],
      hasPlugin: (name: string) => name === 'fake' || name === 'bare',
    };
    const bare = await post({ plugin: 'bare', event: { type: 'x' } }, deps2);
    expect(bare.status).toBe(400);
    expect(bare.json.error).toContain("declares no event mappings");
    expect(bare.json.available).toBeUndefined();
    const unknown = await post({ plugin: 'nope', event: { type: 'x' } }, deps2);
    expect(unknown.status).toBe(400);
    expect(unknown.json.error).toContain("unknown plugin 'nope'");
    expect(unknown.json.available).toEqual(['fake', 'bare']);
  });
});

describe('POST /api/runtime/dry-event tool primitive hop', () => {
  const entry = {
    eventSource: { typePath: '$.type', sessionIdPath: '$.sessionID' },
    eventMappings: [
      { from: 'tc', to: 'tool.call', fields: { callID: { path: '$.id' }, tool: { path: '$.name' }, input: { path: '$.args' } } },
    ],
  };
  const deps = { getPluginEventEntry: (n: string) => (n === 'fake2' ? entry : null), listPlugins: () => ['fake2'] };

  it('映射到 tool.call → assembled 回显 ToolPart 快照，facets 跳过', async () => {
    const { status, json } = await post({ plugin: 'fake2', event: { type: 'tc', sessionID: 's1', id: 'tc1', name: 'bash', args: { command: 'ls' } } }, deps);
    expect(status).toBe(200);
    expect(json.mapping).toEqual({ matched: true, to: 'tool.call' });
    expect(json.known).toBe(true);
    expect(json.facets).toBeNull();
    const part = json.assembled.find((e: any) => e.payload?.type === 'message.part.updated')?.payload?.properties?.part;
    expect(part?.id).toBe('toolpart_tc1');
    expect(part?.type).toBe('tool');
    expect(part?.state.status).toBe('running');
  });
});
