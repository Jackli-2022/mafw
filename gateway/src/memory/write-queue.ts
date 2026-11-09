// gateway/src/memory/write-queue.ts
// FIFO write serialization for harmonic file stores.
// Internally uses the unified MutexQueue from concurrency/.

import { MutexQueue } from '../concurrency';

export class WriteQueue {
  private queue = new MutexQueue();

  enqueue(fn: () => Promise<void>): Promise<void> {
    return this.queue.run('write', fn);
  }
}
