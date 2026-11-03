export type LeadCandidateSource = 'slot' | 'pod';

export interface LeadCandidate {
  sessionId: string;
  source: LeadCandidateSource;
}

export type LeadResolution =
  | { action: 'reuse'; sessionId: string; source: LeadCandidateSource }
  | { action: 'create' }
  | { action: 'conflict'; reason: 'ambiguous_slot_keys' };

/**
 * Choose the single current Lead session from the two legal evidence sources.
 * A live kv slot wins; otherwise an active Pod coordination session can be
 * adopted. Ambiguous slot keys without a Pod winner must never create a second
 * Lead. History-based fallbacks are intentionally absent.
 */
export function resolveLeadCandidate(input: {
  slot: LeadCandidate | null;
  pod: LeadCandidate | null;
  slotKeyConflict?: boolean;
}): LeadResolution {
  if (input.slot) {
    return {
      action: 'reuse',
      sessionId: input.slot.sessionId,
      source: input.slot.source,
    };
  }
  if (input.pod) {
    return {
      action: 'reuse',
      sessionId: input.pod.sessionId,
      source: input.pod.source,
    };
  }
  if (input.slotKeyConflict) {
    return { action: 'conflict', reason: 'ambiguous_slot_keys' };
  }
  return { action: 'create' };
}

/** Pod-less registered projects do not need a hidden Lead with no entry point. */
export function shouldEnsureLeadOnStartup(input: {
  hasPod: boolean;
  hasInFlightGoal: boolean;
}): boolean {
  return input.hasPod || input.hasInFlightGoal;
}
