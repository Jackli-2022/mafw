import type { RuntimeChannels } from '@mafw/runtime-contract';
import type { ClaudeSdk } from './runtime.ts';
import { normalizeClaudeHistory } from './history.ts';

export function createClaudeChannels(sdk: ClaudeSdk): RuntimeChannels {
  return {
    messages: {
      list: async (sessionID) => ({ data: normalizeClaudeHistory(await sdk.getSessionMessages(sessionID)) }),
      normalize: normalizeClaudeHistory,
    },
    session: {
      list: async () => {
        const raw = await sdk.listSessions();
        return (Array.isArray(raw) ? raw : []).map((x: any) => ({
          id: x?.id ?? x?.sessionId,
          title: x?.title ?? x?.name ?? 'claude session',
          directory: x?.cwd ?? '',
          time: {
            created: x?.createdAt ? Date.parse(String(x.createdAt)) : 0,
            updated: x?.updatedAt ? Date.parse(String(x.updatedAt)) : 0,
          },
        }));
      },
      get: async (sessionID) => ({ id: sessionID, messages: normalizeClaudeHistory(await sdk.getSessionMessages(sessionID)) }),
      delete: async () => { /* the SDK has no delete primitive in this adapter */ },
    },
  };
}
