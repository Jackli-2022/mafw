import { createPiRuntime } from '../../src/runtime/plugins/pi-runtime';
import { translatePiEvent } from '../../src/runtime/pi/pi-events';
import { normalizeOpencodeEvent } from '../../src/runtime/normalize';
import { ApprovalBridge } from '../../src/runtime/pi/pi-approval-bridge';

jest.mock('../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/config', () => ({
  config: { raw: { paths: { projectDir: '/tmp/proj' } }, server: { apiPort: 3000 } },
}));
jest.mock('../../src/runtime/auth', () => ({
  DEFAULT_AUTH_PATH: () => '/tmp/nonexistent-auth.json',
  readOpencodeAuth: () => ({}),
}));

const fakePi = {
  ModelRuntime: {
    create: async () => ({
      getModel: (p: string, m: string) => ({ id: `${p}/${m}`, baseUrl: 'http://fake' }),
      getProviders: () => [{ id: 'xiaomi', name: 'Xiaomi' }],
      getModels: () => [{ id: 'mimo-v2.5' }],
      hasConfiguredAuth: () => true,
      setRuntimeApiKey: async () => {},
    }),
  },
  createAgentSession: async ({ cwd }: any) => {
    const session: any = {
      prompt: async () => {},
      waitForIdle: async () => {},
      abort: async () => {},
      dispose: async () => {},
      compact: async () => ({}),
      subscribe: () => () => {},
      isStreaming: false,
      messages: [],
    };
    return { session };
  },
};

function makeCtx() {
  return { fetch, log: console, pluginConfig: () => ({ provider: 'xiaomi', model: 'mimo-v2.5' }) } as any;
}

describe('pi nativeApprovals integration', () => {
  it('should emit permission.asked event and handle approval via bridge', async () => {
    const rt = await createPiRuntime(makeCtx(), { loadPi: async () => fakePi });
    const { id: sessionID } = await rt.session.create({ directory: '/tmp/proj' });

    const bridge: ApprovalBridge = (rt as any).registry['approvalBridges'].get(sessionID);
    expect(bridge).toBeDefined();

    const requestId = 'test-req-1';
    const promise = bridge.request(requestId);

    const result = await rt.session.permissionReply(sessionID, requestId, true);
    expect(result).toBe(true);

    const approved = await promise;
    expect(approved).toBe(true);

    await (rt as any).dispose();
  });

  it('should handle rejection via bridge', async () => {
    const rt = await createPiRuntime(makeCtx(), { loadPi: async () => fakePi });
    const { id: sessionID } = await rt.session.create({ directory: '/tmp/proj' });

    const bridge: ApprovalBridge = (rt as any).registry['approvalBridges'].get(sessionID);
    const requestId = 'test-req-2';

    const promise = bridge.request(requestId);
    await rt.session.permissionReply(sessionID, requestId, false);

    const approved = await promise;
    expect(approved).toBe(false);

    await (rt as any).dispose();
  });

  it('should translate permission.asked through translatePiEvent and normalizeOpencodeEvent', () => {
    const rawEvent = {
      payload: {
        type: 'permission.asked',
        properties: {
          sessionID: 'pi_test',
          requestId: 'req-100',
          toolName: 'bash',
          args: { command: 'ls -la' },
          risk: 'medium',
        },
      },
    };

    const translated = translatePiEvent(rawEvent, 'pi_test');
    expect(translated).not.toBeNull();
    expect(translated!.payload!.type).toBe('permission.asked');
    expect(translated!.payload!.properties.toolName).toBe('bash');

    const facets = normalizeOpencodeEvent(translated!);
    expect(facets.type).toBe('permission.asked');
    expect(facets.sessionID).toBe('pi_test');
    expect(facets.properties.requestId).toBe('req-100');
    expect(facets.broadcast).toBe('passthrough');
    expect(facets.step).toBeNull();
  });

  it('should translate permission.replied through the event pipeline', () => {
    const rawEvent = {
      payload: {
        type: 'permission.replied',
        properties: {
          sessionID: 'pi_test',
          requestId: 'req-100',
          approved: true,
        },
      },
    };

    const translated = translatePiEvent(rawEvent, 'pi_test');
    expect(translated).not.toBeNull();
    expect(translated!.payload!.type).toBe('permission.replied');

    const facets = normalizeOpencodeEvent(translated!);
    expect(facets.type).toBe('permission.replied');
    expect(facets.properties.approved).toBe(true);
    expect(facets.broadcast).toBe('passthrough');
  });

  it('should return false when permissionReply is called for unknown session', async () => {
    const rt = await createPiRuntime(makeCtx(), { loadPi: async () => fakePi });
    const result = await rt.session.permissionReply('nonexistent', 'req-x', true);
    expect(result).toBe(false);
    await (rt as any).dispose();
  });

  it('should route emitEvent through eventStream.push to subscribers', async () => {
    const rt = await createPiRuntime(makeCtx(), { loadPi: async () => fakePi });
    const { id: sessionID } = await rt.session.create({ directory: '/tmp/proj' });

    const { stream } = await rt.global!.event();
    const iter = stream[Symbol.asyncIterator]();

    const registry = (rt as any).registry;
    const emitEvent = registry['emitEvent'];

    const rawEvent = {
      payload: {
        type: 'permission.asked',
        properties: {
          sessionID,
          requestId: 'req-push-1',
          toolName: 'bash',
          args: { command: 'rm -rf /' },
          risk: 'high',
        },
      },
    };

    const nextPromise = iter.next();
    emitEvent(rawEvent);

    const result = await nextPromise;
    expect(result.done).toBe(false);
    expect(result.value.payload.type).toBe('permission.asked');
    expect(result.value.payload.properties.requestId).toBe('req-push-1');
    expect(result.value.payload.properties.toolName).toBe('bash');

    await iter.return!();
    await (rt as any).dispose();
  });

  it('should clean up bridge on session delete', async () => {
    const rt = await createPiRuntime(makeCtx(), { loadPi: async () => fakePi });
    const { id: sessionID } = await rt.session.create({ directory: '/tmp/proj' });

    const bridge: ApprovalBridge = (rt as any).registry['approvalBridges'].get(sessionID);
    expect(bridge).toBeDefined();

    await rt.session.delete({ sessionID });

    const bridgeAfter: ApprovalBridge | undefined = (rt as any).registry['approvalBridges'].get(sessionID);
    expect(bridgeAfter).toBeUndefined();

    await (rt as any).dispose();
  });
});
