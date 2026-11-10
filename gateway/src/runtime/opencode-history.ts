/**
 * One-release re-export shim — Plan 6 Task 5.
 *
 * The opencode history wire → flat translation moved to
 * `adapters/opencode/src/history.ts` (`@mafw/adapter-opencode`). Gateway call
 * sites keep their old import path until Task 7 removes the shim.
 */
export { normalizeOpencodeHistory } from '@mafw/adapter-opencode';
