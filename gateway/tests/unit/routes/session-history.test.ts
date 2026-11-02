import * as http from 'http';
import { handleSessionHistory, type SessionHistoryDeps } from '../../../src/routes/session-history';
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
}> = {}): SessionHistoryDeps {
  const runtime = overrides.runtime === undefined
    ? { session: { messages: async () => ({ data: overrides.data ?? FLAT_HISTORY, nextCursor: overrides.nextCursor ?? null }) } }
    : overrides.runtime;
  return {
    getRuntime: () => runtime,
    listDataParts: overrides.listDataParts ?? (() => overrides.rows ?? []),
    warn: overrides.warn,
  };
}

async function get(url: string, d: SessionHistoryDeps) {
  const res = mockRes();
  const handled = await handleSessionHistory(mockReq(url), res, url, d);
  return { handled, res, body: res.body ? JSON.parse(res.body) : null };
}

describe('session history route (flat by default and only)', () => {
  it('preserves tool identity and merges data parts', async () => {
    const listDataParts = jest.fn(() => [row('data_card', 'msg_assistant', 'data-card', { ok: true })]);
    const { handled, body } = await get('/api/sessions/ses_1/messages', deps({ listDataParts }));
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

  it('keeps flat content with no info/parts envelope (no format parameter)', async () => {
    const { body } = await get('/api/sessions/ses_1/messages', deps());
    expect(body.data).toHaveLength(2);
    for (const message of body.data) {
      expect((message as any).info).toBeUndefined();
      expect((message as any).parts).toBeUndefined();
      expect(Array.isArray(message.content)).toBe(true);
    }
    expect(body.data[0].content[0]).toMatchObject({ id: 'part_text', type: 'text', text: 'run it' });
  });

  it('ignores the removed format parameter', async () => {
    for (const format of ['flat', 'wire', 'anything']) {
      const { handled, body } = await get(`/api/sessions/ses_1/messages?format=${format}`, deps());
      expect(handled).toBe(true);
      expect((body.data[0] as any).info).toBeUndefined();
      expect(Array.isArray(body.data[0].content)).toBe(true);
    }
  });

  it('returns nextCursor and forwards limit/before to the runtime', async () => {
    const messages = jest.fn(async () => ({ data: FLAT_HISTORY, nextCursor: 'cursor_next' }));
    const { body } = await get('/api/sessions/ses_1/messages?limit=7&before=cursor_prev', deps({
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
    await get('/api/sessions/ses_1/messages', deps({
      runtime: { session: { messages } },
      listDataParts,
    }));
    expect(listDataParts).toHaveBeenCalledWith('ses_1', ['msg_assistant']);
  });

  it('rejects other paths and methods without handling them', async () => {
    for (const url of ['/api/sessions/ses_1/message', '/api/sessions/ses_1/messages/extra']) {
      const { handled } = await get(url, deps());
      expect(handled).toBe(false);
    }
    const res = mockRes();
    const handled = await handleSessionHistory(
      mockReq('/api/sessions/ses_1/messages', 'POST'), res,
      '/api/sessions/ses_1/messages', deps(),
    );
    expect(handled).toBe(false);
  });

  it('returns an empty happy envelope when the runtime is missing', async () => {
    const { handled, res, body } = await get('/api/sessions/ses_1/messages', deps({ runtime: null }));
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(body).toEqual({ data: [], nextCursor: null });
  });

  it('fails open on runtime errors and reports through warn', async () => {
    const warn = jest.fn();
    const { handled, res, body } = await get('/api/sessions/ses_1/messages', deps({
      runtime: { session: { messages: async () => { throw new Error('serve down'); } } },
      warn,
    }));
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(body).toEqual({ data: [], nextCursor: null });
    expect(warn).toHaveBeenCalled();
  });

  it('fails open when the data-part overlay throws', async () => {
    const { body } = await get('/api/sessions/ses_1/messages', deps({
      listDataParts: () => { throw new Error('db down'); },
    }));
    expect(body.data).toHaveLength(2);
    expect(body.data[1].content).toHaveLength(1);
  });
});
