/**
 * One-release re-export shim — Plan 6 Task 5.
 *
 * The JSONC comment-preserving editor moved to
 * `adapters/opencode/src/mcp-jsonc.ts` (`@mafw/adapter-opencode`). Gateway call
 * sites keep their old import path until Task 7 removes the shim.
 */
export {
  editServer,
  maskSecrets,
  parseConfig,
  removeServerEntry,
  renderDiff,
  restoreServersSubtree,
} from '@mafw/adapter-opencode';
export type {
  ConfigParse,
  EditResult,
  McpServerEditInput,
  RemoveResult,
  RestoreResult,
} from '@mafw/adapter-opencode';
