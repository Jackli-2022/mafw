// Observation capture client (plugin side). Pushes user/tool/assistant/
// reasoning observations to the gateway's T1 SQLite store via HTTP.
// Fail-open: gateway unreachable → observation silently dropped (never throw
// into the hook pipeline).

export type ObservationSource = 'user_input' | 'assistant_reply' | 'tool_result' | 'reasoning';

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const CAPTURE_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/obs/capture`;
const MAX_CONTENT = 100_000;

export async function pushObservation(
  sessionID: string,
  source: ObservationSource,
  content: string,
  failure = false,
): Promise<void> {
  if (!sessionID || !content || !content.trim()) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(CAPTURE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionID, source, content: content.slice(0, MAX_CONTENT), failure }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // fail-open
  }
}

/** Extract plain text from an opencode message parts array. */
export function extractTextFromParts(parts: any[] | undefined | null): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p: any) => p?.type === 'text' && typeof p?.text === 'string')
    .map((p: any) => p.text)
    .join('\n');
}

/** Tool failure signal from the event stream (session.next.tool.failed). */
export function toolFailureText(props: any): string {
  const tool = props?.tool || '';
  const err = props?.error;
  const message =
    typeof err === 'string'
      ? err
      : err?.message || (err && Object.keys(err).length > 0 ? JSON.stringify(err) : 'tool failed');
  return tool ? `[${tool}] ${message}` : message;
}
