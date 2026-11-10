/**
 * One-release re-export shim — Plan 6 Task 5.
 *
 * The opencode MCP runtime channel moved to `adapters/opencode/src/mcp.ts`
 * (`@mafw/adapter-opencode`). Gateway call sites keep their old import path
 * until Task 7 removes the shim.
 */
export {
  createOpencodeMcpChannel,
  parseMcpListOutput,
  resolveMcpListCommand,
} from '@mafw/adapter-opencode';
export type {
  McpListCommand,
  McpListEntry,
  McpListStatus,
  OpencodeMcpDeps,
  RuntimeMcpServer,
  RuntimeMcpStatus,
} from '@mafw/adapter-opencode';
