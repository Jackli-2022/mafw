type AsyncFn = () => Promise<void>;

export class WriteQueue {
  private queue: AsyncFn[] = [];
  private processing = false;

  async enqueue(fn: AsyncFn): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try { await fn(); resolve(); } catch (e) { reject(e); }
      });
      if (!this.processing) this.process();
    });
  }

  private async process(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      await fn();
    }
    this.processing = false;
  }
}
