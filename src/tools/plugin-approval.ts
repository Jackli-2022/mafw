/**
 * Native approval bridge for Creator plugin operations (Task 3).
 *
 * Every Creator code-execution (`check`/`test`) and write (`install`/`enable`/
 * `disable`/`remove`/`reload`) runs inside the host tool pipeline, so the
 * permission prompt is the host's own awaitable `ctx.ask` — not the gateway
 * `ApprovalPolicyService`, and not a blocking MCP question.
 *
 * Two invariants:
 *
 * - the only bypass is an explicit `full-access` session mode, read live from
 *   the existing session config route;
 * - everything else fails closed — an unreachable config route or a host
 *   without `ask` must never turn into an implicit approval.
 *
 * `always: []` is deliberate: one prompt approves one exact operation, and the
 * UI cannot persist a rule that would auto-approve later calls.
 */
import {
  pluginGatewayGet,
  type PluginToolApproval,
  type PluginToolContext,
} from './plugin-common';

/** Permission key the host prompts under (pinned by the Creator identity). */
export const CREATOR_PERMISSION = 'mafw_plugin_manager';

export interface CreatorApprovalRequest {
  /** Manager operation being approved (`check`, `test`, `install`, …). */
  operation: string;
  /** Human-readable, operation-specific detail shown in the prompt. */
  patterns: string[];
}

/** Session config route that carries the live permission mode. */
export function creatorSessionConfigPath(sessionID: string): string {
  return `/api/session/${encodeURIComponent(sessionID)}/config`;
}

/**
 * Live session mode, or `undefined` when it cannot be determined.
 *
 * `undefined` is treated exactly like a non-`full-access` mode: the caller asks.
 */
async function readSessionMode(ctx: PluginToolContext): Promise<string | undefined> {
  // No session, no live config: an unknown mode must ask, not skip the prompt
  // (and must not query `/api/session/undefined/config`).
  if (!ctx.sessionID) return undefined;
  try {
    const body: any = await pluginGatewayGet(creatorSessionConfigPath(ctx.sessionID), ctx);
    return typeof body?.mode === 'string' ? body.mode : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves approval for one Creator operation.
 *
 * Resolves when the operation may proceed; rejects when the user rejects it or
 * when the host cannot prompt. Never throws "allowed" on an unknown state.
 */
export async function approveCreatorOperation(
  ctx: PluginToolContext,
  request: CreatorApprovalRequest,
): Promise<void> {
  const mode = await readSessionMode(ctx);
  if (mode === 'full-access') return;

  const ask = ctx.ask;
  if (typeof ask !== 'function') {
    // `operation` is not part of the host prompt payload; it names the action
    // in the failure so the agent can report what was blocked.
    throw new Error(`native approval unavailable: ${request.operation} requires human approval`);
  }

  const approval: PluginToolApproval = {
    permission: CREATOR_PERMISSION,
    patterns: request.patterns,
    always: [],
  };
  await ask(approval);
}
