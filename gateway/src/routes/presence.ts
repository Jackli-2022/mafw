// gateway/src/routes/presence.ts
// Thin HTTP shell over the presence projection: the handler returns
// { status, body } so it stays unit-testable without a ServerResponse.
import type { PodPresence } from '../core/pod/pod-presence';

export interface PresenceDeps {
  list(): PodPresence | Promise<PodPresence>;
}

export async function handlePresence(deps: PresenceDeps): Promise<{ status: number; body: unknown }> {
  try {
    return { status: 200, body: await deps.list() };
  } catch (err: any) {
    return { status: 500, body: { error: err?.message ?? 'presence failed' } };
  }
}
