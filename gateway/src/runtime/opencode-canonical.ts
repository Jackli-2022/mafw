/**
 * One-release re-export shim — Plan 6 Task 5.
 *
 * The opencode canonical-message producer moved to
 * `adapters/opencode/src/canonical.ts` (`@mafw/adapter-opencode`). Gateway call
 * sites keep their old import path until Task 7 removes the shim.
 */
export {
  assistantModelOf,
  canonicalMessage,
  canonicalMessageFields,
  canonicalParts,
  canonicalStopReason,
  canonicalToolPart,
  canonicalError,
  errorKindOf,
  errorTextOf,
  isCanonicalError,
  toolStateOutput,
} from '@mafw/adapter-opencode';
export type { CanonicalMessageFields, MafwErrorKind } from '@mafw/adapter-opencode';
