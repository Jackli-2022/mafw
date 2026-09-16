/** media 引擎解析（deps 注入可单测）。用户引擎可同名覆盖内置 pi。 */
import { log } from '../core/utils/logger';
import type { PromptFn } from './media-service';
import type { MediaEngine } from './media-plugin-loader';

export interface ResolveMediaPromptDeps {
  engines: Map<string, MediaEngine>;
  /** 内置 pi 路径：pi runtime 激活时返回 executor.prompt，否则 undefined（调用方回退默认 adapter）。 */
  builtinPi: () => PromptFn | undefined;
}

export function resolveMediaPrompt(engineName: string, kind: string, deps: ResolveMediaPromptDeps): PromptFn | undefined {
  const engine = deps.engines.get(engineName);
  if (!engine) {
    if (engineName !== 'pi') log.warn(`[MediaService] engine '${engineName}' not found, falling back to pi`);
    return deps.builtinPi();
  }
  if (engine.builtin) return deps.builtinPi();
  if (!engine.modalities.includes(kind)) {
    log.warn(`[MediaService] engine '${engineName}' does not support modality '${kind}', falling back to pi`);
    return deps.builtinPi();
  }
  return engine.prompt;
}
