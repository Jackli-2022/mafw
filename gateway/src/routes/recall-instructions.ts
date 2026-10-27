/**
 * T2-4 fallback surface: the opencode plugin and the pi host extension ask the
 * gateway which of the three instruction blocks are actually missing from the
 * session's opencode entries. `managed:true` means all desired entries are
 * present; `blocks` then carries only the missing ones (never a duplicate of an
 * existing entry). No instructions API / list failure / breaker / disabled
 * config returns the full block set for the legacy injection path.
 */
import * as http from 'http';
import { INSTRUCTION_KEYS, MEMORY_GUIDE, type InstructionBlocks } from '../recall/instruction-blocks';
import type { InstructionInspectResult, InstructionSyncService } from '../core/instructions/instruction-sync-service';

export interface RecallInstructionsDeps {
  getBlocks(): Promise<InstructionBlocks>;
  getSync(): Pick<InstructionSyncService, 'inspect'> | null;
}

export interface RecallInstructionsResponse {
  managed: boolean;
  revision: string;
  missing: string[];
  staleKeys: string[];
  erroredKeys: string[];
  reason?: string;
  blocks: Partial<Pick<InstructionBlocks, 'memoryGuide' | 'userProfile' | 'agentPriors'>>;
}

const FIELD_BY_KEY: Record<string, 'memoryGuide' | 'userProfile' | 'agentPriors'> = {
  [INSTRUCTION_KEYS.memoryGuide]: 'memoryGuide',
  [INSTRUCTION_KEYS.userProfile]: 'userProfile',
  [INSTRUCTION_KEYS.agentPriors]: 'agentPriors',
};

const ALL_KEYS = [
  INSTRUCTION_KEYS.memoryGuide,
  INSTRUCTION_KEYS.userProfile,
  INSTRUCTION_KEYS.agentPriors,
];

export function buildRecallInstructionsResponse(
  blocks: InstructionBlocks,
  inspected: InstructionInspectResult | null,
): RecallInstructionsResponse {
  const managed = inspected?.managed === true;
  const missing = inspected?.missing ?? ALL_KEYS;
  const out: RecallInstructionsResponse = {
    managed,
    revision: blocks.revision,
    missing,
    staleKeys: inspected?.staleKeys ?? [],
    erroredKeys: inspected?.erroredKeys ?? [],
    ...(inspected?.reason ? { reason: inspected.reason } : {}),
    blocks: {},
  };
  if (managed) return out;

  for (const key of missing) {
    const field = FIELD_BY_KEY[key];
    if (!field) continue;
    const value = blocks[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      out.blocks[field] = value;
    }
  }
  return out;
}

export async function handleRecallInstructions(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: RecallInstructionsDeps,
): Promise<boolean> {
  if (req.method !== 'GET' || !url.startsWith('/api/recall/instructions')) return false;

  let body: RecallInstructionsResponse;
  try {
    const blocks = await deps.getBlocks();
    const sessionID = new URL(url, 'http://localhost').searchParams.get('sessionID') || '';
    const sync = deps.getSync();
    const inspected = sessionID && sync ? await sync.inspect(sessionID, blocks) : null;
    body = buildRecallInstructionsResponse(blocks, inspected);
  } catch {
    // Fail-open even if the renderer itself is unavailable: the plugin must
    // still receive the static guide, otherwise a 200 with empty blocks makes
    // it inject nothing (a fail-closed path).
    body = {
      managed: false,
      revision: '',
      missing: ALL_KEYS,
      staleKeys: [],
      erroredKeys: [],
      reason: 'render_failed',
      blocks: { memoryGuide: MEMORY_GUIDE },
    };
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
  return true;
}
