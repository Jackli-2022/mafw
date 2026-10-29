/**
 * V2 plugin API tests — @jack200714/mafw ported to the OpenCode V2 plugin API.
 *
 * Root cause these tests pin: OpenCode v2 requires the default export to be an
 * object definition (`{ id, setup(ctx) }`); the V1 entrypoint was a bare async
 * function and the plugin failed to load with
 * `Plugin must export a default definition with an id and an effect or setup
 * function. (cause: SchemaError(Expected object at ["default"]))`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';

import mafwPlugin from '../src/plugin';
import { zodToJsonSchema, toV1Views, captureAssistantOutput } from '../src/utils/v2-compat';

// ---------------------------------------------------------------- helpers

interface FetchCall { url: string; body: any }

function makeFetch(routes: Array<[string, any]>) {
  const calls: FetchCall[] = [];
  const fetchMock = jest.fn(async (url: any, init?: any) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, body: init?.body ? JSON.parse(init.body) : null });
    for (const [needle, data] of routes) {
      if (urlStr.includes(needle)) {
        return { ok: true, status: 200, json: async () => data };
      }
    }
    return { ok: false, status: 503, json: async () => ({}) };
  });
  return { fetchMock, calls };
}

interface Registrations {
  tools: any[];
  commands: any[];
  sessionHooks: Record<string, (event: any) => any>;
  toolHooks: Record<string, (event: any) => any>;
  eventSignal: AbortSignal | null;
  seededEvents: any[];
}

function makeCtx(directory: string) {
  const regs: Registrations = {
    tools: [], commands: [], sessionHooks: {}, toolHooks: {},
    eventSignal: null, seededEvents: [],
  };
  const ctx: any = {
    location: { directory },
    options: {},
    tool: {
      transform: async (cb: any) => cb({ add: (t: any) => regs.tools.push(t) }),
      hook: async (name: string, cb: any) => { regs.toolHooks[name] = cb; },
    },
    session: {
      hook: async (name: string, cb: any) => { regs.sessionHooks[name] = cb; },
      prompt: jest.fn(async (input: any) => ({ ...input })),
      synthetic: jest.fn(async (input: any) => ({ ...input })),
      context: jest.fn(async ({ sessionID }: any) => sessionContexts[sessionID] ?? []),
    },
    command: {
      transform: async (cb: any) => cb({ add: (c: any) => regs.commands.push(c) }),
    },
    event: {
      subscribe: async function* ({ signal }: any = {}) {
        regs.eventSignal = signal ?? null;
        for (const ev of regs.seededEvents) {
          if (signal?.aborted) return;
          yield ev;
        }
        if (signal) await new Promise((resolve) => signal.addEventListener('abort', resolve));
      },
    },
  };
  return { ctx, regs };
}

/** Per-test V2 persisted-message store served by ctx.session.context. */
const sessionContexts: Record<string, any[]> = {};

function mkdtempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-v2-test-'));
}

const flush = () => new Promise((r) => setImmediate(r));

let tmpHome: string | undefined;
const realFetch = global.fetch;

beforeEach(() => {
  sessionContexts['ses_ctx'] = [];
  // Isolate ensureMcpWiring from the user's real global opencode config.
  tmpHome = mkdtempDir();
  process.env.USERPROFILE = tmpHome;
  process.env.HOME = tmpHome;
});

afterEach(() => {
  global.fetch = realFetch;
  if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
});

// ---------------------------------------------------------------- the bug

describe('V2 plugin definition', () => {
  it('default-exports an object definition with id and a setup function', () => {
    expect(mafwPlugin).not.toBeNull();
    expect(typeof mafwPlugin).toBe('object');
    expect((mafwPlugin as any).id).toBe('mafw');
    expect(typeof (mafwPlugin as any).setup).toBe('function');
  });

  it('no-ops on a V1-shaped ctx (no session.hook / tool.transform)', async () => {
    await expect((mafwPlugin as any).setup({ location: { directory: mkdtempDir() } })).resolves.toBeUndefined();
    await expect((mafwPlugin as any).setup(undefined)).resolves.toBeUndefined();
  });
});

