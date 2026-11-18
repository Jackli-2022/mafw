// Hidden turn marker: a synthetic text part carried with every user send.
// The runtime may persist it by concatenating its text into the user message,
// so both the part id and the `[[turn:<key>]]` sentinel are read. The gateway
// recall hook uses the key as the receipt anchor; the renderer strips it.

export const TURN_MARKER_PREFIX = 'turn_'

const MARKER_RE = /\[\[turn:(turn_[A-Za-z0-9_-]+)\]\]/

export interface TurnMarkerPart {
  type: 'text'
  id: string
  text: string
  synthetic: true
}

export function composeTurnMarkerPart(_ts: number, uuid: string): TurnMarkerPart {
  const key = `${TURN_MARKER_PREFIX}${uuid}`
  return {
    type: 'text',
    id: key,
    text: `[[turn:${key}]]`,
    synthetic: true,
  }
}

type MarkerPartLike = {
  id?: string
  type?: string
  text?: string
  synthetic?: boolean
}

export function extractTurnMarkerKey(parts: MarkerPartLike[] | undefined | null): string | null {
  if (!Array.isArray(parts)) return null
  for (const part of parts) {
    if (part?.type !== 'text') continue
    if (part.synthetic === true && typeof part.id === 'string' && part.id.startsWith(TURN_MARKER_PREFIX)) {
      return part.id
    }
    if (typeof part.text === 'string') {
      const hit = MARKER_RE.exec(part.text)
      if (hit?.[1]) return hit[1]
    }
  }
  return null
}

export function stripTurnMarker(text: string): string {
  return text.replace(/\[\[turn:turn_[A-Za-z0-9_-]+\]\]/g, '')
}
