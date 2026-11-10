/**
 * One-release re-export shim — Plan 6 Task 5.
 *
 * The supervised `opencode serve` sidecar moved to
 * `adapters/opencode/src/serve-sidecar.ts` (`@mafw/adapter-opencode`). Gateway
 * call sites keep their old import path until Task 7 removes the shim.
 */
export {
  killServePort,
  resolveOpencodeBin,
  resolveServePassword,
  serveAuthHeaders,
  startServeSidecar,
} from '@mafw/adapter-opencode';
export type { ServeSidecar, ServeSidecarOptions } from '@mafw/adapter-opencode';
