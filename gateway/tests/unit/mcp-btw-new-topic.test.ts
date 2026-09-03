import { handleNewTopic } from '../../src/mcp/handlers/new-topic';
import { handleBtw } from '../../src/mcp/handlers/btw';

describe('mafw_new_topic handler', () => {
  it('returns rotated session ids', async () => {
    const rotateManagerSession = async () => ({ sessionId: 'ses_new', previousSessionId: 'ses_old', created: 'rotated' as const });
    const res = await handleNewTopic({ reason: 'user asked' }, { rotateManagerSession } as any);
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed).toMatchObject({ success: true, sessionId: 'ses_new' });
  });

  it('errors when rotate callback unavailable', async () => {
    const res = await handleNewTopic({}, {} as any);
    expect(res.isError).toBe(true);
  });

  it('errors when rotate throws', async () => {
    const res = await handleNewTopic({}, { rotateManagerSession: async () => { throw new Error('serve down'); } } as any);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toBe('serve down');
  });
});

describe('mafw_btw handler', () => {
  it('returns the answer text', async () => {
    const btwAsk = async (q: string) => ({ answer: `ANS:${q}` });
    const res = await handleBtw({ question: '什么是X' }, { btwAsk } as any);
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toBe('ANS:什么是X');
  });

  it('errors on empty question', async () => {
    const res = await handleBtw({ question: '  ' }, { btwAsk: async () => ({ answer: 'x' }) } as any);
    expect(res.isError).toBe(true);
  });

  it('errors when btwAsk unavailable', async () => {
    const res = await handleBtw({ question: 'q' }, {} as any);
    expect(res.isError).toBe(true);
  });
});
