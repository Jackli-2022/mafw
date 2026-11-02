import { readFileSync } from 'fs';
import { join } from 'path';
import * as http from 'http';
import { handleSessionHistoryFlat, type SessionHistoryFlatDeps } from '../../../src/routes/session-history-flat';
import type { MafwMessage } from '../../../src/runtime/canonical-types';
import type { SessionDataPartRow } from '../../../src/memory/gateway-db';

function mockRes() {
  const res: any = {
    status: 0,
    body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string };
}

function mockReq(url: string, method = 'GET'): http.IncomingMessage {
  return { method, url } as http.IncomingMessage;
}

function row(id: string, messageID: string, type: string, data: unknown): SessionDataPartRow {
  return {
    session_id: 'ses_1', id, message_id: messageID, type,
    data_json: JSON.stringify(data),
    created_at: '2026-10-26T01:00:00Z', updated_at: '2026-10-26T01:00:00Z',
  };
}

const FLAT_HISTORY: MafwMessage[] = [
  { id: 'msg_user', sessionID: 'ses_1', role: 'user', content: [{ id: 'part_text', type: 'text', text: 'run it' }] },
  {
    id: 'msg_assistant', sessionID: 'ses_1', role: 'assistant',
    content: [{ id: 'part_tool', type: 'tool', callID: 'call_1', tool: 'shell', state: { status: 'completed', output: 'ok' } }],
  },
];

function deps(overrides: Partial<{
  data: MafwMessage[];
  nextCursor?: string | null;
  rows: SessionDataPartRow[];
  runtime: any;
  listDataParts: jest.Mock;
  warn: jest.Mock;
}> = {}): SessionHistoryFlatDeps {
  const runtime = overrides.runtime === undefined
    ? { session: { messages: async () => ({ data: overrides.data ?? FLAT_HISTORY, nextCursor: overrides.nextCursor ?? null }) } }
    : overrides.runtime;
  return {
    getRuntime: () => runtime,
    listDataParts: overrides.listDataParts ?? (() => overrides.rows ?? []),
    warn: overrides.warn,
  };
}

async function get(url: string, d: SessionHistoryFlatDeps) {
  const res = mockRes();
  const handled = await handleSessionHistoryFlat(mockReq(url), res, url, d);
  return { handled, res, body: res.body ? JSON.parse(res.body) : null };
}

describe('flat history route', () => {
  it('flat history preserves tool identity and merges data parts', async () => {
    const listDataParts = jest.fn(() => [row('data_card', 'msg_assistant', 'data-card', { ok: true })]);
    const { handled, body } = await get('/api/sessions/ses_1/messages?format=flat', deps({ listDataParts }));
    expect(handled).toBe(true);
    expect(body.data[1]).toMatchObject({
      role: 'assistant',
      content: [
        { id: 'part_tool', type: 'tool', tool: 'shell', toolClass: 'shell', canonicalTool: 'bash' },
        { id: 'data_card', type: 'data-card', data: { ok: true } },
      ],
    });
    expect(body.data[1].content[0]).toMatchObject({
      state: { status: 'completed', output: 'ok' },
    });
    expect((body.data[1] as any).info).toBeUndefined();
    expect((body.data[1] as any).parts).toBeUndefined();
  });

  it('never calls toWireHistory — flat items keep content, no info/parts envelope', async () => {
    const { body } = await get('/api/sessions/ses_1/messages?format=flat', deps());
    expect(body.data).toHaveLength(2);
    for (const message of body.data) {
      expect((message as any).info).toBeUndefined();
      expect((message as any).parts).toBeUndefined();
      expect(Array.isArray(message.content)).toBe(true);
    }
    expect(body.data[0].content[0]).toMatchObject({ id: 'part_text', type: 'text', text: 'run it' });
  });

  it('returns nextCursor and forwards limit/before to the runtime', async () => {
    const messages = jest.fn(async () => ({ data: FLAT_HISTORY, nextCursor: 'cursor_next' }));
    const { body } = await get('/api/sessions/ses_1/messages?format=flat&limit=7&before=cursor_prev', deps({
      runtime: { session: { messages } },
    }));
    expect(messages).toHaveBeenCalledWith({ sessionID: 'ses_1', limit: 7, before: 'cursor_prev' });
    expect(body.nextCursor).toBe('cursor_next');
  });

  it('only asks for data parts of message ids present in the page', async () => {
    const listDataParts = jest.fn(() => []);
    const messages = jest.fn(async () => ({
      data: [{ id: 'msg_assistant', role: 'assistant', content: [] } as MafwMessage],
    }));
    await get('/api/sessions/ses_1/messages?format=flat', deps({
      runtime: { session: { messages } },
      listDataParts,
    }));
    expect(listDataParts).toHaveBeenCalledWith('ses_1', ['msg_assistant']);
  });

  it('does not touch the default (non-flat) path', async () => {
    const { handled, res } = await get('/api/sessions/ses_1/messages', deps());
    expect(handled).toBe(false);
    expect(res.status).toBe(0);
  });

  it('rejects other formats and methods without handling them', async () => {
    for (const url of ['/api/sessions/ses_1/messages?format=wire', '/api/sessions/ses_1/message?format=flat', '/api/sessions/ses_1/messages']) {
      const { handled } = await get(url, deps());
      expect(handled).toBe(false);
    }
    const res = mockRes();
    const handled = await handleSessionHistoryFlat(
      mockReq('/api/sessions/ses_1/messages?format=flat', 'POST'), res,
      '/api/sessions/ses_1/messages?format=flat', deps(),
    );
    expect(handled).toBe(false);
  });

  it('returns an empty happy envelope when the runtime is missing', async () => {
    const { handled, res, body } = await get('/api/sessions/ses_1/messages?format=flat', deps({ runtime: null }));
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(body).toEqual({ data: [], nextCursor: null });
  });

  it('fails open on runtime errors and reports through warn', async () => {
    const warn = jest.fn();
    const { handled, res, body } = await get('/api/sessions/ses_1/messages?format=flat', deps({
      runtime: { session: { messages: async () => { throw new Error('serve down'); } } },
      warn,
    }));
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(body).toEqual({ data: [], nextCursor: null });
    expect(warn).toHaveBeenCalled();
  });

  it('fails open when the data-part overlay throws', async () => {
    const { body } = await get('/api/sessions/ses_1/messages?format=flat', deps({
      listDataParts: () => { throw new Error('db down'); },
    }));
    expect(body.data).toHaveLength(2);
    expect(body.data[1].content).toHaveLength(1);
  });

  it('is wired before the wire egress in index.ts', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'src', 'index.ts'), 'utf-8');
    const flatCall = src.indexOf('handleSessionHistoryFlat(');
    const wireCall = src.indexOf('toWireHistory(flatData');
    expect(flatCall).toBeGreaterThan(-1);
    expect(wireCall).toBeGreaterThan(-1);
    expect(flatCall).toBeLessThan(wireCall);
    expect(src).toContain("format === 'flat'");
  });
});
