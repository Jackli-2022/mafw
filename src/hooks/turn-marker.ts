// Host-side mirror of the desktop turn marker. The runtime may concatenate the
// synthetic part's text into the user message, so the key is read from either
// the part id or the `[[turn:<key>]]` sentinel. This module stays local to the
// standalone host plugin.

export const TURN_MARKER_PREFIX = 'turn_'

const MARKER_RE = /\[\[turn:(turn_[A-Za-z0-9_-]+)\]\]/

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
