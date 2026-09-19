import { normalizeOpencodeEvent } from '../../../src/runtime/normalize';

describe('EventFacets approval 切面（双 runtime 形状对齐）', () => {
  it('opencode 形状：id/permission/patterns/metadata', () => {
    const f = normalizeOpencodeEvent({
      type: 'permission.asked',
      properties: { id: 'req-1', sessionID: 'ses_1', permission: 'bash', patterns: ['git status*'], metadata: { impact: 'run command' } },
    });
    expect(f.approval).toEqual({
      requestId: 'req-1', toolName: 'bash', patterns: ['git status*'], metadata: { impact: 'run command' },
    });
  });

  it('pi 形状：requestId/toolName/args/risk 归一到 metadata', () => {
    const f = normalizeOpencodeEvent({
      payload: {
        type: 'permission.asked',
        properties: { sessionID: 'pi_1', requestId: 'uuid-1', toolName: 'bash', args: { command: 'npm test' }, risk: 'medium' },
      },
    });
    expect(f.approval).toEqual({
      requestId: 'uuid-1', toolName: 'bash', patterns: [], metadata: { args: { command: 'npm test' }, risk: 'medium' },
    });
  });

  it('非 asked 事件 → null', () => {
    const f = normalizeOpencodeEvent({ type: 'session.idle', properties: { sessionID: 's' } });
    expect(f.approval).toBeNull();
  });

  it('asked 缺 requestId 或 toolName → null（畸形防御）', () => {
    expect(normalizeOpencodeEvent({ type: 'permission.asked', properties: { sessionID: 's' } }).approval).toBeNull();
    expect(normalizeOpencodeEvent({ type: 'permission.asked', properties: { sessionID: 's', id: 'x' } }).approval).toBeNull();
  });

  it('opencode metadata 缺省时 metadata 为 undefined', () => {
    const f = normalizeOpencodeEvent({
      type: 'permission.asked',
      properties: { id: 'r', sessionID: 's', permission: 'edit', patterns: [] },
    });
    expect(f.approval?.metadata).toBeUndefined();
  });
});
