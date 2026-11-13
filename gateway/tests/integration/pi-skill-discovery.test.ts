import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createPiRuntime } from '../fixtures/pi-test-runtime';

function makeCtx() {
  return { fetch, log: console, pluginConfig: () => ({ provider: 'xiaomi', model: 'mimo-v2.5' }) } as any;
}

function fakePi(skillFile: string, prompts: string[]) {
  return {
    ModelRuntime: {
      create: async () => ({
        getModel: (p: string, m: string) => ({ id: `${p}/${m}`, baseUrl: 'http://fake' }),
        getProviders: () => [],
        getModels: () => [],
        hasConfiguredAuth: () => true,
        setRuntimeApiKey: async () => {},
      }),
    },
    createAgentSession: async () => ({
      session: {
        prompt: async (text: string) => { prompts.push(text); },
        waitForIdle: async () => {},
        abort: async () => {},
        dispose: async () => {},
        compact: async () => ({}),
        subscribe: () => () => {},
        isStreaming: false,
        messages: [],
      },
    }),
    loadSkills: () => ({
      skills: [{ name: 'superpowers', description: 'skill', filePath: skillFile }],
      diagnostics: [],
    }),
  };
}

describe('pi skill discovery', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-skill-'));
  const skillFile = path.join(dir, 'SKILL.md');
  fs.writeFileSync(skillFile, '# superpowers\n');

  it('lists, loads and invokes a skill with the native /skill: command', async () => {
    const prompts: string[] = [];
    const rt = await createPiRuntime(makeCtx(), { loadPi: async () => fakePi(skillFile, prompts) });

    const listed = await rt.discovery!.list({ directory: dir });
    expect(listed.skills).toEqual([{
      id: 'superpowers',
      name: 'superpowers',
      description: 'skill',
      location: skillFile,
      contentLength: fs.statSync(skillFile).size,
    }]);

    const loaded = await rt.discovery!.loadSkill({ directory: dir, key: 'superpowers' });
    expect(loaded?.content).toBe('# superpowers\n');

    const { id } = await rt.session.create({ directory: dir });
    await rt.discovery!.invokeSkill!({
      sessionID: id,
      directory: dir,
      key: 'superpowers',
      args: '帮我审一下',
    });
    expect(prompts).toEqual(['/skill:superpowers 帮我审一下']);

    await (rt as any).dispose();
  });
});
