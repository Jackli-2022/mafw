import {
  handleCreateSource,
  handleDeleteSubscription,
  handleListSources,
  handlePatchSource,
  handleWebhook,
} from '../../../src/routes/events';

function deps(over: Record<string, any> = {}) {
  return {
    enabled: () => true,
    sources: {
      list: jest.fn(() => [{
        id: 's1', projectDir: '/p', kind: 'github', name: 'repo',
        config: { token: 'secret' }, enabled: true, cursor: {},
        createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
      }]),
      create: jest.fn((input: any) => ({
        id: 's1',
        projectDir: input.projectDir,
        kind: input.kind,
        name: input.name,
        config: input.config,
        enabled: true,
        cursor: {},
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
      })),
      setEnabled: jest.fn(() => true),
    },
    threads: {
      list: jest.fn(() => []),
      triggers: jest.fn(() => []),
      subscriptions: jest.fn(() => []),
    },
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    deliveries: jest.fn(() => []),
    webhook: jest.fn(async () => ({ accepted: false, status: 401 })),
    ...over,
  } as any;
}

describe('event routes', () => {
  test('returns 503 when the event layer is off', () => {
    expect(handleListSources({ projectDir: '/p' }, deps({ enabled: () => false })).status).toBe(503);
  });

  test('creates a source and rejects an unknown kind', () => {
    expect(handleCreateSource({ kind: 'nope' }, deps()).status).toBe(400);
    expect(handleCreateSource({
      kind: 'github',
      projectDir: '/p',
      name: 'repo',
      config: { repo: 'acme/app', token: 'secret' },
    }, deps()).status).toBe(200);
  });

  test('never returns source config secrets', () => {
    const list = handleListSources({ projectDir: '/p' }, deps());
    expect((list.body.items[0] as any).config).toBeUndefined();
    const created = handleCreateSource({ kind: 'github', projectDir: '/p', name: 'r', config: { token: 'x' } }, deps());
    expect((created.body as any).config).toBeUndefined();
  });

  test('unknown source/subscription ids return 404', () => {
    const d = deps();
    d.sources.setEnabled = jest.fn(() => false);
    expect(handlePatchSource({ id: 'missing', enabled: true }, d).status).toBe(404);
    d.unsubscribe = jest.fn(() => false);
    expect(handleDeleteSubscription({ id: 'missing' }, d).status).toBe(404);
  });

  test('webhook verifies the HMAC signature', async () => {
    const out = await handleWebhook(
      { id: 's1' },
      { 'x-hub-signature-256': 'bad' },
      {},
      deps(),
    );
    expect(out.status).toBe(401);
  });
});
