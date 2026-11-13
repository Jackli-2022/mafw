import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { createNeutralRuntime } from '../../../src/runtime/neutral-runtime';
import type { RuntimePluginContext } from '../../../src/runtime/loader';
import { createClaudeDefinition } from '../../../../adapters/claude/src/index';

function ctx(): RuntimePluginContext {
  return {
    fetch: async () => new Response(''),
    log: { info() {}, warn() {}, error() {}, debug() {} } as any,
    pluginConfig: () => ({}),
    credentials: { getApiKey: () => null },
    gatewayPort: 3000,
    projectDir: process.cwd(),
    rootDir: process.cwd(),
  };
}

function fakeSdk(prompts: string[]) {
  return {
    async query(args: any) {
      prompts.push(String(args?.prompt ?? ''));
      const stream: any = (async function* () {})();
      stream.interrupt = () => {};
      return stream;
    },
    async listSessions() { return []; },
    async getSessionMessages() { return []; },
  };
}

describe('claude skill discovery', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-skill-'));
  const skillDir = path.join(dir, '.claude', 'skills', 'superpowers');
  fs.mkdirSync(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(skillFile, '---\ndescription: test skill\n---\n# body\n');

  it('lists, loads and invokes a skill with the native /name command', async () => {
    const prompts: string[] = [];
    const definition = await createClaudeDefinition(ctx(), { sdk: fakeSdk(prompts) as any });
    const bus = new RuntimeBus();
    bus.register(definition);
    const rt = createNeutralRuntime(definition, { bus });

    const listed = await rt.discovery!.list({ directory: dir });
    expect(listed.skills).toEqual([{
      id: 'superpowers',
      name: 'superpowers',
      description: 'test skill',
      slash: true,
      location: skillFile,
      contentLength: fs.statSync(skillFile).size,
    }]);

    const loaded = await rt.discovery!.loadSkill({ directory: dir, key: 'superpowers' });
    expect(loaded?.content).toBe('---\ndescription: test skill\n---\n# body\n');

    const { sessionID } = await rt.session.create({ directory: dir });
    await rt.discovery!.invokeSkill!({
      sessionID,
      directory: dir,
      key: 'superpowers',
      args: '帮我审一下',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(prompts).toEqual(['/superpowers 帮我审一下']);
  });
});
