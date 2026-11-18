// Host-side mirror of the desktop turn marker. The host plugin is a standalone
// opencode plugin, so it keeps this tiny extractor local rather than importing
// renderer code.

export const TURN_MARKER_PREFIX = 'turn_'

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
