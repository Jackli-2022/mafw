import type { VoiceConfig } from './config';
import type { VoiceRouting } from './transport/protocol';

/**
 * Honest v1 routing projection.
 *
 * Plan 1 only ever runs locally, so the reported status comes from the
 * configured local tier instead of a hardcoded optimistic value. A dgpu box
 * runs the accelerated local path; an igpu box runs local CPU. Cloud is not
 * reachable in v1 and therefore never reported here.
 */
export function routingForConfig(config: Pick<VoiceConfig, 'localTier'>): VoiceRouting {
  return { status: config.localTier === 'dgpu' ? 'local_accelerated' : 'local_cpu' };
}
