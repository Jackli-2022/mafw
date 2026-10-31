/**
 * pi model catalog compatibility shim (2026-10-31).
 *
 * pi-ai's bundled xiaomi catalog still only knows mimo-v2.5, while the xiaomi
 * API has moved to mimo-v2.6-*. Media Agent resolves models through pi's
 * ModelRuntime, so without this overlay every image/video/audio call fails with
 * "Unsupported model" / "not found in pi registry".
 *
 * We merge the new model ids into `~/.pi/agent/models.json` (pi's documented
 * custom-model file) at gateway startup. Missing ids are appended; existing
 * entries (including user overrides) are never replaced. Invalid JSON is left
 * untouched and reported, never overwritten.
 */
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export type PiModelSpec = {
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
};

export const XIAOMI_V26_MODELS: PiModelSpec[] = [
  {
    id: 'mimo-v2.6-pro',
    name: 'MiMo-V2.6-Pro',
    reasoning: false,
    input: ['text', 'image'],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: { input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 },
  },
  {
    id: 'mimo-v2.6-flash',
    name: 'MiMo-V2.6-Flash',
    reasoning: false,
    input: ['text', 'image'],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: { input: 0.1, output: 0.3, cacheRead: 0.01, cacheWrite: 0 },
  },
];

export type EnsurePiModelsResult =
  | { ok: true; action: 'created' | 'updated' | 'unchanged'; path: string }
  | { ok: false; reason: 'invalid-json' | 'io'; path: string };

export function defaultPiModelsPath(): string {
  return process.env.MAFW_PI_MODELS_PATH || path.join(os.homedir(), '.pi', 'agent', 'models.json');
}

export async function ensurePiModels(opts: {
  modelsPath?: string;
  provider?: string;
  models?: PiModelSpec[];
} = {}): Promise<EnsurePiModelsResult> {
  const target = opts.modelsPath ?? defaultPiModelsPath();
  const providerId = opts.provider ?? 'xiaomi';
  const wanted = opts.models ?? XIAOMI_V26_MODELS;

  let root: any;
  let existed = false;
  try {
    const raw = await fs.readFile(target, 'utf8');
    existed = true;
    try {
      // Editors/PowerShell often write UTF-8 with BOM; JSON.parse rejects it.
      root = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch {
      return { ok: false, reason: 'invalid-json', path: target };
    }
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
      return { ok: false, reason: 'invalid-json', path: target };
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') return { ok: false, reason: 'io', path: target };
    root = {};
  }

  if (!root.providers || typeof root.providers !== 'object' || Array.isArray(root.providers)) {
    root.providers = {};
  }
  const provider = root.providers[providerId];
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    root.providers[providerId] = {};
  }
  const targetProvider = root.providers[providerId];
  if (!Array.isArray(targetProvider.models)) targetProvider.models = [];

  let added = 0;
  for (const model of wanted) {
    if (targetProvider.models.some((existing: any) => existing?.id === model.id)) continue;
    targetProvider.models.push(model);
    added += 1;
  }

  if (added === 0) return { ok: true, action: 'unchanged', path: target };

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(root, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, target);
    return { ok: true, action: existed ? 'updated' : 'created', path: target };
  } catch {
    return { ok: false, reason: 'io', path: target };
  }
}
