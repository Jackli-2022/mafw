import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../../src/plugins/package-host';
import { createPluginPackageContext } from '../../../src/plugins/package-context';

const EXAMPLES = path.join(__dirname, '..', '..', '..', '..', 'examples', 'plugins');

function makeHost(root: string): PluginHost {
  return new PluginHost(
    root,
    (pkg, bag) => createPluginPackageContext(pkg, { projectDir: '/p', gatewayPort: 3000, bag }),
  );
}

async function checkExample(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-example-'));
  const host = makeHost(root);
  try {
    return await host.checkPackage(path.join(EXAMPLES, name));
  } finally {
    host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('example packages', () => {
  it('hello-plugin passes the check', async () => {
    const result = await checkExample('hello-plugin');
    expect(result.ok).toBe(true);
    expect(result.contributions).toEqual(expect.arrayContaining(['actions', 'events']));
    // The minimal reference stays minimal: no tools/observers/http/ui.
    expect(result.contributions).toHaveLength(2);
  });

  it('kitchen-sink passes the check and covers all five gateway planes', async () => {
    const result = await checkExample('kitchen-sink');
    expect(result.ok).toBe(true);
    // `http` has no contribution kind of its own: it is declared statically in
    // plugin.json and verified end-to-end by the commit test below.
    expect(result.contributions).toEqual(
      expect.arrayContaining(['actions', 'events', 'tools', 'observers', 'ui']),
    );

    const manifest = JSON.parse(
      fs.readFileSync(path.join(EXAMPLES, 'kitchen-sink', 'plugin.json'), 'utf-8'),
    );
    expect(manifest.contributes.gateway).toMatchObject({
      actions: ['echo'],
      events: ['plugin:kitchen-sink:ping'],
      observers: ['audit'],
      http: true,
    });
  });

  it('kitchen-sink commits and registers every declared plane', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-example-commit-'));
    fs.cpSync(path.join(EXAMPLES, 'kitchen-sink'), path.join(root, 'kitchen-sink'), {
      recursive: true,
    });
    const host = makeHost(root);
    let tools: Array<{ name: string }> = [];
    let observers: Array<{ id: string }> = [];
    host.bindKernelV2((nextTools, nextObservers) => {
      tools = nextTools;
      observers = nextObservers;
    });
    try {
      await host.init();
      expect(host.getState().find((entry) => entry.name === 'kitchen-sink')).toMatchObject({
        status: 'ok',
      });
      expect(host.getActionRegistry().has('kitchen-sink', 'echo')).toBe(true);
      expect(host.getEventRegistry().has('kitchen-sink', 'plugin:kitchen-sink:ping')).toBe(true);
      expect(tools.map((tool) => tool.name)).toContain('lookup');
      expect(observers.map((observer) => observer.id)).toContain('audit');
      expect(host.getHttpRegistry().routes()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ package: 'kitchen-sink', method: 'GET', path: '/ping', ws: false }),
        ]),
      );
    } finally {
      host.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
