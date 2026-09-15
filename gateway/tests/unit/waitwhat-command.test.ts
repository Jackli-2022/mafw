import { runWaitwhat, buildWaitwhatPrompt, WaitwhatDeps } from '../../src/routes/waitwhat-command';

function msg(role: string, ...texts: string[]) {
  return { info: { role }, parts: texts.map((t) => ({ type: 'text', text: t })) };
}

function harness(messages: any[]) {
  const calls: { prompts: Array<{ sessionID: string; text: string }> } = { prompts: [] };
  const deps: WaitwhatDeps = {
    listMessages: async () => messages,
    promptAsync: async (sessionID, text) => { calls.prompts.push({ sessionID, text }); },
  };
  return { calls, deps };
}

describe('runWaitwhat', () => {
  it('re-pitches the last assistant text into the same session', async () => {
    const { calls, deps } = harness([
      msg('user', '怎么做？'),
      msg('assistant', '把 frontier 往外推，先清决策票。'),
    ]);
    const result = await runWaitwhat('s1', deps);
    expect(result.ok).toBe(true);
    expect(calls.prompts).toHaveLength(1);
    expect(calls.prompts[0].sessionID).toBe('s1');
    expect(calls.prompts[0].text).toContain('把 frontier 往外推，先清决策票。');
    expect(calls.prompts[0].text).toMatch(/CONTEXT\.md/);
    expect(calls.prompts[0].text).toMatch(/重述|重新解释|简化/);
  });

  it('picks the LAST assistant message even when the user spoke afterwards', async () => {
    const { calls, deps } = harness([
      msg('assistant', '第一条解释'),
      msg('user', '嗯'),
      msg('assistant', '第二条解释'),
      msg('user', 'wait what'),
    ]);
    const result = await runWaitwhat('s1', deps);
    expect(result.ok).toBe(true);
    expect(calls.prompts[0].text).toContain('第二条解释');
    expect(calls.prompts[0].text).not.toContain('第一条解释');
  });

  it('joins multiple text parts of the last assistant message', async () => {
    const { calls, deps } = harness([msg('assistant', 'part one', 'part two')]);
    await runWaitwhat('s1', deps);
    expect(calls.prompts[0].text).toContain('part one');
    expect(calls.prompts[0].text).toContain('part two');
  });

  it('returns an error and does not prompt when no assistant message exists', async () => {
    const { calls, deps } = harness([msg('user', 'hello')]);
    const result = await runWaitwhat('s1', deps);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(calls.prompts).toHaveLength(0);
  });

  it('ignores non-text parts (tool calls) when collecting the original text', async () => {
    const toolPart = { info: { role: 'assistant' }, parts: [{ type: 'tool', tool: 'bash' }, { type: 'text', text: '真正的解释' }] };
    const { calls, deps } = harness([toolPart]);
    const result = await runWaitwhat('s1', deps);
    expect(result.ok).toBe(true);
    expect(calls.prompts[0].text).toContain('真正的解释');
  });
});

describe('buildWaitwhatPrompt', () => {
  it('embeds the original text and the simplified-language + glossary instructions', () => {
    const p = buildWaitwhatPrompt('原文');
    expect(p).toContain('原文');
    expect(p).toMatch(/CONTEXT\.md/);
    expect(p).toMatch(/术语/);
    expect(p).toMatch(/不要新增内容|不引入新内容/);
  });
});
