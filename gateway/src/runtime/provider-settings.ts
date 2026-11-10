/**
 * One-release re-export shim — Plan 6 Task 5.
 *
 * The opencode provider-settings reader moved to
 * `adapters/opencode/src/provider-settings.ts` (`@mafw/adapter-opencode`).
 * Gateway call sites keep their old import path until Task 7 removes the shim.
 */
export {
  readProviderApiKey,
  readProviderBaseUrl,
  readProviderBaseUrlWithPath,
  readProviderTransportFromList,
} from '@mafw/adapter-opencode';
export type { ProviderEntryLike } from '@mafw/adapter-opencode';
