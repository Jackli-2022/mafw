/**
 * Mobile media proxy — exposes MediaAgent capabilities to the mobile app
 * via simple HTTP endpoints (no A2A protocol knowledge needed on the client).
 *
 * Endpoints:
 *   POST /api/mobile/media/tasks        — multipart upload → A2A SendMessage → task
 *   POST /api/mobile/media/tasks/:id/ask — follow-up question (auth proxy)
 *
 * Security:
 *   - Loopback-only (same as /a2a)
 *   - Reuses MediaAgent's MAX_*_BYTES limits per media type
 *   - Blocks external URLs (only artifact URLs accepted by MediaAgent)
 */

import * as http from 'http';
import { MediaAgent } from '../media/media-agent';
import { isLoopbackAddr } from './auth-helpers';

/** Dependencies injected for testability. */
export interface MobileMediaDeps {
  agent: MediaAgent;
  /** API token for non-loopback auth (empty = loopback-only). */
  apiToken: string;
}

// Reuse the same size caps as MediaAgent (media-agent.ts lines 165-167).
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function maxSizeForType(mediaType: string): number {
  if (mediaType.startsWith('video/')) return MAX_VIDEO_BYTES;
  if (mediaType.startsWith('audio/')) return MAX_AUDIO_BYTES;
  return MAX_IMAGE_BYTES;
}

const SUPPORTED_MEDIA_PREFIXES = ['image/', 'video/', 'audio/'];

interface MultipartFile {
  name: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

/**
 * Parse a multipart/form-data body. Returns the first file part.
 * Minimal parser — sufficient for single-file uploads from the mobile app.
 */
function parseMultipartFirstFile(raw: Buffer, boundary: string): MultipartFile | null {
  const sections = raw.toString('latin1').split(`--${boundary}`);
  for (const section of sections) {
    if (section.trim() === '' || section.trim() === '--') continue;
    const headerEnd = section.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headerPart = section.slice(0, headerEnd);
    const bodyPart = section.slice(headerEnd + 4);
    const bodyClean = bodyPart.replace(/\r\n$/, '');

    const nameMatch = headerPart.match(/name="([^"]+)"/);
    const filenameMatch = headerPart.match(/filename="([^"]+)"/);
    const ctMatch = headerPart.match(/Content-Type:\s*(.+)/i);

    if (filenameMatch && nameMatch) {
      return {
        name: nameMatch[1],
        filename: filenameMatch[1],
        contentType: ctMatch?.[1]?.trim() || 'application/octet-stream',
        data: Buffer.from(bodyClean, 'latin1'),
      };
    }
  }
  return null;
}

/**
 * Read the full request body as a Buffer.
 */
function readBodyBuffer(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Read the full request body as a string.
 */
function readBodyString(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function jsonResponse(res: http.ServerResponse, status: number, data: Record<string, unknown>) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Creates a request handler for the mobile media proxy routes.
 * Returns true if the request was handled, false if not matched.
 */
export function createMobileMediaHandler(deps: MobileMediaDeps) {
  const { agent } = deps;

  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> => {
    const addr = req.socket?.remoteAddress || '';
    const isLoopback = isLoopbackAddr(addr);

    // ── POST /api/mobile/media/tasks — multipart upload → A2A task ──
    if (req.url === '/api/mobile/media/tasks' && req.method === 'POST') {
      if (!isLoopback) {
        jsonResponse(res, 403, { error: 'forbidden' });
        return true;
      }

      // Must be multipart
      const contentTypeHeader = req.headers['content-type'] || '';
      if (!contentTypeHeader.includes('multipart/form-data')) {
        jsonResponse(res, 400, { error: 'Content-Type must be multipart/form-data' });
        return true;
      }

      const boundaryMatch = contentTypeHeader.match(/boundary=(.+)/);
      if (!boundaryMatch) {
        jsonResponse(res, 400, { error: 'missing multipart boundary' });
        return true;
      }
      const boundary = boundaryMatch[1];

      try {
        const raw = await readBodyBuffer(req);
        const file = parseMultipartFirstFile(raw, boundary);
        if (!file) {
          jsonResponse(res, 400, { error: 'no file part in multipart body' });
          return true;
        }

        // Validate media type
        if (!SUPPORTED_MEDIA_PREFIXES.some(p => file.contentType.startsWith(p))) {
          jsonResponse(res, 415, { error: `Unsupported media type: ${file.contentType}` });
          return true;
        }

        // Validate size
        const maxBytes = maxSizeForType(file.contentType);
        if (file.data.length > maxBytes) {
          jsonResponse(res, 413, {
            error: `Media exceeds ${(maxBytes / (1024 * 1024)).toFixed(0)}MB limit`,
          });
          return true;
        }

        // Store artifact
        const artifactId = agent.putArtifactBytes(file.data, file.contentType);
        const port = (req.socket?.localPort as number) || 3000;
        const baseUrl = `http://127.0.0.1:${port}`;

        // Create A2A task via SendMessage
        const payload = {
          jsonrpc: '2.0',
          id: 1,
          method: 'SendMessage',
          params: {
            message: {
              messageId: `mob-${Date.now()}`,
              role: 1,
              parts: [
                { url: `/a2a/artifacts/${artifactId}`, mediaType: file.contentType, filename: file.filename },
              ],
            },
          },
        };
        const result = await agent.handleJsonRpc(payload, { 'a2a-version': '1.0' });
        const parsed = JSON.parse(result.body);
        if (parsed?.error) {
          jsonResponse(res, result.status || 502, { error: parsed.error });
          return true;
        }
        const task = parsed?.result?.task;
        if (!task?.id) {
          jsonResponse(res, 502, { error: 'no task returned' });
          return true;
        }
        jsonResponse(res, 200, {
          id: task.id,
          contextId: task.contextId,
          state: task.status?.state || '',
          artifactId,
        });
        return true;
      } catch (err: any) {
        jsonResponse(res, 500, { error: err?.message || String(err) });
        return true;
      }
    }

    // ── POST /api/mobile/media/tasks/:id/ask — follow-up question ──
    const askMatch = req.url?.match(/^\/api\/mobile\/media\/tasks\/([^/]+)\/ask$/);
    if (askMatch && req.method === 'POST') {
      if (!isLoopback) {
        jsonResponse(res, 403, { error: 'forbidden' });
        return true;
      }

      const taskId = askMatch[1];
      try {
        const bodyStr = await readBodyString(req);
        const { question } = JSON.parse(bodyStr);
        if (!question || typeof question !== 'string' || !question.trim()) {
          jsonResponse(res, 400, { error: 'question is required' });
          return true;
        }

        // Delegate to A2A SendMessage with referenceTaskIds
        const payload = {
          jsonrpc: '2.0',
          id: 2,
          method: 'SendMessage',
          params: {
            message: {
              messageId: `mob-ask-${Date.now()}`,
              role: 1,
              parts: [{ text: question }],
              referenceTaskIds: [taskId],
            },
          },
        };
        const result = await agent.handleJsonRpc(payload, { 'a2a-version': '1.0' });
        const parsed = JSON.parse(result.body);
        if (parsed?.error) {
          jsonResponse(res, result.status || 502, { error: parsed.error });
          return true;
        }
        const task = parsed?.result?.task;
        const answer = task?.status?.message?.parts?.[0]?.text || '';
        jsonResponse(res, 200, { answer, taskId: task?.id });
        return true;
      } catch (err: any) {
        jsonResponse(res, 500, { error: err?.message || String(err) });
        return true;
      }
    }

    return false; // Not handled
  };
}