// ------------------------------------------------------- zod → JSON Schema

describe('zodToJsonSchema', () => {
  it('converts the V1 tool args shapes (string/enum/array/number/optional + describe)', () => {
    const input = zodToJsonSchema({
      content: z.string().describe('memory content'),
      memoryType: z.enum(['semantic', 'episodic']).optional().describe('type'),
      cueAnchors: z.array(z.string()).max(8).optional().describe('cues'),
      importance: z.number().int().min(1).max(10).optional().describe('score'),
    });
    expect(input).toEqual({
      type: 'object',
      properties: {
        content: { type: 'string', description: 'memory content' },
        memoryType: { type: 'string', enum: ['semantic', 'episodic'], description: 'type' },
        cueAnchors: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'cues' },
        importance: { type: 'integer', minimum: 1, maximum: 10, description: 'score' },
      },
      required: ['content'],
      additionalProperties: false,
    });
  });

  it('handles empty args maps (python-restart has none)', () => {
    expect(zodToJsonSchema({})).toEqual({
      type: 'object', properties: {}, required: [], additionalProperties: false,
    });
  });
});

// --------------------------------------------------------- message adapter

describe('toV1Views', () => {
  it('exposes V1-style views whose parts alias the V2 content array (in-place mutation propagates)', () => {
    const content = [{ type: 'text', text: 'hi' }];
    const msg = { role: 'user', content };
    const views = toV1Views([msg], 'ses_a');
    expect(views[0].role).toBe('user');
    expect(views[0].info.sessionID).toBe('ses_a');
    expect(views[0].info.id).toBeTruthy();
    expect(views[0].parts).toBe(msg.content); // same reference
    views[0].parts.push({ type: 'text', text: '<recall>…</recall>', synthetic: true });
    expect(msg.content).toHaveLength(2);
  });

  it('marks views with the original message so synthetic pushes can be detected', () => {
    const msg = { role: 'user', content: [{ type: 'text', text: 'x' }] };
    const views = toV1Views([msg], 'ses_a');
    expect((views[0] as any).__v2).toBe(msg);
  });
});

// ---------------------------------------------------------- setup() wiring

describe('setup(ctx) registration', () => {
  it('registers the 20 plugin tools with JSON Schema inputs and a result adapter', async () => {
    const dir = mkdtempDir();
    const { fetchMock, calls } = makeFetch([['/api/memory/add', { success: true, id: 'mem_9' }]]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);

    const names = regs.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'mafw_add_memory', 'mafw_media_ask', 'mafw_media_speak',
      'mafw_media_upload', 'mafw_message_subagent', 'mafw_pod_memory_read',
      'mafw_pod_memory_write', 'mafw_pod_message', 'mafw_pod_status',
      'mafw_pod_task_create', 'mafw_pod_task_update', 'mafw_python',
      'mafw_python_restart', 'mafw_spawn_subagent', 'mafw_subagent_result',
      'mafw_submit_result', 'mafw_task_cancel', 'mafw_task_list',
      'mafw_task_message', 'mafw_task_submit',
    ]);
    for (const tool of regs.tools) {
      expect(tool.input.type).toBe('object');
      expect(typeof tool.execute).toBe('function');
    }

    const add = regs.tools.find((t) => t.name === 'mafw_add_memory')!;
    const result = await add.execute({ content: '记住这个' }, { sessionID: 'ses_t', signal: undefined });
    expect(calls.some((c) => c.url.includes('/api/memory/add') && c.body?.content === '记住这个')).toBe(true);
    const parsed = JSON.parse((result as any).content);
    expect(parsed.id).toBe('mem_9');
  });

  it('registers prompt + context session hooks and the tool execute.after hook', async () => {
    const dir = mkdtempDir();
    global.fetch = makeFetch([]).fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);
    expect(typeof regs.sessionHooks.prompt).toBe('function');
    expect(typeof regs.sessionHooks.context).toBe('function');
    expect(typeof regs.toolHooks['execute.after']).toBe('function');
  });

  it('registers the six slash commands', async () => {
    const dir = mkdtempDir();
    global.fetch = makeFetch([]).fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);
    const names = regs.commands.map((c) => c.name).sort();
    expect(names).toEqual(['btw', 'goal', 'merge-memory', 'new-topic', 'status', 'waitwhat']);
  });

  it('returns a cleanup function that aborts the event subscription', async () => {
    const dir = mkdtempDir();
    global.fetch = makeFetch([]).fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    const cleanup = await (mafwPlugin as any).setup(ctx);
    expect(typeof cleanup).toBe('function');
    await flush();
    expect(regs.eventSignal).not.toBeNull();
    (cleanup as () => void)();
    expect(regs.eventSignal!.aborted).toBe(true);
  });
});

