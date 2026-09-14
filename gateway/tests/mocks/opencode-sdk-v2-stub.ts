/**
 * jest moduleNameMapper stub for '@opencode-ai/sdk/v2' — the real subpath is
 * ESM-only (exports."import" only), unresolvable from jest's CJS runtime.
 * Tests override this via jest.mock(..., factory); the stub only exists so
 * resolution succeeds for non-mocking import paths.
 */
export const createOpencodeClient: any = () => {
  throw new Error('@opencode-ai/sdk/v2 stub — tests must jest.mock this module');
};
