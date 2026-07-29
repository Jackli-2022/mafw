import { HarmonicIndexManager } from '../core/memory/harmonic-index';
import { ParametricStore } from '../core/memory/store';
import { DeltaInjector } from '../core/memory/injector';

export interface MemoryFact {
  source: 'parametric' | 'harmonic';
  type: string;
  content: string;
  energy: number;
}

export interface InjectorOptions {
  search: (query: string, maxFacts: number) => Promise<MemoryFact[]>;
  enabled?: boolean;
  maxFacts?: number;
  maxTokens?: number;
}

/**
 * Wraps a promptAsync-style function with automatic memory injection.
 * Injects `<mafw-deltas>` and `<mafw-facts>` blocks before the user message.
 * The wrapped function has the exact same signature as the original.
 */
export function withMemoryInjection<T extends (sessionID: string, message: string, ...rest: any[]) => Promise<any>>(
  fn: T,
  opts: InjectorOptions,
): T {
  if (!opts.enabled) return fn;

  const maxFacts = opts.maxFacts ?? 5;
  const maxTokens = opts.maxTokens ?? 500;

  const wrapped = async (sessionID: string, message: string, ...rest: any[]) => {
    const results = await opts.search(message, maxFacts);
    if (results.length === 0) return fn(sessionID, message, ...rest);

    const deltas: string[] = [];
    const facts: string[] = [];
    let totalChars = 0;

    for (const r of results) {
      const line = r.source === 'parametric'
        ? `[Î” ${r.type}] ${r.content}`
        : `â€?[${r.type}] ${r.content}`;
      if (totalChars + line.length > maxTokens) break;
      (r.source === 'parametric' ? deltas : facts).push(line);
      totalChars += line.length;
    }

    const chunks: string[] = [];
    if (deltas.length) chunks.push('<mafw-deltas>\n' + deltas.join('\n') + '\n</mafw-deltas>');
    if (facts.length) chunks.push('<mafw-facts>\n' + facts.join('\n') + '\n</mafw-facts>');
    if (chunks.length === 0) return fn(sessionID, message, ...rest);

    const augmented = chunks.join('\n\n') + '\n\n' + message;
    return fn(sessionID, augmented, ...rest);
  };

  return wrapped as any;
}

/**
 * Builds the search function that merges L3 parametric deltas + Harmonic Index results.
 */
export function createMemorySearch(
  parametricStore?: ParametricStore,
  deltaInjector?: DeltaInjector,
  harmonicIndex?: HarmonicIndexManager,
): (query: string, maxFacts: number) => Promise<MemoryFact[]> {
  return async (query: string, maxFacts: number) => {
    const results: MemoryFact[] = [];

    if (parametricStore && deltaInjector) {
      try {
        const deltas = parametricStore.match({ loopStage: 'executing' });
        if (deltas.length > 0) {
          const injection = deltaInjector.inject(deltas);
          const rendered = deltaInjector.render(injection);
          for (const line of rendered.split('\n').filter(Boolean)) {
            results.push({ source: 'parametric', type: 'delta', content: line, energy: 0.8 });
          }
        }
      } catch {
        // non-fatal
      }
    }

    if (harmonicIndex) {
      try {
        const entries = harmonicIndex.search(query, maxFacts);
        for (const e of entries) {
          results.push({
            source: 'harmonic',
            type: e.type,
            content: e.primary_abstraction,
            energy: e.energy,
          });
        }
      } catch {
        // non-fatal
      }
    }

    results.sort((a, b) => b.energy - a.energy);
    return results.slice(0, maxFacts);
  };
}
