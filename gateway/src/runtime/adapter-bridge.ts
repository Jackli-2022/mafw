/**
 * One-release compatibility path for the legacy plugin bridge.
 *
 * Phase 4 W4 renamed the implementation to `legacy-plugin-bridge.ts` (Phase 4.1
 * shim: file plugins using `createRuntime(ctx)` still get bridged). Gateway
 * source imports the new path; tests and out-of-tree callers can keep this path
 * until the next major version removes both.
 *
 * @deprecated import from `./legacy-plugin-bridge` instead.
 */
export * from './legacy-plugin-bridge';
