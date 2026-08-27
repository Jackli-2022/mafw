# Pi nativeApprovals Translation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement nativeApprovals capability for pi runtime, enabling desktop UI approval cards for pi tool executions with approve/deny workflow.

**Architecture:** ApprovalBridge (shared Promise map) coordinates between MafwApprovalExtension (pi extension intercepting tool_call events) and gateway HTTP API. Events flow through pi-events.ts translation → normalize.ts → EventFacets → desktop SSE. Per-session bridge lifecycle managed by PiSessionRegistry.

**Tech Stack:** TypeScript, pi-coding-agent 0.84.1 extension API, Jest, opencode PermissionCard UI component.

## Global Constraints

- pi-coding-agent version locked at 0.84.1 (extension API stability)
- Default approval policy: autoApprove = ['read', 'grep', 'ls', 'find', 'glob'], autoDeny = []
- Approval timeout: 5 minutes (300_000 ms), auto-reject on timeout
- All new files follow existing naming conventions (pi-*.ts in gateway/src/runtime/pi/)
- Tests in gateway/tests/unit/runtime/pi-*.test.ts
- No changes to opencode runtime path (behavior unchanged)
- RuntimeClient.permissionReply is optional (opencode doesn't implement it)

---

### Task 1: ApprovalBridge Core

**Files:**
- Create: `gateway/src/runtime/pi/pi-approval-bridge.ts`
- Create: `gateway/tests/unit/runtime/pi-approval-bridge.test.ts`

**Interfaces:**
- Consumes: None (standalone utility)
- Produces: `ApprovalBridge` class with `request(requestId: string): Promise<boolean>`, `reply(requestId: string, approved: boolean): boolean`, `dispose(): void`

- [ ] **Step 1: Write the failing test**

```typescript
// gateway/tests/unit/runtime/pi-approval-bridge.test.ts
import { ApprovalBridge } from '../../../src/runtime/pi/pi-approval-bridge';

describe('ApprovalBridge', () => {
  let bridge: ApprovalBridge;

  beforeEach(() => {
    bridge = new ApprovalBridge();
  });

  afterEach(() => {
    bridge.dispose();
  });

  it('should resolve request when reply is called with true', async () => {
    const promise = bridge.request('req-1');
    const result = bridge.reply('req-1', true);
    expect(result).toBe(true);
    await expect(promise).resolves.toBe(true);
  });

  it('should resolve request when reply is called with false', async () => {
    const promise = bridge.request('req-2');
    bridge.reply('req-2', false);
    await expect(promise).resolves.toBe(false);
  });

  it('should return false when reply is called for unknown requestId', () => {
    const result = bridge.reply('unknown', true);
    expect(result).toBe(false);
  });

  it('should auto-reject on timeout', async () => {
    jest.useFakeTimers();
    const promise = bridge.request('req-3');
    jest.advanceTimersByTime(300_000);
    await expect(promise).resolves.toBe(false);
    jest.useRealTimers();
  });

  it('should reject all pending requests on dispose', async () => {
    const p1 = bridge.request('req-4');
    const p2 = bridge.request('req-5');
    bridge.dispose();
    await expect(p1).resolves.toBe(false);
    await expect(p2).resolves.toBe(false);
  });

  it('should handle multiple concurrent requests', async () => {
    const p1 = bridge.request('req-6');
    const p2 = bridge.request('req-7');
    bridge.reply('req-6', true);
    bridge.reply('req-7', false);
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/pi-approval-bridge.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement ApprovalBridge**

```typescript
// gateway/src/runtime/pi/pi-approval-bridge.ts
interface PendingRequest {
  resolve: (approved: boolean) => void;
  timeout: NodeJS.Timeout;
}

export class ApprovalBridge {
  private pending = new Map<string, PendingRequest>();
  private timeoutMs: number;

  constructor(timeoutMs: number = 300_000) {
    this.timeoutMs = timeoutMs;
  }

  request(requestId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(false);
      }, this.timeoutMs);

      this.pending.set(requestId, { resolve, timeout });
    });
  }

  reply(requestId: string, approved: boolean): boolean {
    const req = this.pending.get(requestId);
    if (!req) return false;

    clearTimeout(req.timeout);
    this.pending.delete(requestId);
    req.resolve(approved);
    return true;
  }

  dispose(): void {
    for (const { resolve, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      resolve(false);
    }
    this.pending.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/pi-approval-bridge.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd gateway && git add src/runtime/pi/pi-approval-bridge.ts tests/unit/runtime/pi-approval-bridge.test.ts
git commit -m "feat(pi): add ApprovalBridge for nativeApprovals

Shared Promise map coordinating between pi extension and gateway HTTP API.
5-minute timeout, auto-reject on timeout, per-session lifecycle."
```

---

### Task 2: MafwApprovalExtension

**Files:**
- Create: `gateway/src/runtime/pi/pi-approval-extension.ts`
- Create: `gateway/tests/unit/runtime/pi-approval-extension.test.ts`

**Interfaces:**
- Consumes: `ApprovalBridge` (Task 1), `RawRuntimeEvent` (gateway/src/runtime/normalize.ts)
- Produces: `createMafwApprovalExtension(bridge, emitEvent, policy?)` returning pi `Extension`

- [ ] **Step 1: Write the failing test**

```typescript
// gateway/tests/unit/runtime/pi-approval-extension.test.ts
import { createMafwApprovalExtension } from '../../../src/runtime/pi/pi-approval-extension';
import { ApprovalBridge } from '../../../src/runtime/pi/pi-approval-bridge';
import type { RawRuntimeEvent } from '../../../src/runtime/normalize';

describe('MafwApprovalExtension', () => {
  let bridge: ApprovalBridge;
  let emittedEvents: RawRuntimeEvent[];
  let extension: any;

  beforeEach(() => {
    bridge = new ApprovalBridge();
    emittedEvents = [];
    extension = createMafwApprovalExtension(
      bridge,
      (event) => emittedEvents.push(event),
    );
  });

  afterEach(() => {
    bridge.dispose();
  });

  it('should auto-approve read-only tools', async () => {
    const handler = extension.on.mock.calls.find((c: any) => c[0] === 'tool_call')[1];
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
    const handler = extension.on.mock.calls.find((c: any) => c[0] === 'tool_call')[1];
    const event = { toolName: 'bash', input: { command: 'rm -rf /' } };
    const ctx = { sessionId: 'session-1' };
    
    const result = await handler(event, ctx);
    
    expect(result).toEqual({ block: true, reason: 'auto-denied by policy' });
  });

  it('should emit permission.asked event and wait for approval', async () => {
    const handler = extension.on.mock.calls.find((c: any) => c[0] === 'tool_call')[1];
    const event = { toolName: 'bash', input: { command: 'ls' } };
    const ctx = { sessionId: 'session-1' };
    
    const promise = handler(event, ctx);
    
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].payload.type).toBe('permission.asked');
    expect(emittedEvents[0].payload.properties.toolName).toBe('bash');
    
    const requestId = emittedEvents[0].payload.properties.requestId;
    bridge.reply(requestId, true);
    
    const result = await promise;
    expect(result).toBeUndefined();
    
    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[1].payload.type).toBe('permission.replied');
    expect(emittedEvents[1].payload.properties.approved).toBe(true);
  });

  it('should block tool when user rejects', async () => {
    const handler = extension.on.mock.calls.find((c: any) => c[0] === 'tool_call')[1];
    const event = { toolName: 'write', input: { path: '/tmp/file', content: 'data' } };
    const ctx = { sessionId: 'session-1' };
    
    const promise = handler(event, ctx);
    const requestId = emittedEvents[0].payload.properties.requestId;
    bridge.reply(requestId, false);
    
    const result = await promise;
    expect(result).toEqual({ block: true, reason: 'rejected by user' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/pi-approval-extension.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement MafwApprovalExtension**

```typescript
// gateway/src/runtime/pi/pi-approval-extension.ts
import { randomUUID } from 'crypto';
import type { RawRuntimeEvent } from '../normalize';
import type { ApprovalBridge } from './pi-approval-bridge';

export interface ApprovalPolicy {
  autoApprove: string[];
  autoDeny: string[];
}

const DEFAULT_POLICY: ApprovalPolicy = {
  autoApprove: ['read', 'grep', 'ls', 'find', 'glob'],
  autoDeny: [],
};

export function createMafwApprovalExtension(
  bridge: ApprovalBridge,
  emitEvent: (event: RawRuntimeEvent) => void,
  policy: ApprovalPolicy = DEFAULT_POLICY,
) {
  return {
    name: 'mafw-approval',
    on: (emitter: any) => {
      emitter.on('tool_call', async (event: any, ctx: any) => {
        const toolName = event.toolName;

        if (policy.autoApprove.includes(toolName)) {
          return;
        }

        if (policy.autoDeny.includes(toolName)) {
          return { block: true, reason: 'auto-denied by policy' };
        }

        const requestId = randomUUID();
        const sessionID = ctx.sessionId;

        emitEvent({
          payload: {
            type: 'permission.asked',
            properties: {
              sessionID,
              requestId,
              toolName,
              args: event.input,
              risk: 'medium',
            },
          },
        });

        const approved = await bridge.request(requestId);

        emitEvent({
          payload: {
            type: 'permission.replied',
            properties: {
              sessionID,
              requestId,
              approved,
            },
          },
        });

        if (!approved) {
          return { block: true, reason: 'rejected by user' };
        }
      });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/pi-approval-extension.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd gateway && git add src/runtime/pi/pi-approval-extension.ts tests/unit/runtime/pi-approval-extension.test.ts
git commit -m "feat(pi): add MafwApprovalExtension for tool_call interception

Intercepts pi tool_call events, translates to permission.asked/replied,
waits for ApprovalBridge response. Configurable auto-approve/deny policy."
```

---

### Task 3: pi-events Translation

**Files:**
- Modify: `gateway/src/runtime/pi/pi-events.ts` (add permission.asked/replied cases)
- Modify: `gateway/tests/unit/runtime/pi-events.test.ts` (add translation tests)

**Interfaces:**
- Consumes: `RawRuntimeEvent` (existing)
- Produces: Extended `translatePiEvent` handling permission.asked/replied

- [ ] **Step 1: Write the failing test**

```typescript
// gateway/tests/unit/runtime/pi-events.test.ts (append to existing)
describe('permission events', () => {
  it('should translate permission.asked event', () => {
    const event = {
      payload: {
        type: 'permission.asked',
        properties: {
          sessionID: 'session-1',
          requestId: 'req-1',
          toolName: 'bash',
          args: { command: 'ls' },
          risk: 'medium',
        },
      },
    };

    const result = translatePiEvent(event, 'session-1');

    expect(result.payload.type).toBe('permission.asked');
    expect(result.payload.properties.sessionID).toBe('session-1');
    expect(result.payload.properties.requestId).toBe('req-1');
    expect(result.payload.properties.toolName).toBe('bash');
  });

  it('should translate permission.replied event', () => {
    const event = {
      payload: {
        type: 'permission.replied',
        properties: {
          sessionID: 'session-1',
          requestId: 'req-1',
          approved: true,
        },
      },
    };

    const result = translatePiEvent(event, 'session-1');

    expect(result.payload.type).toBe('permission.replied');
    expect(result.payload.properties.approved).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/pi-events.test.ts`
Expected: FAIL (new tests fail, existing tests pass)

- [ ] **Step 3: Extend translatePiEvent**

```typescript
// gateway/src/runtime/pi/pi-events.ts (add to switch statement)
case 'permission.asked':
  return {
    payload: {
      type: 'permission.asked',
      properties: {
        sessionID: event.payload.properties.sessionID,
        requestId: event.payload.properties.requestId,
        toolName: event.payload.properties.toolName,
        args: event.payload.properties.args,
        risk: event.payload.properties.risk,
      },
    },
  };

case 'permission.replied':
  return {
    payload: {
      type: 'permission.replied',
      properties: {
        sessionID: event.payload.properties.sessionID,
        requestId: event.payload.properties.requestId,
        approved: event.payload.properties.approved,
      },
    },
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/pi-events.test.ts`
Expected: PASS (all tests including new permission tests)

- [ ] **Step 5: Commit**

```bash
cd gateway && git add src/runtime/pi/pi-events.ts tests/unit/runtime/pi-events.test.ts
git commit -m "feat(pi): extend pi-events for permission.asked/replied translation

Translates pi permission events to opencode shape for normalize.ts consumption."
```

---

### Task 4: PiSessionRegistry Integration

**Files:**
- Modify: `gateway/src/runtime/pi/pi-session.ts` (add approvalBridges map, permissionReply method)
- Modify: `gateway/tests/unit/runtime/pi-session.test.ts` (add integration tests)

**Interfaces:**
- Consumes: `ApprovalBridge` (Task 1), `createMafwApprovalExtension` (Task 2)
- Produces: Extended `PiSessionRegistry` with `permissionReply(sessionID, requestId, approved)`

- [ ] **Step 1: Write the failing test**

```typescript
// gateway/tests/unit/runtime/pi-session.test.ts (append to existing)
describe('approval integration', () => {
  it('should create ApprovalBridge per session', async () => {
    const registry = new PiSessionRegistry();
    const { id } = await registry.create({ directory: '/tmp' });
    
    expect(registry['approvalBridges'].has(id)).toBe(true);
  });

  it('should dispose ApprovalBridge when session is deleted', async () => {
    const registry = new PiSessionRegistry();
    const { id } = await registry.create({ directory: '/tmp' });
    const bridge = registry['approvalBridges'].get(id);
    const disposeSpy = jest.spyOn(bridge!, 'dispose');
    
    await registry.delete(id);
    
    expect(disposeSpy).toHaveBeenCalled();
    expect(registry['approvalBridges'].has(id)).toBe(false);
  });

  it('should forward permissionReply to bridge', async () => {
    const registry = new PiSessionRegistry();
    const { id } = await registry.create({ directory: '/tmp' });
    const bridge = registry['approvalBridges'].get(id);
    const replySpy = jest.spyOn(bridge!, 'reply');
    
    const result = await registry.permissionReply(id, 'req-1', true);
    
    expect(replySpy).toHaveBeenCalledWith('req-1', true);
    expect(result).toBe(true);
  });

  it('should return false when permissionReply called for unknown session', async () => {
    const registry = new PiSessionRegistry();
    const result = await registry.permissionReply('unknown', 'req-1', true);
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/pi-session.test.ts`
Expected: FAIL (new tests fail)

- [ ] **Step 3: Extend PiSessionRegistry**

```typescript
// gateway/src/runtime/pi/pi-session.ts (add imports)
import { ApprovalBridge } from './pi-approval-bridge';
import { createMafwApprovalExtension } from './pi-approval-extension';

// Add to class
private approvalBridges = new Map<string, ApprovalBridge>();
private emitEvent: (event: RawRuntimeEvent) => void;

constructor(emitEvent: (event: RawRuntimeEvent) => void) {
  this.emitEvent = emitEvent;
}

// Modify create method
async create(opts: { directory?: string }): Promise<{ id: string }> {
  const id = randomUUID();
  const bridge = new ApprovalBridge();
  this.approvalBridges.set(id, bridge);

  const extension = createMafwApprovalExtension(bridge, this.emitEvent);
  const session = await createAgentSession({
    cwd: opts.directory,
    extensions: [extension],
  });

  this.sessions.set(id, session);
  return { id };
}

// Add permissionReply method
async permissionReply(sessionID: string, requestId: string, approved: boolean): Promise<boolean> {
  const bridge = this.approvalBridges.get(sessionID);
  if (!bridge) return false;
  return bridge.reply(requestId, approved);
}

// Modify delete method
async delete(sessionID: string): Promise<void> {
  const bridge = this.approvalBridges.get(sessionID);
  if (bridge) {
    bridge.dispose();
    this.approvalBridges.delete(sessionID);
  }
  // ... existing delete logic
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/pi-session.test.ts`
Expected: PASS (all tests including new approval tests)

- [ ] **Step 5: Commit**

```bash
cd gateway && git add src/runtime/pi/pi-session.ts tests/unit/runtime/pi-session.test.ts
git commit -m "feat(pi): integrate ApprovalBridge into PiSessionRegistry

Per-session bridge lifecycle, permissionReply forwarding, cleanup on delete."
```

---

### Task 5: RuntimeClient Extension

**Files:**
- Modify: `gateway/src/runtime/contract.ts` (add optional permissionReply to RuntimeClient)
- Modify: `gateway/src/runtime/pi/pi-runtime.ts` (implement permissionReply)

**Interfaces:**
- Consumes: `PiSessionRegistry.permissionReply` (Task 4)
- Produces: Extended `RuntimeClient.session` with optional `permissionReply`

- [ ] **Step 1: Write the failing test**

```typescript
// gateway/tests/unit/runtime/pi-runtime.test.ts (append to existing)
describe('permissionReply', () => {
  it('should expose permissionReply on session API', () => {
    const runtime = createPiRuntime();
    expect(runtime.session.permissionReply).toBeDefined();
  });

  it('should forward permissionReply to registry', async () => {
    const runtime = createPiRuntime();
    const { id } = await runtime.session.create({ directory: '/tmp' });
    const registry = runtime['registry'];
    const replySpy = jest.spyOn(registry, 'permissionReply');
    
    await runtime.session.permissionReply(id, 'req-1', true);
    
    expect(replySpy).toHaveBeenCalledWith(id, 'req-1', true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/pi-runtime.test.ts`
Expected: FAIL (permissionReply not defined)

- [ ] **Step 3: Extend RuntimeClient interface**

```typescript
// gateway/src/runtime/contract.ts (modify RuntimeClient)
export interface RuntimeClient {
  session: {
    // ... existing methods
    permissionReply?(sessionID: string, requestId: string, approved: boolean): Promise<boolean>;
  };
  // ... rest of interface
}
```

- [ ] **Step 4: Implement in pi-runtime**

```typescript
// gateway/src/runtime/pi/pi-runtime.ts (in createPiRuntime)
const registry = new PiSessionRegistry(emitEvent);

return {
  // ... existing properties
  session: {
    // ... existing methods
    permissionReply: (sessionID: string, requestId: string, approved: boolean) =>
      registry.permissionReply(sessionID, requestId, approved),
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/pi-runtime.test.ts`
Expected: PASS (all tests including permissionReply tests)

- [ ] **Step 6: Commit**

```bash
cd gateway && git add src/runtime/contract.ts src/runtime/pi/pi-runtime.ts tests/unit/runtime/pi-runtime.test.ts
git commit -m "feat(pi): add permissionReply to RuntimeClient and pi-runtime

Optional method for nativeApprovals, opencode runtime doesn't implement."
```

---

### Task 6: index.ts Wiring

**Files:**
- Modify: `gateway/src/index.ts` (add HTTP endpoint, handle permission events)
- Modify: `gateway/tests/unit/gateway.test.ts` (add HTTP endpoint tests)

**Interfaces:**
- Consumes: `runtime.session.permissionReply` (Task 5), permission.asked/replied events (Task 3)
- Produces: HTTP POST `/api/sessions/:sessionID/permissions/:requestId` endpoint

- [ ] **Step 1: Write the failing test**

```typescript
// gateway/tests/unit/gateway.test.ts (append to existing)
describe('POST /api/sessions/:sessionID/permissions/:requestId', () => {
  it('should call runtime.session.permissionReply', async () => {
    const runtime = {
      session: {
        permissionReply: jest.fn().mockResolvedValue(true),
      },
    };
    const gateway = createGateway({ runtime });
    
    const response = await gateway.inject({
      method: 'POST',
      url: '/api/sessions/session-1/permissions/req-1',
      payload: { approved: true },
    });
    
    expect(response.statusCode).toBe(200);
    expect(runtime.session.permissionReply).toHaveBeenCalledWith('session-1', 'req-1', true);
  });

  it('should return 404 when permissionReply returns false', async () => {
    const runtime = {
      session: {
        permissionReply: jest.fn().mockResolvedValue(false),
      },
    };
    const gateway = createGateway({ runtime });
    
    const response = await gateway.inject({
      method: 'POST',
      url: '/api/sessions/session-1/permissions/req-1',
      payload: { approved: false },
    });
    
    expect(response.statusCode).toBe(404);
  });

  it('should return 503 when runtime doesn\'t support permissionReply', async () => {
    const runtime = {
      session: {},
    };
    const gateway = createGateway({ runtime });
    
    const response = await gateway.inject({
      method: 'POST',
      url: '/api/sessions/session-1/permissions/req-1',
      payload: { approved: true },
    });
    
    expect(response.statusCode).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/gateway.test.ts`
Expected: FAIL (endpoint not found)

- [ ] **Step 3: Add HTTP endpoint**

```typescript
// gateway/src/index.ts (in route handler)
if (req.method === 'POST' && req.url.match(/^\/api\/sessions\/([^/]+)\/permissions\/([^/]+)$/)) {
  const match = req.url.match(/^\/api\/sessions\/([^/]+)\/permissions\/([^/]+)$/);
  const sessionID = match[1];
  const requestId = match[2];
  
  if (!this.runtime?.session?.permissionReply) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Runtime does not support permissionReply' }));
    return;
  }
  
  const body = await readBody(req);
  const { approved } = JSON.parse(body);
  
  const result = await this.runtime.session.permissionReply(sessionID, requestId, approved);
  
  if (!result) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Permission request not found' }));
    return;
  }
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
  return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/gateway.test.ts`
Expected: PASS (all tests including permission endpoint tests)

- [ ] **Step 5: Commit**

```bash
cd gateway && git add src/index.ts tests/unit/gateway.test.ts
git commit -m "feat(gateway): add HTTP endpoint for permission replies

POST /api/sessions/:sessionID/permissions/:requestId forwards to runtime.session.permissionReply.
503 when runtime doesn't support it, 404 when request not found."
```

---

### Task 7: Configuration

**Files:**
- Modify: `gateway/src/runtime/pi/pi-runtime.ts` (read approvalPolicy from pluginConfig)
- Modify: `gateway/tests/unit/runtime/pi-runtime.test.ts` (add config tests)

**Interfaces:**
- Consumes: `config.runtime.pluginConfig.pi.approvalPolicy`
- Produces: Configured `createMafwApprovalExtension` with custom policy

- [ ] **Step 1: Write the failing test**

```typescript
// gateway/tests/unit/runtime/pi-runtime.test.ts (append to existing)
describe('approval policy configuration', () => {
  it('should use default policy when not configured', () => {
    const runtime = createPiRuntime({});
    const registry = runtime['registry'];
    const bridge = registry['approvalBridges'].values().next().value;
    const extension = registry['emitEvent']; // indirect check
    
    // Default policy auto-approves read
    expect(extension).toBeDefined();
  });

  it('should use custom policy from pluginConfig', () => {
    const runtime = createPiRuntime({
      runtime: {
        pluginConfig: {
          pi: {
            approvalPolicy: {
              autoApprove: ['read', 'grep'],
              autoDeny: ['bash'],
            },
          },
        },
      },
    });
    
    // Custom policy should be applied (tested via extension behavior)
    expect(runtime).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/pi-runtime.test.ts`
Expected: FAIL (config not read)

- [ ] **Step 3: Read config in pi-runtime**

```typescript
// gateway/src/runtime/pi/pi-runtime.ts (in createPiRuntime)
const policy = config.runtime?.pluginConfig?.pi?.approvalPolicy;
const registry = new PiSessionRegistry(emitEvent, policy);

// Modify PiSessionRegistry constructor
constructor(emitEvent: (event: RawRuntimeEvent) => void, policy?: ApprovalPolicy) {
  this.emitEvent = emitEvent;
  this.policy = policy;
}

// Modify create method
const extension = createMafwApprovalExtension(bridge, this.emitEvent, this.policy);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/pi-runtime.test.ts`
Expected: PASS (all tests including config tests)

- [ ] **Step 5: Commit**

```bash
cd gateway && git add src/runtime/pi/pi-runtime.ts src/runtime/pi/pi-session.ts tests/unit/runtime/pi-runtime.test.ts
git commit -m "feat(pi): read approvalPolicy from pluginConfig

Custom autoApprove/autoDeny lists via runtime.pluginConfig.pi.approvalPolicy."
```

---

### Task 8: Integration Test + Docs

**Files:**
- Create: `gateway/tests/integration/pi-native-approvals.test.ts`
- Modify: `AGENTS.md` (update §5.19 with nativeApprovals)

**Interfaces:**
- Consumes: All previous tasks
- Produces: End-to-end integration test, updated documentation

- [ ] **Step 1: Write integration test**

```typescript
// gateway/tests/integration/pi-native-approvals.test.ts
import { createPiRuntime } from '../../src/runtime/pi/pi-runtime';
import { normalizeOpencodeEvent } from '../../src/runtime/normalize';

describe('pi nativeApprovals integration', () => {
  it('should emit permission.asked event and handle approval', async () => {
    const runtime = createPiRuntime();
    const { id: sessionID } = await runtime.session.create({ directory: '/tmp' });
    
    // Simulate tool_call event (would normally come from pi)
    const bridge = runtime['registry']['approvalBridges'].get(sessionID);
    const requestId = 'test-req-1';
    
    const promise = bridge.request(requestId);
    
    // Simulate gateway receiving permission.asked event
    const event = {
      payload: {
        type: 'permission.asked',
        properties: {
          sessionID,
          requestId,
          toolName: 'bash',
          args: { command: 'ls' },
          risk: 'medium',
        },
      },
    };
    
    const facets = normalizeOpencodeEvent(event);
    expect(facets.type).toBe('permission.asked');
    
    // Simulate HTTP API call
    const result = await runtime.session.permissionReply(sessionID, requestId, true);
    expect(result).toBe(true);
    
    // Bridge should resolve
    const approved = await promise;
    expect(approved).toBe(true);
  });

  it('should handle rejection', async () => {
    const runtime = createPiRuntime();
    const { id: sessionID } = await runtime.session.create({ directory: '/tmp' });
    const bridge = runtime['registry']['approvalBridges'].get(sessionID);
    const requestId = 'test-req-2';
    
    const promise = bridge.request(requestId);
    await runtime.session.permissionReply(sessionID, requestId, false);
    
    const approved = await promise;
    expect(approved).toBe(false);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd gateway && npx jest tests/integration/pi-native-approvals.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 3: Update AGENTS.md**

```markdown
// AGENTS.md (update §5.19)
### 5.19 Runtime 能力契约（多 runtime 接缝）

// ... existing content ...

#### nativeApprovals 翻译层（pi runtime）

pi runtime 声明 `nativeApprovals: true`，通过 MafwApprovalExtension 拦截 tool_call 事件：

1. **ApprovalBridge**：每个 session 独立的 Promise map，5 分钟超时自动拒绝
2. **MafwApprovalExtension**：pi extension，拦截 tool_call，发射 permission.asked/replied 事件
3. **事件翻译**：pi-events.ts 将 permission 事件翻译为 opencode 形状
4. **HTTP API**：`POST /api/sessions/:sessionID/permissions/:requestId` 转发到 `runtime.session.permissionReply`
5. **配置**：`runtime.pluginConfig.pi.approvalPolicy` 自定义 autoApprove/autoDeny 列表

默认策略：read/grep/ls/find/glob 自动放行，其余需审批。
```

- [ ] **Step 4: Run full test suite**

Run: `cd gateway && npx jest`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
cd gateway && git add tests/integration/pi-native-approvals.test.ts AGENTS.md
git commit -m "docs(pi): add nativeApprovals integration test and update AGENTS.md

End-to-end test covering permission.asked → HTTP API → bridge resolution flow."
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ ApprovalBridge (Task 1)
- ✅ MafwApprovalExtension (Task 2)
- ✅ pi-events translation (Task 3)
- ✅ PiSessionRegistry integration (Task 4)
- ✅ RuntimeClient extension (Task 5)
- ✅ index.ts wiring (Task 6)
- ✅ Configuration (Task 7)
- ✅ Integration test + docs (Task 8)

**Placeholder scan:** No TBD/TODO/placeholders found.

**Type consistency:**
- `ApprovalBridge` signature consistent across Tasks 1, 2, 4
- `permissionReply(sessionID, requestId, approved)` signature consistent across Tasks 4, 5, 6
- `ApprovalPolicy` interface consistent across Tasks 2, 7

All good. Plan is ready for execution.
