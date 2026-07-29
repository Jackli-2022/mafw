type AsyncFn = () => Promise<void>;
export declare class WriteQueue {
    private queue;
    private processing;
    enqueue(fn: AsyncFn): Promise<void>;
    private process;
}
export {};
//# sourceMappingURL=write-queue.d.ts.map