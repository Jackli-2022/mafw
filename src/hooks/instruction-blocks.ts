// T2-4 fallback for the opencode plugin: ask the gateway which of the three
// instruction blocks are actually missing from this session's instruction
// entries. Only missing blocks are appended to event.system; managed sessions
// carry the blocks in the native instruction snapshot and need no injection.
//
// Failure policy:
// - 5s fresh cache per session (the context hook runs per LLM step).
// - 10min last-good cache: managed=true -> inject nothing, managed=false ->
//   inject the last known missing blocks.
// - no cache at all -> bundled <memory-guide> only; never throw.

import { memoryGuideHook } from './memory-guide'

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000'
const INSTRUCTIONS_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/recall/instructions`
const CACHE_TTL_MS = 5_000
const LAST_GOOD_TTL_MS = 10 * 60 * 1000

interface InstructionBlocks {
  memoryGuide?: string | null
  userProfile?: string | null
  agentPriors?: string | null
}

interface Record {
  at: number
  managed: boolean
  blocks: InstructionBlocks
}

const records = new Map<string, Record>()

function appendBlocks(output: { system?: string[] }, blocks: InstructionBlocks | undefined): void {
  if (!blocks) return
  if (!output.system) output.system = []
  for (const value of [blocks.memoryGuide, blocks.userProfile, blocks.agentPriors]) {
    if (typeof value === 'string' && value.trim().length > 0) output.system.push(value)
  }
}

export async function instructionBlocksSystemHook(
  input: { sessionID?: string },
  output: { system?: string[] },
): Promise<any> {
  const sessionID = input?.sessionID
  if (!sessionID) return output

  const now = Date.now()
  const cached = records.get(sessionID)
  if (cached && now - cached.at < CACHE_TTL_MS) {
    if (!cached.managed) appendBlocks(output, cached.blocks)
    return output
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 200)
    const res = await fetch(`${INSTRUCTIONS_URL}?sessionID=${encodeURIComponent(sessionID)}`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as any
    const record: Record = {
      at: now,
      managed: body?.managed === true,
      blocks: body?.blocks ?? {},
    }
    records.set(sessionID, record)
    if (!record.managed) appendBlocks(output, record.blocks)
    return output
  } catch {
    if (cached && now - cached.at <= LAST_GOOD_TTL_MS) {
      if (!cached.managed) appendBlocks(output, cached.blocks)
      return output
    }
    // No gateway data at all: keep the legacy static guide. Profile/priors
    // cannot be known without the gateway, so they are omitted.
    memoryGuideHook({}, output)
    return output
  }
}
