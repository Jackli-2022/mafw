export interface ModelRef {
  providerID: string;
  modelID: string;
}

export interface MediaModelRef {
  provider?: string;
  model?: string;
}

export interface AvailableModel {
  id: string;
  name: string;
}

export interface AvailableProvider {
  providerID: string;
  providerName: string;
  models: AvailableModel[];
}

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

export interface ModelConfigResponse extends CurrentModelConfig {
  available: AvailableProvider[] | null;
}

export async function fetchModelConfig(): Promise<ModelConfigResponse | null> {
  const res = await fetch('/api/model-config');
  if (!res.ok) return null;
  return res.json();
}

export async function updateModelConfig(payload: {
  recall?: { providerID: string; modelID: string };
  media?: {
    provider?: string;
    model?: string;
    image?: MediaModelRef;
    video?: MediaModelRef;
    audio?: MediaModelRef;
  };
}): Promise<{ success: boolean; recall?: any; media?: any; error?: string }> {
  const res = await fetch('/api/model-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) return { success: false, error: data.error || 'Update failed' };
  return data;
}
