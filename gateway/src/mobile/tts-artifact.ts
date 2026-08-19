/**
 * Mobile TTS artifact playback — token-authed alternative to the
 * loopback-only GET /a2a/artifacts/:id for synthesized TTS audio.
 *
 * Endpoint:
 *   GET /api/mobile/tts/artifacts/:id — stream artifact bytes
 *
 * Security:
 *   - Auth handled by gateway's authorize() middleware (Bearer/x-api-token/?token=;
 *     loopback passes) — /a2a/artifacts stays loopback-only (AGENTS.md §5.14)
 *   - Only serves bytes from the in-process ArtifactStore (no URL fetch, no SSRF)
 */

import * as http from 'http';
import { MediaAgent } from '../media/media-agent';

/** Dependencies injected for testability. */
export interface TtsArtifactDeps {
  agent: MediaAgent;
}

/**
 * Creates a request handler for the mobile TTS artifact route.
 * Returns true if the request was handled, false if not matched.
 */
export function createTtsArtifactHandler(deps: TtsArtifactDeps) {
  const { agent } = deps;

  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> => {
    const match = req.url?.match(/^\/api\/mobile\/tts\/artifacts\/([^/?]+)(?:\?|$)/);
    if (!match || req.method !== 'GET') return false;

    try {
      const artifact = agent.getArtifact(match[1]);
      if (!artifact) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'artifact not found' }));
        return true;
      }
      const b64 = artifact.dataUrl.split(',')[1] || '';
      res.writeHead(200, { 'Content-Type': artifact.mediaType });
      res.end(Buffer.from(b64, 'base64'));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
    return true;
  };
}
