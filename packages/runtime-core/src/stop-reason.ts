/**
 * Runtime finish reason → canonical `StopReason` (runtime-neutral).
 *
 * Moved verbatim from `gateway/src/runtime/contract.ts` so drivers can classify
 * turn endings without importing gateway types. `StopReason` itself lives in
 * the View DTO mirror (`view-dto.generated.ts`, single source: gateway-sdk).
 */
import type { StopReason } from './view-dto.generated.ts';

/** runtime finish (opencode AssistantMessage.finish) → canonical StopReason. */
export function stopReasonOf(finish?: string | null): StopReason {
  switch (finish) {
    case 'stop': return 'end_turn';
    case 'length': return 'max_tokens';
    case 'tool-calls': return 'tool_use';
    case 'content-filter': return 'refusal';
    case 'error': return 'error';
    case 'cancelled': return 'cancelled';
    case 'interrupted': return 'cancelled';
    case 'end_turn':
    case 'max_tokens':
    case 'tool_use':
    case 'refusal':
    case 'unknown':
      return finish;
    default:
      return 'unknown';
  }
}
