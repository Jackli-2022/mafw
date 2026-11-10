/**
 * Skill v1 6B: trusted runtime activation detection.
 *
 * Only a runtime `tool.call` whose tool is literally `skill` counts. Listing,
 * searching or reading SKILL.md never reaches this module. A successful tool
 * result is NOT success — it only means the skill content loaded.
 */
export interface SkillInvocationFacets {
  type?: string;
  sessionID?: string;
  properties?: any;
}

export interface SkillInvocationRecord {
  skillName: string;
  callId: string;
  sessionId?: string;
}

export interface SkillInvocationStore {
  recordSkillInvocation(record: SkillInvocationRecord): boolean;
  markSkillInvocationFailed(callId: string): boolean;
}

function clean(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function extractSkillInvocation(facets: SkillInvocationFacets): SkillInvocationRecord | null {
  if (facets?.type !== 'tool.call') return null;
  const props = facets.properties ?? {};
  if (props.tool !== 'skill') return null;
  const input = props.input ?? {};
  const skillName = clean(input.name) || clean(input.skill) || clean(input.id);
  const callId = clean(props.callID);
  if (!skillName || !callId) return null;
  return { skillName, callId, ...(facets.sessionID ? { sessionId: facets.sessionID } : {}) };
}

export function extractFailedSkillCall(facets: SkillInvocationFacets): { callId: string } | null {
  if (facets?.type !== 'tool.result') return null;
  const props = facets.properties ?? {};
  if (props.isError !== true) return null;
  const callId = clean(props.callID);
  return callId ? { callId } : null;
}

/** Fail-open side effect helper shared by the kernel and tests. */
export function observeSkillInvocation(
  store: SkillInvocationStore,
  facets: SkillInvocationFacets,
): 'recorded' | 'failed' | null {
  try {
    const invocation = extractSkillInvocation(facets);
    if (invocation) return store.recordSkillInvocation(invocation) ? 'recorded' : null;
    const failed = extractFailedSkillCall(facets);
    if (failed) return store.markSkillInvocationFailed(failed.callId) ? 'failed' : null;
    return null;
  } catch {
    return null;
  }
}
