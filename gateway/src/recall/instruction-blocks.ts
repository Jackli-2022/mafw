/**
 * T2-4: the three MAFW system blocks that move from per-turn system injection
 * to opencode 2.1 per-session instruction entries.
 *
 * One renderer, two consumers: the gateway prompt-time sync writes the values;
 * the fallback endpoint returns the same values for pi / older runtimes /
 * plugin fallback. `MEMORY_GUIDE` stays owned by host-adapter (cognitive
 * contract) and is re-exported here so plugin/pi call sites can use one module.
 */
import { createHash } from 'crypto';
import { MEMORY_GUIDE } from '../runtime/host-adapter';

export { MEMORY_GUIDE };

export const INSTRUCTION_KEYS = {
  memoryGuide: 'mafw.memory-guide',
  userProfile: 'mafw.user-profile',
  agentPriors: 'mafw.agent-priors',
} as const;

export type InstructionKey = (typeof INSTRUCTION_KEYS)[keyof typeof INSTRUCTION_KEYS];

export interface InstructionBlocks {
  memoryGuide: string;
  userProfile: string | null;
  agentPriors: string | null;
  /**
   * Per-block render errors. `null` without an entry here means "genuinely
   * empty" (delete the entry); `null` with an error means "unknown, keep the
   * previous entry" so a transient read failure cannot erase the disclosure
   * layer.
   */
  errors?: { userProfile?: string; agentPriors?: string };
  revision: string;
}

export interface InstructionBlockDeps {
  getPinnedProfile(): Promise<string | null>;
  getAgentPriors(): Promise<string | null>;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalize(value: string | null): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export async function renderInstructionBlocks(deps: InstructionBlockDeps): Promise<InstructionBlocks> {
  let userProfile: string | null = null;
  let agentPriors: string | null = null;
  const errors: { userProfile?: string; agentPriors?: string } = {};

  try {
    userProfile = normalize(await deps.getPinnedProfile());
  } catch (err) {
    errors.userProfile = messageOf(err);
  }
  try {
    agentPriors = normalize(await deps.getAgentPriors());
  } catch (err) {
    errors.agentPriors = messageOf(err);
  }

  const revision = createHash('sha256')
    .update(JSON.stringify({ memoryGuide: MEMORY_GUIDE, userProfile, agentPriors }))
    .digest('hex');

  return {
    memoryGuide: MEMORY_GUIDE,
    userProfile,
    agentPriors,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
    revision,
  };
}
