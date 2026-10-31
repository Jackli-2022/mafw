/**
 * 事件总线 —— 进程内 fan-out，语义与 pi PiEventStream / claude 适配器内联实现一致：
 * 每个订阅者独立队列；订阅前 push 的值不重放（无缓冲）。
 */
export interface EventBus<T = any> {
  push(value: T): void;
  event(): Promise<{ stream: AsyncIterable<T> }>;
}

export function createEventBus<T = any>(): EventBus<T> {
  const listeners = new Set<(evt: T) => void>();
  return {
    push(value: T): void {
      for (const listener of listeners) listener(value);
    },
    async event() {
      const queue: T[] = [];
      const waiters: Array<(v: T) => void> = [];
      const listener = (evt: T) => {
        const waiter = waiters.shift();
        if (waiter) waiter(evt);
        else queue.push(evt);
      };
      listeners.add(listener);
      const stream: AsyncIterable<T> = {
        [Symbol.asyncIterator]() {
          return {
            next: async (): Promise<IteratorResult<T>> => {
              if (queue.length > 0) return { value: queue.shift()!, done: false };
              return new Promise((resolve) => waiters.push((v) => resolve({ value: v, done: false })));
            },
            return: async (): Promise<IteratorResult<T>> => {
              listeners.delete(listener);
              return { done: true, value: undefined as any };
            },
          };
        },
      };
      return { stream };
    },
  };
}
