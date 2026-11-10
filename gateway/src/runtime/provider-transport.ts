/**
 * Provider transport resolution shared by the judge/scan paths.
 *
 * Precedence is deliberately the pre-extraction order:
 *   1. runtime credentials (`auth.json` / active host) — authoritative;
 *   2. the active driver's `resolveProviderTransport` (adapter-local config);
 *   3. the gateway fallback chain (runtime config → provider list).
 *
 * The adapter transport is asked once. The fallback runs only for the fields
 * still missing, so a transport that already paid for `config.get()` does not
 * trigger a duplicate read in the gateway.
 */

export interface ProviderTransportCandidate {
  baseUrl?: string | null;
  apiKey?: string | null;
}

export interface ProviderTransportFallbackInput {
  needBaseUrl: boolean;
  needApiKey: boolean;
}

export interface ResolveProviderTransportOptions {
  providerID: string;
  credentials?: { getApiKey(provider: string): string | null };
  /**
   * Adapter-owned resolution. May return a base URL, a key, or both. Errors are
   * fail-open to the fallback chain.
   */
  resolveTransport?(
    providerID: string,
  ): ProviderTransportCandidate | Promise<ProviderTransportCandidate>;
  /** Gateway chain for whatever the driver could not resolve. */
  fallback(
    input: ProviderTransportFallbackInput,
  ): ProviderTransportCandidate | Promise<ProviderTransportCandidate>;
}

export interface ResolvedProviderTransport {
  baseUrl: string | null;
  apiKey: string | null;
}

export async function resolveProviderTransportPrecedence(
  options: ResolveProviderTransportOptions,
): Promise<ResolvedProviderTransport> {
  let apiKey: string | null = null;
  try {
    apiKey = options.credentials?.getApiKey(options.providerID) ?? null;
  } catch { /* fail-open to the driver/fallback chain */ }

  let transport: ProviderTransportCandidate | undefined;
  try {
    transport = await options.resolveTransport?.(options.providerID);
  } catch { /* fail-open to the gateway chain */ }

  let baseUrl = transport?.baseUrl ?? null;
  if (!apiKey) apiKey = transport?.apiKey ?? null;

  if (!baseUrl || !apiKey) {
    const filled = await options.fallback({ needBaseUrl: !baseUrl, needApiKey: !apiKey });
    if (!baseUrl) baseUrl = filled.baseUrl ?? null;
    if (!apiKey) apiKey = filled.apiKey ?? null;
  }

  return { baseUrl, apiKey };
}
