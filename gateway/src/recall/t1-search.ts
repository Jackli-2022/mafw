import type { GatewayDatabase } from '../memory/gateway-db';
import type { EmbeddingRuntime } from '../memory/embedding-runtime';
import { getEmbeddingRuntime } from '../memory/embedding-runtime';
import { makeT1Search, T1Hit } from './verbatim-recall';

/**
 * Shared gateway T1 dense search. Resolves the embedding runtime lazily so a
 * hot-swapped embedding engine cannot leave a stale provider wired here.
 * Archive rows are preferred; active rows are the fallback for turns that have
 * not been archived yet. Fail-open to an empty hit list.
 */
export function createGatewayT1Search(
  db: GatewayDatabase,
  getRuntime: () => EmbeddingRuntime | null = getEmbeddingRuntime,
): (query: string, k: number) => Promise<T1Hit[]> {
  return async (query: string, k: number): Promise<T1Hit[]> => {
    try {
      const runtime = getRuntime();
      if (!runtime?.t1Vectors) return [];
      return await makeT1Search({
        runtime,
        fetchRows: (sessionId, turnId) => {
          const archived = db.readArchiveTurn(sessionId, turnId);
          return archived.length ? archived : db.readTurn(sessionId, turnId);
        },
      })(query, k);
    } catch {
      return [];
    }
  };
}
