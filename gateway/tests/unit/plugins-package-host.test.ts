import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../src/plugins/package-host';
import { createPluginPackageContext } from '../../src/plugins/package-context';

function mkHost(dir: string) {
  return new PluginHost(dir, (name) => createPluginPackageContext(name, { projectDir: '/p', gatewayPort: 3000 }));
}

describe('PluginHost', () => {
  let dir: string;
  let host: PluginHost;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pkghost-')); });
  afterEach(() => { host?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('扫描单文件包并激活 usage 贡献', async () => {
    fs.writeFileSync(path.join(dir, 'acme.js'), `
module.exports = { name: 'acme', usage: { name: 'acme', type: 'api', plan: 'P', async fetch() { return null; } } };
`);
    host = mkHost(dir);
    const usage: any[] = [];
    host.bindUsage((entries) => { usage.length = 0; usage.push(...entries); });
    await host.init();
    expect(usage).toHaveLength(1);
    expect(usage[0].mod.name).toBe('acme');
    expect(host.getState()[0]).toMatchObject({ name: 'acme', status: 'ok', contributions: ['usage'] });
  });

  it('目录包读 plugin.json manifest（main 自定义）', async () => {
    const pkg = path.join(dir, 'big');
    fs.mkdirSync(pkg);
    fs.writeFileSync(path.join(pkg, 'plugin.json'), JSON.stringify({ name: 'big', version: '1.2.0', main: 'entry.js' }));
    fs.writeFileSync(path.join(pkg, 'entry.js'), `
module.exports = { name: 'big', runtime: { async createRuntime() { return { name: 'big', capabilities: {} }; } } };
`);
    host = mkHost(dir);
    const rt: any[] = [];
    host.bindRuntime((entries) => { rt.length = 0; rt.push(...entries); });
    await host.init();
    expect(rt).toHaveLength(1);
    expect(rt[0]).toMatchObject({ name: 'big', external: true });
    expect(host.getState()[0].version).toBe('1.2.0');
  });

  it('activate() 函数形式收到统一 ctx', async () => {
    fs.writeFileSync(path.join(dir, 'acme.js'), `
module.exports = { name: 'acme', async activate(ctx) {
  return { usage: { name: 'acme', type: 'api', plan: ctx.projectDir, async fetch() { return null; } } };
} };
`);
    host = mkHost(dir);
    const usage: any[] = [];
    host.bindUsage((e) => { usage.length = 0; usage.push(...e); });
    await host.init();
    expect(usage[0].mod.plan).toBe('/p');
  });

  it('media engine:"pi" + fixPayload 产出 prompt 函数', async () => {
    fs.writeFileSync(path.join(dir, 'vl.js'), `
module.exports = { name: 'vl', media: { modalities: ['image'], engine: 'pi', fixPayload: (p) => p } };
`);
    host = mkHost(dir);
    const media: any[] = [];
    host.bindMedia((e) => { media.length = 0; media.push(...e); });
    await host.init();
    expect(media).toHaveLength(1);
    expect(typeof media[0].prompt).toBe('function');
    expect(media[0].modalities).toEqual(['image']);
  });

  it('激活失败 fail-open：坏包记 error state，好包照常', async () => {
    fs.writeFileSync(path.join(dir, 'bad.js'), `throw new Error('boom');`);
    fs.writeFileSync(path.join(dir, 'good.js'), `
module.exports = { name: 'good', usage: { name: 'good', type: 'api', plan: 'P', async fetch() { return null; } } };
`);
    host = mkHost(dir);
    await host.init();
    const states = host.getState();
    expect(states.find((s) => s.name === 'bad')).toMatchObject({ status: 'error', error: 'boom' });
    expect(states.find((s) => s.name === 'good')).toMatchObject({ status: 'ok' });
  });

  it('name 与包名不一致报错', async () => {
    fs.writeFileSync(path.join(dir, 'acme.js'), `module.exports = { name: 'other', usage: {} };`);
    host = mkHost(dir);
    await host.init();
    expect(host.getState()[0].status).toBe('error');
    expect(host.getState()[0].error).toMatch(/name mismatch/);
  });

  it('无贡献字段报错', async () => {
    fs.writeFileSync(path.join(dir, 'empty.js'), `module.exports = { name: 'empty' };`);
    host = mkHost(dir);
    await host.init();
    expect(host.getState()[0].error).toMatch(/no contributions/);
  });

  it('uiTools 值非对象 → 字段级报错', async () => {
    fs.writeFileSync(path.join(dir, 'badui.js'), `
module.exports = { name: 'badui', uiTools: { bash: 'not-an-object' } };
`);
    host = mkHost(dir);
    await host.init();
    const st = host.getState().find((s) => s.name === 'badui');
    expect(st?.status).toBe('error');
    expect(st?.error).toMatch(/uiTools\.bash/);
  });

  it('uiTools 合法（对象值 + 可选 render 函数）→ 贡献登记', async () => {
    fs.writeFileSync(path.join(dir, 'ui.js'), `
module.exports = { name: 'ui', uiTools: { bash: { override: false, render: () => ({}) } } };
`);
    host = mkHost(dir);
    await host.init();
    expect(host.getState().find((s) => s.name === 'ui')).toMatchObject({ status: 'ok', contributions: ['uiTools'] });
  });

  it('bind 晚于 init 时回放当前条目', async () => {
    fs.writeFileSync(path.join(dir, 'acme.js'), `
module.exports = { name: 'acme', usage: { name: 'acme', type: 'api', plan: 'P', async fetch() { return null; } } };
`);
    host = mkHost(dir);
    await host.init();
    const usage: any[] = [];
    host.bindUsage((e) => { usage.length = 0; usage.push(...e); });
    expect(usage).toHaveLength(1);
  });

  // 注：不断言重读后的模块内容——jest 环境的 require.cache 删除不驱逐
  // （生产 Node 正常，纯 node 探针已证）。这里只验证 watch→debounce→reload 管道。
  it('修改包文件触发热重载（watch→debounce→reload 管道）', async () => {
    const file = path.join(dir, 'acme.js');
    fs.writeFileSync(file, `
module.exports = { name: 'acme', usage: { name: 'acme', type: 'api', plan: 'v1', async fetch() { return null; } } };
`);
    host = mkHost(dir);
    await host.init();
    const realReload = host.reload.bind(host);
    const reloadSpy = jest.fn(() => realReload());
    (host as any).reload = reloadSpy;
    fs.writeFileSync(file, `
module.exports = { name: 'acme', usage: { name: 'acme', type: 'api', plan: 'v2', async fetch() { return null; } } };
`);
    await new Promise((resolve) => setTimeout(resolve, 800)); // debounce 300ms + margin
    expect(reloadSpy).toHaveBeenCalled();
  }, 10000);

  it('目录包主文件变更触发重载（子目录 watcher）', async () => {
    const pkg = path.join(dir, 'big');
    fs.mkdirSync(pkg);
    fs.writeFileSync(path.join(pkg, 'index.js'), `
module.exports = { name: 'big', usage: { name: 'big', type: 'api', plan: 'v1', async fetch() { return null; } } };
`);
    host = mkHost(dir);
    await host.init();
    const realReload = host.reload.bind(host);
    const reloadSpy = jest.fn(() => realReload());
    (host as any).reload = reloadSpy;
    fs.writeFileSync(path.join(pkg, 'index.js'), `
module.exports = { name: 'big', usage: { name: 'big', type: 'api', plan: 'v2', async fetch() { return null; } } };
`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(reloadSpy).toHaveBeenCalled();
  }, 10000);
});
