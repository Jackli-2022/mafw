/**
 * One-release re-export shim — Plan 6 Task 5.
 *
 * The opencode dialect probe moved to `adapters/opencode/src/dialect-probe.ts`
 * (`@mafw/adapter-opencode`). Gateway call sites keep their old import path
 * until Task 7 removes the shim.
 */
export { probeOpencodeDialect } from '@mafw/adapter-opencode';
