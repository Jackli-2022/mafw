/**
 * One-release re-export shim — Plan 6 Task 5.
 *
 * The opencode MCP config (JSONC) channel moved to
 * `adapters/opencode/src/mcp-config.ts` (`@mafw/adapter-opencode`). Gateway call
 * sites keep their old import path until Task 7 removes the shim.
 */
export {
  MCP_CONFIG_MAX_BYTES,
  McpConfigError,
  createOpencodeMcpConfigChannel,
} from '@mafw/adapter-opencode';
export type { McpConfigErrorCode, OpencodeMcpConfigDeps } from '@mafw/adapter-opencode';
