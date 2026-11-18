// Hidden turn marker: a synthetic text part carried with every user send.
// The gateway recall hook reads the id (`turn_<uuid>`) as the receipt anchor,
// so live and historical receipts can attach to the same turn without relying
// on the runtime's user-message id.

export const TURN_MARKER_PREFIX = 'turn_'

export interface TurnMarkerPart {
  type: 'text'
  id: string
  text: string
  synthetic: true
}

export function composeTurnMarkerPart(_ts: number, uuid: string): TurnMarkerPart {
  return {
    type: 'text',
    id: `${TURN_MARKER_PREFIX}${uuid}`,
    text: '[[turn]]',
    synthetic: true,
  }
}

type MarkerPartLike = {
  id?: string
  type?: string
  synthetic?: boolean
}

export function extractTurnMarkerKey(parts: MarkerPartLike[] | undefined | null): string | null {
  if (!Array.isArray(parts)) return null
  for (const part of parts) {
    if (
      part?.type === 'text'
      && part.synthetic === true
      && typeof part.id === 'string'
      && part.id.startsWith(TURN_MARKER_PREFIX)
    ) {
      return part.id
    }
  }
  return null
}
