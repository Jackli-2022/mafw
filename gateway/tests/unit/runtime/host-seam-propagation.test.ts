/**
 * Task 3 — host-seam propagation.
 *
 * The gateway hands a runtime plugin a `RuntimePluginContext`; the values in it
 * (project dir, runtime root, gateway port, serve endpoint, policy hooks) are the
 * only way an out-of-process driver learns where the host lives. Dropping one in
 * the composition root silently degrades a driver instead of failing anywhere,
 * so the seam is pinned twice: behaviour of the factory, and the exact call site
 * in `gateway/src/index.ts`.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { RuntimeCredentials } from '../../../src/runtime/contract';
import { createRuntimePluginContext } from '../../../src/runtime/loader';

const SOURCE = path.resolve(__dirname, '..', '..', '..', 'src', 'index.ts');

it('passes every host seam through the plugin context and keeps the credentials object', () => {
  const credentials = { media: { baseUrl: 'http://127.0.0.1:1' } } as unknown as RuntimeCredentials;
  const policy = { approval: () => 'allow' } as any;

  const ctx = createRuntimePluginContext(credentials, {
    projectDir: '/repo/project',
    rootDir: '/home/user/.mafw',
    gatewayPort: 3000,
    serve: { host: '127.0.0.1', port: 4096 },
    policy,
  });

  expect(ctx.credentials).toBe(credentials);
  expect(ctx.projectDir).toBe('/repo/project');
  expect(ctx.rootDir).toBe('/home/user/.mafw');
  expect(ctx.gatewayPort).toBe(3000);
  expect(ctx.serve).toEqual({ host: '127.0.0.1', port: 4096 });
  expect(ctx.policy).toBe(policy);
  // The always-present surface must not be displaced by the extra seams.
  expect(typeof ctx.fetch).toBe('function');
  expect(typeof ctx.pluginConfig).toBe('function');
  expect(typeof ctx.events.make).toBe('function');
});

it('leaves host seams undefined when the caller supplies none', () => {
  const ctx = createRuntimePluginContext(undefined, {});
  expect(ctx.credentials).toBeUndefined();
  expect(ctx.projectDir).toBeUndefined();
  expect(ctx.rootDir).toBeUndefined();
  expect(ctx.gatewayPort).toBeUndefined();
  expect(ctx.serve).toBeUndefined();
  expect(ctx.policy).toBeUndefined();
});

it('activatePluginRuntime forwards all five seams to createRuntimePluginContext', () => {
  // Narrow source guard on purpose: it reads exactly the `createRuntimePluginContext`
  // call inside `activatePluginRuntime`, not the whole file. A general text lint
  // would pass on a mention anywhere (docs, another call site) and would also
  // break on unrelated refactors; this fails only when the activation seam itself
  // drops a field.
  const source = fs.readFileSync(SOURCE, 'utf8');
  const methodStart = source.indexOf('private async activatePluginRuntime');
  expect(methodStart).toBeGreaterThan(-1);

  const callStart = source.indexOf('createRuntimePluginContext(', methodStart);
  expect(callStart).toBeGreaterThan(-1);
  const callEnd = source.indexOf('});', callStart);
  expect(callEnd).toBeGreaterThan(callStart);
  const call = source.slice(callStart, callEnd);

  for (const seam of ['projectDir', 'rootDir', 'gatewayPort', 'serve', 'policy']) {
    expect(call).toMatch(new RegExp(`\\b${seam}\\s*:`));
  }
});
