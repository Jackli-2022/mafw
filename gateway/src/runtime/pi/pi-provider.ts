export async function translateProviders(mr: any): Promise<{ all: any[]; connected: string[]; default: Record<string, string> }> {
  const providers = (mr?.getProviders?.() || []) as any[];
  const all = providers.map((p: any) => ({
    id: p?.id,
    name: p?.name ?? p?.id,
    models: (mr?.getModels?.(p?.id) || []).map((m: any) => ({ id: m?.id, name: m?.id })),
  }));
  const connected = providers.filter((p: any) => mr?.hasConfiguredAuth?.(p?.id) ?? false).map((p: any) => p?.id);
  return { all, connected, default: {} };
}

export async function translateAgents(): Promise<any[]> { return []; }

export async function translateConfigGet(): Promise<any> { return {}; }

export async function translateConfigUpdate(cfg: any): Promise<any> { return cfg; }