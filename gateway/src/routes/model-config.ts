import * as http from 'http';
import { log } from '../core/utils/logger';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export interface ModelRef { providerID: string; modelID: string }
export interface MediaModelRef { provider?: string; model?: string }
export interface AvailableModel { id: string; name: string }
export interface AvailableProvider { providerID: string; providerName: string; models: AvailableModel[] }

export interface CurrentModelConfig {
  recall: { workerModel: ModelRef };
  media: {
    provider?: string;
    model?: string;
    image?: MediaModelRef;
    video?: MediaModelRef;
    audio?: MediaModelRef;
  };
}

export interface ModelConfigDeps {
  persist: (overrides: Record<string, any>) => { changed: string[] };
  /** null → provider list unavailable (fail-open). */
  listProviders: () => Promise<AvailableProvider[] | null>;
  currentConfig: () => CurrentModelConfig;
  invalidateScanService: () => void;
}

const MEDIA_MODALITIES = ['image', 'video', 'audio'] as const;

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/** Empty-string provider+model = "follow default" clear path — skips strict validation. */
function isClearRef(ref: any): boolean {
  return (ref?.provider ?? '') === '' && (ref?.model ?? '') === '';
}

function findProvider(list: AvailableProvider[], providerID: string): AvailableProvider | undefined {
  return list.find(p => p.providerID === providerID);
}

function validateRecall(ref: any, available: AvailableProvider[]): string | null {
  const prov = findProvider(available, ref?.providerID ?? '');
  if (!prov) return `Provider '${ref?.providerID ?? ''}' not found`;
  if (!prov.models.some(m => m.id === ref.modelID)) {
    return `Model '${ref.modelID}' not found under provider '${ref.providerID}'`;
  }
  return null;
}

/** Validate a media ref; empty provider falls back to the current top-level provider. */
function validateMediaRef(
  ref: any,
  fallbackProvider: string | undefined,
  available: AvailableProvider[],
): string | null {
  const effProvider = ref?.provider || fallbackProvider || '';
  const prov = findProvider(available, effProvider);
  if (!prov) return `Provider '${effProvider}' not found`;
  if (ref?.model && !prov.models.some(m => m.id === ref.model)) {
    return `Model '${ref.model}' not found under provider '${effProvider}'`;
  }
  return null;
}

export async function handleModelConfigGet(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ModelConfigDeps,
): Promise<void> {
  try {
    const available = await deps.listProviders().catch(() => null);
    const cur = deps.currentConfig();
    json(res, 200, { recall: cur.recall, media: cur.media, available });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

export async function handleModelConfigUpdate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ModelConfigDeps,
): Promise<void> {
  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err: any) {
    json(res, 400, { error: err.message });
    return;
  }

  const recallUpdate = body?.recall ?? null;
  const mediaUpdate: Record<string, any> = {};
  for (const key of ['provider', 'model', ...MEDIA_MODALITIES]) {
    if (body?.media?.[key] !== undefined) mediaUpdate[key] = body.media[key];
  }

  if (!recallUpdate && Object.keys(mediaUpdate).length === 0) {
    json(res, 400, { error: 'No model config specified' });
    return;
  }

  // recall must always be a complete pair (no clear concept for the worker model).
  if (recallUpdate && (!recallUpdate.providerID || !recallUpdate.modelID)) {
    json(res, 400, { error: 'recall.workerModel requires both providerID and modelID' });
    return;
  }

  const available = await deps.listProviders().catch(() => null);

  if (available !== null) {
    if (recallUpdate) {
      const err = validateRecall(recallUpdate, available);
      if (err) { json(res, 400, { error: err, available }); return; }
    }
    // Top-level media pair: both empty = reset to built-in default (skip);
    // partial pair falls back to the current persisted provider for validation.
    const pairProvider = mediaUpdate.provider ?? '';
    const pairModel = mediaUpdate.model ?? '';
    if (pairProvider !== '' || pairModel !== '') {
      const pairErr = validateMediaRef(
        { provider: pairProvider, model: pairModel },
        deps.currentConfig().media.provider,
        available,
      );
      if (pairErr) { json(res, 400, { error: pairErr, available }); return; }
    }
    for (const modality of MEDIA_MODALITIES) {
      const ref = mediaUpdate[modality];
      if (ref && !isClearRef(ref)) {
        const err = validateMediaRef(ref, mediaUpdate.provider ?? deps.currentConfig().media.provider, available);
        if (err) { json(res, 400, { error: err, available }); return; }
      }
    }
  }

  try {
    const overrides: Record<string, any> = {};
    if (recallUpdate) overrides.recall = { workerModel: { providerID: recallUpdate.providerID, modelID: recallUpdate.modelID } };
    if (Object.keys(mediaUpdate).length > 0) overrides.media = mediaUpdate;
    deps.persist(overrides);
    if (recallUpdate) {
      try { deps.invalidateScanService(); } catch (err: any) {
        log.warn(`[ModelConfig] invalidateScanService failed: ${err.message}`);
      }
    }
    const cur = deps.currentConfig();
    json(res, 200, { success: true, recall: cur.recall, media: cur.media });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
