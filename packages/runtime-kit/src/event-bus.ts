/**
 * 事件总线 —— 进程内 fan-out，语义与 pi PiEventStream / claude 适配器内联实现一致：
 * 每个订阅者独立队列；订阅前 push 的值不重放（无缓冲）。
 * 迭代器 return()/关闭后：挂起的 next() 立即以 done:true 结算（不留下永不 settle 的 promise）。
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
      const waiters: Array<(result: IteratorResult<T>) => void> = [];
      let closed = false;
      const listener = (evt: T) => {
        const waiter = waiters.shift();
        if (waiter) waiter({ value: evt, done: false });
        else queue.push(evt);
      };
      listeners.add(listener);
      const stream: AsyncIterable<T> = {
        [Symbol.asyncIterator]() {
          return {
            next: async (): Promise<IteratorResult<T>> => {
              if (closed) return { value: undefined as any, done: true };
              if (queue.length > 0) return { value: queue.shift()!, done: false };
              return new Promise((resolve) => waiters.push(resolve));
            },
            return: async (): Promise<IteratorResult<T>> => {
              if (!closed) {
                closed = true;
                listeners.delete(listener);
                for (const waiter of waiters.splice(0)) waiter({ value: undefined as any, done: true });
              }
              return { done: true, value: undefined as any };
            },
          };
        },
      };
      return { stream };
    },
  };
}
