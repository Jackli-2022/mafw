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
