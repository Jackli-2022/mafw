/**
 * Wire gateway policy hooks (`ctx.policy`) into the pi session registry.
 *
 * The composition root no longer reaches `(runtime as any).registry`; the
 * driver owns its native objects and only receives neutral functions.
 */
import type { RuntimePolicyHooks } from '@mafw/runtime-contract';

export interface PiPolicyTarget {
  setPermissionEvaluator?(fn: (sessionID: string, candidate: unknown) => unknown): void;
  setCognitionGate?(fn: (sessionID: string, payload: { tool: string; input: Record<string, unknown> }) => unknown): void;
  setCognitionHost?(host: {
    gatePrompt(sessionID: string, text: string): unknown;
    applyToolResultRedact(sessionID: string, tool: string, content: unknown[]): unknown;
  }): void;
}

export function applyPiPolicyHooks(registry: PiPolicyTarget, policy: RuntimePolicyHooks | undefined): void {
  if (!policy) return;

  if (policy.evaluatePermission && typeof registry.setPermissionEvaluator === 'function') {
    registry.setPermissionEvaluator((sessionID, candidate) => {
      try { return policy.evaluatePermission!(sessionID, candidate as any); } catch { return null; }
    });
  }

  if (policy.gateToolCall && typeof registry.setCognitionGate === 'function') {
    registry.setCognitionGate((sessionID, payload) => policy.gateToolCall!(sessionID, payload));
  }

  if ((policy.gatePrompt || policy.redactToolResult) && typeof registry.setCognitionHost === 'function') {
    registry.setCognitionHost({
      gatePrompt: (sessionID, text) => policy.gatePrompt?.(sessionID, text) ?? null,
      applyToolResultRedact: (sessionID, tool, content) => policy.redactToolResult?.(sessionID, tool, content) ?? content,
    });
  }
}