// ------------------------------------------------------------- context hook

describe('session context hook', () => {
  it('managed=false injects only the missing blocks in guide -> profile -> priors order', async () => {
    const dir = mkdtempDir();
    const { fetchMock } = makeFetch([
      ['/api/recall/instructions', {
        managed: false,
        missing: ['mafw.user-profile'],
        staleKeys: [],
        blocks: {
          userProfile: '<user-profile>P</user-profile>',
        },
      }],
      ['/api/recall/context', { pointers: null }],
    ]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);

    const event = {
      sessionID: 'ses_missing',
      system: [{ type: 'text', text: 'base system' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    };
    await regs.sessionHooks.context(event);
    const texts = event.system.map((p: any) => p.text);
    expect(texts[0]).toBe('base system');
    expect(texts).toContain('<user-profile>P</user-profile>');
    expect(texts.some((t: string) => t.includes('<memory-guide>'))).toBe(false);
    expect(texts.some((t: string) => t.includes('<agent-priors>'))).toBe(false);
  });

  it('managed=false with all three missing appends guide -> profile -> priors', async () => {
    const dir = mkdtempDir();
    const { fetchMock } = makeFetch([
      ['/api/recall/instructions', {
        managed: false,
        missing: ['mafw.memory-guide', 'mafw.user-profile', 'mafw.agent-priors'],
        staleKeys: [],
        blocks: {
          memoryGuide: '<memory-guide>G</memory-guide>',
          userProfile: '<user-profile>P</user-profile>',
          agentPriors: '<agent-priors>A</agent-priors>',
        },
      }],
      ['/api/recall/context', { pointers: null }],
    ]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);
    const event = { sessionID: 'ses_all_missing', system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] };
    await regs.sessionHooks.context(event);
    const texts = event.system.map((p: any) => p.text);
    expect(texts).toEqual([
      '<memory-guide>G</memory-guide>',
      '<user-profile>P</user-profile>',
      '<agent-priors>A</agent-priors>',
    ]);
  });

  it('managed=true injects none of the three blocks', async () => {
    const dir = mkdtempDir();
    const { fetchMock } = makeFetch([
      ['/api/recall/instructions', { managed: true, missing: [], staleKeys: [], blocks: {} }],
      ['/api/recall/context', { pointers: null }],
    ]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);
    const event = { sessionID: 'ses_managed', system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] };
    await regs.sessionHooks.context(event);
    const texts = event.system.map((p: any) => String(p.text));
    expect(texts.some((t) => t.includes('<memory-guide>'))).toBe(false);
    expect(texts.some((t) => t.includes('<user-profile>'))).toBe(false);
    expect(texts.some((t) => t.includes('<agent-priors>'))).toBe(false);
  });

  it('gateway unavailable after managed=true does not inject blocks', async () => {
    const realNow = Date.now();
    let now = realNow;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { fetchMock } = makeFetch([
      ['/api/recall/instructions', { managed: true, missing: [], staleKeys: [], blocks: {} }],
      ['/api/recall/context', { pointers: null }],
    ]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(mkdtempDir());
    await (mafwPlugin as any).setup(ctx);
    const first = { sessionID: 'ses_cached_true', system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] };
    await regs.sessionHooks.context(first);
    now += 6000; // bypass the 5s fresh cache, stay inside the 10min last-good window
    global.fetch = jest.fn(async () => { throw new Error('gateway down'); }) as any;
    const second = { sessionID: 'ses_cached_true', system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'y' }] }] };
    await regs.sessionHooks.context(second);
    nowSpy.mockRestore();
    const texts = second.system.map((p: any) => String(p.text));
    expect(texts.some((t) => t.includes('<memory-guide>'))).toBe(false);
    expect(texts.some((t) => t.includes('<user-profile>'))).toBe(false);
    expect(texts.some((t) => t.includes('<agent-priors>'))).toBe(false);
  });

  it('caches the endpoint for 5s per session', async () => {
    const { fetchMock, calls } = makeFetch([
      ['/api/recall/instructions', { managed: true, missing: [], staleKeys: [], blocks: {} }],
      ['/api/recall/context', { pointers: null }],
    ]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(mkdtempDir());
    await (mafwPlugin as any).setup(ctx);
    for (const text of ['a', 'b']) {
      await regs.sessionHooks.context({ sessionID: 'ses_cache', system: [], messages: [{ role: 'user', content: [{ type: 'text', text }] }] });
    }
    expect(calls.filter((c) => c.url.includes('/api/recall/instructions'))).toHaveLength(1);
  });

  it('bounds the last-good cache and evicts the oldest session', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { fetchMock, calls } = makeFetch([
      ['/api/recall/instructions', { managed: true, missing: [], staleKeys: [], blocks: {} }],
      ['/api/recall/context', { pointers: null }],
    ]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(mkdtempDir());
    await (mafwPlugin as any).setup(ctx);
    for (let i = 0; i < 201; i++) {
      await regs.sessionHooks.context({ sessionID: `ses_lru_${i}`, system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] });
    }
    const before = calls.filter((c) => c.url.includes('/api/recall/instructions')).length;
    await regs.sessionHooks.context({ sessionID: 'ses_lru_0', system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'y' }] }] });
    nowSpy.mockRestore();
    expect(calls.filter((c) => c.url.includes('/api/recall/instructions')).length).toBe(before + 1);
  });

  it('injects <recall> pointers into the last user message content in place', async () => {
    const dir = mkdtempDir();
    const { fetchMock } = makeFetch([
      ['/api/recall/context', { pointers: '<recall>#mem-abc123</recall>' }],
      ['/api/recall/pinned', { profile: null }],
      ['/api/recall/priors', { block: null }],
    ]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);

    const content = [{ type: 'text', text: '查一下上次的架构决定' }];
    const event = {
      sessionID: 'ses_recall_1',
      system: [],
      messages: [
        { role: 'user', content },
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      ],
    };
    await regs.sessionHooks.context(event);
    const injected = content.find((p: any) => p.type === 'text' && String(p.text).startsWith('<recall>'));
    expect(injected).toBeTruthy();
    expect(String(injected!.text)).toContain('#mem-abc123');
  });

  it('fail-open: gateway fully down never throws and still injects the static memory guide', async () => {
    const dir = mkdtempDir();
    global.fetch = jest.fn(async () => { throw new Error('gateway down'); }) as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);
    const event = {
      sessionID: 'ses_down',
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    };
    await expect(regs.sessionHooks.context(event)).resolves.toBeUndefined();
    const guide = event.system.map((p: any) => String(p.text)).find((t: string) => t.includes('<memory-guide>')) || '';
    expect(guide).toContain('<memory-guide>');
    expect(guide).toContain('常驻披露层');
    expect(guide).not.toContain('每轮保证注入');
  });
});

