// gateway/src/concurrency/mutex-queue.ts
// Same-key calls FIFO-queue; different keys run in parallel.
// A key is "running" while its head task executes; others wait in queue.

export class MutexQueue {
  private readonly queues = new Map<string, Array<() => void>>();
  private readonly running = new Set<string>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = () => {
        this.running.add(key);
        fn().then(
          (value) => {
            resolve(value);
            queueMicrotask(() => this.finish(key));
          },
          (err) => {
            reject(err);
            queueMicrotask(() => this.finish(key));
          },
        );
      };

      if (this.running.has(key)) {
        const q = this.queues.get(key);
        if (q) q.push(task);
        else this.queues.set(key, [task]);
      } else {
        task();
      }
    });
  }

  queueLength(key: string): number {
    return this.queues.get(key)?.length ?? 0;
  }

  private finish(key: string): void {
    this.running.delete(key);
    const q = this.queues.get(key);
    if (q && q.length > 0) {
      const next = q.shift()!;
      if (q.length === 0) this.queues.delete(key);
      next();
    }
  }
}
