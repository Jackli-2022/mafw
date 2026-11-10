/**
 * One-release re-export shim — Plan 6 Task 5.
 *
 * The opencode auth.json credential reader moved to
 * `adapters/opencode/src/auth.ts` (`@mafw/adapter-opencode`). Gateway call sites
 * keep their old import path until Task 7 removes the shim.
 */
export { DEFAULT_AUTH_PATH, getProviderApiKey, readOpencodeAuth } from '@mafw/adapter-opencode';
export type { ProviderCredential, RuntimeCredentials } from '@mafw/adapter-opencode';
