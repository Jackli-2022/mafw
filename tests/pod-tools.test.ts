import { podStatusTool } from '../src/tools/pod-status';
import { podTaskUpdateTool } from '../src/tools/pod-task-update';
import { podMemoryWriteTool } from '../src/tools/pod-memory-write';
import { podMessageTool } from '../src/tools/pod-message';

function okJson(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => data });
}

describe('pod plugin tools', () => {
  beforeEach(() => {
    delete process.env.MAFW_SERVER_API_PORT;
    delete process.env.MAFW_GATEWAY_PORT;
    (globalThis as any).fetch = jest.fn();
  });

  test('status fetches an explicit pod', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(okJson({ pod: { id: 'pod_1' }, members: [] }));
    const result: any = await podStatusTool.execute({ podId: 'pod_1' }, { sessionID: 'ses_lead' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/pods/pod_1?actorSessionID=ses_lead',
      expect.anything(),
    );
    expect(result.metadata.podId).toBe('pod_1');
    expect(result.title).toContain('鲸群');
  });

  test('status resolves a pod from the caller session directory', async () => {
    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce(okJson({ directory: '/proj' }))
      .mockResolvedValueOnce(okJson({ pod: { id: 'pod_2' }, members: [] }))
      .mockResolvedValueOnce(okJson({ pod: { id: 'pod_2' }, members: [] }));
    const result: any = await podStatusTool.execute({}, { sessionID: 'ses_lead' });
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toContain('/api/sessions/ses_lead');
    expect((globalThis.fetch as jest.Mock).mock.calls[1][0]).toContain('/api/projects/%2Fproj/pod');
    expect(result.metadata.podId).toBe('pod_2');
  });

  test('task update sends actorSessionID and returns task metadata', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(okJson({ task: { id: 't1', status: 'done' } }));
    const result: any = await podTaskUpdateTool.execute(
      { podId: 'pod_1', taskId: 't1', status: 'done' },
      { sessionID: 'ses_builder' },
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/pods/pod_1/tasks/t1',
      expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('ses_builder') }),
    );
    expect(result.metadata.taskId).toBe('t1');
  });

  test('memory write surfaces 403 as isError', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'forbidden' }),
    });
    const result: any = await podMemoryWriteTool.execute(
      { podId: 'pod_1', file: 'POD', content: 'x' },
      { sessionID: 'ses_builder' },
    );
    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('403');
  });

  test('fetch rejection is reported as an error', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValue(new Error('down'));
    const result: any = await podStatusTool.execute({ podId: 'pod_1' }, { sessionID: 'ses_lead' });
    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('down');
  });

  test('pod message defaults to A2A JSON-RPC', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(okJson({ jsonrpc: '2.0', result: { task: { id: 't1' } } }));
    const result: any = await podMessageTool.execute(
      { podId: 'pod_1', kind: 'request', toMemberId: 'm_builder', body: 'do' },
      { sessionID: 'ses_lead' },
    );
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/a2a/pods/pod_1');
    expect(JSON.parse(init.body).method).toBe('message/send');
    expect(result.metadata.protocol).toBe('a2a');
  });

  test('pod message falls back to REST when A2A is unavailable', async () => {
    (globalThis.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(okJson({ message: { id: 'm1' } }));
    const result: any = await podMessageTool.execute(
      { podId: 'pod_1', kind: 'note', body: 'x' },
      { sessionID: 'ses_lead' },
    );
    expect((globalThis.fetch as jest.Mock).mock.calls[1][0]).toContain('/api/pods/pod_1/messages');
    expect(result.metadata.protocol).toBe('rest');
  });
});
