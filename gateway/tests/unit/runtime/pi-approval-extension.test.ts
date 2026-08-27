import { createMafwApprovalExtension } from '../../../src/runtime/pi/pi-approval-extension';
import { ApprovalBridge } from '../../../src/runtime/pi/pi-approval-bridge';
import type { RawRuntimeEvent } from '../../../src/runtime/normalize';

describe('MafwApprovalExtension', () => {
  let bridge: ApprovalBridge;
  let emittedEvents: RawRuntimeEvent[];
  let extension: ReturnType<typeof createMafwApprovalExtension>;
  let mockEmitter: { on: jest.Mock };
  let toolCallHandler: (event: any, ctx: any) => Promise<any>;

  beforeEach(() => {
    bridge = new ApprovalBridge();
    emittedEvents = [];
    extension = createMafwApprovalExtension(
      bridge,
      (event) => emittedEvents.push(event),
    );
    mockEmitter = { on: jest.fn() };
    extension.on(mockEmitter);
    const call = mockEmitter.on.mock.calls.find((c: any) => c[0] === 'tool_call');
    toolCallHandler = call![1];
  });

  afterEach(() => {
    bridge.dispose();
  });

  it('should auto-approve read-only tools', async () => {
    const event = { toolName: 'read', input: { path: '/tmp/file' } };
    const ctx = { sessionId: 'session-1' };

    const result = await toolCallHandler(event, ctx);

    expect(result).toBeUndefined();
    expect(emittedEvents).toHaveLength(0);
  });

  it('should auto-deny tools in autoDeny list', async () => {
    const customExtension = createMafwApprovalExtension(
      bridge,
      (event) => emittedEvents.push(event),
      { autoApprove: [], autoDeny: ['bash'] },
    );
    const customEmitter = { on: jest.fn() };
    customExtension.on(customEmitter);
    const handler = customEmitter.on.mock.calls.find((c: any) => c[0] === 'tool_call')![1];

    const event = { toolName: 'bash', input: { command: 'rm -rf /' } };
    const ctx = { sessionId: 'session-1' };

    const result = await handler(event, ctx);

    expect(result).toEqual({ block: true, reason: 'auto-denied by policy' });
  });

  it('should emit permission.asked event and wait for approval', async () => {
    const event = { toolName: 'bash', input: { command: 'ls' } };
    const ctx = { sessionId: 'session-1' };

    const promise = toolCallHandler(event, ctx);

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

    const promise = toolCallHandler(event, ctx);
    const requestId = emittedEvents[0].payload!.properties.requestId;
    bridge.reply(requestId, false);

    const result = await promise;
    expect(result).toEqual({ block: true, reason: 'rejected by user' });
  });
});