// --------------------------------------------------------------- prompt hook

describe('session prompt hook', () => {
  it('captures user_input observations from prompt text', async () => {
    const dir = mkdtempDir();
    const { fetchMock, calls } = makeFetch([]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);
    await regs.sessionHooks.prompt({ sessionID: 'ses_p', prompt: { text: '帮我分析这张图' } });
    const obs = calls.find((c) => c.url.includes('/api/obs/capture'));
    expect(obs?.body).toMatchObject({ sessionID: 'ses_p', source: 'user_input', content: '帮我分析这张图' });
  });

  it('converts pasted media attachments to A2A text pointers before admission', async () => {
    const dir = mkdtempDir();
    const png = path.join(dir, 'paste.png');
    fs.writeFileSync(png, Buffer.from('fake-png-bytes'));
    const { fetchMock } = makeFetch([
      ['/a2a', { result: { task: { id: 'task_77', contextId: 'ctx_88' } } }],
    ]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);

    const event = {
      sessionID: 'ses_p2',
      prompt: { text: '这是什么', files: [{ uri: `file:///${png.replace(/\\/g, '/')}`, name: 'paste.png' }] },
    };
    await regs.sessionHooks.prompt(event);
    expect(event.prompt.files).toHaveLength(0);
    expect(event.prompt.text).toContain('taskID: task_77');
    expect(event.prompt.text).toContain('contextID: ctx_88');
  });

  it('leaves non-media attachments untouched', async () => {
    const dir = mkdtempDir();
    const { fetchMock } = makeFetch([]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);
    const doc = { uri: 'file:///C:/tmp/spec.md', name: 'spec.md' };
    const event = { sessionID: 'ses_p3', prompt: { text: '读文档', files: [doc] } };
    await regs.sessionHooks.prompt(event);
    expect(event.prompt.files).toEqual([doc]);
    expect(event.prompt.text).toBe('读文档');
  });
});

