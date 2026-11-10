/**
 * One-release re-export shim — Plan 6 Task 5.
 *
 * The opencode @2.1 dialect table moved to `adapters/opencode/src/events-21.ts`
 * (`@mafw/adapter-opencode`). Gateway call sites keep their old import path
 * until Task 7 removes the shim.
 */
export {
  OPENCODE_21_EVENT_SOURCE,
  OPENCODE_21_EVENT_MAPPINGS,
  translateOpencode21Event,
} from '@mafw/adapter-opencode';
