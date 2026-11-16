import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../src/plugins/package-host';
import { createPluginPackageContext } from '../../src/plugins/package-context';
import { createRegistrationBag } from '../../src/plugins/registration-bag';
import { createKernelV2Live } from '../../src/runtime/v2-live';

const TOOLFUL = `
module.exports = { name: 'toolful', async activate() {
  return {
    tools: [{
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object' },
      handler: async (input) => ({ text: 'echo:' + String(input?.text ?? '') }),
    }],
    observers: [{
      id: 'watch',
      filter: { types: ['part.updated'] },
      onEvent(event) {
        const g = globalThis;
        g.__mafwObserverHits = (g.__mafwObserverHits || 0) + 1;
        g.__mafwObserverType = event.type;
      },
    }],
  };
} };
`;

test('package tools and observers auto-register into the live bridge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-plugin-kernel-v2-'));
  const file = path.join(dir, 'toolful.js');
  fs.writeFileSync(file, TOOLFUL);
  delete (globalThis as any).__mafwObserverHits;
  delete (globalThis as any).__mafwObserverType;

  const live = createKernelV2Live({ env: {} })!;
  const host = new PluginHost(
    dir,
    (name, bag) =>
      createPluginPackageContext(name, {
        projectDir: '/p',
        gatewayPort: 3000,
        bag,
      }),
    { createBag: createRegistrationBag },
  );
  host.bindKernelV2((tools, observers) => live.syncPluginContributions(tools, observers));

  try {
    await host.init();
    const registration = live
      .toolFactory()!('s1')
      .find((item) => item.name === 'plugin:toolful:echo');
    expect(registration).toBeDefined();
    await expect(registration!.execute({ text: 'hi' })).resolves.toEqual({
      text: 'echo:hi',
    });

    live.observe({ type: 'part.updated', sessionID: 's1' });
    await live.drain();
    expect((globalThis as any).__mafwObserverHits).toBe(1);
    expect((globalThis as any).__mafwObserverType).toBe('part.updated');

    fs.unlinkSync(file);
    await host.reload();
    expect(live.toolFactory()!('s1')).toEqual([]);
  } finally {
    host.stop();
    await live.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