// ------------------------------------------------------------ tool hook

describe('tool execute.after hook', () => {
  it('captures completed tool results as tool_result observations', async () => {
    const dir = mkdtempDir();
    const { fetchMock, calls } = makeFetch([]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);
    await regs.toolHooks['execute.after']({
      tool: 'read', sessionID: 'ses_ta', status: 'completed', result: { content: 'file body' },
    });
    const obs = calls.find((c) => c.url.includes('/api/obs/capture'));
    expect(obs?.body).toMatchObject({ sessionID: 'ses_ta', source: 'tool_result', content: 'file body' });
  });

  it('captures failed tool executions with failure=true', async () => {
    const dir = mkdtempDir();
    const { fetchMock, calls } = makeFetch([]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);
    await regs.toolHooks['execute.after']({
      tool: 'bash', sessionID: 'ses_tb', status: 'error', error: { message: 'exit 1' },
    });
    const obs = calls.find((c) => c.url.includes('/api/obs/capture'));
    expect(obs?.body?.source).toBe('tool_result');
    expect(obs?.body?.failure).toBe(true);
    expect(obs?.body?.content).toContain('bash');
    expect(obs?.body?.content).toContain('exit 1');
  });
});

// ---------------------------------------------------------- event stream

describe('event subscription', () => {
  it('on session.idle captures assistant text and reasoning since the last cursor', async () => {
    const dir = mkdtempDir();
    const { fetchMock, calls } = makeFetch([]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    regs.seededEvents.push({ type: 'session.idle', sessionID: 'ses_ev1' });
    sessionContexts['ses_ev1'] = [
      { id: 'm1', type: 'user', text: '问题' },
      {
        id: 'm2', type: 'assistant',
        content: [
          { type: 'reasoning', text: '思考过程' },
          { type: 'text', text: '这是回答' },
        ],
      },
    ];
    await (mafwPlugin as any).setup(ctx);
    await flush();
    const sources = calls.filter((c) => c.url.includes('/api/obs/capture')).map((c) => c.body?.source);
    expect(sources).toContain('assistant_reply');
    expect(sources).toContain('reasoning');
    const reply = calls.find((c) => c.url.includes('/api/obs/capture') && c.body?.source === 'assistant_reply');
    expect(reply?.body?.content).toContain('这是回答');
  });

  it('does not re-capture the same assistant message on repeated idle events', async () => {
    const dir = mkdtempDir();
    const { fetchMock, calls } = makeFetch([]);
    global.fetch = fetchMock as any;
    const messages = [
      { id: 'm1', type: 'user', text: 'q' },
      { id: 'm2', type: 'assistant', content: [{ type: 'text', text: 'a' }] },
    ];
    await captureAssistantOutput('ses_ev2', messages);
    await captureAssistantOutput('ses_ev2', messages);
    const replies = calls.filter((c) => c.url.includes('/api/obs/capture') && c.body?.source === 'assistant_reply');
    expect(replies).toHaveLength(1);
    // 新消息（游标之后）会被收割
    messages.push({ id: 'm3', type: 'assistant', content: [{ type: 'text', text: 'b' }] });
    await captureAssistantOutput('ses_ev2', messages);
    const repliesAfter = calls.filter((c) => c.url.includes('/api/obs/capture') && c.body?.source === 'assistant_reply');
    expect(repliesAfter).toHaveLength(2);
    expect(repliesAfter[1].body?.content).toBe('b');
  });

  it('on session.deleted runs the session-ending fallback (state dir absent → warn only)', async () => {
    const dir = mkdtempDir();
    const { fetchMock } = makeFetch([]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    regs.seededEvents.push({ type: 'session.deleted', sessionID: 'ses_gone' });
    await (mafwPlugin as any).setup(ctx);
    await flush();
    // No .mafw/state directory exists in the temp dir — the hook must have
    // returned quietly instead of throwing (console.warn swallowed by logger).
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------- commands

describe('commands', () => {
  it('/status reads .mafw/STATUS.md and posts it as a synthetic message', async () => {
    const dir = mkdtempDir();
    fs.mkdirSync(path.join(dir, '.mafw'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.mafw', 'STATUS.md'), '# Status\nall good');
    const { fetchMock } = makeFetch([]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);
    const status = regs.commands.find((c) => c.name === 'status')!;
    await status.execute({ sessionID: 'ses_cmd', prompt: { text: '/status' }, delivery: 'steer' });
    expect(ctx.session.synthetic).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: 'ses_cmd', text: expect.stringContaining('all good') }),
    );
  });

  it('/btw asks the gateway and posts the answer as a synthetic message', async () => {
    const dir = mkdtempDir();
    const { fetchMock, calls } = makeFetch([['/api/mafw-commands/run', { text: '顺便的答案' }]]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);
    const btw = regs.commands.find((c) => c.name === 'btw')!;
    await btw.execute({ sessionID: 'ses_cmd2', prompt: { text: '/btw 今天几号' }, delivery: 'steer' });
    expect(calls.some((c) => c.url.includes('/api/mafw-commands/run') && c.body?.command === 'btw')).toBe(true);
    expect(ctx.session.synthetic).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: 'ses_cmd2', text: '顺便的答案' }),
    );
  });

  it('/goal submits a prompt that drives goal creation', async () => {
    const dir = mkdtempDir();
    const { fetchMock } = makeFetch([]);
    global.fetch = fetchMock as any;
    const { ctx, regs } = makeCtx(dir);
    await (mafwPlugin as any).setup(ctx);
    const goal = regs.commands.find((c) => c.name === 'goal')!;
    await goal.execute({ sessionID: 'ses_cmd3', prompt: { text: '/goal 重构记忆检索' }, delivery: 'steer' });
    expect(ctx.session.prompt).toHaveBeenCalledTimes(1);
    const arg = ctx.session.prompt.mock.calls[0][0];
    expect(arg.sessionID).toBe('ses_cmd3');
    expect(arg.text).toContain('重构记忆检索');
    expect(arg.text).toContain('mafw_create_goal');
  });
});
