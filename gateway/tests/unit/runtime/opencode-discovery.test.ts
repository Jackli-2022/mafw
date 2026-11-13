import { createOpencodeAdapter } from '../../../../adapters/opencode/src/adapter';

jest.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: jest.fn(() => ({})),
}));
jest.mock('../../../../adapters/opencode/src/serve-sidecar', () => ({
  serveAuthHeaders: () => ({ Authorization: 'Basic dGVzdA==' }),
}));

function json(body: any) {
  return { ok: true, status: 200, json: async () => body };
}

describe('opencode adapter discovery', () => {
  it('maps live sparse command/skill payload and strips skill content', async () => {
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.includes('/api/command')) return json({
        location: { directory: '/proj' },
        data: [{ name: 'init', description: 'guided setup' }],
      });
      return json({
        location: { directory: '/proj' },
        data: [{ id: 'mafw-plan', name: 'mafw-plan', path: '/proj/.opencode/skills/mafw-plan/SKILL.md', content: '# plan' }],
      });
    });

    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    const out = await rt.discovery!.list({ directory: '/proj' });

    expect(out.commands).toEqual([{ name: 'init', description: 'guided setup' }]);
    expect(out.skills).toEqual([{
      id: 'mafw-plan',
      name: 'mafw-plan',
      location: '/proj/.opencode/skills/mafw-plan/SKILL.md',
      slash: false,
      contentLength: 6,
    }]);
    expect(out.warnings).toEqual([]);
  });

  it('keeps commands when skills endpoint fails', async () => {
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.includes('/api/command')) return json({ data: [{ name: 'init' }] });
      throw new Error('skill endpoint down');
    });

    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    const out = await rt.discovery!.list({ directory: '/proj' });

    expect(out.commands).toEqual([{ name: 'init' }]);
    expect(out.skills).toEqual([]);
    expect(out.warnings[0]).toMatchObject({ source: 'skills' });
  });

  it('loadSkill returns content by id/name and null when absent', async () => {
    (global as any).fetch = jest.fn(async () => json({
      data: [{ id: 'mafw-plan', name: 'mafw-plan', path: '/p/SKILL.md', content: '# plan' }],
    }));

    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });

    expect((await rt.discovery!.loadSkill({ directory: '/proj', key: 'mafw-plan' }))?.content).toBe('# plan');
    expect(await rt.discovery!.loadSkill({ directory: '/proj', key: 'nope' })).toBeNull();
  });

  it('invokeSkill sends the native @skill prompt', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return json({});
    });

    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    await rt.discovery!.invokeSkill!({
      sessionID: 's1',
      directory: '/proj',
      key: 'superpowers',
      args: '帮我审一下',
    });

    const call = calls.find((c) => c.url.includes('/api/session/s1/prompt'));
    expect(call).toBeTruthy();
    expect(call!.url).toContain('directory=%2Fproj');
    expect(JSON.parse(call!.init.body)).toMatchObject({ text: '@superpowers 帮我审一下' });
  });

  it('invokeSkill without args sends the bare @skill', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return json({});
    });

    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    await rt.discovery!.invokeSkill!({
      sessionID: 's1',
      directory: '/proj',
      key: 'superpowers',
      args: '',
    });

    const call = calls.find((c) => c.url.includes('/api/session/s1/prompt'));
    expect(JSON.parse(call!.init.body)).toMatchObject({ text: '@superpowers' });
  });
});
