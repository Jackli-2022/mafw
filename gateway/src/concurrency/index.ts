// gateway/src/concurrency/index.ts
// Unified concurrency primitives for the gateway kernel.
// Spec: docs/superpowers/specs/2026-11-09-gateway-kernel-concurrency-design.md

export { Singleflight } from './singleflight';
export { MutexQueue } from './mutex-queue';
export { Guard, GuardTimeoutError, type GuardOpts } from './guard';
export { TtlMap, type TtlMapOptions } from './ttl-map';
export { Watermark } from './watermark';
