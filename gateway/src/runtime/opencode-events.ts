/**
 * One-release re-export shim — Plan 6 Task 5.
 *
 * The opencode @v1/@v2 event tables moved to `adapters/opencode/src/events.ts`
 * (`@mafw/adapter-opencode`). Gateway call sites keep their old import path
 * until Task 7 removes the shim.
 */
export {
  OPENCODE_CANONICAL_IDENTITY_TYPES,
  OPENCODE_EVENT_SOURCE,
  OPENCODE_V1_EVENT_MAPPINGS,
  OPENCODE_EVENT_MAPPINGS,
  OPENCODE_V2_EVENT_MAPPINGS,
  OPENCODE_TRANSFORM_EVENT,
} from '@mafw/adapter-opencode';
