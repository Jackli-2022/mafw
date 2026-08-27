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
