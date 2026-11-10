import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defineRuntime,
  type RuntimeDefinitionInput,
  type RuntimeHostSurface,
  type RuntimeProviderTransport,
} from './define-runtime.ts';
import type { RuntimeFactoryContext, SendTurnInput, RuntimeTransport } from './transport.ts';
import type {
  RuntimeMcpConfigChannel,
  RuntimeMcpConfigPreview,
  RuntimeMcpConfigResult,
  RuntimeMcpServerConfigInput,
  RuntimePtyChannel,
  RuntimePtyConnection,
  RuntimePtyCreateOpts,
  RuntimePtyInfo,
} from './channels.ts';

const transport: RuntimeTransport = {
  createSession: async () => ({ sessionID: 's1' }),
  sendTurn: async (input) => ({ turnID: input.turnID }),
  interruptTurn: async () => {},
  onEvent: () => () => {},
};

test('definition accepts an external flag', () => {
  const def = defineRuntime({
    api: 1, name: 'x', displayName: 'X', preset: 'core', transport, external: false,
  });
  assert.equal(def.external, false);
});

test('session channel exposes the production parity methods', () => {
  const def = defineRuntime({
    api: 1, name: 'x', displayName: 'X', preset: 'core', transport,
    channels: {
      session: {
        todo: async () => [],
        children: async () => [],
        summarize: async () => ({}),
        switchAgent: async () => {},
        switchModel: async () => {},
        setThinkingLevel: async () => {},
        permissionList: async () => [],
        background: async () => {},
      },
    },
  });
  for (const key of [
    'todo', 'children', 'summarize', 'switchAgent',
    'switchModel', 'setThinkingLevel', 'permissionList', 'background',
  ] as const) {
    assert.equal(typeof def.channels!.session![key], 'function', key);
  }
});

test('sendTurn accepts a delivery hint', () => {
  const input: SendTurnInput = { sessionID: 's1', turnID: 't1', text: 'hi', delivery: 'steer' };
  assert.equal(input.delivery, 'steer');
});

test('factory context can carry policy hooks', () => {
  const input: RuntimeDefinitionInput = {
    api: 1, name: 'x', displayName: 'X', preset: 'core', transport,
  };
  assert.equal(input.channels, undefined);
});

test('factory context accepts the serve host/port seam', () => {
  const ctx: RuntimeFactoryContext = {
    pluginConfig: () => ({}),
    serve: { host: '127.0.0.1', port: 4096 },
  };
  assert.deepEqual(ctx.serve, { host: '127.0.0.1', port: 4096 });

  // Absent serve = the adapter keeps its own default (127.0.0.1:4096).
  const withoutServe: RuntimeFactoryContext = { pluginConfig: () => ({}) };
  assert.equal(withoutServe.serve, undefined);
});

test('host surface exposes proxy auth headers and provider transport resolution', async () => {
  const host: RuntimeHostSurface = {
    proxyHeaders: () => ({ Authorization: 'Basic c2VydmU6cGFzcw==' }),
    resolveProviderTransport: async (providerID): Promise<RuntimeProviderTransport> => ({
      baseUrl: `https://${providerID}.example/v1`,
      apiKey: 'sk-host',
    }),
  };
  assert.deepEqual(host.proxyHeaders?.(), { Authorization: 'Basic c2VydmU6cGFzcw==' });
  assert.deepEqual(await host.resolveProviderTransport?.('qwen'), {
    baseUrl: 'https://qwen.example/v1',
    apiKey: 'sk-host',
  });
});

test('MCP config/preview DTOs are typed end to end', async () => {
  const input: RuntimeMcpServerConfigInput = {
    name: 'docs',
    type: 'remote',
    url: 'https://docs.example/mcp',
  };
  const preview: RuntimeMcpConfigPreview = {
    token: 'sha256:abc',
    target: '/home/u/.config/mcp.json',
    diff: '+ "docs"',
    preserved: ['theme'],
    warnings: ['masked'],
  };
  const result: RuntimeMcpConfigResult = {
    applied: true,
    runtimeApplied: false,
    backup: 'mcp.json.bak',
  };
  const channel: RuntimeMcpConfigChannel = {
    preview: async (i) => ({ ...preview, diff: `${i.name}: ${preview.diff}` }),
    previewRemove: async () => preview,
    apply: async () => result,
    remove: async () => result,
    restore: async () => result,
  };

  assert.equal((await channel.preview(input)).diff, 'docs: + "docs"');
  assert.equal((await channel.apply({ ...input, token: preview.token, confirm: true })).applied, true);
  assert.equal((await channel.remove(input.name, { token: preview.token, confirm: true })).runtimeApplied, false);
  assert.equal(
    (await channel.restore({ token: preview.token, confirm: true, backupPath: result.backup })).backup,
    'mcp.json.bak',
  );
});

test('PTY metadata keeps cwd/command/status and connection auth headers', async () => {
  const rows: RuntimePtyInfo[] = [
    { id: 'pty-1', title: 'shell', command: 'pwsh', cwd: '/proj', status: 'running' },
  ];
  const connection: RuntimePtyConnection = {
    url: 'ws://127.0.0.1:4096/api/pty/pty-1/connect',
    headers: { Authorization: 'Basic c2VydmU6cGFzcw==' },
    protocol: 'mafw-terminal/1',
    ticket: 't-1',
    cursor: 3,
  };
  const channel: RuntimePtyChannel = {
    create: async (opts: RuntimePtyCreateOpts) => ({ id: opts.directory === '/proj' ? 'pty-1' : 'other' }),
    connect: async () => connection,
    resize: async () => {},
    remove: async () => {},
    list: async () => rows,
  };

  assert.equal(
    (await channel.create({ directory: '/proj', cwd: '/proj', cols: 120, rows: 30 })).id,
    'pty-1',
  );
  assert.deepEqual(await channel.list?.(), rows);
  assert.deepEqual(await channel.connect({ id: 'pty-1' }), connection);
});
