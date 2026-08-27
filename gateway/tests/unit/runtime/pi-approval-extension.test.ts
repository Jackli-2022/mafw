import { createMafwApprovalExtension } from '../../../src/runtime/pi/pi-approval-extension';
import { ApprovalBridge } from '../../../src/runtime/pi/pi-approval-bridge';
import type { RawRuntimeEvent } from '../../../src/runtime/normalize';

describe('MafwApprovalExtension', () => {
  let bridge: ApprovalBridge;
  let emittedEvents: RawRuntimeEvent[];
  let extension: any;
  let handler: (event: any, ctx: any) => Promise<any>;

  function extractHandler(ext: any) {
    const mockOn = jest.fn();
    ext.on({ on: mockOn });
    return mockOn.mock.calls.find((c: any) => c[0] === 'tool_call')![1];
  }

  beforeEach(() => {
    bridge = new ApprovalBridge();
    emittedEvents = [];
    extension = createMafwApprovalExtension(
      bridge,
      (event) => emittedEvents.push(event),
    );
    handler = extractHandler(extension);
  });

  afterEach(() => {
    bridge.dispose();
  });

  it('should auto-approve read-only tools', async () => {
    const event = { toolName: 'read', input: { path: '/tmp/file' } };
    const ctx = { sessionId: 'session-1' };

    const result = await handler(event, ctx);

    expect(result).toBeUndefined();
    expect(emittedEvents).toHaveLength(0);
  });

  it('should auto-deny tools in autoDeny list', async () => {
    extension = createMafwApprovalExtension(
      bridge,
      (event) => emittedEvents.push(event),
      { autoApprove: [], autoDeny: ['bash'] },
    );
    handler = extractHandler(extension);
    const event = { toolName: 'bash', input: { command: 'rm -rf /' } };
    const ctx = { sessionId: 'session-1' };

    const result = await handler(event, ctx);

    expect(result).toEqual({ block: true, reason: 'auto-denied by policy' });
  });

  it('should emit permission.asked event and wait for approval', async () => {
    const event = { toolName: 'bash', input: { command: 'ls' } };
    const ctx = { sessionId: 'session-1' };

    const promise = handler(event, ctx);

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].payload!.type).toBe('permission.asked');
    expect(emittedEvents[0].payload!.properties.toolName).toBe('bash');

    const requestId = emittedEvents[0].payload!.properties.requestId;
    bridge.reply(requestId, true);

    const result = await promise;
    expect(result).toBeUndefined();

    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[1].payload!.type).toBe('permission.replied');
    expect(emittedEvents[1].payload!.properties.approved).toBe(true);
  });

  it('should block tool when user rejects', async () => {
    const event = { toolName: 'write', input: { path: '/tmp/file', content: 'data' } };
    const ctx = { sessionId: 'session-1' };

    const promise = handler(event, ctx);
    const requestId = emittedEvents[0].payload!.properties.requestId;
    bridge.reply(requestId, false);

    const result = await promise;
    expect(result).toEqual({ block: true, reason: 'rejected by user' });
  });
});
