/** Shared helpers for runtime drivers that produce flat Mafw message data. */

/** Normalise a tool output value to the string carried by a tool part. */
export function coerceOutput(output: unknown): string {
  if (output === undefined || output === null) return '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output.map((block: any) => (typeof block?.text === 'string' ? block.text : '')).join('');
  }
  try { return JSON.stringify(output); } catch { return String(output); }
}
