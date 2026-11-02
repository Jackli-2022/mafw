/**
 * Read endpoint/key out of an opencode config document.
 *
 * opencode v2 normalises user-defined providers to `provider.<id>.settings`
 * (verified against `GET /api/runtime-config`: `{provider:{gateway:{settings:{
 * apiKey, baseURL}}}}`). Older documents used `options`. Both are accepted so
 * the stateless completion channel can resolve inline-defined providers
 * ("gateway", "commandcode", ...) — without this the judge silently failed
 * with "no endpoint or API key" and fell back to create/skip for two weeks.
 */
export interface ProviderEntryLike {
  settings?: { baseURL?: unknown; apiKey?: unknown };
  options?: { baseURL?: unknown; apiKey?: unknown };
}

function entryOf(cfg: any, providerID: string): ProviderEntryLike | null {
  const entry = cfg?.provider?.[providerID];
  return entry && typeof entry === 'object' ? (entry as ProviderEntryLike) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function readProviderBaseUrl(cfg: any, providerID: string): string | null {
  const e = entryOf(cfg, providerID);
  if (!e) return null;
  return str(e.settings?.baseURL) ?? str(e.options?.baseURL);
}

export function readProviderApiKey(cfg: any, providerID: string): string | null {
  const e = entryOf(cfg, providerID);
  if (!e) return null;
  return str(e.settings?.apiKey) ?? str(e.options?.apiKey);
}

/** Chat-completions URL for a provider, appended exactly once. */
export function readProviderBaseUrlWithPath(cfg: any, providerID: string): string | null {
  const base = readProviderBaseUrl(cfg, providerID);
  return base ? withChatPath(base) : null;
}

function withChatPath(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

/**
 * Fallback source: the runtime's provider registry
 * (`provider.list()` → `{all:[{id, settings:{baseURL, apiKey}}]}`). The config
 * document and the registry disagree across opencode versions, so the
 * completion channel tries both.
 */
export function readProviderTransportFromList(
  list: any,
  providerID: string,
): { baseUrl: string | null; apiKey: string | null } {
  const all = Array.isArray(list?.all) ? list.all : Array.isArray(list) ? list : [];
  const p = all.find((x: any) => x && x.id === providerID);
  if (!p) return { baseUrl: null, apiKey: null };
  const base = str(p.settings?.baseURL) ?? str(p.options?.baseURL);
  const key = str(p.settings?.apiKey) ?? str(p.options?.apiKey);
  return { baseUrl: base ? withChatPath(base) : null, apiKey: key };
}
